import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { companiesFile, faresFile, holidaysFile, placesFile, routeFile } from "./schema";
import { UNKNOWN, type Dataset, type Route } from "./dataset";

z.config(z.locales.es());

export class DataError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Hay ${problems.length} problema(s) en los datos:\n` + problems.map((p) => `  • ${p}`).join("\n"));
  }
}

function readYaml<T extends z.ZodType>(
  file: string,
  schema: T,
  problems: string[],
  root: string,
): z.infer<T> | undefined {
  const name = relative(root, file);
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${name}: no se pudo leer el YAML (${(e as Error).message})`);
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${name} → ${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
    }
    return undefined;
  }
  return result.data;
}

function listYaml(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return listYaml(full);
    return /\.ya?ml$/.test(e.name) ? [full] : [];
  });
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Loads and validates every data file under `dataDir`. Throws DataError listing all problems found. */
export function loadDataset(dataDir = "data"): Dataset {
  const problems: string[] = [];
  const root = join(dataDir, "..");

  const placesData = readYaml(join(dataDir, "places.yaml"), placesFile, problems, root);
  const companiesData = readYaml(join(dataDir, "companies.yaml"), companiesFile, problems, root);
  const faresData = readYaml(join(dataDir, "fares.yaml"), faresFile, problems, root);
  const holidaysData = readYaml(join(dataDir, "holidays.yaml"), holidaysFile, problems, root);

  const placeIds = new Set(placesData?.places.map((p) => p.id));
  for (const p of placesData?.places ?? []) {
    if (p.fareAs && !placeIds.has(p.fareAs))
      problems.push(`places.yaml: "${p.id}" usa la tarifa del lugar inexistente "${p.fareAs}"`);
  }
  const stops: Dataset["stops"] = {};
  for (const s of placesData?.stops ?? []) {
    if (stops[s.id]) problems.push(`places.yaml: la parada "${s.id}" está repetida`);
    if (!placeIds.has(s.place))
      problems.push(`places.yaml: la parada "${s.id}" apunta al lugar inexistente "${s.place}"`);
    stops[s.id] = { name: s.name, place: s.place };
  }

  const companies: Dataset["companies"] = {};
  for (const { id, ...rest } of companiesData?.companies ?? []) companies[id] = rest;

  const routes: Route[] = [];
  const routeKeys = new Set<string>();
  for (const file of listYaml(join(dataDir, "routes"))) {
    const name = relative(root, file);
    const r = readYaml(file, routeFile, problems, root);
    if (!r) continue;
    const key = `${r.company}/${r.id}`;
    if (routeKeys.has(key)) problems.push(`${name}: el recorrido "${key}" ya existe en otro archivo`);
    routeKeys.add(key);
    if (!companies[r.company]) problems.push(`${name}: la empresa "${r.company}" no está en companies.yaml`);

    const directions = r.directions.map((d) => {
      d.stops.forEach((s) => {
        if (!stops[s]) problems.push(`${name} → ${d.id}: la parada "${s}" no está en places.yaml`);
      });
      const schedules = d.schedules.map((sch, si) => ({
        days: sch.days,
        trips: sch.trips.map((t, ti) => {
          const trip = Array.isArray(t) ? { times: t } : t;
          const where = `${name} → ${d.id}, horario ${si + 1}, viaje ${ti + 1}`;
          if (trip.times.length !== d.stops.length) {
            problems.push(
              `${where}: tiene ${trip.times.length} horas pero el recorrido tiene ${d.stops.length} paradas`,
            );
          }
          const present = trip.times.filter((x): x is string => x !== null && x !== UNKNOWN);
          const served = trip.times.filter((x) => x !== null).length;
          if (served < 2 || present.length < 1) {
            problems.push(`${where}: necesita al menos dos paradas, y al menos una con hora`);
          }
          for (let i = 1; i < present.length; i++) {
            if (toMinutes(present[i]) < toMinutes(present[i - 1])) {
              problems.push(`${where}: la hora ${present[i]} es anterior a ${present[i - 1]}`);
            }
          }
          return trip;
        }),
      }));
      return { id: d.id, stops: d.stops, schedules };
    });
    routes.push({
      id: r.id,
      company: r.company,
      name: r.name,
      service: r.service,
      validFrom: r.validFrom,
      source: r.source,
      directions,
    });
  }

  for (const f of faresData?.fares ?? []) {
    if (f.company && !companies[f.company])
      problems.push(`fares.yaml: la empresa "${f.company}" no está en companies.yaml`);
    for (const p of f.between)
      if (!placeIds.has(p)) problems.push(`fares.yaml: el lugar "${p}" no está en places.yaml`);
  }

  if (problems.length) throw new DataError(problems);

  return {
    places: placesData!.places,
    stops,
    companies,
    routes,
    fares: faresData!.fares,
    fareRounding: faresData!.rounding,
    increases: [...faresData!.increases].sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
    holidays: holidaysData!.holidays,
  };
}
