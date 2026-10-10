import { z } from "zod";

export const DAY_TYPES = ["weekday", "saturday", "sunday_holiday"] as const;
export type DayType = (typeof DAY_TYPES)[number];

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Debe ser un id en kebab-case (ej: cba-terminal)");
const isoDate = z.iso.date({ error: "Debe ser una fecha AAAA-MM-DD" });
// Hours up to 29 so trips past midnight keep sorting after the evening ones.
export const time = z.string().regex(/^([01]\d|2[0-9]):[0-5]\d$/, "Debe ser una hora HH:MM (ej: 06:45)");

export const placesFile = z.object({
  // aliases: other spellings used by the news when reporting fares.
  places: z.array(z.object({ id, name: z.string().min(1), aliases: z.array(z.string()).default([]) })),
  stops: z.array(
    z.object({
      id,
      name: z.string().min(1),
      place: id,
      aliases: z.array(z.string()).default([]),
    }),
  ),
});

export const companiesFile = z.object({
  companies: z.array(
    z.object({
      id,
      name: z.string().min(1),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Debe ser un color #RRGGBB"),
      phone: z.string().optional(),
      website: z.url().optional(),
    }),
  ),
});

// A trip is a list of times aligned with the direction's stops; null = does not stop there.
const tripTimes = z.array(time.nullable());
const trip = z.union([tripTimes, z.object({ times: tripTimes, note: z.string().optional() })]);

export const routeFile = z.object({
  id,
  company: id,
  name: z.string().min(1),
  validFrom: isoDate,
  source: z.string().min(1),
  directions: z.array(
    z.object({
      id,
      stops: z.array(id).min(2),
      // The source only gives some times: stops without time (null) are still served, at an unknown time.
      untimedStopsServed: z.boolean().default(false),
      schedules: z.array(
        z.object({
          days: z.array(z.enum(DAY_TYPES)).min(1),
          trips: z.array(trip),
        }),
      ),
    }),
  ),
});

export const faresFile = z.object({
  // Companies round fares; estimates are rounded to the nearest multiple of this after each increase.
  rounding: z.number().positive(),
  // Province-wide increases approved by ERSeP (percent over the per-km base rate).
  increases: z.array(
    z.object({
      validFrom: isoDate,
      percent: z.number().positive(),
      source: z.string().min(1),
    }),
  ),
  // Observed prices (news, company boards). Missing or outdated ones are estimated with `increases`.
  fares: z.array(
    z.object({
      // Without company the fare applies to every company (news usually report one price per destination).
      company: id.optional(),
      // Fares apply in both directions between the two places.
      between: z.tuple([id, id]),
      price: z.number().positive(),
      validFrom: isoDate,
      source: z.string().min(1),
    }),
  ),
});

export const holidaysFile = z.object({ holidays: z.array(isoDate) });

export type PlacesFile = z.infer<typeof placesFile>;
export type CompaniesFile = z.infer<typeof companiesFile>;
export type RouteFile = z.infer<typeof routeFile>;
export type FaresFile = z.infer<typeof faresFile>;
