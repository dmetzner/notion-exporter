import fsp from "node:fs/promises";
import path from "node:path";
import lunr from "lunr";

export interface SearchDoc {
  /** Page/DB id; primary key in the lunr index. */
  id: string;
  title: string;
  /** Snippet of body text used for excerpts. */
  body: string;
  /** Relative href from html/index.html. */
  href: string;
  kind: "page" | "database";
}

export interface SearchPayload {
  /** Pre-built lunr index, serialised. */
  index: object;
  /** Lookup table for title/href/snippet by id. */
  docs: Record<string, { title: string; href: string; kind: "page" | "database"; snippet: string }>;
}

/**
 * Maximum number of body characters fed into Lunr per doc. TF-IDF only needs a
 * representative sample of the text — the first ~500 chars cover the title,
 * lede, and opening paragraph, which is enough for the inverted index to rank
 * correctly while keeping the shipped `search-index.js` payload an order of
 * magnitude smaller than embedding full bodies.
 */
export const BODY_INDEX_CAP = 500;

export function buildSearchIndex(docs: SearchDoc[]): SearchPayload {
  const index = lunr(function () {
    this.ref("id");
    this.field("title", { boost: 5 });
    this.field("body");
    for (const d of docs) {
      this.add({ id: d.id, title: d.title, body: d.body.slice(0, BODY_INDEX_CAP) });
    }
  });
  const lookup: SearchPayload["docs"] = {};
  for (const d of docs) {
    lookup[d.id] = {
      title: d.title,
      href: d.href,
      kind: d.kind,
      snippet: d.body.slice(0, 160).replace(/\s+/g, " "),
    };
  }
  // The pre-built lunr index already contains the tokenised representation of
  // each doc's body; the runtime never re-reads the raw body, so we drop it
  // from the shipped lookup entirely. Only title/kind/href/snippet survive.
  return { index: index.toJSON(), docs: lookup };
}

// Built via `new RegExp` rather than regex literals because line-terminator code points
// (LS U+2028 / PS U+2029) are not allowed inside regex literal source per the ECMAScript
// grammar — and our parser/formatter (biome) rejects them outright.
// biome-ignore lint/complexity/useRegexLiterals: regex literal cannot contain LS/PS code points.
const LS_RE = new RegExp("\\u2028", "g");
// biome-ignore lint/complexity/useRegexLiterals: regex literal cannot contain LS/PS code points.
const PS_RE = new RegExp("\\u2029", "g");

/**
 * JSON-stringify a value so it is safe to embed inside an inline `<script>` tag.
 *
 * `JSON.stringify` alone does not escape `<`, `>`, or `/`, so a payload containing
 * `</script>` (e.g. a Notion page title) would break out of the script context and
 * allow arbitrary HTML injection. We also escape the HTML comment closer `-->` and
 * the LS/PS characters that are valid in JSON strings but illegal in JS source.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e")
    .replace(LS_RE, "\\u2028")
    .replace(PS_RE, "\\u2029");
}

// Emit as a `.js` file that sets a window-scoped global instead of a `.json` file.
// The HTML opens via file://, where fetch() is blocked by CORS; a `<script>` tag avoids
// that limitation entirely.
export async function writeSearchIndex(htmlDir: string, payload: SearchPayload): Promise<string> {
  const abs = path.join(htmlDir, "search-index.js");
  await fsp.writeFile(abs, `window.NE_SEARCH_DATA=${jsonForScript(payload)};`);
  return abs;
}

/**
 * Internal sidecar file (NOT shipped to the browser) that captures each doc's
 * indexable body text, capped at `BODY_INDEX_CAP`. The shipped `search-index.js`
 * intentionally strips bodies to keep the runtime payload small (only the
 * lunr-tokenised form survives, and tokens cannot be reversed into searchable
 * text). Without a sidecar, `repair` would have to re-read every page's
 * markdown off disk to rebuild the lunr index — for a 941-page workspace that
 * is ~24 MB of reads and ~3-5 s of CPU on a 1-asset repair where ≥99% of
 * bodies are byte-identical to what the previous run already indexed.
 *
 * Sits next to `search-index.js` under `html/` so retention prunes it
 * alongside the index. JSON, not JS — repair reads it directly, the browser
 * never loads it.
 */
export const SEARCH_BODIES_FILENAME = "search-bodies.json";

export async function writeSearchBodies(htmlDir: string, docs: SearchDoc[]): Promise<string> {
  const abs = path.join(htmlDir, SEARCH_BODIES_FILENAME);
  const bodies: Record<string, string> = {};
  for (const d of docs) bodies[d.id] = d.body.slice(0, BODY_INDEX_CAP);
  await fsp.writeFile(abs, JSON.stringify(bodies));
  return abs;
}

export async function readSearchBodies(htmlDir: string): Promise<Record<string, string> | null> {
  const abs = path.join(htmlDir, SEARCH_BODIES_FILENAME);
  try {
    const raw = await fsp.readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // Reject any non-string entries; defensive against tampering.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// Single regex that matches every markdown construct we want to strip, in
// priority order: fenced code → inline code → image/link → raw HTML →
// formatting punctuation. Anchored at "any" so each match replaces a
// contiguous span without re-scanning the document six times.
const PLAIN_TEXT_STRIP = /```[\s\S]*?```|`[^`]+`|!?\[[^\]]*\]\([^)]*\)|<[^>]+>|[#>*_~|-]+/g;

/** Strip markdown formatting into a flat snippet-friendly string. */
export function plainText(md: string): string {
  return md.replace(PLAIN_TEXT_STRIP, " ").replace(/\s+/g, " ").trim();
}
