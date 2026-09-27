// Shared behaviour for all templates. No dependencies.

(function () {
  const root = document.documentElement;

  // Theme: explicit choice wins, otherwise follow the OS.
  function storedTheme() {
    try { return localStorage.getItem("theme"); } catch { return null; }
  }
  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch {}
  }
  const initial = storedTheme() ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  root.dataset.theme = initial;

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "toggle-theme") {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
    }

    if (action === "toggle-nav") {
      const nav = document.getElementById(el.getAttribute("aria-controls"));
      const open = nav.classList.toggle("open");
      el.setAttribute("aria-expanded", String(open));
    }

    // Segmented controls: <div class="segmented" data-group="billing">
    if (action === "segment") {
      const group = el.closest(".segmented");
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      document.dispatchEvent(new CustomEvent("segment:change", {
        detail: { group: group.dataset.group, value: el.dataset.value },
      }));
    }

    // Tabs: buttons with aria-controls pointing at panels.
    if (action === "tab") {
      const list = el.closest("[role=tablist]");
      list.querySelectorAll("[role=tab]").forEach((t) => {
        const selected = t === el;
        t.setAttribute("aria-selected", String(selected));
        document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
      });
    }
  });

  // Close mobile nav / sidebar on Escape.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".nav.open, .sidebar.open").forEach((n) => n.classList.remove("open"));
    document.querySelectorAll("[data-action=toggle-nav]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  });

  // Current year in footers.
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
