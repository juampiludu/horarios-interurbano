import type { Dataset, Fare } from "./dataset";
import type { DayType } from "./schema";

export interface Departure {
  company: string;
  routeId: string;
  routeName: string;
  fromStop: string;
  toStop: string;
  depart: string;
  /** null when the source does not give arrival times. */
  arrive: string | null;
  note?: string;
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Day type for a calendar date. `date` is YYYY-MM-DD, `weekday` 0 = Sunday. */
export function dayTypeFor(date: string, weekday: number, holidays: string[]): DayType {
  if (weekday === 0 || holidays.includes(date)) return "sunday_holiday";
  if (weekday === 6) return "saturday";
  return "weekday";
}

/** Current date, weekday and minutes since midnight in Córdoba, regardless of the device timezone. */
export function nowInCordoba(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Cordoba",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Places that appear in at least one route, in the order of places.yaml. */
export function servedPlaces(ds: Dataset) {
  const used = new Set(ds.routes.flatMap((r) => r.directions.flatMap((d) => d.stops.map((s) => ds.stops[s].place))));
  return ds.places.filter((p) => used.has(p.id));
}

/** Every trip that goes from `fromPlace` to `toPlace` on the given day type, sorted by departure. */
export function findDepartures(ds: Dataset, fromPlace: string, toPlace: string, dayType: DayType): Departure[] {
  if (fromPlace === toPlace) return [];
  const out: Departure[] = [];
  for (const route of ds.routes) {
    for (const dir of route.directions) {
      const places = dir.stops.map((s) => ds.stops[s].place);
      if (!places.includes(fromPlace) || !places.includes(toPlace)) continue;
      for (const sch of dir.schedules) {
        if (!sch.days.includes(dayType)) continue;
        for (const trip of sch.trips) {
          const i = places.findIndex((p, k) => p === fromPlace && trip.times[k] !== null);
          if (i < 0) continue;
          const j = places.findIndex((p, k) => k > i && p === toPlace && (dir.untimedStopsServed || trip.times[k] !== null));
          if (j < 0) continue;
          out.push({
            company: route.company,
            routeId: route.id,
            routeName: route.name,
            fromStop: dir.stops[i],
            toStop: dir.stops[j],
            depart: trip.times[i]!,
            arrive: trip.times[j],
            note: trip.note,
          });
        }
      }
    }
  }
  const arrival = (d: Departure) => (d.arrive ? toMinutes(d.arrive) : Infinity);
  return out.sort((a, b) => toMinutes(a.depart) - toMinutes(b.depart) || arrival(a) - arrival(b));
}

export interface FareQuote {
  price: number;
  /** True when the price was projected from an older observed fare with the ERSeP increases. */
  estimated: boolean;
  /** The observed fare the quote is based on. */
  base: Fare;
}

/**
 * Fare on `date` for a company between two places (either direction).
 * Starts from the latest observed fare (company-specific wins over generic on the same date) and applies every
 * increase that came into force after it, rounding after each step as companies do.
 */
export function fareFor(ds: Dataset, company: string, a: string, b: string, date: string): FareQuote | undefined {
  const base = ds.fares
    .filter(
      (f) =>
        (f.company === company || !f.company) &&
        f.validFrom <= date &&
        ((f.between[0] === a && f.between[1] === b) || (f.between[0] === b && f.between[1] === a)),
    )
    .sort((x, y) => y.validFrom.localeCompare(x.validFrom) || Number(!!y.company) - Number(!!x.company))[0];
  if (!base) return undefined;
  const pending = ds.increases.filter((i) => i.validFrom > base.validFrom && i.validFrom <= date);
  const price = pending.reduce(
    (p, i) => Math.round((p * (1 + i.percent / 100)) / ds.fareRounding) * ds.fareRounding,
    base.price,
  );
  return { price, estimated: pending.length > 0, base };
}
