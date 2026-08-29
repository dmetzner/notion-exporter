import type { Logger } from "../logger.js";
import type { RateLimitedNotion } from "./client.js";

/**
 * Schema for a Notion data source, as returned by
 * `notion.dataSources.retrieve({ data_source_id })`.
 *
 * Captured during crawl so the renderer can use Notion's
 * canonical option order for `status`, `select`, and `multi_select`
 * columns instead of falling back to first-occurrence + STATUS_RANK
 * heuristics.
 *
 * Only the subset the renderer needs is typed — the SDK returns far more
 * (formulas, relations, etc.) but we persist the whole `properties` blob
 * verbatim so future readers can dig deeper without another crawl.
 */
export interface DataSourceSchema {
  id: string;
  properties: Record<string, DataSourceProperty>;
}

export interface DataSourceSelectOption {
  id: string;
  name: string;
  color: string;
}

export interface DataSourceStatusGroup {
  id: string;
  name: string;
  color: string;
  option_ids: string[];
}

/** Minimal shape — Notion returns many more fields per property type; the
 * renderer only reads the option arrays today. We keep the rest as an
 * index signature so the persisted JSON survives round-tripping. */
export interface DataSourceProperty {
  id: string;
  name: string;
  type: string;
  status?: { options: DataSourceSelectOption[]; groups: DataSourceStatusGroup[] };
  select?: { options: DataSourceSelectOption[] };
  multi_select?: { options: DataSourceSelectOption[] };
  [k: string]: unknown;
}

interface RetrieveResponse {
  id?: string;
  properties?: unknown;
}

/**
 * Runtime shape gate for the `properties` blob coming back from
 * `dataSources.retrieve` (or rehydrated from raw JSON during rerender).
 *
 * Returns the typed schema when `raw` is a plausible Notion data-source
 * response, or `null` when the shape is malformed (non-object `properties`,
 * an array masquerading as an object, etc). Logs at `info` on rejection —
 * the only realistic trigger is operator-tampered raw JSON, which is worth
 * surfacing without escalating to a hard crash. The renderer's downstream
 * code falls back to the legacy STATUS_RANK + first-occurrence heuristics
 * when `dataSource` is absent, so a `null` return is safe.
 *
 * Wired into `retrieveDataSourceSchema` (live fetch path) and exported for
 * defense-in-depth at the renderer's read sites.
 */
export function validateDataSourceSchema(
  raw: unknown,
  fallbackId: string,
  log?: Logger,
): DataSourceSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    log?.info({ fallbackId }, "dataSourceSchema: rejected non-object payload");
    return null;
  }
  const obj = raw as { id?: unknown; properties?: unknown };
  if (!obj.properties || typeof obj.properties !== "object" || Array.isArray(obj.properties)) {
    log?.info(
      { fallbackId, propertiesType: typeof obj.properties },
      "dataSourceSchema: rejected non-object properties blob",
    );
    return null;
  }
  return {
    id: typeof obj.id === "string" ? obj.id : fallbackId,
    properties: obj.properties as Record<string, DataSourceProperty>,
  };
}

/**
 * Retrieve a data source schema through the rate-limited client.
 *
 * Returns the schema with options ordered as Notion returns them — this is
 * the canonical workspace order set by the user. Caller is responsible for
 * caching across multiple databases that share a data source id.
 */
export async function retrieveDataSourceSchema(
  notion: RateLimitedNotion,
  dataSourceId: string,
  log?: Logger,
): Promise<DataSourceSchema> {
  const res = (await notion.run((c) =>
    // The v5 SDK exposes `dataSources.retrieve`; type the response loosely
    // because the SDK's generated types don't expose option lists with the
    // discriminated-union precision we'd want here.
    (
      c as unknown as {
        dataSources: { retrieve: (args: { data_source_id: string }) => Promise<unknown> };
      }
    ).dataSources.retrieve({ data_source_id: dataSourceId }),
  )) as RetrieveResponse;
  const validated = validateDataSourceSchema(res, dataSourceId, log);
  if (validated) return validated;
  // Plausibility check failed — return a stub with the requested id and an
  // empty properties bag so callers that already type-narrow on
  // `properties[col]` continue to compile and behave (they'll just fall back
  // to the heuristic path).
  return { id: dataSourceId, properties: {} };
}
