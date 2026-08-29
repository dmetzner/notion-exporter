export const SIDEBAR_CSS = `
.app {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  min-height: 100vh;
  transition: grid-template-columns 0.22s ease;
}
.main-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/*
 * Content grid: a centered prose column (≤ 880px) bracketed by flexible side
 * gutters. Elements that want to break out (cover, callout, columns) span the
 * "full" track and use the entire main-col width; prose elements stay in the
 * middle for comfortable reading width.
 */
.app > .main-col > .layout {
  display: grid;
  grid-template-columns:
    [full-start] minmax(1.5rem, 1fr)
    [prose-start] minmax(0, 1080px) [prose-end]
    minmax(1.5rem, 1fr) [full-end];
  padding: 0 0 5rem;
  max-width: none;
  margin: 0;
  row-gap: 0;
}
.app > .main-col > .layout > * { grid-column: prose; }
.app > .main-col > .layout > .cover { grid-column: full; }
/* No-cover pages need explicit breathing room between the sticky topbar and
 * the H1 since there's no banner to provide that gap. */
.app > .main-col > .layout:not(:has(> .cover)) { padding-top: 2.5rem; }
.sidebar {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.75rem 0.5rem 2rem;
  background: var(--bg-subtle);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: transform 0.22s ease;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem 0.5rem;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}
.sidebar-home {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--fg);
  text-decoration: none;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.sidebar-home-icon {
  width: 2.2em;
  height: 2.2em;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.sidebar-home-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.sidebar-home:hover { color: var(--accent); }
.sidebar-nav {
  font-size: 0.875rem;
  flex: 1;
  min-width: 0;
}
.sidebar-nav ul.tree .row:hover { background: var(--accent-bg); }
.sidebar-nav ul.tree .row:has(a.active) { background: var(--accent-bg); }

/* Sticky topbar — full-width, flush to top, modern. Sits above the cover and
 * stays pinned as the user scrolls. Becomes opaque with a subtle border once
 * any content scrolls underneath. */
.topbar {
  position: sticky;
  top: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 3rem;
  padding: 0 0.75rem;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.topbar-toggle {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  color: var(--fg-muted);
  border-radius: 6px;
  user-select: none;
  transition: background 0.12s, color 0.12s, transform 0.12s;
  flex-shrink: 0;
}
.topbar-toggle:hover {
  background: var(--bg-subtle);
  color: var(--fg);
}
.topbar-toggle:active { transform: scale(0.95); }
.topbar-crumbs {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  color: var(--fg-muted);
  overflow: hidden;
  display: flex;
  align-items: center;
}
.topbar-stats {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-left: 0.5rem;
  flex-shrink: 0;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--fg-muted);
  text-decoration: none;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.topbar-stats:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}
.topbar-stats svg { display: block; }
@media (max-width: 600px) {
  .topbar-stats { width: 28px; height: 28px; }
}
.topbar-theme {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 2px;
  margin-left: 0.4rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  gap: 0;
}
.topbar-theme .theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  background: transparent;
  border-radius: 999px;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.topbar-theme .theme-btn:hover { color: var(--fg); }
.topbar-theme .theme-btn.is-active {
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.topbar-theme .theme-btn svg { display: block; }
@media (max-width: 600px) {
  .topbar-theme .theme-btn { width: 24px; height: 24px; }
}
/* Index-page placement: float top-right of the hero. */
.index-hero { position: relative; }
/* Workspace icon sits to the LEFT of the title block, vertically centered.
 * The text block's centroid lands near the H1 baseline, which is what reads
 * as "the title" — so center-alignment ties the icon to that visual anchor. */
.index-hero-row {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  margin: 0 0 1.5rem;
}
.index-hero-row .index-hero-text { min-width: 0; flex: 1; }
.index-hero-row .index-hero-text > * { margin: 0; }
/* Eyebrow → H1 keeps the 0.4rem gap so the small label has air below it.
 * Lede sits flush against the H1 — collapsing that gap pulls the text block's
 * centroid up, which lines the icon's center back up with the H1 baseline. */
.index-hero-row .index-hero-text .eyebrow + h1 { margin-top: 0.4rem; }
.index-hero-row .index-hero-text h1 + .lede { margin-top: 0; }
/* Override the generic 1rem bottom margin paragraphs get, so the lede sits
 * flush at the bottom of the text block — otherwise the icon visually
 * drops below the H1 baseline. */
.index-hero-row .index-hero-text .lede { margin-bottom: 0; }
.index-hero-icon {
  display: block;
  width: 96px;
  height: 96px;
  border-radius: 16px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.index-hero-emoji {
  display: block;
  font-size: 4.5rem;
  line-height: 1;
  flex-shrink: 0;
}
@media (max-width: 599px) {
  .index-hero-row { flex-direction: column; align-items: flex-start; gap: 0.8rem; }
  .index-hero-icon { width: 72px; height: 72px; border-radius: 12px; }
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) .index-hero-icon {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
}
:root[data-theme="dark"] .index-hero-icon { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); }
.topbar-theme.index-theme {
  position: absolute;
  top: 1rem;
  right: 1rem;
  margin: 0;
}
.topbar-crumbs .breadcrumbs {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.05rem;
  flex-wrap: nowrap;
  /* Allow horizontal scroll when even truncated crumbs overflow on narrow
   * widths — keeps every level reachable instead of clipping silently. */
  overflow-x: auto;
  scrollbar-width: none;  /* Firefox */
  -ms-overflow-style: none;  /* IE/Edge */
  min-width: 0;
  max-width: 100%;
}
.topbar-crumbs .breadcrumbs::-webkit-scrollbar { display: none; }
.topbar-crumbs .breadcrumbs a {
  color: var(--fg-muted);
  text-decoration: none;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  /* Each ancestor crumb truncates to a sane max so deeply nested paths
   * still fit the topbar; users can hover/click the tooltip if they want
   * the full title. */
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}
.topbar-crumbs .breadcrumbs a:hover {
  color: var(--fg);
  background: var(--bg-subtle);
  /* Reveal full title on hover (useful when text was ellipsized). */
  max-width: none;
}
/* Current page sits at the tail of the crumb chain — same chevron separator
 * as the links but stronger weight + non-clickable styling. Gets more room
 * than ancestor crumbs and never shrinks below its content. */
.topbar-crumbs .breadcrumbs .breadcrumb-current {
  padding: 0.15rem 0.4rem;
  color: var(--fg);
  font-weight: 600;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.sidebar-scrim { display: none; }

/* Desktop: collapse with smooth grid + sidebar transform. Topbar stays
 * visible in both states so breadcrumbs are always available. */
@media (min-width: 900px) {
  #ne-sb-toggle:checked ~ .app {
    grid-template-columns: 0 minmax(0, 1fr);
  }
  #ne-sb-toggle:checked ~ .app .sidebar {
    transform: translateX(-100%);
    pointer-events: none;
  }
}
/* Two icons in the topbar toggle: hamburger when sidebar is collapsed, a
 * back-chevron when sidebar is visible. Swap visibility based on checkbox
 * state instead of rotating the (symmetrical) hamburger. */
.topbar-toggle .icon-open,
.topbar-toggle .icon-close { display: none; }
#ne-sb-toggle:checked ~ .app .topbar-toggle .icon-open { display: inline-block; }
#ne-sb-toggle:not(:checked) ~ .app .topbar-toggle .icon-close { display: inline-block; }
/* Mobile (sidebar is overlay, default-collapsed) always shows the hamburger. */
@media (max-width: 899.98px) {
  .topbar-toggle .icon-open { display: inline-block !important; }
  .topbar-toggle .icon-close { display: none !important; }
}

/* Mobile: sidebar becomes overlay drawer; edge trigger always shown */
@media (max-width: 899.98px) {
  .app {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: min(85vw, 320px);
    z-index: 30;
    transform: translateX(-100%);
    box-shadow: 2px 0 24px rgba(0,0,0,0.18);
  }
  #ne-sb-toggle:checked ~ .app .sidebar { transform: translateX(0); }
  .sidebar-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 20;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  #ne-sb-toggle:checked ~ .app .sidebar-scrim {
    opacity: 1;
    pointer-events: auto;
  }
  .app > .main-col > .layout {
    grid-template-columns:
      [full-start] minmax(0.85rem, 1fr)
      [prose-start] minmax(0, 1080px) [prose-end]
      minmax(0.85rem, 1fr) [full-end];
    padding: 0 0 4rem;
  }
}

/* sidebar search input + result list */
/* Sidebar search is always visible — provides a stable nav-side affordance
 * on both desktop and mobile, complementing the topbar search. */
.sidebar-search { margin: 0 0.4rem; }
#ne-sidebar-search {
  width: 100%;
  font-size: 0.875rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  border-radius: 6px;
  outline: none;
}
#ne-sidebar-search:focus { border-color: var(--accent); }
.ne-results {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0.25rem;
}
.ne-results li { border-bottom: 1px solid var(--border); }
.ne-results li:last-child { border-bottom: 0; }
.ne-results li a {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.5rem;
  color: var(--fg);
  text-decoration: none;
  border-radius: 6px;
}
.ne-results li a:hover { background: var(--accent-bg); color: var(--accent); }
.ne-results .ne-icon { flex: 0 0 1.25rem; text-align: center; }
.ne-results .ne-title {
  font-size: 0.875rem;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ne-results .ne-snippet {
  display: block;
  padding: 0 0.5rem 0.45rem 2.2rem;
  font-size: 0.75rem;
  color: var(--fg-muted);
  line-height: 1.35;
}
.ne-results .ne-empty {
  padding: 0.6rem 0.65rem;
  color: var(--fg-muted);
  font-size: 0.8125rem;
}
body.ne-sb-searching .sidebar-nav { display: none; }
`;
