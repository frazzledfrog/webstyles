# webstyles

A small kit of reusable page templates in plain HTML, CSS and a little vanilla JS. No framework, no build step: open `index.html` in a browser to browse them.

## Layout

```
index.html                 gallery of every template
assets/css/tokens.css      design tokens (colours, type, spacing, radii); edit this to rebrand
assets/css/base.css        reset, typography, layout primitives (.container, .stack, .grid, .cluster, .split)
assets/css/components.css  buttons, cards, forms, nav, tables, pricing, prose, app shell, etc.
assets/js/main.js          theme toggle, mobile nav, tabs, segmented controls
pages/                     the templates
```

| Group     | Pages                                   |
|-----------|-----------------------------------------|
| Marketing | landing, pricing, about, contact        |
| Content   | blog, article, docs                     |
| App       | dashboard, settings, metrics-dashboard  |
| Utility   | login, signup, 404                      |

## Using a template in another project

1. Copy `assets/` and the pages you need.
2. Change `--accent*` and fonts in `tokens.css`. Everything else derives from the tokens, and dark mode is defined alongside them.
3. Replace `.placeholder` blocks with real images and "Brand" with your name.

Header and footer markup is duplicated in each page on purpose so every file stands alone; if a project has a templating system, lift them into partials there.

## Conventions

- Theme: follows the OS by default; the toggle stores an explicit choice in `localStorage` and sets `data-theme` on `<html>`.
- Interactivity is declared with `data-action` attributes (`toggle-theme`, `toggle-nav`, `tab`, `segment`) and handled by one delegated listener in `main.js`.
- Layout primitives take CSS custom properties for tuning inline, e.g. `style="--min:200px"` on `.grid` or `--stack:var(--sp-6)` on `.stack`.

## Metrics dashboard

`pages/metrics-dashboard.html` is a standalone themed variant that does not use the shared tokens: it loads `assets/css/metrics.css` and `assets/js/metrics-dashboard.js` (plus `main.js` for the theme and nav toggles). The layout is flat and full-width with two moods: light "ink" (ultramarine linework on white, a solid blue sidebar, tall condensed serif titles, Y2K pop-up windows, dithered textures) and dark "night city" (acid yellow, cyan and hot red on near-black, notched corners, RGB-split titles).

- Layout: a 12-column grid across the whole viewport. Charts scale with their panels, the sidebar collapses to an icon rail, and at 1400px and wider the explorer docks the row inspector beside the table.
- Date range picker: presets plus a two-month custom calendar (keyboard arrows move between days).
- Database explorer: connection switcher, schema tree, search, enum filter, sortable columns, pagination, generated SQL preview and a row inspector.
- Charts are hand-built SVG with hover and keyboard readouts; the time series has a table view. Categorical colours are validated for colour-vision deficiency in both themes.
- Radar view (`#radar`): each service connected to the selected database is a blip on a latency scope. Bearing is its region, distance its p95 latency on a log scale with the SLO ring marked, and size its request rate. It comes with a contact list with SLO gauges, triangle unit columns per region, and a live mode that drifts latencies and logs SLO crossings.
- All data is synthetic and deterministic (the `Data` module in the script). Replace it with real fetches; the render functions only take arrays.
