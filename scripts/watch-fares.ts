// Looks for interurban fare news in Córdoba media and extracts prices for our places.
// Usage:
//   npx tsx scripts/watch-fares.ts               → scan sources, report new candidates
//   npx tsx scripts/watch-fares.ts --url <url>   → read specific articles (repeatable)
//   add --apply to append the candidates to data/fares.yaml (review the diff before publishing)
// Besides prices from the news, it checks ERSeP for new province-wide increases (fares.yaml → increases).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as cheerio from "cheerio";
import { parse, parseDocument } from "yaml";
import { loadDataset } from "../src/lib/load";

const CONFIG = "data/watch/fares.yaml";
const LOCK = "data/watch/fares.lock.json";
const FARES = "data/fares.yaml";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const FARE_WORDS = /aument|subi|sube|suba|precio|tarifa|cuesta|valor/;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const { values: args } = parseArgs({
  options: { url: { type: "string", multiple: true }, apply: { type: "boolean", default: false } },
});

interface Candidate {
  place: string;
  price: number;
  validFrom: string;
  source: string;
  excerpt: string;
}

const config = parse(readFileSync(CONFIG, "utf8")) as {
  ersep: string;
  sitemaps: { name: string; url: string }[];
  googleNews: string;
  titleMatch: string;
};
const seen = new Set<string>(existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : []);
const ds = loadDataset();

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "es-AR,es;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Article text split in blocks (paragraphs, list items, table rows). */
function articleBlocks($: cheerio.CheerioAPI): string[] {
  $("script,style,nav,footer,aside").remove();
  const blocks = $("p,li,tr,h2,h3")
    .map((_, e) => $(e).clone().children("p,li,tr").remove().end().text().replace(/\s+/g, " ").trim())
    .get()
    .filter((t) => t.length > 0 && t.length < 600);
  return [...new Set(blocks)];
}

