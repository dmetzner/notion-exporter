export const BLOCKS_CSS = `
/* Notion toggle blocks render as <details>. Minimal styling — no panel chrome,
 * just a chevron + summary, with the body indented when expanded. */
details {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0;
  margin: 0 0 0.5rem;
}
details > summary {
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.2rem 0.5rem 0.2rem 0.3rem;
  margin-left: -0.3rem;
  border-radius: 4px;
  transition: background 0.12s ease, color 0.12s ease;
}
details > summary:hover { background: var(--bg-subtle); }
details > summary:hover::before { color: var(--accent); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before {
  content: "";
  display: inline-block;
  width: 0.65em;
  height: 0.65em;
  flex-shrink: 0;
  /* SVG chevron drawn with currentColor so hover/dark-mode just work. */
  background: currentColor;
  color: var(--fg-muted);
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M4 2 L8 6 L4 10' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat center / contain;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M4 2 L8 6 L4 10' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat center / contain;
  transition: transform 0.16s ease, color 0.12s ease;
}
details[open] > summary::before { transform: rotate(90deg); color: var(--fg); }
details > :not(summary) {
  margin-left: 1.1rem;
  padding-left: 0.7rem;
  /* Vertical guide makes the open body visually attached to its toggle —
   * a subtle "this content belongs to that summary" affordance. */
  border-left: 2px solid var(--border);
}
details[open]:hover > :not(summary) { border-left-color: var(--accent-bg); }
details[open] > summary { margin-bottom: 0.35rem; }

/* Notion toggle headings: <h1|2|3> inside the <summary> keeps the heading
 * typography while the chevron sits alongside it. */
details.toggle-heading > summary > h1,
details.toggle-heading > summary > h2,
details.toggle-heading > summary > h3 {
  margin: 0;
  display: inline;
  font-weight: inherit;
}
details.toggle-heading { margin: 1rem 0 1rem; }
/* Toggle headings act like top-level structure — drop the indent + guide rail
 * the generic <details> gets so they read like normal section headings. */
details.toggle-heading > :not(summary) {
  margin-left: 0;
  padding-left: 0;
  border-left: 0;
}
details.toggle-heading > summary > h1 { font-size: 1.6rem; font-weight: 700; }
details.toggle-heading > summary > h2 { font-size: 1.3rem; font-weight: 700; }
details.toggle-heading > summary > h3 { font-size: 1.1rem; font-weight: 700; }
details.toggle-heading > summary > h4 { font-size: 1rem; font-weight: 600; }

/* Table of Contents — rendered from Notion's table_of_contents block. */
nav.toc {
  margin: 0.5rem 0 1.5rem;
  padding: 0.75rem 1rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.95rem;
}
nav.toc::before {
  content: "Inhaltsverzeichnis";
  display: block;
  font-weight: 600;
  margin-bottom: 0.35rem;
  color: var(--fg-muted);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
nav.toc ul { margin: 0; padding-left: 1.1rem; }
nav.toc li { margin: 0.15rem 0; }
nav.toc a { color: var(--fg); }
nav.toc a:hover { color: var(--accent); }

/* Inline child_database views — render rows like a compact Notion table view. */
section.inline-db {
  margin: 1rem 0 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.inline-db-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.6rem 0.9rem;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}
.inline-db-title { font-weight: 600; }
.inline-db-count { color: var(--fg-muted); font-size: 0.85rem; }
.inline-db-open { margin-left: auto; font-size: 0.85rem; }
.inline-db-linked-note {
  margin: 0;
  padding: 0.45rem 0.9rem;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 0.8rem;
  font-style: italic;
}
.inline-db-table-wrap { overflow-x: auto; max-height: 480px; overflow-y: auto; }
table.inline-db-table { width: 100%; margin: 0; border-collapse: collapse; font-size: 0.9rem; }
table.inline-db-table th,
table.inline-db-table td {
  padding: 0.4rem 0.7rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  white-space: nowrap;
}
table.inline-db-table th {
  background: var(--bg-subtle);
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
table.inline-db-table tr:last-child td { border-bottom: 0; }
table.inline-db-table tr:nth-child(even) td { background: var(--bg-subtle); }
.inline-db-empty { padding: 0.75rem 0.9rem; color: var(--fg-muted); }

/* Quick filter input + sortable column headers for inline DB views. */
.inline-db-filter {
  margin-left: auto;
  margin-right: 0.5rem;
  padding: 0.2rem 0.55rem;
  font-size: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  outline: none;
  width: 140px;
  transition: width 0.18s ease, border-color 0.12s ease;
}
.inline-db-filter:focus { border-color: var(--accent); width: 180px; }
table.inline-db-table th[data-sort-col] {
  cursor: pointer;
  user-select: none;
}
table.inline-db-table th[data-sort-col]:hover { color: var(--fg); }
table.inline-db-table th .sort-arrow {
  display: inline-block;
  width: 0.9em;
  margin-left: 0.2em;
  opacity: 0.4;
  font-size: 0.85em;
}
table.inline-db-table th.sorted-asc .sort-arrow::before { content: "▲"; opacity: 1; }
table.inline-db-table th.sorted-desc .sort-arrow::before { content: "▼"; opacity: 1; }
table.inline-db-table th.sorted-asc,
table.inline-db-table th.sorted-desc { color: var(--fg); }
.inline-db-gallery .inline-db-filter { margin-right: 0; }

/* Clickable title cell in inline-db table view — the entire title text
 * navigates to the row's detail page. Keeps the visible affordance scoped to
 * the title cell only (wrapping the whole <tr> in <a> would be invalid HTML). */
table.inline-db-table td.db-row-title-cell { cursor: pointer; }
table.inline-db-table td.db-row-title-cell a.db-row-link {
  display: block;
  color: inherit;
  text-decoration: none;
  font-weight: 500;
}
table.inline-db-table td.db-row-title-cell:hover a.db-row-link {
  color: var(--accent);
  text-decoration: underline;
}

/* Gallery view — Notion-style cards for databases whose rows have covers. */
.inline-db-gallery { background: transparent; border: 0; }
.inline-db-gallery .inline-db-head { background: transparent; border: 0; padding: 0.1rem 0 0.6rem; }
.db-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.9rem;
}
.db-card {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: box-shadow 0.12s ease, transform 0.12s ease;
}
.db-card:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06); }
.db-card-cover {
  aspect-ratio: 16 / 11;
  background: var(--bg-subtle);
  overflow: hidden;
}
.db-card-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.db-card-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.db-card-cover-empty::before {
  content: "📷";
  font-size: 1.75rem;
  opacity: 0.4;
}
.db-card-meta { padding: 0.7rem 0.85rem 0.85rem; display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; overflow-wrap: anywhere; }
.db-card-title {
  font-weight: 600;
  font-size: 0.95rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--fg);
  text-decoration: none;
  line-height: 1.25;
}
a.db-card-title:hover { color: var(--accent); }
.db-card-icon { width: 1em; height: 1em; object-fit: contain; }
.db-card-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.1rem; }
.db-card-body { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: var(--fg-muted); }
.db-card-detail { line-height: 1.35; }
.db-card-label {
  display: inline-block;
  min-width: 5.5em;
  margin-right: 0.4em;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--fg-muted);
  opacity: 0.85;
}
.db-card-value { color: var(--fg); }

/* Subpages listing — renders below the body for pages that have children we
 * couldn't otherwise place via child_page / child_database blocks. */
/* Opt-in via STYLE_BACK_LINKS=true: "↩️ Zurück zu X" / "↩️ Back to X" links
 * the user places under the H1 get a deliberate back-button pill so they
 * read as navigation rather than body prose. */
p.back-link {
  margin: 0.4rem 0 0.5rem;
  font-size: 0.875rem;
}
p.back-link a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  text-decoration: none;
  transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease;
}
p.back-link a:hover {
  color: var(--fg);
  background: var(--bg);
  border-color: var(--accent);
  text-decoration: none;
}

section.page-children {
  margin: 2rem 0 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.page-children-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--fg-muted);
  font-weight: 600;
  margin: 0 0 0.6rem;
  border: 0;
}
.page-children-list { display: flex; flex-direction: column; gap: 0.25rem; }

/* === page comments === */
/* Bottom-of-page Notion comments. Sidebar accent stripe distinguishes the
 * section from the rest of the body. */
section.page-comments {
  margin: 2rem 0 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.page-comments-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--fg-muted);
  font-weight: 600;
  margin: 0 0 0.75rem;
  border: 0;
}
.comments {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.comment {
  position: relative;
  padding: 0.65rem 0.8rem 0.65rem 1rem;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
}
.comment-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.85rem;
}
.comment-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  flex: 0 0 auto;
}
.comment-author {
  font-weight: 600;
  color: var(--fg);
}
.comment-time {
  color: var(--fg-muted);
  font-size: 0.8rem;
  margin-left: auto;
}
.comment-body {
  color: var(--fg);
  line-height: 1.45;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.comment-body p { margin: 0.25rem 0; }
.comment-body p:first-child { margin-top: 0; }
.comment-body p:last-child { margin-bottom: 0; }

.db-url { color: var(--fg-muted); }
.db-url:hover { color: var(--accent); }
`;
