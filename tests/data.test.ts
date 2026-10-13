// Facts confirmed by the user about the real network. They guard data/ against wrong stops or places.
import { describe, expect, it } from "vitest";
import { loadDataset } from "../src/lib/load";
import { fareFor, findDepartures, servedPlaces } from "../src/lib/query";
import { DAY_TYPES } from "../src/lib/schema";

const ds = loadDataset();
const trips = (from: string, to: string, company?: string) =>
  DAY_TYPES.flatMap((day) => findDepartures(ds, from, to, day)).filter((d) => !company || d.company === company);

describe("real data", () => {
  it("urban lines (FonoBus and Intercórdoba) serve El Talar and stay out of Córdoba", () => {
    const urban = servedPlaces(ds, "urban").map((p) => p.id);
    expect(urban).toEqual(expect.arrayContaining(["el-talar", "mendiolaza", "unquillo"]));
    expect(urban).not.toContain("cordoba");
    const companies = new Set(
      findDepartures(ds, "el-talar", "mendiolaza", "weekday")
        .filter((d) => d.service === "urban")
        .map((d) => d.company),
    );
    expect(companies).toEqual(new Set(["fonobus", "intercordoba"]));
  });

  it("FonoBus never links Villa Allende with El Talar or Mendiolaza", () => {
    for (const other of ["el-talar", "mendiolaza"]) {
      expect(trips("villa-allende", other, "fonobus")).toEqual([]);
      expect(trips(other, "villa-allende", "fonobus")).toEqual([]);
    }
  });

  it("only FonoBus enters El Talar on Saturdays, and nobody on Sundays and holidays", () => {
    for (const [from, to] of [
      ["cordoba", "el-talar"],
      ["el-talar", "cordoba"],
    ]) {
      const saturday = findDepartures(ds, from, to, "saturday");
      expect(saturday.length).toBeGreaterThan(0);
      expect(new Set(saturday.map((d) => d.company))).toEqual(new Set(["fonobus"]));
      expect(findDepartures(ds, from, to, "sunday_holiday")).toEqual([]);
    }
  });

  it("Intercórdoba trips between Córdoba and El Talar through Villa Allende stop at CPC Argüello", () => {
    const viaVa = [
      ...trips("villa-allende", "el-talar", "intercordoba"),
      ...trips("el-talar", "villa-allende", "intercordoba"),
    ];
    expect(viaVa.length).toBe(3);
    for (const d of viaVa) {
      const route = ds.routes.find((r) => r.id === d.routeId)!;
      const ok = route.directions.some((dir) =>
        dir.schedules.some((s) =>
          s.trips.some((t) => t.note === d.note && t.times[dir.stops.indexOf("cba-cpc-arguello")] !== null),
        ),
      );
      expect(ok, `${d.depart} ${d.note}`).toBe(true);
    }
  });

  it("Intercórdoba's El Talar por Villa Allende trips (pink) stop at Mendiolaza", () => {
    const pink = [
      ...trips("villa-allende", "el-talar", "intercordoba"),
      ...trips("el-talar", "villa-allende", "intercordoba"),
    ];
    for (const d of pink) {
      const viaMendiolaza = trips(
        d.fromStop === "el-talar" ? "el-talar" : "mendiolaza",
        d.fromStop === "el-talar" ? "mendiolaza" : "el-talar",
        "intercordoba",
      ).some((x) => x.note === d.note);
      expect(viaMendiolaza, `${d.depart} ${d.note}`).toBe(true);
    }
  });

  it("FonoBus Saldán trips (blue) pass CPC Argüello, Talar trips (red) do not", () => {
    expect(trips("cordoba", "cordoba-arguello", "fonobus").length).toBeGreaterThan(0);
    expect(trips("saldan", "cordoba-arguello", "fonobus").length).toBeGreaterThan(0);
    // Its time is estimated like the E-57 (Córdoba ± 35'), so you can also board there.
    expect(trips("cordoba-arguello", "saldan", "fonobus").length).toBeGreaterThan(0);
    expect(trips("el-talar", "cordoba-arguello", "fonobus")).toEqual([]);
    expect(trips("cordoba", "saldan", "fonobus").every((d) => d.arrive !== null)).toBe(true);
  });

  it("Intercórdoba trips by the airport (orange) never pass CPC Argüello", () => {
    for (const r of ds.routes.filter((r) => r.company === "intercordoba"))
      for (const d of r.directions)
        for (const s of d.schedules)
          for (const t of s.trips)
            if (t.note?.startsWith("Por Aeropuerto"))
              expect(t.times[d.stops.indexOf("cba-cpc-arguello")] ?? null).toBeNull();
  });

  it("Sarmiento's Talar line does not stop at Mendiolaza", () => {
    expect(trips("cordoba", "mendiolaza", "sarmiento").filter((d) => d.routeId === "cba-talar-unquillo")).toEqual([]);
    expect(trips("el-talar", "cordoba", "sarmiento").length).toBeGreaterThan(0);
  });

  it("El Talar pays the same fare as Mendiolaza", () => {
    for (const company of Object.keys(ds.companies)) {
      expect(fareFor(ds, company, "cordoba", "el-talar", "2026-10-12")).toEqual(
        fareFor(ds, company, "cordoba", "mendiolaza", "2026-10-12"),
      );
    }
    expect(fareFor(ds, "intercordoba", "el-talar", "cordoba", "2026-10-12")?.price).toBeGreaterThan(0);
  });
});
