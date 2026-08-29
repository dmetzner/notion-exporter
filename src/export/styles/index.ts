export const INDEX_CSS = `
/* index page */
.layout.index { max-width: 920px; }
.index-hero {
  margin: 0 0 2.5rem;
  padding: 2rem 2rem 2.25rem;
  background:
    radial-gradient(120% 140% at 0% 0%, var(--accent-bg) 0%, transparent 55%),
    linear-gradient(180deg, var(--bg-subtle), var(--bg));
  border: 1px solid var(--border);
  border-radius: 12px;
}
.index-hero .eyebrow {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}
.index-hero h1 {
  margin: 0.35rem 0 0.5rem;
  border: 0;
  padding: 0;
  font-size: 2.25rem;
  letter-spacing: -0.01em;
}
.index-hero .lede {
  margin: 0 0 1.25rem;
  color: var(--fg-muted);
  font-size: 1.0625rem;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  padding: 0;
}
.stats > div {
  padding: 0.6rem 0.85rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.stats dt {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-muted);
}
.stats dd {
  margin: 0.15rem 0 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.index-tree { margin-top: 2rem; }
.section-title {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-muted);
  border: 0;
  padding: 0;
}
.site-footer {
  margin-top: 4rem;
  padding: 1.5rem 0 0;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 0.8125rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.site-footer .footer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
}
.site-footer .footer-page {
  color: var(--fg);
  font-weight: 500;
  font-size: 0.875rem;
}
.site-footer .footer-meta {
  justify-content: space-between;
  padding-top: 0.4rem;
  border-top: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
}
.site-footer .footer-brand a {
  color: var(--fg-muted);
  text-decoration: none;
  border-bottom: 1px dotted var(--border);
  transition: color 0.15s, border-color 0.15s;
}
.site-footer .footer-brand a:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.site-footer a { color: var(--fg-muted); }
.site-footer .footer-copy { font-variant-numeric: tabular-nums; }
.ne-search { margin: 0.5rem 0 0; }
#ne-search {
  width: 100%;
  font-size: 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--fg);
  border-radius: 6px;
  outline: none;
}
#ne-search:focus { border-color: var(--accent); background: var(--bg); }
/* index page search results: use .ne-results shared styles, plus a card frame */
#ne-search-results {
  margin: 0.6rem 0 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
#ne-search-results li a { padding: 0.55rem 0.85rem; border-radius: 0; }
#ne-search-results .ne-snippet { padding: 0 0.85rem 0.55rem 2.6rem; font-size: 0.8125rem; }
#ne-search-results .ne-empty { padding: 0.75rem 0.85rem; font-size: 0.875rem; }
body.ne-searching .index-tree { display: none; }

/* tree nav (shared by index and sidebar) */
.tree-root { margin-top: 1rem; }
ul.tree {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
ul.tree ul.children {
  list-style: none;
  margin: 0 0 0 0.6rem;
  padding-left: 0.65rem;
  border-left: 1px solid var(--border);
}
ul.tree li { margin: 0; }
ul.tree .row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 6px;
  padding: 0.15rem 0.25rem;
  transition: background 0.1s ease;
}
ul.tree .row:hover { background: var(--bg-subtle); }
ul.tree .caret,
ul.tree .caret-spacer {
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--fg-muted);
}
ul.tree .caret {
  cursor: pointer;
  user-select: none;
}
ul.tree .caret:hover { background: var(--border); color: var(--fg); }
ul.tree .caret svg {
  transition: transform 0.12s ease;
}
ul.tree .branch > input.branch-toggle:checked ~ .row > .caret svg { transform: rotate(90deg); }
ul.tree .branch > input.branch-toggle:not(:checked) ~ ul.children { display: none; }
ul.tree .tree-icon,
ul.tree .tree-emoji {
  flex: 0 0 1.25rem;
  width: 1.25rem;
  height: 1.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
  margin: 0;
}
ul.tree img.tree-icon {
  border-radius: 4px;
  object-fit: cover;
  width: 1.25rem !important;
  height: 1.25rem !important;
  max-width: 1.25rem;
  display: block;
}
ul.tree .tree-fallback { color: var(--fg-muted); opacity: 0.7; }
ul.tree a {
  flex: 1;
  min-width: 0;
  display: block;
  padding: 0.1rem 0.25rem;
  color: var(--fg);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 450;
}
ul.tree a:hover { color: var(--accent); }
ul.tree a:hover .tree-title { text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; }
ul.tree a.active {
  color: var(--accent);
  font-weight: 600;
}

/* page cover — full-width banner. Lives in the "full" grid track so it
 * extends edge-to-edge of the main column. Spacing to the H1 below is
 * generous so the title has room to breathe. */
.cover {
  margin: 0 0 2.5rem;
  padding: 0;
  width: 100%;
}
.cover img {
  width: 100%;
  height: 280px;
  max-height: 34vh;
  object-fit: cover;
  border-radius: 0;
  margin: 0;
  display: block;
}
.breadcrumbs {
  font-size: 0.875rem;
  color: var(--fg-muted);
  margin: 0;
  word-break: break-word;
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}
.breadcrumbs a:not(:last-child)::after { content: " ›"; color: var(--fg-muted); margin-left: 0.15rem; }
@media (max-width: 899.98px) {
  .cover { margin: 0 0 1.75rem; }
  .cover img { height: 220px; max-height: 30vh; }
}
.breadcrumbs a { color: var(--fg-muted); }
.breadcrumbs a:hover { color: var(--accent); }
h1:has(> .page-icon) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.page-icon {
  width: 1.25em;
  height: 1.25em;
  border-radius: 6px;
  display: inline-block;
  margin: 0;
  object-fit: cover;
  vertical-align: -0.2em;
  flex-shrink: 0;
}
.page-footer {
  display: block;
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 0.875rem;
}
.page-footer a { color: var(--fg-muted); text-decoration: underline; }
.page-footer a:hover { color: var(--accent); }
.page-props {
  width: auto;
  display: table;
  margin-bottom: 1.5rem;
  font-size: 0.9375em;
}
.page-props th {
  text-align: left;
  color: var(--fg-muted);
  font-weight: 500;
  padding-right: 1rem;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.page-props td {
  border: 0;
  border-bottom: 1px solid var(--border);
}
.page-props tr:last-child th, .page-props tr:last-child td { border-bottom: 0; }

/* child_page / child_database / link_to_page: Notion-style inline page link.
 * No bullet, no surrounding list — just icon + title on its own row. */
.page-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.15rem 0;
  color: var(--fg);
  text-decoration: none;
  font-size: 0.9375rem;
  line-height: 1.5;
}
.page-link:hover { color: var(--accent); }
.page-link-title {
  border-bottom: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  transition: border-color 0.15s;
}
.page-link:hover .page-link-title { border-bottom-color: currentColor; }
.page-link-icon {
  width: 1.25rem;
  height: 1.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
  margin: 0;
}
img.page-link-icon {
  border-radius: 4px;
  object-fit: cover;
}
.page-link-fallback { color: var(--fg-muted); }
`;
