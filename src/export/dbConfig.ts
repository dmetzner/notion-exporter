// Parse a `%%notion-exporter` fenced JSON block out of a Notion database's
// `description` rich-text. Returns a typed, validated override object that the
// renderer consults before falling back to its heuristics.
//
// Lives in `src/export/` because this is a renderer-time convention (an
// operator-embedded fence in the description) — not a wire-level Notion
// concern. `src/notion/` is reserved for SDK / pagination / rate-limit code.

import type { Logger } from "../logger.js";

export interface DbViewConfig {
  view?: "kanban" | "table" | "gallery";
  groupBy?: string;
  order?: string[];
  hideFilters?: boolean;
  cardMeta?: string[];
}

const VIEW_VALUES = new Set(["kanban", "table", "gallery"]);

interface RichTextLike {
  plain_text?: string;
}

interface DescriptionCarrier {
  description?: RichTextLike[] | null;
  id?: string;
}

/**
 * Concat `database.description` rich-text into a single plain-text string,
 * tolerating missing/empty fields and non-string `plain_text` entries.
 */
function descriptionText(database: unknown): string {
  const db = database as DescriptionCarrier | null | undefined;
  const rt = db?.description;
  if (!Array.isArray(rt)) return "";
  let out = "";
  for (const item of rt) {
    const t = item?.plain_text;
    if (typeof t === "string") out += t;
  }
  return out;
}

/**
 * Extract the FIRST `%%notion-exporter` … `%%` block body. Returns:
 *   - `{ body }` when a complete fence was found
 *   - `{ unterminated: true }` when an opener exists but no closing `%%`
 *   - `null` when no opener is present at all
 *
 * The opener match is anchored to a line start (or string start) so a stray
 * `%%notion-exporter` inside running prose can't accidentally trigger. The
 * body is captured ungreedy so multiple fences don't bleed into one.
 */
function findFence(text: string): { body: string } | { unterminated: true } | null {
  // Multiline + ungreedy. `\n%%` ensures the closing fence is on its own line.
  const re = /(?:^|\n)%%notion-exporter[ \t]*\r?\n([\s\S]*?)\r?\n%%(?=\r?\n|$)/;
  const m = re.exec(text);
  if (m) return { body: m[1] ?? "" };
  // No closer — but did the user at least open a fence? If so, that's worth a
  // warning so the operator notices their dangling block.
  if (/(?:^|\n)%%notion-exporter[ \t]*\r?\n/.test(text)) return { unterminated: true };
  return null;
}

/**
 * Coerce a parsed JSON object into a `DbViewConfig`, dropping any keys whose
 * shape doesn't match. Bad shapes log a warn but never throw — partial config
 * is strictly better than a hard failure on a single typo.
 */
function validate(raw: unknown, log: Logger | undefined, dbId: string | undefined): DbViewConfig {
  const out: DbViewConfig = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    log?.warn(
      { dbId },
      "notion-exporter: %%notion-exporter fence body must be a JSON object; ignoring",
    );
    return out;
  }
  const obj = raw as Record<string, unknown>;

  if (obj.view !== undefined) {
    if (typeof obj.view === "string" && VIEW_VALUES.has(obj.view)) {
      out.view = obj.view as DbViewConfig["view"];
    } else {
      log?.warn(
        { dbId, view: obj.view },
        'notion-exporter: db-config "view" must be one of "kanban" | "table" | "gallery"; dropped',
      );
    }
  }

  if (obj.groupBy !== undefined) {
    if (typeof obj.groupBy === "string") {
      out.groupBy = obj.groupBy;
    } else {
      log?.warn({ dbId }, 'notion-exporter: db-config "groupBy" must be a string; dropped');
    }
  }

  if (obj.order !== undefined) {
    if (Array.isArray(obj.order) && obj.order.every((x) => typeof x === "string")) {
      out.order = obj.order as string[];
    } else {
      log?.warn({ dbId }, 'notion-exporter: db-config "order" must be string[]; dropped');
    }
  }

  if (obj.hideFilters !== undefined) {
    if (typeof obj.hideFilters === "boolean") {
      out.hideFilters = obj.hideFilters;
    } else {
      log?.warn({ dbId }, 'notion-exporter: db-config "hideFilters" must be boolean; dropped');
    }
  }

  if (obj.cardMeta !== undefined) {
    if (Array.isArray(obj.cardMeta) && obj.cardMeta.every((x) => typeof x === "string")) {
      out.cardMeta = obj.cardMeta as string[];
    } else {
      log?.warn({ dbId }, 'notion-exporter: db-config "cardMeta" must be string[]; dropped');
    }
  }

  return out;
}

/**
 * Parse the first `%%notion-exporter` JSON fence out of `database.description`.
 *
 * Returns `{}` when:
 *   - no fence is present (silent — most DBs won't have one)
 *   - the fence body is not valid JSON (logged, with a hint that JSON, not YAML, is expected)
 *   - the fence opener is present but never closed (logged)
 *
 * Returns a partial object when individual keys fail validation — bad keys are
 * dropped + logged, valid sibling keys still apply.
 */
export function parseDbConfig(database: unknown, log?: Logger): DbViewConfig {
  const text = descriptionText(database);
  if (!text) return {};
  const found = findFence(text);
  if (!found) return {};
  const dbId = (database as { id?: string } | null | undefined)?.id;
  if ("unterminated" in found) {
    log?.warn(
      { dbId },
      "notion-exporter: %%notion-exporter fence is missing its closing %% on its own line; skipping",
    );
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(found.body);
  } catch (err) {
    log?.warn(
      { dbId, err: (err as Error).message },
      "notion-exporter: %%notion-exporter fence body is not valid JSON (note: JSON, not YAML — keys must be quoted); ignoring",
    );
    return {};
  }
  return validate(parsed, log, dbId);
}
