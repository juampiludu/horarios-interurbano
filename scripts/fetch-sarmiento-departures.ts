// Queries Sarmiento's booking system (horarios.gruposarmiento.com.ar) for departures between two localities.
// It only lists some services and only departure times, so it is used for lines missing from the timetable images.
// Usage: npx tsx scripts/fetch-sarmiento-departures.ts <fromId> <toId> <dd/mm/yyyy>...
//   Locality ids come from the "ddlDesde" select (e.g. 1 = Córdoba, 49 = Mendiolaza, 50 = Unquillo).
import * as cheerio from "cheerio";

const URL = "http://horarios.gruposarmiento.com.ar/Horarios.aspx";
const ALL_SERVICES = "3";
const [from, to, ...dates] = process.argv.slice(2);
if (!from || !to || !dates.length) {
  console.error("Uso: npx tsx scripts/fetch-sarmiento-departures.ts <desdeId> <hastaId> <dd/mm/aaaa>...");
  process.exit(1);
}

async function search(date: string) {
  const first = await fetch(URL);
  const cookie = first.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const $ = cheerio.load(await first.text());
  const form = new FormData();
  $("input[type=hidden]").each((_, i) => form.append($(i).attr("name")!, $(i).attr("value") ?? ""));
  form.set("txtFecha", date);
  form.set("ddlDesde", from);
  form.set("ddlHasta", to);
  form.set("ddlServicio", ALL_SERVICES);
  form.set("btnBuscar", "Buscar");
  const res = await fetch(URL, { method: "POST", body: form, headers: { cookie } });
  const $r = cheerio.load(await res.text());
  const header = $r("tr").filter((_, tr) => /Hora/.test($r(tr).text()) && /Ruta/.test($r(tr).text())).first();
  const cols = header.find("th,td").map((_, c) => $r(c).text().trim()).get();
  return header
    .nextAll("tr")
    .map((_, tr) => {
      const cells = $r(tr).find("td").map((_, c) => $r(c).text().replace(/\s+/g, " ").trim()).get();
      return {
        time: cells[cols.indexOf("Hora")],
        route: cells[cols.indexOf("Ruta")],
        service: cells[cols.indexOf("Servicio")],
        price: cells[cols.indexOf("Precio")],
      };
    })
    .get()
    .filter((r) => /^\d{2}:\d{2}$/.test(r.time ?? ""));
}

for (const date of dates) {
  const rows = await search(date);
  console.log(`${date}: ${rows.length ? rows.map((r) => `${r.time} (${r.route}${r.price && r.price !== "$0" ? `, ${r.price}` : ""})`).join(", ") : "sin resultados"}`);
}
