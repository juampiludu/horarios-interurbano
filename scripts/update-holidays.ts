// Regenerates data/holidays.yaml from api.argentinadatos.com for the current and next year.
// Bridge days ("puente") are included: companies usually run the holiday schedule on them.
import { writeFileSync } from "node:fs";

const year = new Date().getFullYear();
const dates: string[] = [];
for (const y of [year, year + 1]) {
  const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${y}`);
  if (!res.ok) throw new Error(`No se pudieron obtener los feriados de ${y} (HTTP ${res.status})`);
  const list = (await res.json()) as { fecha: string; nombre: string }[];
  dates.push(...list.map((h) => `  - "${h.fecha}" # ${h.nombre}`));
}
writeFileSync(
  "data/holidays.yaml",
  `# Generado con: npx tsx scripts/update-holidays.ts\nholidays:\n${dates.join("\n")}\n`,
);
console.log(`Feriados actualizados: ${dates.length}`);
