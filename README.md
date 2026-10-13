# Horarios Sierras Chicas

Horarios de colectivos entre Córdoba y Sierras Chicas (Villa Allende, Mendiolaza, El Talar, Unquillo, Río Ceballos…)
en una sola página. Elegís origen y destino y ves los horarios de todas las empresas (Intercórdoba, FonoBus y
Sarmiento), con el próximo servicio resaltado y la tarifa vigente.

- Selector **Interurbano | Urbano** (los urbanos de El Talar son un servicio aparte, con sus propios horarios).
- Tipo de día automático según la fecha y los feriados, o elegido a mano.
- **Filtros** por empresa, hora de salida y hora de llegada.
- Notas en cada viaje cuando importa el recorrido ("Por Aeropuerto", "Por E-53", "Por El Talar"…).
- Colores de cada empresa como en la planilla vecinal de El Talar.

Sitio estático hecho con [Astro](https://astro.build) + Preact. Los datos están en archivos YAML dentro de `data/`.

## Uso

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # valida los datos y genera dist/
npm run preview    # sirve dist/
npm test           # tests de la búsqueda, las tarifas y los datos reales
```

Para probarla desde el celular en la red local, agregá `--host` (y `--port` si querés otro puerto) y abrí
`http://<IP de la compu>:4321` con el celular en el mismo Wi-Fi:

```sh
npm run dev -- --host
npm run build && npm run preview -- --host --port 8080
```

## Cómo se actualizan los datos

| Qué | De dónde sale | Cómo se actualiza |
|---|---|---|
| Sarmiento Córdoba – V. Allende – Unquillo | Imágenes de [gruposarmiento.com.ar/horarios](https://www.gruposarmiento.com.ar/horarios/) | `npx tsx scripts/watch-sarmiento.ts` baja las imágenes nuevas a `sources/sarmiento/`; después se transcriben a `data/routes/sarmiento/` |
| Sarmiento Córdoba – Talar – Unquillo | Planilla vecinal de El Talar (`sources/community/`) | A mano. El [sistema de reservas](http://horarios.gruposarmiento.com.ar/Horarios.aspx) (`npx tsx scripts/fetch-sarmiento-departures.ts`) sirve de referencia, pero no es fuente |
| Intercórdoba y FonoBus (interurbanos y urbanos) | PDFs o fotos que mandan por WhatsApp | Se guardan en `sources/intercordoba/` o `sources/fonobus/` y se transcriben a `data/routes/` |
| Tarifas | Notas de El Doce, Cba24n, Perfil, Cadena 3 y aumentos oficiales del [ERSeP](https://ersep.cba.gov.ar) | `npx tsx scripts/watch-fares.ts` informa novedades; con `--apply` las agrega a `data/fares.yaml` |
| Feriados | [argentinadatos.com](https://argentinadatos.com) | `npx tsx scripts/update-holidays.ts` (una vez por año) |

Las planillas que se cargan son la fuente de verdad. Solo se corrigen errores físicamente imposibles (por ejemplo, un
viaje "por Aeropuerto" con hora en CPC Argüello). El mapa de recorridos `sources/community/routes-map.jpg` sirve para
chequear que cada viaje pase por donde corresponde.

Después de cargar datos:

1. `npm run check` valida los archivos y explica en castellano qué está mal (paradas inexistentes, horas fuera de
   orden, etc.).
2. `npx tsx scripts/audit.ts` lista todos los tramos que ofrece la página por empresa y servicio, con la cantidad de
   viajes por tipo de día. Una conexión que no existe salta a la vista.
3. `npm test` incluye `tests/data.test.ts`, con hechos confirmados de la red real (por ejemplo, que FonoBus no une
   Villa Allende con El Talar).

### Tarifas estimadas

Para cada tramo se guarda el último precio conocido. La serie de aumentos del ERSeP desde 2025 está en `data/fares.yaml`.
Si después de ese precio hubo aumentos, la página los aplica, redondea a $50 en cada paso y muestra el resultado como
"≈ $X (estimada)". Por ejemplo, Villa Allende costaba $3.160 en mayo de 2025: la proyección da $3.950, que es el precio
publicado en octubre de 2026. El Talar paga lo mismo que Mendiolaza. Las tarifas urbanas todavía no están cargadas.

## Estructura

```
data/
  places.yaml        lugares que se eligen en la página y paradas de cada uno
  companies.yaml     empresas (nombre y color)
  routes/<empresa>/  recorridos: paradas en orden y viajes por tipo de día
  fares.yaml         precios conocidos + serie de aumentos
  holidays.yaml      feriados (generado)
  watch/             configuración y estado de los scrapers
sources/             horarios originales (PDF/JPG) de los que salen los datos
  community/         planilla vecinal de El Talar y mapa de recorridos
scripts/             validación, auditoría y scrapers
src/                 página (Astro + Preact)
tests/               tests con datos de prueba y sobre los datos reales
```

## Limitaciones conocidas

- **El Talar ≠ Puente Talar.** Puente Talar está sobre la E-57, junto a Muni. Mendiolaza, y cuenta como Mendiolaza.
  A El Talar (la calle que une la E-57 con la E-53) entran solo algunos:
  - los E-53 de Intercórdoba que no pasan por Mendiolaza;
  - los de Intercórdoba "El Talar por Villa Allende";
  - la línea por Talar de Sarmiento;
  - los "Talar de Mendiolaza" de FonoBus;
  - los urbanos.

  Los fines de semana solo entra FonoBus los sábados.
- Algunas horas son estimadas y lo dice la nota del viaje: CPC Argüello y Mendiolaza en los viajes de Intercórdoba
  por Villa Allende ⇄ El Talar. En los FonoBus a Saldán, CPC Argüello no tiene hora: se puede bajar ahí, pero no
  figura como lugar para subirse.
- La línea Córdoba – Talar – Unquillo de Sarmiento sale de la planilla vecinal de marzo de 2025.
- Ubicación supuesta de algunas paradas de los urbanos: Barrio Golf, Estación Sol y Calle 3 se toman como
  Mendiolaza, y Corzuelas como un lugar aparte. El horario "en caso de paro o taller docente" del Urbano Talar
  (FonoBus) no está cargado.
- Para Unquillo, Córdoba, etc. se muestra la última parada del lugar antes de salir (por ejemplo, Terminal Unquillo
  y no Frigorífico).
- La Voz y Vía País bloquean el acceso automático: sus notas solo se avisan por título (vía Google News) para
  revisarlas a mano.
- No hay precios publicados para tramos intermedios (por ejemplo, Villa Allende ⇄ Mendiolaza); se cargan a mano
  cuando se conocen.
