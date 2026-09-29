// Metrics dashboard: synthetic data, charts, date range picker, database explorer.
// No dependencies. All data is generated deterministically from (database, day, hour)
// so every panel agrees for any range; swap `Data` for real fetches in a project.

(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const SVG = "http://www.w3.org/2000/svg";
  const DAY = 864e5;

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */

  // Integer hash -> [0, 1). Same inputs always give the same noise.
  function hash(...parts) {
    let h = 2166136261;
    for (const p of parts) { h = Math.imul(h ^ (p | 0), 16777619); h ^= h >>> 13; }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Days are integers (UTC day numbers) so ranges never trip over DST.
  const now = new Date();
  const TODAY = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
  const dayDate = (d) => new Date(d * DAY);
  const weekday = (d) => (d + 4) % 7; // 0 = Sunday (1970-01-01 was a Thursday)
  const fmtDay = (d, opts) => dayDate(d).toLocaleDateString("en", Object.assign({ timeZone: "UTC", month: "short", day: "numeric" }, opts));
  const isoDay = (d) => dayDate(d).toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");

  const nfCompact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const nfInt = new Intl.NumberFormat("en");
  const nfMoney = new Intl.NumberFormat("en", { style: "currency", currency: "USD" });

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => m <= s)) * p;
  }
  function copyText(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = t), 1200); };
    try { navigator.clipboard.writeText(text).then(done, () => {}); } catch { /* clipboard unavailable */ }
  }

  /* ---------------------------------------------------------------------
     Databases & schemas
     --------------------------------------------------------------------- */

  const COUNTRIES = ["AU", "US", "JP", "DE", "GB", "SG", "BR", "CA"];
  const DBS = [
    {
      id: "prod-main", engine: "postgres 16", status: "ok", statusText: "online", meta: "12 ms · 38 conns",
      seed: 11, base: 48000, userRatio: 0.092, lat: 190, err: 0.38, peak: 15, conns: 38, cache: 97.2, slo: 300,
      regions: [["AU-East", 0.34], ["US-West", 0.22], ["EU-Central", 0.18], ["JP-Tokyo", 0.12], ["US-East", 0.09], ["SG", 0.05]],
      tables: [
        { name: "users", rows: 420, cols: [["id", "id"], ["email", "email"], ["plan", "enum", ["free", "pro", "team"]], ["country", "enum", COUNTRIES], ["created_at", "ts"]] },
        { name: "orders", rows: 640, cols: [["id", "id"], ["user_id", "int", [1, 420]], ["total", "money", [4, 480]], ["status", "enum", ["paid", "paid", "paid", "pending", "refunded", "failed"]], ["created_at", "ts"]] },
        { name: "events", rows: 900, cols: [["id", "id"], ["user_id", "int", [1, 420]], ["type", "enum", ["pageview", "pageview", "click", "signup", "export", "error"]], ["path", "text", ["/", "/pricing", "/dashboard", "/settings", "/docs/api", "/checkout"]], ["created_at", "ts"]] },
        { name: "sessions", rows: 520, cols: [["id", "id"], ["user_id", "int", [1, 420]], ["device", "enum", ["desktop", "mobile", "tablet"]], ["duration_s", "int", [4, 3600]], ["started_at", "ts"]] },
      ],
    },
    {
      id: "analytics-replica", engine: "clickhouse", status: "warn", statusText: "lagging", meta: "replication lag 4.2 s",
      seed: 23, base: 162000, userRatio: 0.071, lat: 340, err: 0.21, peak: 13, conns: 64, cache: 88.5, slo: 800,
      regions: [["US-West", 0.29], ["AU-East", 0.24], ["EU-Central", 0.21], ["US-East", 0.13], ["JP-Tokyo", 0.08], ["SG", 0.05]],
      tables: [
        { name: "pageviews", rows: 900, cols: [["id", "id"], ["path", "text", ["/", "/pricing", "/blog/launch", "/docs", "/changelog"]], ["referrer", "enum", ["direct", "search", "soundcloud", "instagram", "newsletter"]], ["country", "enum", COUNTRIES], ["ts", "ts"]] },
        { name: "funnels", rows: 300, cols: [["id", "id"], ["step", "enum", ["visit", "signup", "activate", "pay"]], ["cohort", "text", ["2026-w30", "2026-w31", "2026-w32", "2026-w33", "2026-w34"]], ["users", "int", [20, 9000]], ["created_at", "ts"]] },
        { name: "errors", rows: 360, cols: [["id", "id"], ["code", "enum", ["500", "502", "503", "429", "404", "404"]], ["route", "text", ["/api/login", "/api/export", "/api/metrics", "/api/upload"]], ["count", "int", [1, 240]], ["created_at", "ts"]] },
      ],
    },
    {
      id: "studio.sqlite", engine: "sqlite 3", status: "ok", statusText: "local", meta: "local file · 84 MB",
      seed: 37, base: 2100, userRatio: 0.004, lat: 24, err: 0.9, peak: 2, conns: 2, cache: 99.1, slo: 45,
      regions: [["localhost", 0.81], ["LAN", 0.13], ["USB audio", 0.06]],
      tables: [
        { name: "tracks", rows: 160, cols: [["id", "id"], ["title", "text", ["untitled_final_v7", "bass idea 04", "sidechain test", "vox chop sketch", "rave_edit_MASTER", "4am loop", "supersaw thing"]], ["bpm", "int", [120, 178]], ["key", "enum", ["F min", "A min", "C# min", "G maj", "D maj"]], ["status", "enum", ["demo", "demo", "mixing", "mastered"]], ["created_at", "ts"]] },
        { name: "samples", rows: 420, cols: [["id", "id"], ["name", "text", ["kick_hard_03.wav", "snare_room.wav", "vox_ahh_C.wav", "riser_long.wav", "hat_open_12.wav", "808_glide_F.wav"]], ["pack", "enum", ["own recordings", "drum kit A", "vocal pack", "fx"]], ["bytes", "bytes", [40e3, 9e6]], ["created_at", "ts"]] },
        { name: "plugins", rows: 70, cols: [["id", "id"], ["name", "text", ["wavetable synth", "multiband comp", "linear eq", "tape saturator", "sidechain tool", "reverb plate", "bitcrusher"]], ["format", "enum", ["VST3", "AU", "CLAP"]], ["cpu_pct", "int", [1, 38]], ["updated_at", "ts"]] },
      ],
    },
  ];
  const dbById = (id) => DBS.find((d) => d.id === id);

  /* ---------------------------------------------------------------------
     Data model
     --------------------------------------------------------------------- */

  const Data = (function () {
    const WEEKLY = [0.72, 1.02, 1.06, 1.05, 1.0, 0.94, 0.78]; // Sun..Sat
    const curves = new Map();
    function hourCurve(db) {
      if (!curves.has(db.id)) {
        const c = Array.from({ length: 24 }, (_, hr) => {
          const dist = Math.min(Math.abs(hr - db.peak), 24 - Math.abs(hr - db.peak));
          return 0.25 + Math.exp(-(dist * dist) / (2 * 4.5 * 4.5));
        });
        const sum = c.reduce((a, b) => a + b, 0);
        curves.set(db.id, c.map((v) => v / sum));
      }
      return curves.get(db.id);
    }
    const spike = (db, d) => hash(db.seed, d, 99) < 0.045;

    function day(db, d) {
      const trend = 1 + 0.0035 * (d - TODAY + 200);
      const noise = 0.9 + 0.2 * hash(db.seed, d, 1);
      const requests = db.base * WEEKLY[weekday(d)] * trend * noise * (spike(db, d) ? 1.55 : 1);
      const users = requests * db.userRatio * (0.94 + 0.12 * hash(db.seed, d, 2));
      const load = requests / (db.base * trend);
      const latency = db.lat * (0.78 + 0.3 * load + 0.12 * hash(db.seed, d, 3)) * (spike(db, d) ? 1.35 : 1);
      const errors = db.err * (0.7 + 0.6 * hash(db.seed, d, 4)) + (spike(db, d) ? db.err * 2.2 : 0);
      const conns = db.conns * (0.7 + 0.3 * load) * (0.92 + 0.16 * hash(db.seed, d, 9));
      const cacheHit = Math.min(99.9, db.cache - (load - 1) * 3 - 2 * hash(db.seed, d, 10));
      return { requests, users, latency, errors, conns, cache: cacheHit };
    }
    function hour(db, d, hr) {
      const base = day(db, d);
      const c = hourCurve(db)[hr] * 24;
      const n = 0.9 + 0.2 * hash(db.seed, d, hr, 5);
      return {
        requests: base.requests / 24 * c * n,
        users: base.users / 24 * c * (0.9 + 0.2 * hash(db.seed, d, hr, 6)),
        latency: base.latency * (0.85 + 0.2 * c * n),
        errors: base.errors * (0.75 + 0.5 * hash(db.seed, d, hr, 7)),
        conns: base.conns * (0.6 + 0.5 * c / 1.5) * (0.9 + 0.2 * n),
        cache: Math.min(99.9, base.cache - (c - 1) * 1.5),
      };
    }

    // Buckets: hourly for ranges of 1-2 days, daily otherwise.
    function series(db, start, end) {
      const out = [];
      if (end - start < 2) {
        for (let d = start; d <= end; d++) for (let hr = 0; hr < 24; hr++) {
          out.push(Object.assign({ t: d * DAY + hr * 36e5, label: (end > start ? fmtDay(d) + " " : "") + pad(hr) + ":00" }, hour(db, d, hr)));
        }
      } else {
        for (let d = start; d <= end; d++) out.push(Object.assign({ t: d * DAY, label: fmtDay(d) }, day(db, d)));
      }
      return out;
    }

    function totals(db, start, end) {
      let req = 0, users = 0, lat = 0, err = 0, conns = 0, hit = 0;
      for (let d = start; d <= end; d++) {
        const v = day(db, d);
        req += v.requests; users += v.users; lat += v.latency * v.requests; err += v.errors * v.requests;
        conns += v.conns; hit += v.cache * v.requests;
      }
      const n = end - start + 1;
      return { requests: req, users: users / n, latency: lat / req, errors: err / req, conns: conns / n, cache: hit / req };
    }

    function regions(db, start, end) {
      const total = totals(db, start, end).requests;
      const w = db.regions.map(([name, share], i) => [name, share * (0.85 + 0.3 * hash(db.seed, start, end, i))]);
      const sum = w.reduce((a, [, v]) => a + v, 0);
      return w.map(([name, v]) => ({ name, value: total * v / sum })).sort((a, b) => b.value - a.value);
    }

    const MIX = [["SELECT", 0.68], ["INSERT", 0.16], ["UPDATE", 0.12], ["DELETE", 0.04]];
    function mix(db, buckets) {
      // Fold buckets so the stacked chart never exceeds ~31 columns.
      const size = Math.ceil(buckets.length / 31);
      const out = [];
      for (let i = 0; i < buckets.length; i += size) {
        const chunk = buckets.slice(i, i + size);
        const q = chunk.reduce((a, b) => a + b.requests, 0) * 0.35;
        const parts = MIX.map(([k, s], j) => [k, s * (0.8 + 0.4 * hash(db.seed, chunk[0].t / 36e5, j, 8))]);
        const sum = parts.reduce((a, [, v]) => a + v, 0);
        const label = size > 1 ? chunk[0].label + " – " + chunk[chunk.length - 1].label : chunk[0].label;
        out.push({ label, values: parts.map(([k, v]) => ({ key: k, value: q * v / sum })) });
      }
      return out;
    }

    function heat(db, start, end) {
      // rows Mon..Sun, cols 0..23; average hourly requests; null when the range has no such weekday.
      const acc = Array.from({ length: 7 }, () => Array(24).fill(0));
      const cnt = Array(7).fill(0);
      for (let d = Math.max(start, end - 90); d <= end; d++) {
        const row = (weekday(d) + 6) % 7;
        cnt[row]++;
        for (let hr = 0; hr < 24; hr++) acc[row][hr] += hour(db, d, hr).requests;
      }
      return acc.map((r, i) => r.map((v) => (cnt[i] ? v / cnt[i] : null)));
    }

    function slow(db, start, end) {
      const r = seeded(db.seed * 1000 + start * 7 + end);
      const tpl = [
        (t) => `SELECT * FROM ${t} WHERE created_at > now() - interval '30 days' ORDER BY created_at DESC`,
        (t) => `SELECT count(*) FROM ${t} GROUP BY date_trunc('hour', created_at)`,
        (t) => `UPDATE ${t} SET updated_at = now() WHERE id IN (SELECT id FROM ${t} LIMIT 5000)`,
        (t) => `SELECT ${t}.*, u.email FROM ${t} JOIN users u ON u.id = ${t}.user_id`,
        (t) => `DELETE FROM ${t} WHERE created_at < now() - interval '1 year'`,
      ];
      return Array.from({ length: 6 }, () => {
        const table = db.tables[Math.floor(r() * db.tables.length)].name;
        const ms = Math.round(600 + Math.pow(r(), 2) * 8400);
        const d = start + Math.floor(r() * (end - start + 1));
        return { sql: tpl[Math.floor(r() * tpl.length)](table), ms, t: d * DAY + Math.floor(r() * DAY) };
      }).sort((a, b) => b.ms - a.ms);
    }

    const rowCache = new Map();
    function rows(db, table) {
      const key = db.id + "/" + table.name;
      if (rowCache.has(key)) return rowCache.get(key);
      const r = seeded(db.seed * 31 + table.name.length * 7 + table.name.charCodeAt(0));
      const names = ["nina", "aria", "john", "kai", "mika", "sam", "jules", "rin", "alex", "tom", "yuki", "zoe"];
      const out = [];
      for (let i = 0; i < table.rows; i++) {
        const row = {};
        for (const [k, type, opt] of table.cols) {
          if (type === "id") row[k] = table.rows - i + 1000;
          else if (type === "email") row[k] = names[Math.floor(r() * names.length)] + Math.floor(r() * 99) + "@" + ["gmail.com", "proton.me", "studio.local", "icloud.com"][Math.floor(r() * 4)];
          else if (type === "enum" || type === "text") row[k] = opt[Math.floor(r() * opt.length)];
          else if (type === "int") row[k] = Math.round(opt[0] + Math.pow(r(), 1.6) * (opt[1] - opt[0]));
          else if (type === "money") row[k] = Math.round((opt[0] + Math.pow(r(), 2) * (opt[1] - opt[0])) * 100) / 100;
          else if (type === "bytes") row[k] = Math.round(opt[0] + Math.pow(r(), 2) * (opt[1] - opt[0]));
          else if (type === "ts") row[k] = (TODAY - Math.floor(Math.pow(r(), 1.3) * 180)) * DAY + Math.floor(r() * DAY);
        }
        out.push(row);
      }
      rowCache.set(key, out);
      return out;
    }

    return { series, totals, regions, mix, heat, slow, rows };
  })();

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */

  const PRESETS = [
    { id: "today", label: "Today", range: () => [TODAY, TODAY] },
    { id: "7d", label: "Last 7 days", range: () => [TODAY - 6, TODAY] },
    { id: "30d", label: "Last 30 days", range: () => [TODAY - 29, TODAY] },
    { id: "90d", label: "Last 90 days", range: () => [TODAY - 89, TODAY] },
    { id: "mtd", label: "Month to date", range: () => { const t = dayDate(TODAY); return [Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / DAY), TODAY]; } },
  ];
  const METRICS = [
    { id: "requests", label: "requests", title: "Requests", fmt: (v) => nfCompact.format(v), better: "up" },
    { id: "users", label: "users", title: "Active users / day", fmt: (v) => nfCompact.format(v), better: "up" },
    { id: "latency", label: "p95", title: "p95 latency", fmt: (v) => Math.round(v) + " ms", better: "down" },
    { id: "errors", label: "errors", title: "Error rate", fmt: (v) => v.toFixed(2) + "%", better: "down" },
    { id: "conns", label: "conns", title: "Open connections", fmt: (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))), better: "none" },
    { id: "cache", label: "cache", title: "Cache hit rate", fmt: (v) => v.toFixed(1) + "%", better: "up" },
  ];

  const state = {
    db: "prod-main",
    preset: "30d",
    start: TODAY - 29,
    end: TODAY,
    compare: true,
    metric: "requests",
    tableView: false,
    ex: { table: "orders", search: "", fcol: "", fval: "", sort: null, dir: -1, page: 0, size: 50 },
  };
  try {
    const saved = JSON.parse(localStorage.getItem("metrics-dash-state") || "null");
    if (saved && dbById(saved.db)) Object.assign(state, { db: saved.db, preset: saved.preset, metric: saved.metric });
    const p = PRESETS.find((x) => x.id === state.preset);
    if (p) [state.start, state.end] = p.range(); else state.preset = "30d";
  } catch { /* storage unavailable: defaults are fine */ }
  function persist() {
    try { localStorage.setItem("metrics-dash-state", JSON.stringify({ db: state.db, preset: state.preset, metric: state.metric })); } catch { /* ignore */ }
  }

  const rangeDays = () => state.end - state.start + 1;
  function rangeLabel() {
    const p = PRESETS.find((x) => x.id === state.preset);
    if (p) return p.label;
    if (state.start === state.end) return fmtDay(state.start, { year: "numeric" });
    return fmtDay(state.start) + " – " + fmtDay(state.end, { year: "numeric" });
  }

  /* ---------------------------------------------------------------------
     Tooltip
     --------------------------------------------------------------------- */

  const tip = $("#tooltip");
  function showTip(x, y, title, rows) {
    tip.replaceChildren(h("div", { class: "tt-title", text: title }));
    for (const r of rows) {
      const key = h("i", { class: r.dashed ? "dashed" : "" });
      key.style.borderColor = r.color || "transparent";
      tip.append(h("div", { class: "tt-row" }, key, h("b", { text: r.value }), h("span", { text: r.label })));
    }
    tip.hidden = false;
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + hgt > innerHeight - 8) top = y - hgt - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => (tip.hidden = true);
  function anchorOf(node) { const b = node.getBoundingClientRect(); return [b.left + b.width / 2, b.top]; }

  /* ---------------------------------------------------------------------
     Charts
     --------------------------------------------------------------------- */

  function sparkline(container, values, color) {
    const W = 200, H = 36;
    const max = Math.max(...values), min = Math.min(...values);
    const sx = (i) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W);
    const sy = (v) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "spark", "aria-hidden": "true" });
    const d = values.map((v, i) => (i ? "L" : "M") + sx(i).toFixed(1) + " " + sy(v).toFixed(1)).join("");
    el("path", { d: d + `L${W} ${H}L0 ${H}Z`, fill: color, "fill-opacity": 0.12 }, svg);
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }, svg);
    container.appendChild(svg);
  }

  function lineChart(container, cur, prev, metric) {
    container.replaceChildren();
    const W = Math.max(280, container.clientWidth), H = Math.round(Math.min(460, Math.max(220, W * 0.36)));
    const m = { l: 46, r: 58, t: 12, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = cur.map((b) => b[metric.id]);
    const pvals = prev ? prev.map((b) => b[metric.id]) : [];
    const ymax = niceMax(Math.max(...vals, ...pvals) * 1.05);
    const n = cur.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - (v / ymax) * ih;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${metric.title} over ${rangeLabel().toLowerCase()}` }, container);

    const axis = el("g", { class: "axis" }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = (ymax / 4) * i, yy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "baseline" }, axis);
      el("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end" }, axis).textContent = metric.fmt(v);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 78))));
    for (let i = 0; i < n; i += every) {
      el("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : "middle" }, axis).textContent = cur[i].label;
    }

    const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
    el("path", { d: path(vals) + `L${x(n - 1)} ${y(0)}L${x(0)} ${y(0)}Z`, fill: "var(--s1)", "fill-opacity": 0.08 }, svg);
    if (prev) el("path", { d: path(pvals), fill: "none", stroke: "var(--s-prev)", "stroke-width": 2, "stroke-dasharray": "5 4", "stroke-linejoin": "round" }, svg);
    el("path", { d: path(vals), fill: "none", stroke: "var(--s1)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    // Direct label on the current series' last point.
    el("circle", { cx: x(n - 1), cy: y(vals[n - 1]), r: 4, fill: "var(--s1)", class: "dot" }, svg);
    el("text", { x: x(n - 1) + 8, y: y(vals[n - 1]) + 4, class: "value-label" }, svg).textContent = metric.fmt(vals[n - 1]);

    const cross = el("g", { visibility: "hidden" }, svg);
    const cl = el("line", { y1: m.t, y2: m.t + ih, class: "crosshair" }, cross);
    const dPrev = prev ? el("circle", { r: 4, fill: "var(--s-prev)", class: "dot" }, cross) : null;
    const dCur = el("circle", { r: 4, fill: "var(--s1)", class: "dot" }, cross);

    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "hit", tabindex: 0, "aria-label": "Chart readout; use arrow keys" }, svg);
    let idx = n - 1;
    function show(i, cx, cy) {
      idx = Math.max(0, Math.min(n - 1, i));
      const xx = x(idx);
      cl.setAttribute("x1", xx); cl.setAttribute("x2", xx);
      dCur.setAttribute("cx", xx); dCur.setAttribute("cy", y(vals[idx]));
      if (dPrev) { dPrev.setAttribute("cx", xx); dPrev.setAttribute("cy", y(pvals[idx])); }
      cross.setAttribute("visibility", "visible");
      const rows = [{ color: "var(--s1)", value: metric.fmt(vals[idx]), label: "this period" }];
      if (prev) rows.push({ color: "var(--s-prev)", dashed: true, value: metric.fmt(pvals[idx]), label: "previous · " + prev[idx].label });
      if (cx == null) { const b = svg.getBoundingClientRect(); cx = b.left + (xx / W) * b.width; cy = b.top + (y(vals[idx]) / H) * b.height; }
      showTip(cx, cy, cur[idx].label, rows);
    }
    hit.addEventListener("pointermove", (e) => {
      const b = svg.getBoundingClientRect();
      const px = ((e.clientX - b.left) / b.width) * W;
      show(Math.round(((px - m.l) / iw) * (n - 1)), e.clientX, e.clientY);
    });
    const leave = () => { cross.setAttribute("visibility", "hidden"); hideTip(); };
    hit.addEventListener("pointerleave", leave);
    hit.addEventListener("blur", leave);
    hit.addEventListener("focus", () => show(idx));
    hit.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show(idx + (e.key === "ArrowLeft" ? -1 : 1)); }
      if (e.key === "Home") { e.preventDefault(); show(0); }
      if (e.key === "End") { e.preventDefault(); show(n - 1); }
    });
  }

  function barChart(container, data) {
    container.replaceChildren();
    const W = Math.max(240, container.clientWidth);
    // Rows grow so the bars fill roughly the height of the time series beside them.
    const ts = $("#ts-chart svg");
    const target = Math.max(200, Math.min(420, ts && !$("#ts-chart").hidden ? ts.getBoundingClientRect().height : 300));
    const rowH = Math.round(Math.max(32, Math.min(64, target / data.length))), bh = Math.min(22, Math.round(rowH * 0.45)), labelW = 92, valW = 56;
    const H = data.length * rowH + 4;
    const max = Math.max(...data.map((d) => d.value));
    const total = data.reduce((a, d) => a + d.value, 0);
    const iw = W - labelW - valW;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Requests by region" }, container);
    el("line", { x1: labelW, x2: labelW, y1: 0, y2: H, class: "baseline" }, svg);
    data.forEach((d, i) => {
      const y0 = i * rowH + (rowH - bh) / 2;
      const w = Math.max(2, (d.value / max) * iw);
      const g = el("g", {}, svg);
      el("text", { x: labelW - 10, y: y0 + bh - 3, "text-anchor": "end", class: "label" }, g).textContent = d.name;
      const r = Math.min(2, w / 2);
      const bar = el("path", { class: "mark", fill: "var(--s1)", d: `M${labelW} ${y0}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${bh - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z` }, g);
      el("text", { x: labelW + w + 6, y: y0 + bh - 3, class: "value-label" }, g).textContent = nfCompact.format(d.value);
      const hit = el("rect", { x: 0, y: i * rowH, width: W, height: rowH, class: "hit", tabindex: 0, "aria-label": `${d.name}: ${nfInt.format(Math.round(d.value))} requests` }, g);
      const on = (e) => {
        bar.classList.add("hover");
        const [ax, ay] = e && e.clientX != null ? [e.clientX, e.clientY] : anchorOf(bar);
        showTip(ax, ay, d.name, [{ color: "var(--s1)", value: nfInt.format(Math.round(d.value)), label: "requests" }, { value: ((d.value / total) * 100).toFixed(1) + "%", label: "of total" }]);
      };
      const off = () => { bar.classList.remove("hover"); hideTip(); };
      hit.addEventListener("pointermove", on); hit.addEventListener("focus", () => on()); hit.addEventListener("pointerleave", off); hit.addEventListener("blur", off);
    });
  }

  const MIX_COLORS = { SELECT: "var(--s1)", INSERT: "var(--s2)", UPDATE: "var(--s3)", DELETE: "var(--s4)" };
  function stackedChart(container, data) {
    container.replaceChildren();
    const W = Math.max(240, container.clientWidth), H = Math.round(Math.min(340, Math.max(200, W * 0.55)));
    const m = { l: 40, r: 6, t: 8, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totals = data.map((d) => d.values.reduce((a, v) => a + v.value, 0));
    const ymax = niceMax(Math.max(...totals) * 1.05);
    const y = (v) => (v / ymax) * ih;
    const slot = iw / data.length, bw = Math.max(2, slot - 2);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Query mix by type over time" }, container);
    const axis = el("g", { class: "axis" }, svg);
    for (let i = 0; i <= 3; i++) {
      const v = (ymax / 3) * i, yy = m.t + ih - y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "baseline" }, axis);
      el("text", { x: m.l - 6, y: yy + 3.5, "text-anchor": "end" }, axis).textContent = nfCompact.format(v);
    }
    [0, data.length - 1].forEach((i, k) => {
      el("text", { x: k ? W - m.r : m.l, y: H - 6, "text-anchor": k ? "end" : "start" }, axis).textContent = data[i].label.split(" – ")[0];
    });
    const cols = [];
    data.forEach((d, i) => {
      const g = el("g", { class: "mark" }, svg);
      const x0 = m.l + i * slot + 1;
      let base = m.t + ih;
      d.values.forEach((v, j) => {
        const full = y(v.value);
        const hgt = Math.max(0, full - (j ? 2 : 0)); // 2px surface gap between segments
        if (hgt <= 0) { base -= full; return; }
        const yTop = base - full;
        const r = 0; // square tops: terminal look
        el("path", { fill: MIX_COLORS[v.key], d: `M${x0} ${yTop + hgt}v${-(hgt - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hgt - r}z` }, g);
        base -= full;
      });
      cols.push(g);
      const hit = el("rect", { x: m.l + i * slot, y: m.t, width: slot, height: ih, class: "hit", tabindex: -1 }, svg);
      const on = (e) => {
        cols.forEach((c, k) => c.classList.toggle("dim", k !== i));
        const rows = d.values.slice().reverse().map((v) => ({ color: MIX_COLORS[v.key], value: nfCompact.format(v.value), label: v.key }));
        rows.push({ value: nfCompact.format(totals[i]), label: "total queries" });
        showTip(e.clientX, e.clientY, d.label, rows);
      };
      hit.addEventListener("pointermove", on);
      hit.addEventListener("pointerleave", () => { cols.forEach((c) => c.classList.remove("dim")); hideTip(); });
    });
  }

  function heatmap(container, grid) {
    container.replaceChildren();
    const W = Math.max(240, container.clientWidth);
    const lw = 34, gap = 2, cw = (W - lw) / 24, ch = Math.max(14, Math.min(36, cw * 1.5));
    const H = 7 * (ch + gap) + 18;
    const flat = grid.flat().filter((v) => v != null);
    const min = Math.min(...flat), max = Math.max(...flat);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Average requests by weekday and hour" }, container);
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    grid.forEach((row, ri) => {
      el("text", { x: 0, y: ri * (ch + gap) + ch - 5, class: "axis" }, svg).textContent = DAYS[ri];
      row.forEach((v, hr) => {
        const p = v == null ? 0 : Math.round(((v - min) / (max - min || 1)) * 100);
        const cell = el("rect", { x: lw + hr * cw, y: ri * (ch + gap), width: Math.max(1, cw - gap), height: ch, class: v == null ? "cell-empty" : "mark" }, svg);
        if (v != null) cell.style.fill = `color-mix(in oklab, var(--seq-hi) ${p}%, var(--seq-lo))`;
        cell.addEventListener("pointermove", (e) => {
          cell.classList.add("hover");
          showTip(e.clientX, e.clientY, `${DAYS[ri]} ${pad(hr)}:00`, [{ value: v == null ? "no data" : nfCompact.format(v), label: v == null ? "weekday not in range" : "avg requests / hour" }]);
        });
        cell.addEventListener("pointerleave", () => { cell.classList.remove("hover"); hideTip(); });
      });
    });
    [0, 6, 12, 18, 23].forEach((hr) => {
      el("text", { x: lw + hr * cw + cw / 2, y: H - 3, "text-anchor": "middle", class: "axis" }, svg).textContent = pad(hr);
    });
    $("#heat-range").textContent = `${nfCompact.format(min)}–${nfCompact.format(max)} req/h`;
  }

  /* ---------------------------------------------------------------------
     Panels
     --------------------------------------------------------------------- */

  let cache = null;
  function compute() {
    const db = dbById(state.db);
    const n = rangeDays();
    cache = {
      db,
      cur: Data.series(db, state.start, state.end),
      prev: Data.series(db, state.start - n, state.end - n),
      tot: Data.totals(db, state.start, state.end),
      ptot: Data.totals(db, state.start - n, state.end - n),
    };
  }

  function renderHead() {
    const n = rangeDays();
    $("#page-title").textContent = cache.db.id;
    $("#page-sub").textContent = `${isoDay(state.start)} → ${isoDay(state.end)} · ${n} day${n > 1 ? "s" : ""}` + (state.compare ? ` vs previous ${n}` : "");
    $("#picker-label").textContent = rangeLabel();
  }

  function renderKpis() {
    const box = $("#kpis");
    box.replaceChildren();
    METRICS.forEach((m) => {
      const v = cache.tot[m.id], pv = cache.ptot[m.id];
      const pct = ((v - pv) / pv) * 100;
      const tone = m.better === "none" ? "flat" : (pct >= 0) === (m.better === "up") ? "good" : "bad";
      const tile = h("div", { class: "kpi" },
        h("span", { class: "label", text: m.title }),
        h("span", { class: "value", text: m.fmt(v) }),
        state.compare
          ? h("span", { class: "delta" }, h("b", { class: tone, text: (pct >= 0 ? "▲ " : "▼ ") + Math.abs(pct).toFixed(1) + "%" }), " vs previous")
          : h("span", { class: "delta", text: "comparison off" }));
      box.appendChild(tile);
      const spark = h("div");
      tile.appendChild(spark);
      sparkline(spark, cache.cur.map((b) => b[m.id]), "var(--s1)");
      spark.firstChild.style.width = "100%";
      spark.firstChild.style.height = "28px";
    });
  }

  function renderMetricTabs() {
    const box = $("#metric-tabs");
    box.replaceChildren();
    METRICS.forEach((m) => {
      box.appendChild(h("button", {
        type: "button", role: "tab", "aria-selected": String(m.id === state.metric), text: m.label,
        onclick: () => { state.metric = m.id; persist(); renderMetricTabs(); renderTimeseries(); },
      }));
    });
  }

  function renderTimeseries() {
    const m = METRICS.find((x) => x.id === state.metric);
    $("#ts-title").textContent = m.title + " over time";
    const legend = $("#ts-legend");
    legend.replaceChildren();
    const key = (cls, color, text) => { const k = h("i", { class: cls }); k.style.borderColor = color; return h("span", {}, k, text); };
    legend.append(key("key-line", "var(--s1)", "This period"));
    if (state.compare) legend.append(key("key-line dashed", "var(--s-prev)", "Previous period"));
    legend.append(h("span", { text: rangeDays() > 2 ? "Daily" : "Hourly" }));

    const chart = $("#ts-chart"), table = $("#ts-table");
    chart.hidden = state.tableView; table.hidden = !state.tableView;
    $("#ts-view").setAttribute("aria-pressed", String(state.tableView));
    $("#ts-view").textContent = state.tableView ? "Chart" : "Table";
    if (state.tableView) {
      const t = h("table", { class: "data" });
      t.append(h("thead", {}, h("tr", {}, h("th", { text: "bucket" }), h("th", { class: "num", text: "this period" }), state.compare ? h("th", { class: "num", text: "previous" }) : null)));
      const tb = h("tbody");
      cache.cur.forEach((b, i) => tb.append(h("tr", {}, h("td", { class: "mono", text: b.label }), h("td", { class: "num mono", text: m.fmt(b[m.id]) }), state.compare ? h("td", { class: "num mono", text: m.fmt(cache.prev[i][m.id]) }) : null)));
      t.append(tb);
      table.replaceChildren(t);
    } else {
      lineChart(chart, cache.cur, state.compare ? cache.prev : null, m);
    }
  }

  function renderRegions() { barChart($("#region-chart"), Data.regions(cache.db, state.start, state.end)); }

  function renderMix() {
    const legend = $("#mix-legend");
    legend.replaceChildren();
    for (const k in MIX_COLORS) {
      const r = h("i", { class: "key-rect" });
      r.style.background = MIX_COLORS[k];
      legend.append(h("span", {}, r, k));
    }
    stackedChart($("#mix-chart"), Data.mix(cache.db, cache.cur));
  }

  function renderHeat() { heatmap($("#heat-chart"), Data.heat(cache.db, state.start, state.end)); }

  function renderSlow() {
    const list = $("#slow-log");
    list.replaceChildren();
    for (const q of Data.slow(cache.db, state.start, state.end)) {
      const level = q.ms > 5000 ? ["bad", "critical"] : q.ms > 2000 ? ["warn", "slow"] : ["", "ok"];
      const d = new Date(q.t);
      list.append(h("li", {},
        h("span", { class: "led " + level[0], title: level[1] }),
        h("code", { text: q.sql, title: q.sql }),
        h("span", { class: "dur", text: (q.ms / 1000).toFixed(2) + " s" }),
        h("span", { class: "when", text: `${level[1]} · ${isoDay(Math.floor(q.t / DAY))} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` })));
    }
  }

  /* ---------------------------------------------------------------------
     Database explorer
     --------------------------------------------------------------------- */

  const exTable = () => cache.db.tables.find((t) => t.name === state.ex.table) || cache.db.tables[0];
  const tsCol = (t) => t.cols.find((c) => c[1] === "ts")[0];

  function fmtCell(type, v) {
    if (type === "ts") { const d = new Date(v); return `${isoDay(Math.floor(v / DAY))} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
    if (type === "money") return nfMoney.format(v);
    if (type === "bytes") return v > 1e6 ? (v / 1e6).toFixed(1) + " MB" : Math.round(v / 1e3) + " KB";
    if (type === "int") return nfInt.format(v);
    return String(v);
  }

  function exQuery() {
    const t = exTable(), ex = state.ex, ts = tsCol(t);
    const lo = state.start * DAY, hi = (state.end + 1) * DAY;
    const q = ex.search.trim().toLowerCase();
    let rows = Data.rows(cache.db, t).filter((r) => r[ts] >= lo && r[ts] < hi);
    if (ex.fcol && ex.fval) rows = rows.filter((r) => String(r[ex.fcol]) === ex.fval);
    if (q) rows = rows.filter((r) => t.cols.some(([k, type]) => (type === "text" || type === "email" || type === "enum") && String(r[k]).toLowerCase().includes(q)));
    const sortKey = ex.sort || ts;
    rows = rows.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * (ex.sort ? ex.dir : -1));
    return { t, rows, sortKey };
  }

  function sqlTokens(t, sortKey) {
    const ex = state.ex, ts = tsCol(t), out = [];
    const kw = (s) => out.push([s, "kw"]), str = (s) => out.push(["'" + s.replace(/'/g, "''") + "'", "str"]), txt = (s) => out.push([s, ""]);
    kw("SELECT"); txt(" * "); kw("FROM"); txt(` ${t.name}\n`);
    kw("WHERE"); txt(` ${ts} `); kw("BETWEEN"); txt(" "); str(isoDay(state.start)); txt(" "); kw("AND"); txt(" "); str(isoDay(state.end) + " 23:59:59");
    if (ex.fcol && ex.fval) { txt("\n  "); kw("AND"); txt(` ${ex.fcol} = `); str(ex.fval); }
    const q = ex.search.trim();
    if (q) {
      const searchable = t.cols.filter(([, type]) => type === "text" || type === "email" || type === "enum").map(([k]) => k);
      txt("\n  "); kw("AND"); txt(" (");
      searchable.forEach((k, i) => { if (i) { txt(" "); kw("OR"); txt(" "); } txt(k + " "); kw("ILIKE"); txt(" "); str("%" + q + "%"); });
      txt(")");
    }
    txt("\n"); kw("ORDER BY"); txt(` ${sortKey} `); kw(ex.sort && ex.dir === 1 ? "ASC" : "DESC");
    txt("\n"); kw("LIMIT"); txt(` ${ex.size} `); kw("OFFSET"); txt(` ${ex.page * ex.size};`);
    return out;
  }

  function renderSchema() {
    const box = $("#schema");
    box.replaceChildren(h("h3", { text: cache.db.engine }));
    $("#ex-db").textContent = cache.db.id;
    for (const t of cache.db.tables) {
      const sel = t.name === exTable().name;
      box.append(h("button", {
        type: "button", role: "tab", "aria-selected": String(sel),
        onclick: () => { Object.assign(state.ex, { table: t.name, fcol: "", fval: "", sort: null, page: 0, search: "" }); $("#ex-search").value = ""; renderSchema(); renderExFilters(); renderExplorer(); },
      }, t.name, h("span", { class: "count", text: nfInt.format(t.rows) })));
      if (sel) {
        box.append(h("div", { class: "cols" }, ...t.cols.map(([k, type]) => h("span", {}, h("b", { text: k }), " " + (type === "id" ? "bigint pk" : type === "ts" ? "timestamptz" : type)))));
      }
    }
  }

  function renderExFilters() {
    const t = exTable();
    const colSel = $("#ex-filter-col"), valSel = $("#ex-filter-val");
    colSel.replaceChildren(h("option", { value: "", text: "no filter" }));
    t.cols.filter((c) => c[1] === "enum").forEach(([k]) => colSel.append(h("option", { value: k, text: "where " + k })));
    colSel.value = state.ex.fcol;
    valSel.replaceChildren(h("option", { value: "", text: "= any" }));
    const col = t.cols.find((c) => c[0] === state.ex.fcol);
    if (col) [...new Set(col[2])].forEach((v) => valSel.append(h("option", { value: v, text: "= " + v })));
    valSel.value = state.ex.fval;
    valSel.disabled = !col;
  }

  function renderExplorer() {
    const { t, rows, sortKey } = exQuery();
    const ex = state.ex;
    const pages = Math.max(1, Math.ceil(rows.length / ex.size));
    ex.page = Math.min(ex.page, pages - 1);
    const slice = rows.slice(ex.page * ex.size, (ex.page + 1) * ex.size);

    const code = $("#ex-sql");
    code.replaceChildren(...sqlTokens(t, sortKey).map(([s, cls]) => (cls ? h("span", { class: cls, text: s }) : document.createTextNode(s))));

    const table = $("#ex-table");
    const numeric = (type) => type === "int" || type === "money" || type === "bytes" || type === "id";
    const head = h("tr");
    for (const [k, type] of t.cols) {
      const active = sortKey === k;
      const dir = ex.sort ? ex.dir : -1;
      const th = h("th", { class: numeric(type) ? "num" : "", scope: "col" });
      if (active) th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
      th.append(h("button", {
        type: "button",
        onclick: () => { if (ex.sort === k) ex.dir = -ex.dir; else { ex.sort = k; ex.dir = numeric(type) || type === "ts" ? -1 : 1; } ex.page = 0; renderExplorer(); },
      }, k, h("span", { class: "arrow", "aria-hidden": "true", text: active ? (dir === 1 ? "▲" : "▼") : "" })));
      head.append(th);
    }
    const body = h("tbody");
    if (!slice.length) body.append(h("tr", { class: "empty" }, h("td", { colspan: t.cols.length, text: "no rows match in this date range" })));
    for (const r of slice) {
      const id = r[t.cols[0][0]];
      const tr = h("tr", { tabindex: 0, "aria-selected": String(id === ex.selected), "aria-label": `Open ${t.name} row ${id}` });
      for (const [k, type] of t.cols) {
        const td = h("td", { class: (numeric(type) ? "num " : "") + (type === "id" || type === "ts" || type === "email" ? "mono" : "") });
        if (type === "enum") td.append(h("span", { class: "pill", text: String(r[k]) }));
        else td.textContent = fmtCell(type, r[k]);
        tr.append(td);
      }
      const open = () => {
        ex.selected = id;
        table.querySelectorAll("tbody tr").forEach((x) => x.setAttribute("aria-selected", String(x === tr)));
        inspect(t, r, true);
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      body.append(tr);
    }
    table.replaceChildren(h("thead", {}, head), body);

    const from = rows.length ? ex.page * ex.size + 1 : 0;
    $("#ex-info").textContent = `${from}–${ex.page * ex.size + slice.length} of ${nfInt.format(rows.length)} rows in range · page ${ex.page + 1}/${pages}`;
    $("#ex-prev").disabled = ex.page === 0;
    $("#ex-next").disabled = ex.page >= pages - 1;

    // The docked inspector always shows a row: the selected one if visible, else the first.
    const sel = slice.find((r) => r[t.cols[0][0]] === ex.selected) || slice[0];
    if (sel) {
      if (!slice.some((r) => r[t.cols[0][0]] === ex.selected)) {
        ex.selected = sel[t.cols[0][0]];
        const first = table.querySelector("tbody tr");
        if (first) first.setAttribute("aria-selected", "true");
      }
      inspect(t, sel, false);
    } else {
      $("#ex-detail").replaceChildren(h("h3", { text: "No row selected" }));
    }
  }

  const dlg = $("#inspector");
  const docked = matchMedia("(min-width: 1400px)");
  function detailNodes(t, r) {
    const obj = {};
    for (const [k, type] of t.cols) obj[k] = type === "ts" ? new Date(r[k]).toISOString() : r[k];
    const json = JSON.stringify(obj, null, 2);
    const dl = h("dl");
    for (const [k, type] of t.cols) dl.append(h("dt", { text: k }), h("dd", { text: fmtCell(type, r[k]) }));
    const copy = h("button", { class: "btn sm", type: "button", text: "Copy JSON", onclick: (e) => copyText(json, e.currentTarget) });
    return h("div", { class: "detail" }, dl, h("div", { class: "detail-json" }, h("pre", { text: json }), copy));
  }
  // fromUser: a click or Enter on a row. Narrow screens open the drawer; wide screens update the docked pane.
  function inspect(t, r, fromUser) {
    const title = `${t.name} #${r[t.cols[0][0]]}`;
    $("#ex-detail").replaceChildren(h("h3", { text: title }), detailNodes(t, r));
    if (fromUser && !docked.matches) {
      $("#insp-title").textContent = title;
      $("#insp-body").replaceChildren(detailNodes(t, r));
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    }
  }
  $("#insp-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------------------------------------------------------------------
     Connections & database select
     --------------------------------------------------------------------- */

  function renderConnections() {
    const box = $("#connections"), sel = $("#db-select");
    box.replaceChildren();
    sel.replaceChildren();
    for (const db of DBS) {
      box.append(h("button", { type: "button", class: "conn", title: `${db.id} (${db.statusText})`, "aria-pressed": String(db.id === state.db), onclick: () => setDb(db.id) },
        h("span", { class: "led " + (db.status === "ok" ? "" : db.status), title: db.statusText }),
        h("span", { class: "name", text: db.id }),
        h("span", { class: "meta", text: db.engine + " · " + db.statusText })));
      sel.append(h("option", { value: db.id, text: db.id }));
    }
    sel.value = state.db;
  }
  function setDb(id) {
    if (id === state.db) return;
    state.db = id;
    Object.assign(state.ex, { table: dbById(id).tables[0].name, fcol: "", fval: "", sort: null, page: 0, search: "" });
    $("#ex-search").value = "";
    persist();
    renderConnections();
    refresh();
    $("#sidebar").classList.remove("open");
  }
  $("#db-select").addEventListener("change", (e) => setDb(e.target.value));

  /* ---------------------------------------------------------------------
     Date range picker
     --------------------------------------------------------------------- */

  const pop = $("#picker-pop"), pbtn = $("#picker-btn");
  const cal = { view: 0, a: null, b: null, hover: null }; // view = UTC month index (year*12+month) of the left month

  function monthIndex(d) { const t = dayDate(d); return t.getUTCFullYear() * 12 + t.getUTCMonth(); }

  function openPicker() {
    cal.a = state.start; cal.b = state.end; cal.hover = null;
    cal.view = monthIndex(state.end) - 1;
    renderPresets(); renderCal();
    pop.hidden = false;
    pbtn.setAttribute("aria-expanded", "true");
    (pop.querySelector('[aria-checked="true"]') || pop.querySelector("button")).focus();
  }
  function closePicker(focus) {
    pop.hidden = true;
    pbtn.setAttribute("aria-expanded", "false");
    if (focus) pbtn.focus();
  }
  pbtn.addEventListener("click", () => (pop.hidden ? openPicker() : closePicker()));
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !$("#picker").contains(e.target)) closePicker(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) closePicker(true); });

  function applyRange(start, end, preset) {
    state.start = start; state.end = end; state.preset = preset;
    persist();
    closePicker(true);
    refresh();
  }

  function renderPresets() {
    const box = $("#presets");
    box.replaceChildren();
    const custom = !PRESETS.some((p) => p.id === state.preset);
    for (const p of PRESETS) {
      const on = p.id === state.preset;
      box.append(h("button", { type: "button", role: "radio", "aria-checked": String(on), onclick: () => { const [s, e] = p.range(); applyRange(s, e, p.id); } },
        h("span", { class: "tick", "aria-hidden": "true", text: on ? "✓" : "" }), p.label));
    }
    box.append(h("button", { type: "button", role: "radio", "aria-checked": String(custom), onclick: () => { const f = pop.querySelector(".cal-grid button:not([disabled])"); if (f) f.focus(); } },
      h("span", { class: "tick", "aria-hidden": "true", text: custom ? "✓" : "" }), "Custom range"));
  }

  function renderCal() {
    const box = $("#cal-months");
    box.replaceChildren();
    const lo = cal.a, hi = cal.b != null ? cal.b : cal.hover;
    const [rs, re] = hi == null ? [lo, lo] : [Math.min(lo, hi), Math.max(lo, hi)];
    for (let k = 0; k < 2; k++) {
      const mi = cal.view + k, y = Math.floor(mi / 12), mo = mi % 12;
      const first = Math.floor(Date.UTC(y, mo, 1) / DAY), last = Math.floor(Date.UTC(y, mo + 1, 1) / DAY) - 1;
      const grid = h("div", { class: "cal-grid", role: "grid" });
      ["M", "T", "W", "T", "F", "S", "S"].forEach((d) => grid.append(h("span", { class: "dow", "aria-hidden": "true", text: d })));
      for (let i = 0; i < (weekday(first) + 6) % 7; i++) grid.append(h("span"));
      for (let d = first; d <= last; d++) {
        const cls = [];
        if (lo != null && d >= rs && d <= re) cls.push(d === rs || d === re ? "edge" : "in-range");
        if (d === TODAY) cls.push("today");
        const b = h("button", { type: "button", class: cls.join(" "), text: String(d - first + 1), "aria-label": fmtDay(d, { weekday: "long", year: "numeric" }), "data-day": d });
        if (d > TODAY) b.disabled = true;
        b.addEventListener("click", () => pickDay(d));
        b.addEventListener("pointerenter", () => { if (cal.a != null && cal.b == null) { cal.hover = d; renderCal(); } });
        grid.append(b);
      }
      box.append(h("div", { class: "cal" }, h("h4", { text: dayDate(first).toLocaleDateString("en", { timeZone: "UTC", month: "long", year: "numeric" }) }), grid));
    }
    $("#cal-next").disabled = cal.view + 1 >= monthIndex(TODAY);
    const sel = $("#cal-sel");
    if (cal.a == null) sel.textContent = "pick a start date";
    else if (cal.b == null) sel.textContent = `${fmtDay(cal.a)} → pick an end date`;
    else sel.textContent = `${fmtDay(Math.min(cal.a, cal.b))} → ${fmtDay(Math.max(cal.a, cal.b), { year: "numeric" })} · ${Math.abs(cal.b - cal.a) + 1} days`;
    $("#cal-apply").disabled = cal.a == null;
  }
  function pickDay(d) {
    if (cal.a == null || cal.b != null) { cal.a = d; cal.b = null; }
    else cal.b = d;
    cal.hover = null;
    renderCal();
    const again = pop.querySelector(`[data-day="${d}"]`);
    if (again) again.focus();
  }
  $("#cal-prev").addEventListener("click", () => { cal.view--; renderCal(); });
  $("#cal-next").addEventListener("click", () => { cal.view++; renderCal(); });
  $("#cal-cancel").addEventListener("click", () => closePicker(true));
  $("#cal-apply").addEventListener("click", () => {
    const b = cal.b == null ? cal.a : cal.b;
    applyRange(Math.min(cal.a, b), Math.max(cal.a, b), "custom");
  });
  // Arrow keys move between days inside the calendar.
  $("#cal-months").addEventListener("keydown", (e) => {
    const cur = e.target.closest("[data-day]");
    if (!cur) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = Math.min(TODAY, +cur.dataset.day + step);
    const mi = monthIndex(next);
    if (mi < cal.view) cal.view = mi; else if (mi > cal.view + 1) cal.view = mi - 1;
    if (cal.a != null && cal.b == null) cal.hover = next;
    renderCal();
    const n = pop.querySelector(`[data-day="${next}"]`);
    if (n) n.focus();
  });

  /* ---------------------------------------------------------------------
     Wiring
     --------------------------------------------------------------------- */

  $("#compare").checked = state.compare;
  $("#compare").addEventListener("change", (e) => { state.compare = e.target.checked; renderHead(); renderKpis(); renderTimeseries(); });
  $("#ts-view").addEventListener("click", () => { state.tableView = !state.tableView; renderTimeseries(); });
  $("#refresh").addEventListener("click", refresh);

  let searchTimer;
  $("#ex-search").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.ex.search = e.target.value; state.ex.page = 0; renderExplorer(); }, 150); });
  $("#ex-filter-col").addEventListener("change", (e) => { state.ex.fcol = e.target.value; state.ex.fval = ""; state.ex.page = 0; renderExFilters(); renderExplorer(); });
  $("#ex-filter-val").addEventListener("change", (e) => { state.ex.fval = e.target.value; state.ex.page = 0; renderExplorer(); });
  $("#ex-size").addEventListener("change", (e) => { state.ex.size = +e.target.value; state.ex.page = 0; renderExplorer(); });
  $("#ex-prev").addEventListener("click", () => { state.ex.page--; renderExplorer(); });
  $("#ex-next").addEventListener("click", () => { state.ex.page++; renderExplorer(); });
  $("#ex-copy").addEventListener("click", (e) => copyText($("#ex-sql").textContent, e.currentTarget));

  $("#export").addEventListener("click", () => {
    if (!$("#radar-view").hidden) {
      const rows = ["service,region,kind,p95_ms,req_per_min"].concat(radar.services.map((x) => [x.name, x.region, x.kind, x.lat.toFixed(1), x.rpm.toFixed(1)].join(",")));
      const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
      const a = h("a", { href: url, download: `${state.db}_radar.csv` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const lines = ["bucket,requests,users,p95_latency_ms,error_rate_pct"];
    for (const b of cache.cur) lines.push([new Date(b.t).toISOString(), Math.round(b.requests), Math.round(b.users), b.latency.toFixed(1), b.errors.toFixed(3)].join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = h("a", { href: url, download: `${state.db}_${isoDay(state.start)}_${isoDay(state.end)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function renderAll() {
    compute();
    renderHead(); renderKpis(); renderMetricTabs(); renderTimeseries();
    renderRegions(); renderMix(); renderHeat(); renderSlow();
    renderSchema(); renderExFilters(); renderExplorer();
    renderRadar();
    const t = new Date();
    $("#updated").textContent = `updated ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  }

  // Refetch keeps the frame: dim the current render, then swap in the new one.
  const content = $("#main");
  function refresh() {
    content.classList.add("is-loading");
    setTimeout(() => { renderAll(); content.classList.remove("is-loading"); }, 220);
  }

  // Charts are drawn at their container's pixel width; redraw on resize.
  let resizeTimer, lastW = 0;
  new ResizeObserver(() => {
    const w = content.clientWidth;
    if (w === lastW) return;
    lastW = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!cache) return;
      if (!$("#radar-view").hidden) { renderScope(); renderSignal(); setFocus(radar.focus); return; }
      renderTimeseries(); renderRegions(); renderMix(); renderHeat();
    }, 120);
  }).observe(content);

  /* ---------------------------------------------------------------------
     Radar view: services as blips on a latency scope
     --------------------------------------------------------------------- */

  const KINDS = { api: "var(--s1)", web: "var(--s2)", worker: "var(--s3)", batch: "var(--s4)" };
  const SERVICE_POOL = [["api-gateway", "api"], ["auth", "api"], ["search", "api"], ["web-ssr", "web"], ["cdn-edge", "web"], ["job-worker", "worker"], ["mailer", "worker"], ["etl-nightly", "batch"], ["report-cron", "batch"]];
  const KIND_LAT = { api: 0.55, web: 0.85, worker: 1.35, batch: 2.4 };
  const KIND_RPM = { api: 1, web: 0.8, worker: 0.3, batch: 0.08 };
  const PERIOD = 6; // sweep seconds

  const radar = { services: [], live: true, timer: null, events: [], focus: null, blips: new Map(), rows: new Map() };

  function buildServices() {
    const db = cache.db, n = rangeDays();
    const loadLat = cache.tot.latency / db.lat; // range-level latency drift vs the database baseline
    const rpmTotal = cache.tot.requests / (n * 1440);
    const r = seeded(db.seed * 97 + 5);
    const out = [];
    db.regions.forEach(([region, share], ri) => {
      const pool = SERVICE_POOL.slice().sort(() => r() - 0.5);
      const count = 2 + Math.floor(r() * 2);
      for (let k = 0; k < count; k++) {
        const [name, kind] = pool[k];
        const lat = db.slo * 0.62 * KIND_LAT[kind] * (0.8 + 0.12 * ri) * (0.7 + 0.6 * hash(db.seed, ri, k, state.start, 11)) * loadLat;
        out.push({ id: region + "/" + name, name, kind, region, ri, base: lat, walk: 1, lat, weight: share * KIND_RPM[kind] * (0.6 + 0.8 * r()) });
      }
    });
    const wsum = out.reduce((a, x) => a + x.weight, 0);
    out.forEach((x) => (x.rpm = rpmTotal * x.weight / wsum));
    return out;
  }

  const sloState = (svc) => { const q = svc.lat / cache.db.slo; return q > 1 ? ["bad", "over SLO"] : q > 0.8 ? ["warn", "near SLO"] : ["", "ok"]; };
  const fmtMs = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + " ms";

  let scopeGeo = null;
  function scopeScale() {
    const slo = cache.db.slo, lo = slo / 16, hi = slo * 3, { R } = scopeGeo;
    return (v) => (Math.log(Math.max(lo, Math.min(hi, v)) / lo) / Math.log(hi / lo)) * R;
  }
  function polar(a, rr) {
    const { cx, cy } = scopeGeo, t = (a * Math.PI) / 180;
    return [cx + rr * Math.sin(t), cy - rr * Math.cos(t)];
  }

  function renderScope() {
    const box = $("#scope");
    box.replaceChildren();
    const W = box.clientWidth || 600;
    const S = Math.round(Math.max(300, Math.min(W, innerHeight - 190, 820)));
    scopeGeo = { S, cx: S / 2, cy: S / 2, R: S / 2 - 36 };
    const { cx, cy, R } = scopeGeo, rad = scopeScale(), slo = cache.db.slo;
    const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: "img", "aria-label": `Latency scope: ${radar.services.length} services around ${cache.db.id}` }, box);
    svg.style.setProperty("--period", PERIOD + "s");

    // Breach zone beyond the SLO ring (dithered), then range rings.
    const defs = el("defs", {}, svg);
    const pat = el("pattern", { id: "dither", width: 4, height: 4, patternUnits: "userSpaceOnUse" }, defs);
    el("rect", { width: 1, height: 1, class: "dither-dot" }, pat);
    el("rect", { x: 2, y: 2, width: 1, height: 1, class: "dither-dot" }, pat);
    const rs = rad(slo);
    el("path", { class: "scope-breach", "fill-rule": "evenodd", d: `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0zM${cx - rs} ${cy}a${rs} ${rs} 0 1 1 ${2 * rs} 0a${rs} ${rs} 0 1 1 ${-2 * rs} 0z` }, svg);
    [1 / 8, 1 / 4, 1 / 2, 1, 2].forEach((f) => {
      const v = slo * f, rr = rad(v);
      el("circle", { cx, cy, r: rr, class: "scope-ring" + (f === 1 ? " slo" : "") }, svg);
      el("text", { x: cx + 4, y: cy - rr - 3, class: "axis" }, svg).textContent = f === 1 ? `SLO ${fmtMs(v)}` : fmtMs(v);
    });
    el("circle", { cx, cy, r: R, class: "scope-ring" }, svg);

    // Bearing ticks every 5°, longer every 30°.
    for (let a = 0; a < 360; a += 5) {
      const [x1, y1] = polar(a, R), [x2, y2] = polar(a, R + (a % 30 ? 4 : 9));
      el("line", { x1, y1, x2, y2, class: "scope-tick" }, svg);
    }

    // Region sectors: spokes and labels.
    const regions = cache.db.regions.map(([name]) => name), sw = 360 / regions.length;
    regions.forEach((name, i) => {
      const [x, y] = polar(i * sw, R);
      el("line", { x1: cx, y1: cy, x2: x, y2: y, class: "scope-spoke" }, svg);
      const mid = i * sw + sw / 2, [lx, ly] = polar(mid, R + 22);
      const t = el("text", { x: lx, y: ly + 3, "text-anchor": "middle", class: "label" }, svg);
      t.textContent = name;
    });

    // Sweep: a leading edge with a fading trail, rotating around the centre.
    const sweep = el("g", { class: "scope-sweep", "aria-hidden": "true" }, svg);
    sweep.style.transformOrigin = `${cx}px ${cy}px`;
    for (let k = 0; k < 10; k++) {
      const a0 = -(k + 1) * 4, a1 = -k * 4;
      const [x0, y0] = polar(a0, R), [x1, y1] = polar(a1, R);
      el("path", { class: "trail", "fill-opacity": (0.16 * (1 - k / 10)).toFixed(3), d: `M${cx} ${cy}L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z` }, sweep);
    }
    const [ex, ey] = polar(0, R);
    el("line", { x1: cx, y1: cy, x2: ex, y2: ey, class: "edge" }, sweep);

    // Blips.
    radar.blips.clear();
    const layer = el("g", {}, svg);
    const maxRpm = Math.max(...radar.services.map((x) => x.rpm));
    const labelled = new Set(radar.services.slice().sort((a, b) => b.rpm - a.rpm).slice(0, 3).map((x) => x.id));
    const perRegion = {};
    radar.services.forEach((x) => (perRegion[x.ri] = (perRegion[x.ri] || 0) + 1));
    const seen = {};
    radar.services.forEach((svc) => {
      const j = (seen[svc.ri] = (seen[svc.ri] || 0) + 1);
      svc.angle = svc.ri * sw + (j * sw) / (perRegion[svc.ri] + 1);
      const size = 4 + Math.sqrt(svc.rpm / maxRpm) * 10;
      const g = el("g", { class: "blip", tabindex: 0, role: "button", "aria-label": `${svc.name} in ${svc.region}` }, layer);
      const ping = el("circle", { r: size, class: "ping", stroke: KINDS[svc.kind] }, g);
      ping.style.animationDelay = ((svc.angle / 360) * PERIOD).toFixed(2) + "s";
      el("circle", { r: size, class: "core", fill: KINDS[svc.kind] }, g);
      const label = el("text", { x: size + 4, y: 3.5 }, g);
      const show = () => labelled.has(svc.id) || sloState(svc)[0] === "bad";
      label.textContent = svc.name;
      const tip = (e) => {
        const [st, stText] = sloState(svc);
        const [ax, ay] = e && e.clientX != null ? [e.clientX, e.clientY] : anchorOf(g);
        showTip(ax, ay, `${svc.name} · ${svc.region}`, [
          { color: KINDS[svc.kind], value: fmtMs(svc.lat), label: "p95 · " + stText },
          { value: nfCompact.format(svc.rpm), label: "req / min" },
          { value: svc.kind, label: "kind" },
        ]);
        setFocus(svc.id);
      };
      g.addEventListener("pointermove", tip);
      g.addEventListener("focus", () => tip());
      g.addEventListener("pointerleave", () => { hideTip(); setFocus(null); });
      g.addEventListener("blur", () => { hideTip(); setFocus(null); });
      radar.blips.set(svc.id, { g, label, show });
    });
    placeBlips();
  }

  function placeBlips() {
    const rad = scopeScale();
    for (const svc of radar.services) {
      const b = radar.blips.get(svc.id);
      if (!b) continue;
      const [x, y] = polar(svc.angle, rad(svc.lat));
      b.g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      b.label.style.display = b.show() ? "" : "none";
    }
  }

  function setFocus(id) {
    radar.focus = id;
    $("#scope").classList.toggle("scope-dim", !!id);
    radar.blips.forEach((b, k) => b.g.classList.toggle("on", k === id));
    radar.rows.forEach((row, k) => row.li.classList.toggle("on", k === id));
  }

  function renderContacts() {
    const list = $("#contacts");
    list.replaceChildren();
    radar.rows.clear();
    for (const svc of radar.services) {
      const led = h("span", { class: "led" });
      const ms = h("b"), stTxt = h("span");
      const lat = h("span", { class: "lat" }, ms, stTxt);
      const meta = h("span");
      const gauge = h("span", { class: "gauge", "aria-hidden": "true" }, ...Array.from({ length: 12 }, () => h("i")));
      const key = h("i", { class: "kind" });
      key.style.background = KINDS[svc.kind];
      const li = h("li", { tabindex: 0 }, led, h("span", { class: "who" }, h("b", {}, key, svc.name), meta), lat, gauge);
      li.addEventListener("pointerenter", () => setFocus(svc.id));
      li.addEventListener("pointerleave", () => setFocus(null));
      li.addEventListener("focus", () => setFocus(svc.id));
      li.addEventListener("blur", () => setFocus(null));
      radar.rows.set(svc.id, { li, led, ms, stTxt, meta, gauge });
      list.append(li);
    }
    updateContacts();
  }

  function updateContacts() {
    const slo = cache.db.slo;
    const sorted = radar.services.slice().sort((a, b) => b.lat / slo - a.lat / slo);
    const list = $("#contacts");
    sorted.forEach((svc) => {
      const row = radar.rows.get(svc.id);
      const [st, stText] = sloState(svc);
      row.led.className = "led " + st;
      row.led.title = stText;
      row.ms.textContent = fmtMs(svc.lat);
      row.stTxt.textContent = stText;
      row.meta.textContent = `${svc.region} · ${svc.kind} · ${nfCompact.format(svc.rpm)} rpm`;
      const cells = Math.round((svc.lat / slo) * 10);
      [...row.gauge.children].forEach((c, i) => (c.className = i < Math.min(cells, 12) ? (i >= 10 ? "over" : "fill") : ""));
      list.append(row.li); // re-append in sorted order
    });
    $("#contacts-hint").textContent = `${radar.services.length} services · gauge = share of the ${fmtMs(slo)} SLO`;
  }

  function renderRadarKpis() {
    const svcs = radar.services, slo = cache.db.slo;
    const over = svcs.filter((x) => x.lat > slo).length;
    const lats = svcs.map((x) => x.lat).sort((a, b) => a - b);
    const med = lats[Math.floor(lats.length / 2)];
    const byRegion = {};
    svcs.forEach((x) => (byRegion[x.region] = (byRegion[x.region] || 0) + x.rpm));
    const busiest = Object.entries(byRegion).sort((a, b) => b[1] - a[1])[0];
    const worst = svcs.slice().sort((a, b) => b.lat - a.lat)[0];
    const tiles = [
      ["Contacts", String(svcs.length), `${cache.db.regions.length} regions`],
      ["Over SLO", String(over), `SLO ${fmtMs(slo)}`, over ? "bad" : ""],
      ["Median p95", fmtMs(med), "across services"],
      ["Slowest", fmtMs(worst.lat), `${worst.name} · ${worst.region}`],
      ["Busiest region", busiest[0], nfCompact.format(busiest[1]) + " req / min"],
      ["Total rate", nfCompact.format(svcs.reduce((a, x) => a + x.rpm, 0)), "req / min"],
    ];
    $("#radar-kpis").replaceChildren(...tiles.map(([label, value, sub, cls]) =>
      h("div", { class: "kpi" }, h("span", { class: "label", text: label }), h("span", { class: "value " + (cls || ""), text: value }), h("span", { class: "delta", text: sub }))));
  }

  // Unit chart: each triangle is a fixed number of requests per minute.
  function renderSignal() {
    const box = $("#signal");
    box.replaceChildren();
    const byRegion = cache.db.regions.map(([name]) => ({ name, rpm: radar.services.filter((x) => x.region === name).reduce((a, x) => a + x.rpm, 0) }));
    const max = Math.max(...byRegion.map((d) => d.rpm));
    const raw = max / 12, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const unit = [1, 2, 5, 10].map((m) => m * p).find((u) => u >= raw);
    $("#signal-hint").textContent = `each ▲ = ${nfCompact.format(unit)} req / min`;
    const W = Math.max(240, box.clientWidth), colW = W / byRegion.length;
    const stagger = colW < 72; // alternate label rows when columns are too narrow for region names
    const th = 11, gap = 3, H = 12 * (th + gap) + 44 + (stagger ? 12 : 0);
    const tw = Math.min(26, colW * 0.55);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Requests per minute by region, as triangle units" }, box);
    byRegion.forEach((d, i) => {
      const n = Math.round(d.rpm / unit), x = colW * i + colW / 2, base = H - 22 - (stagger ? 12 : 0);
      const g = el("g", { class: "mark" }, svg);
      for (let k = 0; k < n; k++) {
        const y = base - k * (th + gap);
        el("path", { d: `M${x - tw / 2} ${y}L${x + tw / 2} ${y}L${x} ${y - th}Z`, fill: "var(--s1)" }, g);
      }
      el("text", { x, y: base - n * (th + gap) - 4, "text-anchor": "middle", class: "value-label" }, svg).textContent = nfCompact.format(d.rpm);
      el("text", { x, y: H - 6 - (stagger && i % 2 === 0 ? 12 : 0), "text-anchor": "middle", class: "axis" }, svg).textContent = d.name;
      const hit = el("rect", { x: colW * i, y: 0, width: colW, height: H, class: "hit" }, svg);
      hit.addEventListener("pointermove", (e) => showTip(e.clientX, e.clientY, d.name, [{ color: "var(--s1)", value: nfInt.format(Math.round(d.rpm)), label: "req / min" }, { value: String(n), label: "units" }]));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  function logEvent(level, text) {
    const t = new Date();
    radar.events.unshift({ level, text, at: `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}` });
    radar.events.length = Math.min(radar.events.length, 14);
    renderEvents(true);
  }
  function renderEvents(fresh) {
    $("#events").replaceChildren(...radar.events.map((e, i) =>
      h("li", { class: fresh && i === 0 ? "fresh" : "" },
        h("span", { class: "led " + e.level }),
        h("code", { text: e.text, title: e.text }),
        h("span", { class: "dur", text: e.at }))));
    const f = $("#events li.fresh");
    if (f) setTimeout(() => f.classList.remove("fresh"), 900);
  }

  // Live mode: latencies random-walk around their base; notable changes are logged.
  function tick() {
    if (!radar.services.length) return;
    const slo = cache.db.slo;
    for (const svc of radar.services) {
      const before = svc.lat;
      svc.walk += (1 - svc.walk) * 0.18 + (Math.random() - 0.5) * 0.16;
      if (Math.random() < 0.02) svc.walk *= 1.6; // occasional spike
      svc.walk = Math.max(0.6, Math.min(2.4, svc.walk));
      svc.lat = svc.base * svc.walk;
      svc.rpm *= 0.97 + Math.random() * 0.06;
      if (before <= slo && svc.lat > slo) {
        logEvent("bad", `${svc.name} @ ${svc.region} crossed SLO: ${fmtMs(before)} → ${fmtMs(svc.lat)}`);
        toast(svc, before);
      }
      else if (before > slo && svc.lat <= slo) logEvent("", `${svc.name} @ ${svc.region} back under SLO at ${fmtMs(svc.lat)}`);
    }
    if (Math.random() < 0.35) {
      const svc = radar.services[Math.floor(Math.random() * radar.services.length)];
      const n = 1 + Math.floor(Math.random() * 6);
      logEvent(sloState(svc)[0], Math.random() < 0.5 ? `${svc.name} @ ${svc.region} opened ${n} connection${n > 1 ? "s" : ""}` : `${svc.name} @ ${svc.region} p95 ${fmtMs(svc.lat)}, ${nfCompact.format(svc.rpm)} rpm`);
    }
    placeBlips();
    updateContacts();
    renderRadarKpis();
  }
  // Alert toasts, styled as old desktop pop-up windows. At most three stay on screen.
  function toast(svc, before) {
    const box = $("#toasts");
    while (box.children.length >= 3) box.firstChild.remove();
    const close = () => node.remove();
    const node = h("div", { class: "popup", role: "alertdialog", "aria-label": "SLO breach" },
      h("div", { class: "popup-bar" }, h("span", { text: "SLO breach" }), h("button", { class: "x", type: "button", "aria-label": "Dismiss", text: "✕", onclick: close })),
      h("div", { class: "popup-body" },
        h("span", { class: "ico", "aria-hidden": "true", text: "!" }),
        h("p", { text: `${svc.name} @ ${svc.region} is at ${fmtMs(svc.lat)}` }),
        h("span", { class: "sub", text: `was ${fmtMs(before)} · SLO ${fmtMs(cache.db.slo)}` }),
        h("div", { class: "popup-actions" },
          h("button", { class: "btn sm primary", type: "button", text: "Show", onclick: () => { setFocus(svc.id); $("#scope").scrollIntoView({ block: "center" }); close(); } }),
          h("button", { class: "btn sm", type: "button", text: "Dismiss", onclick: close }))));
    box.append(node);
    setTimeout(close, 9000);
  }

  function syncLive() {
    clearInterval(radar.timer);
    radar.timer = null;
    if (radar.live && !$("#radar-view").hidden && !document.hidden) radar.timer = setInterval(tick, 2500);
  }
  $("#live").addEventListener("change", (e) => { radar.live = e.target.checked; $("#events-hint").textContent = radar.live ? "live feed, newest first" : "paused"; syncLive(); });
  document.addEventListener("visibilitychange", syncLive);

  function renderRadar() {
    if (!cache) return;
    radar.services = buildServices();
    $("#radar-sub").textContent = `${cache.db.id} · ${isoDay(state.start)} → ${isoDay(state.end)} baseline · SLO ${fmtMs(cache.db.slo)}`;
    const legend = $("#radar-legend");
    legend.replaceChildren(...Object.entries(KINDS).map(([k, c]) => { const r = h("i", { class: "key-rect" }); r.style.background = c; r.style.borderRadius = "50%"; return h("span", {}, r, k); }));
    renderRadarKpis();
    renderScope();
    renderContacts();
    renderSignal();
    radar.events = [];
    logEvent("", `scope locked on ${cache.db.id}: ${radar.services.length} services in ${cache.db.regions.length} regions`);
    radar.services.filter((x) => x.lat > cache.db.slo).forEach((x) => logEvent("bad", `${x.name} @ ${x.region} over SLO at ${fmtMs(x.lat)}`));
  }

  /* ---------------------------------------------------------------------
     Views: overview and radar share the filters; the hash picks the view
     --------------------------------------------------------------------- */

  function applyView() {
    const radarOn = location.hash === "#radar";
    $("#overview-view").hidden = radarOn;
    $("#radar-view").hidden = !radarOn;
    const current = radarOn ? "#radar" : ["#explorer", "#slow"].includes(location.hash) ? location.hash : "#overview";
    document.querySelectorAll(".side-link").forEach((link) => {
      if (link.getAttribute("href") === current) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    $("#compare").closest("label").hidden = radarOn;
    if (radarOn) { renderScope(); placeBlips(); renderSignal(); window.scrollTo(0, 0); }
    else if (location.hash && location.hash !== "#radar") { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
    syncLive();
    $("#sidebar").classList.remove("open");
  }
  addEventListener("hashchange", applyView);

  // Collapse the sidebar to an icon rail to give the dashboard more width.
  const app = $("#app"), collapseBtn = $("#collapse");
  function setRail(on) {
    app.classList.toggle("rail", on);
    collapseBtn.setAttribute("aria-pressed", String(on));
    collapseBtn.title = on ? "Expand sidebar" : "Collapse sidebar";
    try { localStorage.setItem("metrics-dash-rail", on ? "1" : "0"); } catch { /* ignore */ }
  }
  try { if (localStorage.getItem("metrics-dash-rail") === "1") setRail(true); } catch { /* ignore */ }
  collapseBtn.addEventListener("click", () => setRail(!app.classList.contains("rail")));

  renderConnections();
  renderAll();
  applyView();
})();
