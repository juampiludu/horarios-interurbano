// Detects changes in Sarmiento's timetable images and downloads new ones to sources/sarmiento/.
// The timetables are JPGs inside qrco.de galleries, embedded in the page as JSON ("url"/"name" pairs).
// Usage: npx tsx scripts/watch-sarmiento.ts  →  prints a report in Spanish; sets `changed` for GitHub Actions.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { parse } from "yaml";

const INDEX_URL = "https://www.gruposarmiento.com.ar/horarios/";
const CONFIG = "data/watch/sarmiento.yaml";
const LOCK = "data/watch/sarmiento.lock.json";
const OUT_DIR = "sources/sarmiento";

interface Image {
  name: string;
  url: string;
  sha256: string;
}
type Lock = Record<string, { label: string; images: Image[] }>;

const config = parse(readFileSync(CONFIG, "utf8")) as { lines: { code: string; label: string }[]; keywords: string[] };
const lock: Lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {};

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": "horarios-interurbano (+watch)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return res;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const codeOf = (href: string) => href.match(/qrco\.de\/([A-Za-z0-9]+)/)?.[1];

/** Image entries ("url" followed by "name") embedded in a qrco.de gallery page. */
function galleryImages(html: string): { name: string; url: string }[] {
  const re = /"url":"(https:\\\/\\\/qrcgcustomers[^"]+)","name":"([^"]+)"/g;
  return [...html.matchAll(re)].map((m) => ({
    url: JSON.parse(`"${m[1]}"`).split("?")[0],
    name: JSON.parse(`"${m[2]}"`),
  }));
}

const report: string[] = [];

// 1. Index page: tracked links still there? Any new relevant line?
const $ = cheerio.load(await (await get(INDEX_URL)).text());
const links = $("a[href*='qrco.de']")
  .map((_, a) => ({ code: codeOf($(a).attr("href") ?? ""), label: $(a).text().replace(/\s+/g, " ").trim() }))
  .get()
  .filter((l) => l.code);
const tracked = new Set(config.lines.map((l) => l.code));
for (const line of config.lines) {
  if (!links.some((l) => l.code === line.code)) {
    report.push(`- ⚠️ **${line.label}** (${line.code}) ya no aparece en la página de horarios.`);
  }
}
for (const l of links) {
  if (!tracked.has(l.code!) && config.keywords.some((k) => normalize(l.label).includes(k))) {
    report.push(`- 🆕 Línea nueva relevante: **${l.label}** → https://qrco.de/${l.code} (agregala a ${CONFIG})`);
  }
}

// 2. Each tracked gallery: compare images by URL and content hash.
for (const line of config.lines) {
  let found: { name: string; url: string }[];
  try {
    found = galleryImages(await (await get(`https://qrco.de/${line.code}`)).text());
  } catch (e) {
    report.push(`- ⚠️ **${line.label}**: no se pudo leer la galería (${(e as Error).message}).`);
    continue;
  }
  if (!found.length) {
    report.push(`- ⚠️ **${line.label}**: la galería no tiene imágenes (¿cambió el formato?).`);
    continue;
  }
  const previous = lock[line.code]?.images ?? [];
  const images: Image[] = [];
  for (const img of found) {
    const bytes = Buffer.from(await (await get(img.url)).arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    images.push({ ...img, sha256 });
    if (previous.some((p) => p.sha256 === sha256)) continue;
    const dir = join(OUT_DIR, line.code);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sha256.slice(0, 8)}-${img.name.replace(/[^\w.-]+/g, "_")}`);
    writeFileSync(file, bytes);
    report.push(`- 🔄 **${line.label}**: imagen nueva "${img.name}" → \`${file}\``);
  }
  for (const p of previous) {
    if (!images.some((i) => i.sha256 === p.sha256)) report.push(`- ➖ **${line.label}**: se quitó la imagen "${p.name}".`);
  }
  lock[line.code] = { label: line.label, images };
}

writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");

const changed = report.length > 0;
console.log(changed ? `Cambios en los horarios de Sarmiento:\n${report.join("\n")}` : "Sarmiento: sin cambios.");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
if (changed && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.join("\n") + "\n");
