export const CHIPS_CSS = `
/* Select/multi_select/status chips — used in gallery and table views. */
.db-chip {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  font-size: 0.8rem;
  border-radius: 4px;
  background: var(--bg-subtle);
  color: var(--fg);
  line-height: 1.4;
  white-space: nowrap;
}
.db-chip.c-gray, .db-chip.c-default, .db-chip.c-gray_background, .db-chip.c-default_background { background: #eaeaea; color: #36383b; }
.db-chip.c-brown, .db-chip.c-brown_background { background: #f1e0d6; color: #5b3b27; }
.db-chip.c-orange, .db-chip.c-orange_background { background: #fde4c8; color: #7a3e1d; }
.db-chip.c-yellow, .db-chip.c-yellow_background { background: #fdecc8; color: #7a5c1d; }
.db-chip.c-green, .db-chip.c-green_background { background: #d3eddb; color: #1f5132; }
.db-chip.c-blue, .db-chip.c-blue_background { background: #d4e6f9; color: #1f3f6a; }
.db-chip.c-purple, .db-chip.c-purple_background { background: #ebdcef; color: #533a7f; }
.db-chip.c-pink, .db-chip.c-pink_background { background: #f8dce8; color: #7a2c52; }
.db-chip.c-red, .db-chip.c-red_background { background: #fbd6d3; color: #832b22; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-gray,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-default,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-gray_background,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-default_background { background: #2f2f2f; color: #d4d4d4; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-brown,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-brown_background { background: #3e2e23; color: #e8c7ac; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-orange,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-orange_background { background: #5c3b1d; color: #f7c08a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-yellow,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-yellow_background { background: #564327; color: #f3d28a; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-green,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-green_background { background: #244e3f; color: #a8d6b9; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-blue,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-blue_background { background: #1f3c54; color: #9cc3e3; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-purple,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-purple_background { background: #3c2c4f; color: #c8a8e0; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-pink,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-pink_background { background: #4c2740; color: #e8a0c5; }
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-red,
  :root:not([data-theme="light"]):not([data-theme="dark"]) .db-chip.c-red_background { background: #59302d; color: #f0a8a4; }
}
:root[data-theme="dark"] .db-chip.c-gray,
:root[data-theme="dark"] .db-chip.c-default,
:root[data-theme="dark"] .db-chip.c-gray_background,
:root[data-theme="dark"] .db-chip.c-default_background { background: #2f2f2f; color: #d4d4d4; }
:root[data-theme="dark"] .db-chip.c-brown,
:root[data-theme="dark"] .db-chip.c-brown_background { background: #3e2e23; color: #e8c7ac; }
:root[data-theme="dark"] .db-chip.c-orange,
:root[data-theme="dark"] .db-chip.c-orange_background { background: #5c3b1d; color: #f7c08a; }
:root[data-theme="dark"] .db-chip.c-yellow,
:root[data-theme="dark"] .db-chip.c-yellow_background { background: #564327; color: #f3d28a; }
:root[data-theme="dark"] .db-chip.c-green,
:root[data-theme="dark"] .db-chip.c-green_background { background: #244e3f; color: #a8d6b9; }
:root[data-theme="dark"] .db-chip.c-blue,
:root[data-theme="dark"] .db-chip.c-blue_background { background: #1f3c54; color: #9cc3e3; }
:root[data-theme="dark"] .db-chip.c-purple,
:root[data-theme="dark"] .db-chip.c-purple_background { background: #3c2c4f; color: #c8a8e0; }
:root[data-theme="dark"] .db-chip.c-pink,
:root[data-theme="dark"] .db-chip.c-pink_background { background: #4c2740; color: #e8a0c5; }
:root[data-theme="dark"] .db-chip.c-red,
:root[data-theme="dark"] .db-chip.c-red_background { background: #59302d; color: #f0a8a4; }
`;
