export const PRINT_CSS = `
/* Print: drop chrome, keep the article. */
@media print {
  .sidebar, .sidebar-scrim, .topbar, .copy-btn, label.topbar-toggle, input#ne-sb-toggle { display: none !important; }
  .app { display: block; }
  .main-col { padding: 0; }
  body.has-sidebar { padding: 0; }
  a { color: inherit; text-decoration: underline; }
  details > summary::before { content: ""; }
  details { page-break-inside: avoid; }
  details[open] > summary { margin-bottom: 0.5rem; }
  details:not([open]) > :not(summary) { display: block !important; }
}
`;
