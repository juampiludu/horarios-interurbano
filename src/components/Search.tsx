import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Dataset } from "../lib/dataset";
import type { DayType } from "../lib/schema";
import {
  dayTypeFor,
  displayTime,
  fareFor,
  findDepartures,
  nowInCordoba,
  servedPlaces,
  toMinutes,
  type Service,
} from "../lib/query";

const DAY_LABELS: Record<DayType, string> = {
  weekday: "Lunes a viernes",
  saturday: "Sábado",
  sunday_holiday: "Domingo y feriado",
};
const SERVICE_LABELS: Record<Service, string> = { interurban: "Interurbano", urban: "Urbano" };
const DEFAULT_TRIP: Record<Service, { from: string; to: string }> = {
  interurban: { from: "cordoba", to: "mendiolaza" },
  urban: { from: "el-talar", to: "mendiolaza" },
};
const STORAGE_KEY = "lastTrip";

interface Stored {
  service: Service;
  trips: Partial<Record<Service, { from: string; to: string }>>;
}

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw?.trips) return raw;
    // Older format: a single interurban trip.
    if (raw?.from) return { service: "interurban", trips: { interurban: { from: raw.from, to: raw.to } } };
  } catch {
    // Storage unavailable or corrupt: start from the defaults.
  }
  return { service: "interurban", trips: {} };
}

export default function Search({ data }: { data: Dataset }) {
  const placesFor = (service: Service) => {
    const served = servedPlaces(data, service);
    return served.length ? served : data.places;
  };
  // A valid trip for the service: the remembered one if its places are served, else the default, else the first two.
  const tripFor = (service: Service, stored: Stored) => {
    const places = placesFor(service);
    const ok = (t?: { from: string; to: string }) =>
      t && places.some((p) => p.id === t.from) && places.some((p) => p.id === t.to) ? t : undefined;
    return ok(stored.trips[service]) ?? ok(DEFAULT_TRIP[service]) ?? { from: places[0]?.id, to: places[1]?.id };
  };

  const [now, setNow] = useState(() => nowInCordoba());
  const today = dayTypeFor(now.date, now.weekday, data.holidays);
  const [service, setService] = useState<Service>("interurban");
  const [from, setFrom] = useState(DEFAULT_TRIP.interurban.from);
  const [to, setTo] = useState(DEFAULT_TRIP.interurban.to);
  const [day, setDay] = useState<DayType>(today);
  const places = useMemo(() => placesFor(service), [data, service]);

  const switchService = (next: Service) => {
    const trip = tripFor(next, readStored());
    setService(next);
    setFrom(trip.from);
    setTo(trip.to);
  };

  useEffect(() => {
    const stored = readStored();
    switchService(stored.service);
    const timer = setInterval(() => setNow(nowInCordoba()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const stored = readStored();
      stored.service = service;
      stored.trips[service] = { from, to };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage unavailable (private mode): just don't remember the choice.
    }
  }, [service, from, to]);

  const deps = useMemo(
    () => findDepartures(data, from, to, day).filter((d) => d.service === service),
    [data, service, from, to, day],
  );
  const isToday = day === today;
  const nextIndex = isToday ? deps.findIndex((d) => toMinutes(d.depart) >= now.minutes) : -1;
  // Jump (no animation) to the next departure when the trip or day changes, so it is visible without scrolling.
  const nextRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    nextRow.current?.scrollIntoView({ block: "center" });
  }, [service, from, to, day, nextIndex === -1]);

  const usedRoutes = [...new Map(deps.map((d) => [`${d.company}/${d.routeId}`, d])).values()].map((d) =>
    data.routes.find((r) => r.company === d.company && r.id === d.routeId)!,
  );
  // Fares are interurban fares; urban lines have their own (not loaded yet).
  const companies = service === "interurban" ? [...new Set(deps.map((d) => d.company))] : [];
  const toPlaceName = places.find((p) => p.id === to)?.name;

  return (
    <>
      <div class="service" role="radiogroup" aria-label="Servicio">
        {(Object.keys(SERVICE_LABELS) as Service[]).map((s) => (
          <button
            type="button"
            role="radio"
            aria-checked={s === service}
            class={s === service ? "on" : ""}
            onClick={() => s !== service && switchService(s)}
          >
            {SERVICE_LABELS[s]}
          </button>
        ))}
      </div>
      <form class="picker" onSubmit={(e) => e.preventDefault()}>
        <label>
          Desde
          <select value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
            {places.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="swap"
          title="Invertir"
          aria-label="Invertir origen y destino"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          ⇄
        </button>
        <label>
          Hasta
          <select value={to} onChange={(e) => setTo(e.currentTarget.value)}>
            {places.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label class="day">
          Día
          <select value={day} onChange={(e) => setDay(e.currentTarget.value as DayType)}>
            {(Object.keys(DAY_LABELS) as DayType[]).map((d) => (
              <option value={d}>
                {DAY_LABELS[d]}
                {d === today ? " (hoy)" : ""}
              </option>
            ))}
          </select>
        </label>
      </form>

      {service === "urban" && deps.length > 0 && <p class="fares">Tarifa urbana: sin cargar</p>}
      {companies.length > 0 && (
        <p class="fares">
          {companies.map((c) => {
            const fare = fareFor(data, c, from, to, now.date);
            return (
              <span>
                <i style={{ background: data.companies[c].color }} />
                {data.companies[c].name}:{" "}
                {fare ? (
                  <span
                    title={
                      fare.estimated
                        ? `Estimada a partir de ${money.format(fare.base.price)} (${fare.base.validFrom.split("-").reverse().join("/")}) más los aumentos del ERSeP`
                        : undefined
                    }
                  >
                    {fare.estimated ? `≈ ${money.format(fare.price)} (estimada)` : money.format(fare.price)}
                  </span>
                ) : (
                  "tarifa sin cargar"
                )}
              </span>
            );
          })}
        </p>
      )}

      {from === to ? (
        <p class="empty">Elegí un origen y un destino distintos.</p>
      ) : deps.length === 0 ? (
        <p class="empty">No hay horarios cargados para este tramo en {DAY_LABELS[day].toLowerCase()}.</p>
      ) : (
        <table class="trips">
          <thead>
            <tr>
              <th>Sale</th>
              <th>Llega</th>
              <th>Empresa</th>
              <th>Desde</th>
            </tr>
          </thead>
          <tbody>
            {deps.map((d, i) => (
              <tr
                ref={i === nextIndex ? nextRow : undefined}
                class={i === nextIndex ? "next" : isToday && (nextIndex === -1 || i < nextIndex) ? "past" : ""}
              >
                <td class="time">{displayTime(d.depart)}</td>
                <td class="time">
                  {d.arrive ? displayTime(d.arrive) : "—"}
                  {!toPlaceName?.includes(data.stops[d.toStop].name) && <small>a {data.stops[d.toStop].name}</small>}
                </td>
                <td>
                  <i style={{ background: data.companies[d.company].color }} />
                  {data.companies[d.company].name}
                </td>
                <td class="stop">
                  {data.stops[d.fromStop].name}
                  {d.note && <small>{d.note}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {usedRoutes.length > 0 && (
        <footer>
          {usedRoutes.map((r) => (
            <div>
              {data.companies[r.company].name} · {r.name}: vigente desde {r.validFrom.split("-").reverse().join("/")}
            </div>
          ))}
        </footer>
      )}
    </>
  );
}
