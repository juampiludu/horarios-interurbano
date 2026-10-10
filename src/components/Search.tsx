import { useEffect, useMemo, useState } from "preact/hooks";
import type { Dataset } from "../lib/dataset";
import type { DayType } from "../lib/schema";
import { dayTypeFor, fareFor, findDepartures, nowInCordoba, servedPlaces, toMinutes } from "../lib/query";

const DAY_LABELS: Record<DayType, string> = {
  weekday: "Lunes a viernes",
  saturday: "Sábado",
  sunday_holiday: "Domingo y feriado",
};
const STORAGE_KEY = "lastTrip";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function readStored(): { from: string; to: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export default function Search({ data }: { data: Dataset }) {
  const places = useMemo(() => {
    const served = servedPlaces(data);
    return served.length ? served : data.places;
  }, [data]);
  const has = (id: string) => places.some((p) => p.id === id);

  const [now, setNow] = useState(() => nowInCordoba());
  const today = dayTypeFor(now.date, now.weekday, data.holidays);
  const [from, setFrom] = useState(has("cordoba") ? "cordoba" : places[0]?.id);
  const [to, setTo] = useState(has("mendiolaza") ? "mendiolaza" : places[1]?.id);
  const [day, setDay] = useState<DayType>(today);

  useEffect(() => {
    const stored = readStored();
    if (stored && has(stored.from) && has(stored.to)) {
      setFrom(stored.from);
      setTo(stored.to);
    }
    const timer = setInterval(() => setNow(nowInCordoba()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ from, to }));
    } catch {
      // Storage unavailable (private mode): just don't remember the choice.
    }
  }, [from, to]);

  const deps = useMemo(() => findDepartures(data, from, to, day), [data, from, to, day]);
  const isToday = day === today;
  const nextIndex = isToday ? deps.findIndex((d) => toMinutes(d.depart) >= now.minutes) : -1;
  const usedRoutes = [...new Map(deps.map((d) => [`${d.company}/${d.routeId}`, d])).values()].map(
    (d) => data.routes.find((r) => r.company === d.company && r.id === d.routeId)!,
  );
  const companies = [...new Set(deps.map((d) => d.company))];

  return (
    <>
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

      {companies.length > 0 && (
        <p class="fares">
          {companies.map((c) => {
            const fare = fareFor(data, c, from, to, now.date);
            return (
              <span>
                <i style={{ background: data.companies[c].color }} />
                {data.companies[c].name}:{" "}
                {fare ? (
                  <span title={fare.estimated ? `Estimada a partir de ${money.format(fare.base.price)} (${fare.base.validFrom.split("-").reverse().join("/")}) más los aumentos del ERSeP` : undefined}>
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
              <tr class={i === nextIndex ? "next" : isToday && (nextIndex === -1 || i < nextIndex) ? "past" : ""}>
                <td class="time">{d.depart}</td>
                <td class="time">{d.arrive ?? "—"}</td>
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
