# webstyles

A metrics dashboard in plain HTML, CSS and vanilla JS. There is no build step and no dependencies: open `index.html` in a browser, or serve the folder (`python3 -m http.server`).

```
index.html                 the dashboard
assets/css/dashboard.css   styles and theme tokens (both moods)
assets/js/dashboard.js     data model, charts, picker, explorer, radar
```

## Views

- **Overview** (`#overview`): six KPI tiles with sparklines and previous-period deltas, a time series with a comparison line and table view, traffic by region, query mix, an hour-by-weekday heatmap, and a slow query log.
- **Explorer** (`#explorer`): schema tree, search, enum filter, sortable columns, pagination, generated SQL, and a row inspector that docks beside the table at 1400px and wider.
- **Radar** (`#radar`): each service is a blip on a latency scope. Bearing is its region, distance its p95 latency (log scale, SLO ring marked), size its request rate. Includes a contact list with SLO gauges, triangle unit columns per region, and a live mode that drifts latencies, logs events and raises SLO breach pop-ups.

The date range picker (presets and a two-month calendar) and the database switcher scope every view.

## Look

Two moods switched by the theme toggle, following the OS by default:

- **Ink** (light): ultramarine linework on white, a solid blue sidebar, tall condensed serif titles, Y2K pop-up windows, dithered textures.
- **Night city** (dark): acid yellow, cyan and hot red on near-black, notched corners, RGB-split titles, faint scanlines.

The layout is a 12-column grid across the full viewport. The sidebar collapses to an icon rail. Chart colours are validated for colour-vision deficiency in both themes.

## Data

All data is synthetic and deterministic: see the `Data` module and the radar's `buildServices` in `dashboard.js`. To use real data, replace those with fetches; the render functions only take arrays.
