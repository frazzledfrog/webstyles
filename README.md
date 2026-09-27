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
| App       | dashboard, settings                     |
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
