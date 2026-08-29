// Kanban (board) layout for inline databases. Buckets rows by a status/select
// group column and orders the columns via the `rankColumn` 5-tier precedence
// cascade (invariant #12).

import type { ViewSchema } from "../../../notion/views.js";
import type { DbViewConfig } from "../../dbConfig.js";
import { formatProp, renderPropertyValue, renderSelectChip, rowTitle } from "../properties.js";
import type { ChildDatabaseData, DatabaseRow, ResolveLink } from "../types.js";
import { escapeHtmlText, mdUrl } from "../util.js";
import {
  dataSourceOptionNames,
  dataSourceOptionRank,
  filterDataAttrs,
  firstOccurrenceRank,
  groupValueOf,
  NO_STATUS,
  rankColumn,
} from "./shared.js";

/** Keys that only depend on `schema` + `titleKey` + `groupKey` — hoisted out
 * of the per-row loop in `renderKanbanView`. The find-by-type scans are pure
 * functions of the schema, so picking once per kanban (instead of once per
 * row × 3 types) is a noticeable win on dense boards. */
interface KanbanCardMetaKeys {
  dateKey: string | undefined;
  peopleKey: string | undefined;
  msKey: string | undefined;
}

function pickKanbanCardMetaKeys(
  schema: Record<string, { type?: string }>,
  titleKey: string | undefined,
  groupKey: string,
): KanbanCardMetaKeys {
  const keys = Object.keys(schema);
  return {
    dateKey: keys.find((k) => k !== groupKey && schema[k]?.type === "date"),
    peopleKey: keys.find((k) => k !== groupKey && schema[k]?.type === "people"),
    msKey: keys.find((k) => k !== titleKey && k !== groupKey && schema[k]?.type === "multi_select"),
  };
}

/** Pick 1–2 most-distinctive properties from the row to show under the card
 * title. `cardKeys` is hoisted from the per-row loop; the row-state
 * predicates (`row.properties?.[k]`) stay here because they vary
 * row-to-row. */
function pickKanbanCardMeta(
  row: DatabaseRow,
  cardKeys: KanbanCardMetaKeys,
  resolveLink: ResolveLink | undefined,
): string {
  // Priority: date → people → multi_select (chips, max 2).
  const { dateKey, peopleKey, msKey } = cardKeys;
  if (dateKey && row.properties?.[dateKey]) {
    const v = renderPropertyValue(row.properties?.[dateKey], resolveLink);
    if (v) return `<div class="kanban-card-meta"><span class="kanban-card-date">${v}</span></div>`;
  }
  if (peopleKey && row.properties?.[peopleKey]) {
    const v = renderPropertyValue(row.properties?.[peopleKey], resolveLink);
    const txt = (formatProp(row.properties?.[peopleKey], resolveLink) || "").trim();
    if (txt)
      return `<div class="kanban-card-meta"><span class="kanban-card-people">${escapeHtmlText(txt)}</span></div>`;
    if (v) return `<div class="kanban-card-meta">${v}</div>`;
  }
  if (msKey) {
    const items =
      (row.properties?.[msKey] as { multi_select?: Array<{ name?: string; color?: string }> })
        ?.multi_select ?? [];
    const chips = items
      .slice(0, 2)
      .map((i) => renderSelectChip(i))
      .filter(Boolean)
      .join(" ");
    if (chips) return `<div class="kanban-card-meta">${chips}</div>`;
  }
  return "";
}

