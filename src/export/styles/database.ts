export const DATABASE_CSS = `
/* === kanban === */
section.inline-db.kanban .inline-db-head { border-bottom: 0; }
.kanban-columns {
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  overflow-x: auto;
  padding: 0.4rem 0 0.6rem;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}
.kanban-col {
  flex: 0 0 280px;
  min-width: 260px;
  max-width: 320px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  scroll-snap-align: start;
  max-height: 540px;
  overflow: hidden;
}
.kanban-col-head {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.7rem;
  font-size: 0.85rem;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  z-index: 1;
}
.kanban-col-title { font-weight: 600; color: var(--fg); }
.kanban-col-count {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--fg-muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
}
.kanban-cards {
  list-style: none;
  margin: 0;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow-y: auto;
}
.kanban-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.55rem 0.7rem;
  font-size: 0.88rem;
  line-height: 1.35;
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 80ms ease;
}
.kanban-card:hover,
.kanban-card:focus-within {
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.kanban-card-link {
  display: block;
  color: var(--fg);
  text-decoration: none;
  font-weight: 500;
}
.kanban-card-link:hover,
.kanban-card-link:focus-visible { color: var(--accent); }
.kanban-card-meta {
  margin-top: 0.3rem;
  font-size: 0.78rem;
  color: var(--fg-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

/* === db filters === */
.db-filters-wrap {
  border-bottom: 1px solid var(--border);
}
.db-filters-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--fg-muted);
  list-style: none;
  user-select: none;
}
.db-filters-toggle::-webkit-details-marker { display: none; }
.db-filters-toggle-icon {
  width: 0.55rem; height: 0.55rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 120ms ease;
}
.db-filters-wrap[open] > .db-filters-toggle .db-filters-toggle-icon {
  transform: rotate(45deg);
}
.db-filters-toggle-count {
  display: inline-block;
  min-width: 1.1rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--fg);
  font-size: 0.7rem;
  text-align: center;
}
.db-filters-toggle:hover { color: var(--fg); }
.db-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
  padding: 0.55rem 0.9rem;
  background: var(--bg);
  align-items: center;
}
.db-filter-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
}
.db-filter-label {
  color: var(--fg-muted);
  font-weight: 500;
}
.db-filter-chips { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; }
.db-filter-chip {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--fg);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
.db-filter-chip:hover { border-color: var(--accent); }
.db-filter-chip.is-active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.db-filter-date,
.db-filter-num {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  max-width: 8.5rem;
}
.db-filter-num { max-width: 5rem; }
.db-filter-sep { color: var(--fg-muted); font-size: 0.8rem; }
.db-filter-sort { display: inline-flex; align-items: center; gap: 0.35rem; margin-left: auto; }
.db-filter-sort-select {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
}
.db-filter-clear {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  border-radius: 4px;
  padding: 0.15rem 0.55rem;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.db-filter-clear:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.inline-db-empty-filter { font-style: italic; }
@media (max-width: 720px) {
  .db-filters { flex-direction: column; align-items: stretch; }
  .db-filter-sort { margin-left: 0; }
}

/* === compact inline DB === */
/* Small inline databases nested inside a column_list render as a quiet
   bulletless list — no filter strip, no sort headers, no "open full view"
   link. The aim is parity with how Notion itself renders small linked DBs
   tucked into a column layout: a tight summary, not a wall of mini-tables. */
.inline-db-compact {
  display: contents;
}
.inline-db-compact .inline-db-compact-head {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0 0 0.3rem;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 0.82rem;
}
.inline-db-compact .inline-db-compact-title {
  font-weight: 600;
  color: var(--fg);
}
.inline-db-compact .inline-db-compact-count {
  color: var(--fg-muted);
  font-size: 0.78rem;
}
.db-compact-list {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.db-compact-row {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.18rem 0.3rem;
  border-radius: 4px;
  font-size: 0.86rem;
  line-height: 1.35;
}
.db-compact-row:hover {
  background: var(--bg-subtle);
}
.db-compact-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-compact-link:hover { text-decoration: underline; }
.db-compact-meta {
  color: var(--fg-muted);
  font-size: 0.78rem;
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-compact-meta .db-chip {
  font-size: 0.72rem;
  padding: 0 0.35rem;
}

/* === muted placeholder for zero-row "Untitled" inline DBs ===
   Without the placeholder these render as the empty string, which collapses
   column_list cells and looks like a rendering bug. The placeholder is
   intentionally smaller than a compact-list row — a single muted line so
   the layout grid stays intact without drawing attention.

   The selector is qualified with section.inline-db so it matches the parent
   section.inline-db rule's (0,1,1) specificity and our
   border/background/border-radius/margin overrides actually win. Without
   this, the parent's solid border + filled background defeats the
   dashed-transparent placeholder design. */
section.inline-db.inline-db-empty-placeholder {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.15rem 0.4rem;
  margin: 0 0 0.4rem;
  border: 1px dashed var(--border, rgba(127, 127, 127, 0.35));
  border-radius: 4px;
  background: transparent;
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--fg-muted);
  opacity: 0.5;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inline-db-empty-placeholder-icon {
  font-size: 0.7rem;
  line-height: 1;
}
.inline-db-empty-placeholder-text {
  font-style: italic;
}

/* Compact card for NAMED zero-row inline DBs. Matches the
   Untitled-placeholder pattern (single muted line, no chrome) but keeps the
   title visible since it carries info ("Maintenance and Warranty", etc.).
   Slightly more emphatic than the muted Untitled placeholder — full opacity,
   no dashed border, title weight intact — because a named empty DB is a
   real operator-known artefact, not a layout filler.

   Qualified with section.inline-db so the (0,1,0) class selector doesn't
   lose to the parent section.inline-db rule's (0,1,1) specificity (see
   placeholder note above). */
section.inline-db.inline-db-empty-named {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.25rem 0.55rem;
  margin: 0 0 0.5rem;
  border: 1px solid var(--border, rgba(127, 127, 127, 0.3));
  border-radius: 5px;
  background: transparent;
  font-size: 0.85rem;
  line-height: 1.3;
  color: var(--fg-muted);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inline-db-empty-named-title {
  font-weight: 500;
  color: var(--fg, currentColor);
}
.inline-db-empty-named-state {
  font-style: italic;
  font-size: 0.78rem;
  opacity: 0.7;
}

/* Stats dashboard (stats.html) */
.index-stats-card {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin: 1rem 0 0;
  padding: 0.85rem 1rem;
  text-decoration: none;
  color: inherit;
  border-radius: 10px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.index-stats-card:hover {
  transform: translateY(-1px);
  border-color: var(--accent, var(--fg));
  background: var(--bg);
}
.index-stats-card-icon {
  font-size: 1.55rem;
  line-height: 1;
  flex-shrink: 0;
}
.index-stats-card-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}
.index-stats-card-title { font-weight: 600; font-size: 1rem; }
.index-stats-card-sub {
  color: var(--fg-muted);
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.index-stats-card-arrow {
  color: var(--fg-muted);
  font-size: 1.15rem;
  transition: transform 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}
.index-stats-card:hover .index-stats-card-arrow {
  transform: translateX(3px);
  color: var(--fg);
}
body.stats-page .stats-layout {
  max-width: 980px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
.stats-hero { margin-bottom: 1.5rem; }
.stats-breadcrumb { margin: 0 0 0.4rem; font-size: 0.88rem; }
.stats-breadcrumb a { text-decoration: none; color: var(--fg-muted); }
.stats-breadcrumb a:hover { color: var(--fg); }
.stats-hero h1 { margin: 0 0 0.25rem; font-size: 1.65rem; }
.stats-generated { margin: 0; color: var(--fg-muted); font-size: 0.85rem; }
.stats-section { margin-top: 1.75rem; }
.stats-section > h2 {
  margin: 0 0 0.7rem;
  font-size: 1.05rem;
  letter-spacing: 0.01em;
}
.stats-section-sub {
  color: var(--fg-muted);
  font-weight: 400;
  font-size: 0.85rem;
  margin-left: 0.35rem;
}
.stats-two-col {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}
@media (min-width: 760px) {
  .stats-two-col { grid-template-columns: 1fr 1fr; }
}
.stats-counters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.6rem;
  margin: 0;
  padding: 0;
}
.stats-counter {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  background: var(--bg-subtle);
}
.stats-counter dt {
  font-size: 0.78rem;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 0.15rem;
}
.stats-counter dd {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stats-counter-recent dd { color: var(--accent, currentColor); }
.stats-bookend {
  margin: 0.7rem 0 0;
  font-size: 0.88rem;
  color: var(--fg-muted);
}
.stats-bookend-label { color: var(--fg-muted); }
.stats-bookend a { font-weight: 500; }
.stats-bookend time { margin-left: 0.4rem; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.stats-chart {
  width: 100%;
  height: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.4rem 0.2rem 0;
  box-sizing: border-box;
}
.stats-chart .stats-bar rect {
  fill: var(--accent, #4c8df6);
  transition: fill 0.15s ease;
}
.stats-chart .stats-bar:hover rect { fill: var(--accent-hover, #3470d8); }
.stats-axis { font-size: 10px; fill: var(--fg-muted); font-variant-numeric: tabular-nums; }
.stats-axis-line { stroke: var(--border); stroke-width: 1; }
.stats-rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.stats-row {
  display: grid;
  grid-template-columns: minmax(0, 9rem) 1fr 4rem;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
}
.stats-row-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-row-label a { text-decoration: none; }
.stats-row-bar {
  display: block;
  height: 0.7rem;
  background: var(--bg-subtle);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.stats-row-fill {
  display: block;
  height: 100%;
  background: var(--accent, #4c8df6);
  border-radius: 3px;
}
.stats-row-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  font-size: 0.85rem;
}
.stats-recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stats-recent-list li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.8rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.93rem;
}
.stats-recent-list li:last-child { border-bottom: 0; }
.stats-recent-list a {
  text-decoration: none;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats-recent-list time {
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  flex-shrink: 0;
}
.stats-empty { color: var(--fg-muted); font-style: italic; margin: 0; }
`;
