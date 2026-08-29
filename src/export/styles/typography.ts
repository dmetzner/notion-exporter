export const TYPOGRAPHY_CSS = `
nav.crumbs {
  font-size: 0.875rem;
  color: var(--fg-muted);
  margin-bottom: 2rem;
}
nav.crumbs a { color: var(--fg-muted); text-decoration: none; }
nav.crumbs a:hover { color: var(--accent); text-decoration: underline; }

h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  scroll-margin-top: 4rem;
}
h1 { font-size: 2rem; margin-top: 0; }
h2 { font-size: 1.5rem; margin-top: 1.5rem; }
h3 { font-size: 1.25rem; margin-top: 1.25rem; font-weight: 550; }
/* Tone down <strong> inside an already-bold h3 so it doesn't read as super-heavy. */
h3 strong, h3 b { font-weight: 600; }
h4 { font-size: 1rem; margin-top: 1rem; font-weight: 600; }
h5 { font-size: 0.875rem; color: var(--fg-muted); }
h6 { font-size: 0.85rem; color: var(--fg-muted); }

p, ul, ol, blockquote, pre, table, details { margin: 0 0 1rem; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

ul, ol { padding-left: 1.5rem; }
li { margin: 0.25rem 0; }
li > p { margin: 0; }
li input[type="checkbox"] { margin-right: 0.4rem; }

/* Task lists: drop the bullet for any list/list-item that holds checkboxes so
 * we don't render bullet + checkbox side by side. */
ul:has(> li > input[type="checkbox"]),
ul:has(> li > p > input[type="checkbox"]) {
  list-style: none;
  padding-left: 0.25rem;
}
li:has(> input[type="checkbox"]),
li:has(> p > input[type="checkbox"]) {
  list-style: none;
}

blockquote {
  margin: 0 0 0.5rem;
  padding: 0.35rem 1rem;
  border-left: 3px solid var(--border);
  color: var(--fg);
  background: transparent;
  border-radius: 0;
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }

code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: 0.875em;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 0.15em 0.35em;
  border-radius: 4px;
}
pre {
  background: var(--pre-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  font-size: 0.875em;
  line-height: 1.5;
}
pre code { padding: 0; background: transparent; border-radius: 0; font-size: inherit; }

/* Copy button injected client-side into every <pre><code>. Subtle, top-right,
 * fades in on hover, swaps to a check on success. */
pre.has-copy { position: relative; }
.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  padding: 0;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--fg-muted);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-1px);
  transition: opacity 0.15s ease, color 0.12s, background 0.12s, border-color 0.12s, transform 0.12s;
}
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
:focus:not(:focus-visible) { outline: none; }
pre.has-copy:hover .copy-btn,
pre.has-copy:focus-within .copy-btn,
.copy-btn:focus-visible { opacity: 1; }
.copy-btn:hover { color: var(--fg); background: var(--bg-subtle); transform: translateY(0); }
.copy-btn:active { transform: translateY(0) scale(0.96); }
.copy-btn.copied {
  opacity: 1;
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: var(--accent-bg);
}
/* On touch devices (no hover), always show the button at reduced opacity. */
@media (hover: none) {
  pre.has-copy .copy-btn { opacity: 0.65; }
}

img, video {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  margin: 0.5rem 0;
}

hr {
  height: 1px;
  border: 0;
  background: var(--border);
  margin: 0.5rem 0;
}

table {
  border-collapse: collapse;
  width: 100%;
  display: block;
  overflow-x: auto;
  font-size: 0.9375em;
}
th, td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}
th { background: var(--bg-subtle); font-weight: 600; }
tr:nth-child(even) td { background: var(--bg-subtle); }
`;