/** Effective date ("desde el 30 de septiembre", "a partir del 2 de enero"), else the publication date. */
function effectiveDate(text: string, published: string): string {
  const year = Number(published.slice(0, 4));
  const m = normalize(text).match(/(?:desde|a partir)(?: de)?(?: el| del)?(?: \w+)? (\d{1,2}) de (\w+)/);
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  if (!m || month < 0) return published;
  // An effective date in December reported in January belongs to the previous year.
  const y = month === 11 && published.slice(5, 7) === "01" ? year - 1 : year;
  return `${y}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function extract(blocks: string[], published: string, source: string): Candidate[] {
  const validFrom = effectiveDate(blocks.join(" "), published);
  const out: Candidate[] = [];
  for (const place of ds.places) {
    if (place.id === "cordoba" || place.id.startsWith("cordoba-")) continue;
    const names = [place.name, ...place.aliases].map((n) => escape(normalize(n)));
    const re = new RegExp(`(?:^|[^a-z])(?:${names.join("|")})(?![a-z])[^$\\n]{0,60}?\\$\\s?(\\d{1,3}(?:[.,]\\d{3})+|\\d{3,6})`);
    for (const block of blocks) {
      const m = normalize(block).match(re);
      if (!m) continue;
      out.push({ place: place.id, price: Number(m[1].replace(/[.,]/g, "")), validFrom, source, excerpt: block });
      break;
    }
  }
  return out;
}

/** Publication date (YYYY-MM-DD) from meta tags, JSON-LD or <time>; undefined if the page has none. */
function publishedDate($: cheerio.CheerioAPI, html: string): string | undefined {
  const raw =
    $('meta[property="article:published_time"]').attr("content") ??
    $('meta[itemprop="datePublished"]').attr("content") ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ??
    $("time[datetime]").first().attr("datetime");
  return raw?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

async function readArticle(url: string): Promise<Candidate[] | "undated"> {
  const html = await get(url);
  const $ = cheerio.load(html);
  // Without a date an old article could pass for a current fare, so it is skipped.
  const published = publishedDate($, html);
  if (!published) return "undated";
  return extract(articleBlocks($), published, url);
}

interface IncreaseCandidate {
  validFrom: string;
  percent: number;
  source: string;
}

/** Effective date of an ERSeP increase: "a partir del viernes 2 de Enero" or the Boletín Oficial publication day. */
function ersepDate(text: string, published: string): string | undefined {
  const t = normalize(text);
  const m =
    t.match(/a partir del? (?:dia )?(?:\w+ )?(\d{1,2}) de (\w+)/) ??
    t.match(/boletin oficial[^.]{0,80}?(\d{1,2}) de (\w+)/) ??
    t.match(/desde el (?:dia )?(\d{1,2}) de (\w+)/);
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  if (!m || month < 0) return undefined;
  const year = Number(published.slice(0, 4)) + (month === 0 && published.slice(5, 7) === "12" ? 1 : 0);
  return `${year}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** New increases announced by ERSeP after the last one in fares.yaml. */
async function ersepIncreases(): Promise<IncreaseCandidate[]> {
  const posts = JSON.parse(await get(config.ersep)) as { date: string; link: string; title: { rendered: string }; content: { rendered: string } }[];
  const last = ds.increases.at(-1)?.validFrom ?? "0000";
  const out: IncreaseCandidate[] = [];
  for (const p of posts) {
    if (!/tarifa|modificacion/.test(normalize(p.title.rendered)) || seen.has(p.link)) continue;
    const text = cheerio.load(p.content.rendered).text().replace(/\s+/g, " ");
    const percent = normalize(text).match(/en un (\d{1,2}(?:[.,]\d{1,2})?) ?%/)?.[1];
    const validFrom = ersepDate(text, p.date);
    if (!percent || !validFrom) continue;
    seen.add(p.link);
    if (validFrom <= last) continue;
    out.push({ validFrom, percent: Number(percent.replace(",", ".")), source: p.link });
  }
  return out.filter((c, i) => out.findIndex((o) => o.validFrom === c.validFrom) === i);
}

const report: string[] = [];
const candidates: Candidate[] = [];
let newIncreases: IncreaseCandidate[] = [];
const urls: string[] = args.url ?? [];

if (!urls.length) {
  try {
    newIncreases = await ersepIncreases();
    for (const i of newIncreases) {
      report.push(`- 📈 Aumento del ERSeP: ${i.percent}% desde ${i.validFrom} (${i.source}). Si se aplica en tramos, cargalos por separado.`);
    }
  } catch (e) {
    report.push(`- ⚠️ No se pudo leer el ERSeP (${(e as Error).message}).`);
  }
  for (const s of config.sitemaps) {
    try {
      const $ = cheerio.load(await get(s.url), { xml: true });
      $("url").each((_, u) => {
        const loc = $(u).children("loc").text().trim();
        const title = $(u).find("news\\:title").text().trim();
        if (loc && normalize(title).includes(config.titleMatch) && !seen.has(loc)) urls.push(loc);
      });
    } catch (e) {
      report.push(`- ⚠️ No se pudo leer ${s.name} (${(e as Error).message}).`);
    }
  }
  try {
    const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(config.googleNews)}+when:7d&hl=es-419&gl=AR&ceid=AR:es-419`;
    const $ = cheerio.load(await get(rss), { xml: true });
    $("item").each((_, it) => {
      const title = $(it).children("title").text().trim();
      const link = $(it).children("link").text().trim();
      if (normalize(title).includes(config.titleMatch) && FARE_WORDS.test(normalize(title)) && !seen.has(link)) {
        report.push(`- 📰 ${title} → ${link} (revisar a mano)`);
        seen.add(link);
      }
    });
  } catch (e) {
    report.push(`- ⚠️ No se pudo leer Google News (${(e as Error).message}).`);
  }
}

for (const url of urls) {
  try {
    const found = await readArticle(url);
    if (found === "undated") report.push(`- ⚠️ Nota sin fecha de publicación, se ignora: ${url}`);
    else if (!found.length) report.push(`- Nota sin precios para nuestros destinos: ${url}`);
    else candidates.push(...found);
  } catch (e) {
    report.push(`- ⚠️ No se pudo leer ${url} (${(e as Error).message}).`);
  }
  seen.add(url);
}

const placeName = (id: string) => ds.places.find((p) => p.id === id)!.name;
const isKnown = (c: Candidate) =>
  ds.fares.some((f) => !f.company && f.between.includes(c.place) && f.price === c.price && f.validFrom === c.validFrom);
// One candidate per place: the most recent one.
candidates.sort((a, b) => b.validFrom.localeCompare(a.validFrom));
const latestFares = (place: string) => ds.fares.filter((f) => !f.company && f.between.includes(place)).map((f) => f.validFrom);
const fresh = candidates.filter(
  (c, i) =>
    candidates.findIndex((o) => o.place === c.place) === i &&
    !isKnown(c) &&
    // Never add a fare older than one already loaded.
    latestFares(c.place).every((d) => d <= c.validFrom),
);
for (const c of fresh) {
  report.push(`- 💲 Córdoba ⇄ ${placeName(c.place)}: $${c.price} desde ${c.validFrom} — «${c.excerpt}» (${c.source})`);
}

if (args.apply && (fresh.length || newIncreases.length)) {
  const doc = parseDocument(readFileSync(FARES, "utf8"));
  for (const i of newIncreases) doc.addIn(["increases"], doc.createNode(i, { flow: false }));
  // `fares: []` parses as a flow sequence; switch to block style so each fare gets its own lines.
  const seq = doc.get("fares") as { flow?: boolean } | undefined;
  if (seq) seq.flow = false;
  for (const c of fresh) {
    doc.addIn(["fares"], doc.createNode({ between: ["cordoba", c.place], price: c.price, validFrom: c.validFrom, source: c.source }, { flow: false }));
  }
  writeFileSync(FARES, doc.toString({ lineWidth: 0 }));
  report.push(
    `- ✅ Se agregaron ${fresh.length} tarifa(s) y ${newIncreases.length} aumento(s) a ${FARES}. Corré \`npm run check\` y revisá el diff.`,
  );
}

writeFileSync(LOCK, JSON.stringify([...seen].sort(), null, 2) + "\n");

const changed = fresh.length > 0 || newIncreases.length > 0 || report.some((r) => r.includes("📰"));
console.log(report.length ? `Tarifas del interurbano:\n${report.join("\n")}` : "Tarifas: sin novedades.");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
if (report.length && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.join("\n") + "\n");
