export const CALLOUTS_CSS = `
/* Notion column_list → flex row, preserves per-column width_ratio via inline
 * flex on each .column. Equal widths when no ratio is present. */
.columns {
  display: flex;
  gap: 1.5rem;
  margin: 0.5rem 0 1.5rem;
  align-items: stretch;
}
.column {
  flex: 1 1 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.column > :first-child { margin-top: 0; }
.column > :last-child { margin-bottom: 0; }
@media (max-width: 760px) {
  .columns { flex-direction: column; gap: 0.75rem; }
}

/* callouts — preserve Notion color via class on the wrapping div. Flex so
 * the body always fills available width whether or not an icon is present. */
.callout {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  padding: 1rem 1.25rem;
  border-radius: 10px;
  margin: 0.25rem 0 1rem;
}
.callout-body { flex: 1; min-width: 0; }
.callout-body > :first-child { margin-top: 0; }
.callout-body > :last-child { margin-bottom: 0; }
/* Notion stores each line of a callout as its own paragraph. Render them
 * tightly stacked instead of with the default p 1rem margin. */
.callout-body > p { margin: 0 0 0.35rem; }
.callout-body > p:last-child { margin-bottom: 0; }
.callout-body > p > img:only-child { margin-bottom: 0.6rem; }
.callout-body > ul,
.callout-body > ol { margin: 0.25rem 0; }
.callout > :last-child { margin-bottom: 0; }
.callout > p:first-of-type { margin-top: 0; }
.callout-icon {
  font-size: 1.125rem;
  line-height: 1.55;
  display: inline-block;
  user-select: none;
}
.callout.warn { background: var(--warn-bg); border-color: var(--warn-border); }

/* Notion color palette — backgrounds */
.callout.c-default { background: var(--bg-subtle); }
.callout.c-gray_background { background: #f1f1ef; border-color: #e3e2e0; }
.callout.c-brown_background { background: #f4eeee; border-color: #e9dfdf; }
.callout.c-orange_background { background: #faebdd; border-color: #f1d7b9; }
.callout.c-yellow_background { background: #fbf3db; border-color: #f0e2b0; }
.callout.c-green_background { background: #ddedea; border-color: #b9d8d1; }
.callout.c-blue_background { background: #ddebf1; border-color: #b9d2dd; }
.callout.c-purple_background { background: #eae4f2; border-color: #d4c7e6; }
.callout.c-pink_background { background: #f4dfeb; border-color: #e7c1d6; }
.callout.c-red_background { background: #fbe4e4; border-color: #f0c2c2; }

/* Notion color palette — solid text colors (no background) */
.callout.c-gray { color: #9b9a97; background: var(--bg); }
.callout.c-brown { color: #64473a; background: var(--bg); }
.callout.c-orange { color: #d9730d; background: var(--bg); }
.callout.c-yellow { color: #cb912f; background: var(--bg); }
.callout.c-green { color: #448361; background: var(--bg); }
.callout.c-blue { color: #337ea9; background: var(--bg); }
.callout.c-purple { color: #9065b0; background: var(--bg); }
.callout.c-pink { color: #c14c8a; background: var(--bg); }
.callout.c-red { color: #d44c47; background: var(--bg); }

/* Callout dark palette — applied both when system prefers dark (and user
 * hasn't forced light) AND when user explicitly chose dark. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-gray_background,
  :root[data-theme="dark"] .callout.c-gray_background { background: #2a2a2a; border-color: #3a3a3a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-brown_background,
  :root[data-theme="dark"] .callout.c-brown_background { background: #3e2e25; border-color: #5a4234; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-orange_background,
  :root[data-theme="dark"] .callout.c-orange_background { background: #5c3b23; border-color: #7d5132; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-yellow_background,
  :root[data-theme="dark"] .callout.c-yellow_background { background: #564328; border-color: #745b39; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-green_background,
  :root[data-theme="dark"] .callout.c-green_background { background: #243e36; border-color: #355649; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-blue_background,
  :root[data-theme="dark"] .callout.c-blue_background { background: #1f3a4c; border-color: #2d536b; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-purple_background,
  :root[data-theme="dark"] .callout.c-purple_background { background: #3c2e54; border-color: #523f72; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-pink_background,
  :root[data-theme="dark"] .callout.c-pink_background { background: #4c2a3e; border-color: #6a3b56; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-red_background,
  :root[data-theme="dark"] .callout.c-red_background { background: #533636; border-color: #714a4a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-gray,
  :root[data-theme="dark"] .callout.c-gray { color: #a5a5a5; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-brown,
  :root[data-theme="dark"] .callout.c-brown { color: #b18371; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-orange,
  :root[data-theme="dark"] .callout.c-orange { color: #e8923a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-yellow,
  :root[data-theme="dark"] .callout.c-yellow { color: #e6b95c; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-green,
  :root[data-theme="dark"] .callout.c-green { color: #6dab8a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-blue,
  :root[data-theme="dark"] .callout.c-blue { color: #5c9cc3; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-purple,
  :root[data-theme="dark"] .callout.c-purple { color: #b692d0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-pink,
  :root[data-theme="dark"] .callout.c-pink { color: #dc83b1; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .callout.c-red,
  :root[data-theme="dark"] .callout.c-red { color: #ec7976; }
}
/* Explicit dark — outside @media so it applies even if system is light. */
:root[data-theme="dark"] .callout.c-gray_background { background: #2a2a2a; border-color: #3a3a3a; }
:root[data-theme="dark"] .callout.c-brown_background { background: #3e2e25; border-color: #5a4234; }
:root[data-theme="dark"] .callout.c-orange_background { background: #5c3b23; border-color: #7d5132; }
:root[data-theme="dark"] .callout.c-yellow_background { background: #564328; border-color: #745b39; }
:root[data-theme="dark"] .callout.c-green_background { background: #243e36; border-color: #355649; }
:root[data-theme="dark"] .callout.c-blue_background { background: #1f3a4c; border-color: #2d536b; }
:root[data-theme="dark"] .callout.c-purple_background { background: #3c2e54; border-color: #523f72; }
:root[data-theme="dark"] .callout.c-pink_background { background: #4c2a3e; border-color: #6a3b56; }
:root[data-theme="dark"] .callout.c-red_background { background: #533636; border-color: #714a4a; }
:root[data-theme="dark"] .callout.c-gray { color: #a5a5a5; }
:root[data-theme="dark"] .callout.c-brown { color: #b18371; }
:root[data-theme="dark"] .callout.c-orange { color: #e8923a; }
:root[data-theme="dark"] .callout.c-yellow { color: #e6b95c; }
:root[data-theme="dark"] .callout.c-green { color: #6dab8a; }
:root[data-theme="dark"] .callout.c-blue { color: #5c9cc3; }
:root[data-theme="dark"] .callout.c-purple { color: #b692d0; }
:root[data-theme="dark"] .callout.c-pink { color: #dc83b1; }
:root[data-theme="dark"] .callout.c-red { color: #ec7976; }

/* Inline rich-text colors. Notion's text annotation \`color\` can be a foreground
 * color ("red", "blue", …) or a background ("red_background", …).
 *
 * Contrast: every .t-* × .b-*_background AND .t-* × --bg combo passes WCAG AA
 * (≥4.5:1 for body text) with ≥5:1 margin, in BOTH light and dark themes.
 * Foreground hues kept; lightness shifted darker (light mode) or lighter
 * (dark mode) from Notion's stock palette to clear the threshold.
 * If you tweak any swatch below, re-run \`pnpm contrast\` to verify. */
.t-gray { color: #605f5c; }
.t-brown { color: #64473a; }
.t-orange { color: #914d09; }
.t-yellow { color: #7c591d; }
.t-green { color: #36684d; }
.t-blue { color: #296588; }
.t-purple { color: #784d97; }
.t-pink { color: #a0376f; }
.t-red { color: #b22e2a; }
.t-gray_background,
.t-brown_background,
.t-orange_background,
.t-yellow_background,
.t-green_background,
.t-blue_background,
.t-purple_background,
.t-pink_background,
.t-red_background {
  padding: 0 0.25rem;
  border-radius: 3px;
  /* Keep inline pill chrome continuous across line breaks. */
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.t-gray_background { background: #f1f1ef; }
.t-brown_background { background: #f4eeee; }
.t-orange_background { background: #faebdd; }
.t-yellow_background { background: #fbf3db; }
.t-green_background { background: #ddedea; }
.t-blue_background { background: #ddebf1; }
.t-purple_background { background: #eae4f2; }
.t-pink_background { background: #f4dfeb; }
.t-red_background { background: #fbe4e4; }
@media (prefers-color-scheme: dark) {
  /* Lift foreground colors so they keep AA contrast on the dark surface. */
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-gray { color: #c0c0c0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-brown { color: #dfb59b; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-orange { color: #f6ae74; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-yellow { color: #efb84a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-green { color: #93caac; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-blue { color: #93c4e0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-purple { color: #ceb5e6; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-pink { color: #eeabc9; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-red { color: #f3adaa; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-gray_background { background: #2f2f2f; color: var(--fg); }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-brown_background { background: #3e2e23; color: #ecd0bb; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-orange_background { background: #5c3b1d; color: #f7c995; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-yellow_background { background: #564327; color: #f3d895; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-green_background { background: #244e3f; color: #b9dbc2; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-blue_background { background: #1f3c54; color: #a8c5dc; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-purple_background { background: #3c2c4f; color: #d0b4e2; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-pink_background { background: #4c2740; color: #ecb1ce; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .t-red_background { background: #59302d; color: #f1b3af; }
}
:root[data-theme="dark"] .t-gray { color: #c0c0c0; }
:root[data-theme="dark"] .t-brown { color: #dfb59b; }
:root[data-theme="dark"] .t-orange { color: #f6ae74; }
:root[data-theme="dark"] .t-yellow { color: #efb84a; }
:root[data-theme="dark"] .t-green { color: #93caac; }
:root[data-theme="dark"] .t-blue { color: #93c4e0; }
:root[data-theme="dark"] .t-purple { color: #ceb5e6; }
:root[data-theme="dark"] .t-pink { color: #eeabc9; }
:root[data-theme="dark"] .t-red { color: #f3adaa; }
:root[data-theme="dark"] .t-gray_background { background: #2f2f2f; color: var(--fg); }
:root[data-theme="dark"] .t-brown_background { background: #3e2e23; color: #ecd0bb; }
:root[data-theme="dark"] .t-orange_background { background: #5c3b1d; color: #f7c995; }
:root[data-theme="dark"] .t-yellow_background { background: #564327; color: #f3d895; }
:root[data-theme="dark"] .t-green_background { background: #244e3f; color: #b9dbc2; }
:root[data-theme="dark"] .t-blue_background { background: #1f3c54; color: #a8c5dc; }
:root[data-theme="dark"] .t-purple_background { background: #3c2c4f; color: #d0b4e2; }
:root[data-theme="dark"] .t-pink_background { background: #4c2740; color: #ecb1ce; }
:root[data-theme="dark"] .t-red_background { background: #59302d; color: #f1b3af; }

/* Block-level color: applied to whole paragraphs / list items / toggles /
 * quotes. Foreground variants tint text; _background variants add a
 * subtle pill-style background to the whole block. */
.b-gray { color: #605f5c; }
.b-brown { color: #64473a; }
.b-orange { color: #914d09; }
.b-yellow { color: #7c591d; }
.b-green { color: #36684d; }
.b-blue { color: #296588; }
.b-purple { color: #784d97; }
.b-pink { color: #a0376f; }
.b-red { color: #b22e2a; }
div.b-gray_background, div.b-brown_background, div.b-orange_background,
div.b-yellow_background, div.b-green_background, div.b-blue_background,
div.b-purple_background, div.b-pink_background, div.b-red_background,
details.b-gray_background, details.b-brown_background, details.b-orange_background,
details.b-yellow_background, details.b-green_background, details.b-blue_background,
details.b-purple_background, details.b-pink_background, details.b-red_background {
  padding: 0.35rem 0.65rem;
  border-radius: 4px;
  margin-bottom: 0.6rem;
}
span.b-gray_background, span.b-brown_background, span.b-orange_background,
span.b-yellow_background, span.b-green_background, span.b-blue_background,
span.b-purple_background, span.b-pink_background, span.b-red_background {
  padding: 0 0.25rem;
  border-radius: 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.b-gray_background { background: #f1f1ef; }
.b-brown_background { background: #f4eeee; }
.b-orange_background { background: #faebdd; }
.b-yellow_background { background: #fbf3db; }
.b-green_background { background: #ddedea; }
.b-blue_background { background: #ddebf1; }
.b-purple_background { background: #eae4f2; }
.b-pink_background { background: #f4dfeb; }
.b-red_background { background: #fbe4e4; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-gray { color: #c0c0c0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-brown { color: #dfb59b; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-orange { color: #f6ae74; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-yellow { color: #efb84a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-green { color: #93caac; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-blue { color: #93c4e0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-purple { color: #ceb5e6; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-pink { color: #eeabc9; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-red { color: #f3adaa; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-gray_background { background: #2f2f2f; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-brown_background { background: #3e2e23; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-orange_background { background: #5c3b1d; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-yellow_background { background: #564327; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-green_background { background: #244e3f; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-blue_background { background: #1f3c54; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-purple_background { background: #3c2c4f; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-pink_background { background: #4c2740; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .b-red_background { background: #59302d; }
}
:root[data-theme="dark"] .b-gray { color: #c0c0c0; }
:root[data-theme="dark"] .b-brown { color: #dfb59b; }
:root[data-theme="dark"] .b-orange { color: #f6ae74; }
:root[data-theme="dark"] .b-yellow { color: #efb84a; }
:root[data-theme="dark"] .b-green { color: #93caac; }
:root[data-theme="dark"] .b-blue { color: #93c4e0; }
:root[data-theme="dark"] .b-purple { color: #ceb5e6; }
:root[data-theme="dark"] .b-pink { color: #eeabc9; }
:root[data-theme="dark"] .b-red { color: #f3adaa; }
:root[data-theme="dark"] .b-gray_background { background: #2f2f2f; }
:root[data-theme="dark"] .b-brown_background { background: #3e2e23; }
:root[data-theme="dark"] .b-orange_background { background: #5c3b1d; }
:root[data-theme="dark"] .b-yellow_background { background: #564327; }
:root[data-theme="dark"] .b-green_background { background: #244e3f; }
:root[data-theme="dark"] .b-blue_background { background: #1f3c54; }
:root[data-theme="dark"] .b-purple_background { background: #3c2c4f; }
:root[data-theme="dark"] .b-pink_background { background: #4c2740; }
:root[data-theme="dark"] .b-red_background { background: #59302d; }

/* Notion custom emoji — rendered as small inline images. */
img.custom-emoji {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.2em;
  margin: 0 0.05em;
  object-fit: contain;
}
`;
