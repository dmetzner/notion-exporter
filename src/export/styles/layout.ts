export const LAYOUT_CSS = `
.layout {
  max-width: 760px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 5rem;
}

/*
 * App shell — sidebar + main content
 *
 * Desktop (>=900px): sidebar visible by default. Toggling #ne-sb-toggle
 *   collapses the grid column to 0 and slides the sidebar offscreen.
 * Mobile (<900px):  sidebar is an overlay drawer, hidden by default.
 *   Toggling #ne-sb-toggle shows the drawer + scrim.
 */`;
