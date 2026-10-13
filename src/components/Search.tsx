import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Dataset } from "../lib/dataset";
import type { DayType } from "../lib/schema";
import {
  dayTypeFor,
  displayTime,
  fareFor,
  filterDepartures,
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
// Only this preference is remembered; the trip always starts empty so the user picks it.
const HIDE_PAST_KEY = "hidePast";
// Older versions remembered the last trip here; it is removed on load.
const LEGACY_TRIP_KEY = "lastTrip";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function Search({ data }: { data: Dataset }) {
  const placesFor = (service: Service) => {
    const served = servedPlaces(data, service);
    return served.length ? served : data.places;
  };
  const [now, setNow] = useState(() => nowInCordoba());
  const today = dayTypeFor(now.date, now.weekday, data.holidays);
  const [service, setService] = useState<Service>("interurban");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hidePast, setHidePast] = useState(false);
  const [day, setDay] = useState<DayType>(today);
  const places = useMemo(() => placesFor(service), [data, service]);

  const switchService = (next: Service) => {
    setService(next);
    setFrom("");
    setTo("");
  };

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_TRIP_KEY);
      setHidePast(localStorage.getItem(HIDE_PAST_KEY) === "1");
    } catch {
      // Storage unavailable: show every trip.
    }
    const timer = setInterval(() => setNow(nowInCordoba()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [hiddenCompanies, setHiddenCompanies] = useState<string[]>([]);
  const [departAfter, setDepartAfter] = useState("");
  const [arriveBefore, setArriveBefore] = useState("");
  const activeFilters = hiddenCompanies.length + (departAfter ? 1 : 0) + (arriveBefore ? 1 : 0);

  const allDeps = useMemo(
    () => findDepartures(data, from, to, day).filter((d) => d.service === service),
    [data, service, from, to, day],
  );
  const tripCompanies = [...new Set(allDeps.map((d) => d.company))];
  const deps = useMemo(
    () => filterDepartures(allDeps, { hiddenCompanies, departAfter, arriveBefore }),
    [allDeps, hiddenCompanies, departAfter, arriveBefore],
  );
  const isToday = day === today;
  const firstUpcoming = isToday ? deps.findIndex((d) => toMinutes(d.depart) >= now.minutes) : -1;
  // "Ocultar los que ya pasaron" only applies to today's timetable.
  const hidingPast = hidePast && isToday;
  const shown = hidingPast ? (firstUpcoming < 0 ? [] : deps.slice(firstUpcoming)) : deps;
  const nextIndex = hidingPast ? (shown.length ? 0 : -1) : firstUpcoming;
  // Jump (no animation) to the next departure when the trip or day changes, so it is visible without scrolling.
  const nextRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    nextRow.current?.scrollIntoView({ block: "center" });
  }, [service, from, to, day, hiddenCompanies, departAfter, arriveBefore, hidingPast, nextIndex === -1]);

  const toggleHidePast = (value: boolean) => {
    setHidePast(value);
    try {
      localStorage.setItem(HIDE_PAST_KEY, value ? "1" : "0");
    } catch {
      // Storage unavailable: the choice lasts until the page is reloaded.
    }
  };

  const usedRoutes = [...new Map(shown.map((d) => [`${d.company}/${d.routeId}`, d])).values()].map((d) =>
    data.routes.find((r) => r.company === d.company && r.id === d.routeId)!,
  );
  // Fares are interurban fares; urban lines have their own (not loaded yet).
  const companies = service === "interurban" ? [...new Set(shown.map((d) => d.company))] : [];
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
            <option value="" disabled>
              Elegí…
            </option>
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
            <option value="" disabled>
              Elegí…
            </option>
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

      <details class="filters">
        <summary>Filtros{activeFilters > 0 && ` (${activeFilters})`}</summary>
        {tripCompanies.length > 1 && (
          <fieldset>
            <legend>Empresas</legend>
            {tripCompanies.map((c) => (
              <label>
                <input
                  type="checkbox"
                  checked={!hiddenCompanies.includes(c)}
                  onChange={(e) =>
                    setHiddenCompanies(
                      e.currentTarget.checked ? hiddenCompanies.filter((h) => h !== c) : [...hiddenCompanies, c],
                    )
                  }
                />
                <i style={{ background: data.companies[c].color }} />
                {data.companies[c].name}
              </label>
            ))}
          </fieldset>
        )}
        <div class="times">
          <label>
            Salir desde
            <input type="time" value={departAfter} onInput={(e) => setDepartAfter(e.currentTarget.value)} />
          </label>
          <label>
            Llegar antes de
            <input type="time" value={arriveBefore} onInput={(e) => setArriveBefore(e.currentTarget.value)} />
          </label>
        </div>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => {
              setHiddenCompanies([]);
              setDepartAfter("");
              setArriveBefore("");
            }}
          >
            Limpiar filtros
          </button>
        )}
      </details>

      {service === "urban" && shown.length > 0 && <p class="fares">Tarifa urbana: sin cargar</p>}
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

      {isToday && from && to && from !== to && deps.length > 0 && (
        <label class="hide-past">
          <input type="checkbox" checked={hidePast} onChange={(e) => toggleHidePast(e.currentTarget.checked)} />
          Ocultar los que ya pasaron
        </label>
      )}

      {!from || !to ? (
        <p class="empty">Elegí desde dónde y hasta dónde viajás.</p>
      ) : from === to ? (
        <p class="empty">Elegí un origen y un destino distintos.</p>
      ) : allDeps.length > 0 && deps.length === 0 ? (
        <p class="empty">Ningún viaje coincide con los filtros.</p>
      ) : deps.length === 0 ? (
        <p class="empty">No hay horarios cargados para este tramo en {DAY_LABELS[day].toLowerCase()}.</p>
      ) : shown.length === 0 ? (
        <p class="empty">Ya no quedan viajes hoy para este tramo.</p>
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
            {shown.map((d, i) => (
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
