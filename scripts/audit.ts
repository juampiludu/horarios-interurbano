// Lists every trip the app offers, as "origin → destination" per company with the number of trips per day type,
// so the whole dataset can be reviewed at a glance (a wrong stop/place shows up as a connection that does not exist).
// Usage: npx tsx scripts/audit.ts [company]
import { loadDataset } from "../src/lib/load";
import { findDepartures } from "../src/lib/query";
import { DAY_TYPES } from "../src/lib/schema";

const ds = loadDataset();
const only = process.argv[2];
const places = ds.places;

for (const [companyId, company] of Object.entries(ds.companies)) {
  if (only && only !== companyId) continue;
  for (const service of ["interurban", "urban"] as const) {
    const label = service === "urban" ? "urbano" : "interurbano";
    const header = `\n${company.name} ${label}  (L-V / Sáb / Dom-Fer)`;
    let printed = false;
    for (const a of places) {
      for (const b of places) {
        const counts = DAY_TYPES.map(
          (day) =>
            findDepartures(ds, a.id, b.id, day).filter((d) => d.company === companyId && d.service === service).length,
        );
        if (!counts.some((n) => n > 0)) continue;
        if (!printed) console.log(header);
        printed = true;
        console.log(`  ${a.name} → ${b.name}: ${counts.join(" / ")}`);
      }
    }
  }
}
