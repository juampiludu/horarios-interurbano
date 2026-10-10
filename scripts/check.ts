// Validates every file under data/ and prints a short summary. Exits 1 on any problem.
import { DataError, loadDataset } from "../src/lib/load";

try {
  const ds = loadDataset();
  const trips = ds.routes.reduce(
    (n, r) => n + r.directions.reduce((m, d) => m + d.schedules.reduce((k, s) => k + s.trips.length, 0), 0),
    0,
  );
  console.log(
    `Datos OK: ${ds.routes.length} recorridos, ${trips} viajes, ${Object.keys(ds.stops).length} paradas, ${ds.fares.length} tarifas, ${ds.increases.length} aumentos.`,
  );
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
