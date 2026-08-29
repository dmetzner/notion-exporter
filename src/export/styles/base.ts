export const BASE_CSS = `
/* The HTML \`hidden\` attribute must win over any layout \`display\` an element's
   class sets — otherwise toggling \`el.hidden\` is a no-op. The inline-db filter
   JS hides rows via \`unit.hidden = true\`; without this, gallery cards
   (\`.db-card { display: flex }\`) would never hide and filtering would appear
   broken. */
[hidden] { display: none !important; }
:root {
  color-scheme: light dark;
  --fg: #1f2328;
  --fg-muted: #59636e;
  --bg: #ffffff;
  --bg-subtle: #f6f8fa;
  --border: #d1d9e0;
  --accent: #0969da;
  --accent-bg: #ddf4ff;
  --warn-bg: #fff8c5;
  --warn-border: #d4a72c;
  --danger: #cf222e;
  --code-fg: #1f2328;
  --code-bg: #eff1f3;
  --pre-bg: #f6f8fa;
}

/* Theme resolution:
 *   no data-theme  → follow system (@media query below applies)
 *   data-theme=system → same as no attribute (@media query applies)
 *   data-theme=light → force light (this :root baseline)
 *   data-theme=dark  → force dark (the explicit override below)
 * The :not([data-theme="light"]):not([data-theme="dark"]) guard means the
 * media query only fires when the user hasn't explicitly chosen a mode. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) {
    --fg: #e6edf3;
    --fg-muted: #9198a1;
    --bg: #0d1117;
    --bg-subtle: #151b23;
    --border: #3d444d;
    --accent: #4493f8;
    --accent-bg: #15263e;
    --warn-bg: #2d2611;
    --warn-border: #845306;
    --danger: #f85149;
    --code-fg: #e6edf3;
    --code-bg: #262c36;
    --pre-bg: #151b23;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --fg: #e6edf3;
  --fg-muted: #9198a1;
  --bg: #0d1117;
  --bg-subtle: #151b23;
  --border: #3d444d;
  --accent: #4493f8;
  --accent-bg: #15263e;
  --warn-bg: #2d2611;
  --warn-border: #845306;
  --danger: #f85149;
  --code-fg: #e6edf3;
  --code-bg: #262c36;
  --pre-bg: #151b23;
}
:root[data-theme="light"] { color-scheme: light; }

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
    Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  line-height: 1.6;
  font-size: 16px;
}
`;
