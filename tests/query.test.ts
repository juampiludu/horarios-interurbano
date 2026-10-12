import { describe, expect, it } from "vitest";
import { loadDataset } from "../src/lib/load";
import { dayTypeFor, displayTime, fareFor, findDepartures, nowInCordoba } from "../src/lib/query";

const ds = loadDataset("tests/fixtures/data");

describe("findDepartures", () => {
  it("merges companies on a weekday, sorted by departure", () => {
    const deps = findDepartures(ds, "cordoba", "mendiolaza", "weekday");
    expect(deps.map((d) => [d.company, d.depart, d.arrive])).toEqual([
      ["alpha", "06:30", "07:15"],
      ["beta", "07:05", "07:50"],
      ["alpha", "07:10", "07:55"],
    ]);
  });

  it("boards at the last stop of the origin place before leaving it", () => {
    const deps = findDepartures(ds, "cordoba", "mendiolaza", "weekday");
    expect(deps.map((d) => d.fromStop)).toEqual(["cba-plaza-espana", "cba-terminal", "cba-plaza-espana"]);
    expect(deps[0].note).toBe("Sale de Plaza España");
  });

  it("skips trips that do not reach the destination", () => {
    const deps = findDepartures(ds, "cordoba", "villa-allende", "weekday");
    expect(deps.map((d) => d.depart)).toEqual(["06:30", "07:10", "08:10"]);
  });

  it("includes trips whose arrival time is unknown", () => {
    const deps = findDepartures(ds, "cordoba", "mendiolaza", "saturday");
    expect(deps.map((d) => [d.company, d.depart, d.arrive])).toEqual([
      ["beta", "09:00", null],
      ["alpha", "09:10", "09:55"],
    ]);
    expect(findDepartures(ds, "villa-allende", "mendiolaza", "saturday").map((d) => d.company)).toEqual(["alpha"]);
  });

  it("uses the schedule for the day type", () => {
    expect(findDepartures(ds, "cordoba", "mendiolaza", "sunday_holiday").map((d) => d.depart)).toEqual(["09:10"]);
  });

  it("respects direction", () => {
    const deps = findDepartures(ds, "mendiolaza", "cordoba", "weekday");
    expect(deps.map((d) => [d.depart, d.arrive, d.toStop])).toEqual([["06:00", "06:45", "cba-plaza-espana"]]);
  });

  it("returns nothing for the same place", () => {
    expect(findDepartures(ds, "cordoba", "cordoba", "weekday")).toEqual([]);
  });
});

describe("displayTime", () => {
  it("shows times past midnight as the next day's clock", () => {
    expect(displayTime("23:59")).toBe("23:59");
    expect(displayTime("24:00")).toBe("00:00");
    expect(displayTime("25:07")).toBe("01:07");
  });
});

describe("dayTypeFor", () => {
  it("maps weekdays, saturdays, sundays and holidays", () => {
    expect(dayTypeFor("2026-10-09", 5, ds.holidays)).toBe("weekday");
    expect(dayTypeFor("2026-10-10", 6, ds.holidays)).toBe("saturday");
    expect(dayTypeFor("2026-10-11", 0, ds.holidays)).toBe("sunday_holiday");
    expect(dayTypeFor("2026-10-12", 1, ds.holidays)).toBe("sunday_holiday");
  });
});

describe("fareFor", () => {
  it("uses an observed fare as is when no increase came after it", () => {
    expect(fareFor(ds, "alpha", "mendiolaza", "cordoba", "2026-09-01")).toMatchObject({ price: 1100, estimated: false });
    expect(fareFor(ds, "beta", "cordoba", "mendiolaza", "2026-04-30")).toBeUndefined();
  });

  it("prefers a company-specific fare over a generic one on the same date", () => {
    expect(fareFor(ds, "alpha", "cordoba", "mendiolaza", "2026-09-01")?.price).toBe(1100);
    expect(fareFor(ds, "beta", "cordoba", "mendiolaza", "2026-09-01")?.price).toBe(1200);
  });

  it("projects older fares with every later increase, rounding after each step", () => {
    // 1000 → +10% = 1100 (observed 1100 on 09-01 takes over afterwards)
    expect(fareFor(ds, "alpha", "cordoba", "mendiolaza", "2026-08-31")).toMatchObject({ price: 1100, estimated: true });
    // 900 → +10% = 990 → 1000; → +14.68% = 1146.8 → 1150
    expect(fareFor(ds, "beta", "villa-allende", "cordoba", "2026-10-10")).toMatchObject({ price: 1150, estimated: true });
    // An increase applies from its own validFrom day: 1200 → +14.68% = 1376.2 → 1400.
    expect(fareFor(ds, "beta", "cordoba", "mendiolaza", "2026-10-01")?.price).toBe(1400);
  });
});

describe("nowInCordoba", () => {
  it("converts to Córdoba time (UTC-3)", () => {
    expect(nowInCordoba(new Date("2026-10-10T02:30:00Z"))).toEqual({ date: "2026-10-09", weekday: 5, minutes: 23 * 60 + 30 });
  });
});
