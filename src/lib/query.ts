import type { Dataset, Fare } from "./dataset";
import { UNKNOWN, type DayType } from "./schema";

export type Service = "interurban" | "urban";

export interface Departure {
  company: string;
  routeId: string;
  routeName: string;
  service: Service;
  fromStop: string;
  toStop: string;
  depart: string;
  /** null when the source does not give arrival times. */
  arrive: string | null;
  note?: string;
}

/** Times past midnight are stored as 24:xx/25:xx so they sort after the evening; show them as 00:xx/01:xx. */
export function displayTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

/** Places that appear in at least one route (of the given service), in the order of places.yaml. */
export function servedPlaces(ds: Dataset, service?: Service) {
  const used = new Set(
    ds.routes
      .filter((r) => !service || r.service === service)
      .flatMap((r) => r.directions.flatMap((d) => d.stops.map((s) => ds.stops[s].place))),
  );
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
          // You can only board where the time is known; you can get off where it is unknown ("?").
          const timed = (k: number) => trip.times[k] !== null && trip.times[k] !== UNKNOWN;
          const first = places.findIndex((p, k) => p === fromPlace && timed(k));
          if (first < 0) continue;
          const j = places.findIndex((p, k) => k > first && p === toPlace && trip.times[k] !== null);
          if (j < 0) continue;
          // Board at the last stop of the origin place before leaving it (e.g. Terminal Unquillo, not Frigorífico).
          let i = first;
          for (let k = first + 1; k < j; k++) if (places[k] === fromPlace && timed(k)) i = k;
          out.push({
            company: route.company,
            routeId: route.id,
            routeName: route.name,
            service: route.service,
            fromStop: dir.stops[i],
            toStop: dir.stops[j],
            depart: trip.times[i]!,
            arrive: trip.times[j] === UNKNOWN ? null : trip.times[j],
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
export function fareFor(ds: Dataset, company: string, from: string, to: string, date: string): FareQuote | undefined {
  const fareAs = (id: string) => ds.places.find((p) => p.id === id)?.fareAs ?? id;
  const [a, b] = [fareAs(from), fareAs(to)];
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
