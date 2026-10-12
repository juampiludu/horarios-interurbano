# Horarios Sierras Chicas

Horarios de colectivos entre Córdoba y Sierras Chicas (Villa Allende, Mendiolaza, El Talar, Unquillo…) en una sola página.
Elegís origen y destino y ves los horarios de todas las empresas (Sarmiento, Intercórdoba y FonoBus), con el próximo
servicio resaltado y la tarifa vigente.

Sitio estático hecho con [Astro](https://astro.build) + Preact. Los datos están en archivos YAML dentro de `data/`.

## Uso

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # valida los datos y genera dist/
npm test           # tests de la búsqueda y las tarifas
```

## Cómo se actualizan los datos

| Qué | De dónde sale | Cómo se actualiza |
|---|---|---|
| Horarios de Sarmiento (Córdoba – V. Allende – Unquillo) | Imágenes de [gruposarmiento.com.ar/horarios](https://www.gruposarmiento.com.ar/horarios/) | `npx tsx scripts/watch-sarmiento.ts` baja las imágenes nuevas a `sources/sarmiento/`; después se transcriben a `data/routes/sarmiento/` |
| Horarios de Sarmiento (Córdoba – Talar – Unquillo) | [Sistema de reservas](http://horarios.gruposarmiento.com.ar/Horarios.aspx) (solo da horas de salida) | `npx tsx scripts/fetch-sarmiento-departures.ts <desde> <hasta> <dd/mm/aaaa>` |
| Horarios de Intercórdoba y FonoBus | PDFs o fotos que mandan por WhatsApp | Se guardan en `sources/intercordoba/` o `sources/fonobus/` y se transcriben a `data/routes/` |
| Tarifas | Notas de El Doce, Cba24n, Perfil, Cadena 3 y aumentos oficiales del [ERSeP](https://ersep.cba.gov.ar) | `npx tsx scripts/watch-fares.ts` informa novedades; con `--apply` las agrega a `data/fares.yaml` |
| Feriados | [argentinadatos.com](https://argentinadatos.com) | `npx tsx scripts/update-holidays.ts` (una vez por año) |

Después de editar cualquier dato, corré `npm run check`: valida los archivos y explica en castellano qué está mal
(paradas inexistentes, horas fuera de orden, etc.).

### Tarifas estimadas

Para cada tramo se guarda el último precio conocido. La serie de aumentos del ERSeP desde 2025 está en `data/fares.yaml`.
Si después de ese precio hubo aumentos, la app los aplica, redondea a $50 en cada paso y muestra el resultado como
"≈ $X (estimada)". Por ejemplo, Villa Allende costaba $3.160 en mayo de 2025: la proyección da $3.950, que es el precio
publicado en octubre de 2026.

## Estructura

```
data/
  places.yaml        lugares que se eligen en la página y paradas de cada uno
  companies.yaml     empresas
  routes/<empresa>/  recorridos: paradas en orden y viajes por tipo de día
  fares.yaml         precios conocidos + serie de aumentos
  holidays.yaml      feriados (generado)
  watch/             configuración y estado de los scrapers
sources/             horarios originales (PDF/JPG) de los que salen los datos
scripts/             validación y scrapers
src/                 página (Astro + Preact)
tests/               tests con datos de prueba
```

## Limitaciones conocidas

- La línea Córdoba – Talar – Unquillo no tiene horarios publicados. La hora en El Talar es aproximada (el sistema de
  Sarmiento la informa como "Mendiolaza") y no se conoce la hora de llegada al final del recorrido.
- Ubicación supuesta de algunas paradas de los urbanos: Barrio Golf, Estación Sol y Calle 3 se toman como Mendiolaza, y
  Corzuelas como un lugar aparte. El horario "en caso de paro o taller docente" del Urbano
  Talar (FonoBus) no está cargado.
- Para Unquillo, Córdoba, etc. se muestra la última parada del lugar antes de salir (por ejemplo, Terminal Unquillo y no
  Frigorífico).
- **El Talar ≠ Puente Talar.** Puente Talar está sobre la E-57, junto a Muni. Mendiolaza, y cuenta como Mendiolaza. A El
  Talar (la calle que une la E-57 con la E-53) entran solo algunos: los E-53 de Intercórdoba que no pasan por Mendiolaza,
  el que sale de El Talar por Villa Allende, la línea por Talar de Sarmiento, los "Talar de Mendiolaza" de FonoBus y los
  urbanos. Los fines de semana solo entra FonoBus los sábados. Referencia: `sources/community/el-talar-2025-03.jpg`.
- La Voz y Vía País bloquean el acceso automático: sus notas solo se avisan por título (vía Google News) para revisarlas
  a mano.
- El Talar paga la misma tarifa que Mendiolaza (`fareAs` en `data/places.yaml`).
- No hay precios publicados para tramos intermedios (por ejemplo, Villa Allende ⇄ Mendiolaza); se cargan a mano cuando
  se conocen.
