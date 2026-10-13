import type { DayType } from "./schema";

// Shared with the browser bundle: keep this file free of runtime imports (no zod).
/** Trip time meaning "stops there, time unknown". */
export const UNKNOWN = "?";

// Normalized, JSON-serializable data shipped to the browser.
export interface Trip {
  times: (string | null)[];
  note?: string;
}

export interface Direction {
  id: string;
  stops: string[];
  schedules: { days: DayType[]; trips: Trip[] }[];
}

export interface Route {
  id: string;
  company: string;
  name: string;
  service: "interurban" | "urban";
  validFrom: string;
  source: string;
  directions: Direction[];
}

export interface Fare {
  company?: string;
  between: [string, string];
  price: number;
  validFrom: string;
  source: string;
}

export interface Increase {
  validFrom: string;
  percent: number;
  source: string;
}

export interface Dataset {
  places: { id: string; name: string; aliases: string[]; fareAs?: string }[];
  stops: Record<string, { name: string; place: string }>;
  companies: Record<string, { name: string; color: string; phone?: string; website?: string }>;
  routes: Route[];
  fares: Fare[];
  fareRounding: number;
  increases: Increase[];
  holidays: string[];
}
