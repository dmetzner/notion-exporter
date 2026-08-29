export const MEDIA_CSS = `
/* === image lightbox === */
main img:not(.custom-emoji):not(.sidebar-home-icon):not(.index-hero-icon):not(.tree-icon):not(.db-card-icon):not([data-no-zoom]) {
  cursor: zoom-in;
}
.ne-lightbox {
  border: none;
  padding: 0;
  background: transparent;
  max-width: 95vw;
  max-height: 95vh;
  overflow: visible;
  color: #fff;
}
.ne-lightbox::backdrop {
  background: rgba(0, 0, 0, 0.85);
}
.ne-lightbox img {
  display: block;
  max-width: 100%;
  max-height: 90vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}
.ne-lightbox button.close {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  z-index: 1;
}
.ne-lightbox button.close:hover,
.ne-lightbox button.close:focus-visible {
  background: rgba(0, 0, 0, 0.92);
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* ── Inline media (audio/video figures) ───────────────────────────────────
 * Both controls share a max width so they don't blow out the reading column.
 * <audio> is fixed-height; <video> keeps its aspect ratio with object-fit. */
figure.media {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 720px;
}
figure.media audio,
figure.media video {
  width: 100%;
  border-radius: 8px;
  display: block;
  margin: 0;
  background: var(--bg-subtle);
}
figure.media.audio audio { height: 40px; }
figure.media.video video {
  aspect-ratio: 16 / 9;
  max-height: 70vh;
  object-fit: contain;
}
figure.media > figcaption {
  font-size: 0.875em;
  color: var(--fg-muted);
  font-style: italic;
}

/* ── PDF preview ─────────────────────────────────────────────────────────
 * Browsers handle PDF rendering inline via <iframe>. We size it tall enough
 * to show the first page comfortably while still letting the iframe's own
 * controls (zoom / page nav) take over for longer documents. */
figure.pdf-preview {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
figure.pdf-preview iframe {
  width: 100%;
  height: 70vh;
  min-height: 480px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
  display: block;
}
figure.pdf-preview > figcaption {
  font-size: 0.875em;
  color: var(--fg-muted);
}

/* ── KaTeX equations ──────────────────────────────────────────────────────
 * Server-rendered HTML is styled by katex.min.css (linked from <head>).
 * These rules only handle the wrapper layout + the malformed-LaTeX fallback. */
.katex-block {
  margin: 1rem 0;
  overflow-x: auto;
  text-align: center;
}
.katex-inline { display: inline; }
.katex-failed {
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
}
pre.katex-failed { padding: 0.75rem 1rem; white-space: pre-wrap; }

/* ── Embed cards (bookmark / embed / link_preview) ────────────────────────
 * Video providers (YouTube/Vimeo/Loom) emit an iframe inside .embed.video-embed;
 * we lock that to 16:9. Generic links emit a .link-card. */
figure.embed {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
figure.embed > figcaption {
  font-size: 0.875em;
  color: var(--fg-muted);
  font-style: italic;
}
figure.embed.video-embed {
  max-width: 880px;
}
figure.embed.video-embed iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: 8px;
  background: #000;
  display: block;
}

figure.link-card {
  margin: 0.75rem 0;
  max-width: 560px;
}
figure.link-card > a {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms ease, background 120ms ease;
}
figure.link-card > a:hover,
figure.link-card > a:focus-visible {
  border-color: var(--accent);
  background: var(--accent-bg);
}
figure.link-card .link-card-host {
  font-size: 0.8125em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
figure.link-card .link-card-url {
  font-size: 0.9375em;
  color: var(--accent);
  word-break: break-all;
}
figure.link-card .link-card-caption {
  font-size: 0.875em;
  color: var(--fg);
  margin-top: 0.25rem;
}
`;