export function renderKanbanView(
  data: ChildDatabaseData,
  rows: DatabaseRow[],
  schema: Record<string, { type?: string }>,
  header: string,
  filterStrip: string,
  groupKey: string | null,
  resolveLink?: ResolveLink,
  config: DbViewConfig = {},
  view?: ViewSchema,
): string {
  const titleKey = Object.keys(schema).find((k) => schema[k]?.type === "title");
  // Bucket rows by group value. When `groupKey` is null (forced kanban, no
  // candidate column) we lump everything into a single "No status" column —
  // operators forcing kanban globally still get a board, just an unhelpful
  // one for DBs without a status property.
  //
  // The workspace's canonical option list lives at
  // `data.dataSource.properties[groupKey].(status|select).options`. Seed the
  // bucket map with every option BEFORE iterating rows so empty workflow
  // stages (e.g. a "Done" column with zero rows) still get a column header +
  // empty `<ul>`. Without this seed, kanban only shows stages that happen to
  // have rows — operators lose the at-a-glance overview of where work _isn't_
  // happening.
  const buckets = new Map<string, DatabaseRow[]>();
  if (groupKey) {
    const optionNames = dataSourceOptionNames(data.dataSource, groupKey);
    if (optionNames) {
      for (const name of optionNames) buckets.set(name, []);
    }
  }
  for (const row of rows) {
    const v = groupKey ? groupValueOf(row, groupKey) : "";
    const key = v || NO_STATUS;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  // Order columns. Precedence:
  //   1. `config.order` — operator override wins absolutely.
  //   2. Persisted dataSource schema option order. Notion's own workspace
  //      ordering for status/select beats the heuristic.
  //   3. STATUS_RANK heuristic (backlog → wip → done) matched by known name.
  //   4. First-occurrence (stable sort tiebreaker).
  //
  // "No status" is always anchored at the end as a catch-all (irrespective of
  // tier) so an unstatused column doesn't elbow into the middle of an
  // operator-defined order.
  //
  // The cascade is encoded in `rankColumn` as a banded numeric so the
  // comparator is a single subtraction. Equal ranks fall through to
  // Array.sort's stable insertion-order tiebreaker.
  const orderArray = Array.isArray(config.order) && config.order.length > 0 ? config.order : null;
  const configRank = orderArray ? new Map(orderArray.map((name, i) => [name, i] as const)) : null;
  const dsRank = groupKey ? dataSourceOptionRank(data.dataSource, groupKey) : null;
  // Tier-2: the primary view's manual column order. `rows` here are already in
  // the view's group-ordered presentation order (see `applyViewOrder`), so the
  // first time each bucket value appears is its column position. Only built
  // when a view was captured — otherwise first-occurrence is mere fetch order
  // and must not override the dataSource/STATUS heuristics.
  const viewRank = view && groupKey ? firstOccurrenceRank(rows, groupKey) : null;
  const orderedEntries = [...buckets.entries()].sort(
    ([a], [b]) =>
      rankColumn(a, configRank, viewRank, dsRank) - rankColumn(b, configRank, viewRank, dsRank),
  );
  // Hoist the schema-only key picks for kanban card meta out of the per-row
  // loop. The candidate `dateKey` / `peopleKey` / `msKey` depend only on
  // `(schema, titleKey, groupKey)` — scanning `Object.keys(schema)` 3× per
  // row is wasted work on dense boards.
  const cardMetaKeys = pickKanbanCardMetaKeys(schema, titleKey, groupKey ?? "");
  // Tier between the operator `cardMeta` fence and the heuristic: the primary
  // view's visible properties (minus the title + group columns, capped) become
  // the card's meta lines, matching what Notion shows on each board card.
  const viewCardMeta =
    !Array.isArray(config.cardMeta) && view?.visibleProps
      ? view.visibleProps.filter((k) => k !== titleKey && k !== groupKey && schema[k]).slice(0, 4)
      : null;
  // Columns the filter strip exposes: chip/range filters work by reading
  // `[data-col="X"][data-filter-…]` off each card. Table TDs already carry
  // these; kanban cards need an explicit hidden span per filterable column or
  // every chip-active filter rejects every card.
  const filterableKeys = Object.keys(schema).filter((k) => {
    const t = schema[k]?.type;
    return (
      t === "select" || t === "status" || t === "multi_select" || t === "date" || t === "number"
    );
  });
  const columns = orderedEntries
    .map(([name, bucketRows]) => {
      const cards = bucketRows
        .map((row) => {
          const id = row.id;
          const href = data.rowHrefs?.get(id);
          const titleHtml = rowTitle(row, schema);
          const linkHtml = href
            ? `<a class="kanban-card-link" href="${mdUrl(href)}">${titleHtml}</a>`
            : `<span class="kanban-card-link">${titleHtml}</span>`;
          // Card meta: config.cardMeta wins when set (empty array = explicit
          // "no meta"); else pickKanbanCardMeta picks heuristically.
          let meta: string;
          if (Array.isArray(config.cardMeta)) {
            meta =
              config.cardMeta.length === 0
                ? ""
                : renderCardMetaFromKeys(row, schema, config.cardMeta, resolveLink);
          } else if (viewCardMeta && viewCardMeta.length > 0) {
            meta = renderCardMetaFromKeys(row, schema, viewCardMeta, resolveLink);
          } else {
            meta = pickKanbanCardMeta(row, cardMetaKeys, resolveLink);
          }
          const filterData = filterableKeys
            .map((k) => {
              const attrs = filterDataAttrs(row.properties?.[k], schema[k]?.type);
              if (!attrs) return "";
              return `<span class="kanban-card-filter-data" data-col="${escapeHtmlText(k)}"${attrs} hidden></span>`;
            })
            .join("");
          return `<li class="kanban-card" data-row-id="${escapeHtmlText(id)}">${linkHtml}${meta}${filterData}</li>`;
        })
        .join("");
      const countLabel = `<span class="kanban-col-count">${bucketRows.length}</span>`;
      return `<div class="kanban-col" data-status="${escapeHtmlText(name)}"><header class="kanban-col-head"><span class="kanban-col-title">${escapeHtmlText(name)}</span>${countLabel}</header><ul class="kanban-cards">${cards}</ul></div>`;
    })
    .join("");
  return `<section class="inline-db kanban">${header}${filterStrip}<div class="kanban-columns">${columns}</div><p class="inline-db-empty inline-db-empty-filter" data-empty-state hidden>No rows match these filters. <a href="#" data-empty-clear>Clear filters</a></p></section>`;
}

// Card-meta from an explicit column list (config.cardMeta). Each named column
// renders one meta line; unknown columns are skipped silently.
// SECURITY: `formatProp` returns raw text (not HTML-safe) for select /
// status / multi_select / number / url / email / people / date /
// created_time / etc. — only relation / rollup / title / rich_text return
// HTML. Route through `renderPropertyValue` which delegates to formatProp
// AND applies the type-aware HTML escape; that's the same pass
// renderPropertyTable uses.
function renderCardMetaFromKeys(
  row: DatabaseRow,
  schema: Record<string, { type?: string }>,
  keys: string[],
  resolveLink?: ResolveLink,
): string {
  const lines: string[] = [];
  for (const k of keys) {
    if (!schema[k]) continue;
    const v = (row.properties as Record<string, unknown> | undefined)?.[k];
    if (!v) continue;
    const valueHtml = renderPropertyValue(v, resolveLink);
    if (!valueHtml) continue;
    lines.push(
      `<div class="kanban-card-meta"><span class="kanban-card-label">${escapeHtmlText(k)}</span> <span class="kanban-card-value">${valueHtml}</span></div>`,
    );
  }
  return lines.join("");
}
