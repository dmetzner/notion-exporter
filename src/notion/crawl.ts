import type { Logger } from "../logger.js";
import { fetchBlocksRecursive, type NotionBlock } from "./blocks.js";
import type { RateLimitedNotion } from "./client.js";
import { asPaginatedList, paginate } from "./client.js";

export interface DiscoveredObject {
  id: string;
  object: "page" | "database";
  title: string;
  parent: { type: string; id?: string };
  url?: string;
  lastEditedTime?: string;
  /** Raw Notion icon ref (emoji char OR remote URL). Pre-resolved for use by
   * mention/child_page rendering that wants the target page's icon. */
  icon?: { kind: "emoji" | "external" | "file"; value: string };
}

interface NotionParent {
  type: string;
  page_id?: string;
  database_id?: string;
  data_source_id?: string;
  block_id?: string;
  workspace?: boolean;
}

interface SearchResultIcon {
  type?: "emoji" | "external" | "file";
  emoji?: string;
  external?: { url?: string };
  file?: { url?: string };
}

interface SearchResultPage {
  object: "page";
  id: string;
  url?: string;
  last_edited_time?: string;
  parent: NotionParent;
  properties?: Record<string, unknown>;
  icon?: SearchResultIcon | null;
}

interface SearchResultDatabase {
  object: "database";
  id: string;
  url?: string;
  last_edited_time?: string;
  title?: Array<{ plain_text?: string }>;
  parent: NotionParent;
  icon?: SearchResultIcon | null;
}

type SearchResult = SearchResultPage | SearchResultDatabase;

function extractSearchIcon(obj: SearchResult): DiscoveredObject["icon"] {
  const i = obj.icon;
  if (!i?.type) return undefined;
  if (i.type === "emoji" && i.emoji) return { kind: "emoji", value: i.emoji };
  if (i.type === "external" && i.external?.url) return { kind: "external", value: i.external.url };
  if (i.type === "file" && i.file?.url) return { kind: "file", value: i.file.url };
  return undefined;
}

function extractTitle(obj: SearchResult): string {
  if (obj.object === "database") {
    const title = obj.title?.map((t) => t.plain_text ?? "").join("") ?? "";
    return title || "(untitled database)";
  }
  const props = obj.properties ?? {};
  for (const value of Object.values(props)) {
    const v = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (v?.type === "title" && Array.isArray(v.title)) {
      const t = v.title.map((x) => x.plain_text ?? "").join("");
      if (t) return t;
    }
  }
  return "(untitled page)";
}

function normalizeParent(obj: SearchResult): { type: string; id?: string } {
  const p = obj.parent;
  if (!p) return { type: "unknown" };
  if (p.type === "workspace") return { type: "workspace" };
  if (p.type === "page_id") return { type: "page_id", id: p.page_id };
  if (p.type === "database_id") return { type: "database_id", id: p.database_id };
  // Notion API v5: pages inside a database now report parent.type as
  // "data_source_id". The database_id is also included on the parent — surface
  // it so hierarchy resolution can place the row under its database folder.
  if (p.type === "data_source_id") return { type: "database_id", id: p.database_id };
  if (p.type === "block_id") return { type: "block_id", id: p.block_id };
  return { type: p.type };
}

interface BlockRetrieveResponse {
  id: string;
  parent?: NotionParent;
}

interface DatabaseRetrieveResponse {
  id: string;
  url?: string;
  last_edited_time?: string;
  title?: Array<{ plain_text?: string }>;
  parent?: NotionParent;
  icon?: SearchResultIcon | null;
}

// Resolves a block_id (column, toggle, callout, page-block) up to the nearest
// page_id / database_id / workspace parent. Cached per block id.
async function resolveContainer(
  notion: RateLimitedNotion,
  blockId: string,
  cache: Map<string, { type: string; id?: string }>,
): Promise<{ type: string; id?: string }> {
  const cached = cache.get(blockId);
  if (cached) return cached;
  let resolved: { type: string; id?: string } = { type: "unknown" };
  try {
    const block = (await notion.run((c) =>
      c.blocks.retrieve({ block_id: blockId }),
    )) as unknown as BlockRetrieveResponse;
    const p = block.parent;
    if (!p) resolved = { type: "unknown" };
    else if (p.type === "workspace") resolved = { type: "workspace" };
    else if (p.type === "page_id") resolved = { type: "page_id", id: p.page_id };
    else if (p.type === "database_id") resolved = { type: "database_id", id: p.database_id };
    else if (p.type === "block_id" && p.block_id)
      resolved = await resolveContainer(notion, p.block_id, cache);
    else resolved = { type: p.type };
  } catch {
    resolved = { type: "unknown" };
  }
  cache.set(blockId, resolved);
  return resolved;
}

// Pages nested inside a column/toggle/callout have parent.type === "block_id"
// pointing at the wrapping block, not the containing page. Walk each such block
// up to its owning page so hierarchy resolution can place the page correctly.
// Idempotent: already-resolved (non-block_id) parents are skipped and the block
// cache dedupes lookups, so this is safe to run more than once.
async function resolveBlockParents(
  notion: RateLimitedNotion,
  objects: DiscoveredObject[],
  known: Set<string>,
  cache: Map<string, { type: string; id?: string }>,
): Promise<void> {
  for (const o of objects) {
    if (o.parent.type !== "block_id") continue;
    if (!o.parent.id) continue;
    if (known.has(o.parent.id)) continue; // block id == page id (top-level subpage)
    o.parent = await resolveContainer(notion, o.parent.id, cache);
  }
}

export interface CrawlOptions {
  /** When true, walk known pages' block trees to discover unsearched
   * child_page subpages. Costs extra blocks.children.list + pages.retrieve
   * calls per discovered subpage. */
  expandChildPages?: boolean;
  /** Out param: blocks already fetched during expansion. Callers can pass in
   * a Map to reuse those blocks during the main export and skip a second
   * fetch per page. */
  blocksCache?: Map<string, NotionBlock[]>;
  /** Logger for progress feedback. Used for both info logs (state changes)
   * and a periodic visited/queued counter during expansion. */
  log?: Logger;
  /** Callback fired during expansion every time the counts change. The TTY
   * renderer hooks this to show "discovered N pages…". */
  onDiscoveryProgress?: (state: { visited: number; queued: number; total: number }) => void;
  /** Number of pages to walk in parallel during expansion. Higher = faster
   * discovery on shallow workspaces, but contends with the Notion limiter. */
  concurrency?: number;
}

export async function crawlAll(
  notion: RateLimitedNotion,
  opts: CrawlOptions = {},
): Promise<DiscoveredObject[]> {
  const log = opts.log;
  log?.info("crawl: searching workspace");
  let searchPage = 0;
  const results = await paginate<SearchResult>(async (cursor) => {
    const res = asPaginatedList<SearchResult>(
      await notion.run((c) =>
        c.search({
          start_cursor: cursor,
          page_size: 100,
        }),
      ),
    );
    searchPage++;
    log?.info({ batch: searchPage, items: res.results.length }, "crawl: search batch");
    return res;
  });

  // Notion v5 search can return other object types (e.g. `data_source`) that
  // aren't directly exportable as a page or database. Filter them out so they
  // don't hit the export loop and trigger "Could not find database" errors.
  const objects: DiscoveredObject[] = results
    .filter((r) => r.object === "page" || r.object === "database")
    .map((r) => {
      const icon = extractSearchIcon(r);
      return {
        id: r.id,
        object: r.object,
        title: extractTitle(r),
        parent: normalizeParent(r),
        url: r.url,
        ...(r.last_edited_time ? { lastEditedTime: r.last_edited_time } : {}),
        ...(icon ? { icon } : {}),
      };
    });

  // Pages nested inside columns / toggles / callouts have parent.type === "block_id"
  // and parent.id pointing at the wrapping block, not the containing page.
  // When that block isn't a known page in our set, walk up via blocks.retrieve.
  const known = new Set(objects.map((o) => o.id));
  const cache = new Map<string, { type: string; id?: string }>();
  await resolveBlockParents(notion, objects, known, cache);

  // Inline databases (those created inside a page via /database, plus the new
  // v5 data-source-backed ones) aren't returned by `search`, but pages within
  // them list the database_id on their parent. Retrieve any referenced parent
  // database that isn't already in the set and add it as a discovered object
  // so hierarchy resolution can place the rows under their database folder.
  log?.info(
    {
      pages: objects.filter((o) => o.object === "page").length,
      dbs: objects.filter((o) => o.object === "database").length,
    },
    "crawl: search complete",
  );
  await ensureParentDatabases(notion, objects, known, cache);
  const addedDbs = objects.length - results.length;
  if (addedDbs > 0) log?.info({ added: addedDbs }, "crawl: pulled in missing parent databases");

  // Many real-world workspaces have integrations connected to a small set of
  // top-level pages — `search` only returns those directly, even though the
  // integration has access to every nested child_page block. Walk the block
  // tree of every known page and pull in any unknown child_page subpages.
  if (opts.expandChildPages) {
    log?.info(
      { fromSearch: objects.filter((o) => o.object === "page").length },
      "crawl: expanding via child_page block traversal",
    );
    await expandViaChildPages(
      notion,
      objects,
      known,
      opts.blocksCache,
      log,
      opts.onDiscoveryProgress,
      opts.concurrency ?? 1,
    );
    log?.info(
      { total: objects.length, pages: objects.filter((o) => o.object === "page").length },
      "crawl: expansion complete",
    );
    // Expansion-discovered subpages can also be block-nested (a child_page
    // inside a callout/column). Resolve their block_id parents now that the
    // full page set is known, or they'd orphan to the sidebar root.
    await resolveBlockParents(notion, objects, known, cache);
  }
  return objects;
}

interface PageRetrieveResponse {
  id: string;
  url?: string;
  last_edited_time?: string;
  parent?: NotionParent;
  properties?: Record<string, unknown>;
  icon?: SearchResultIcon | null;
}

async function expandViaChildPages(
  notion: RateLimitedNotion,
  objects: DiscoveredObject[],
  known: Set<string>,
  blocksCache: Map<string, NotionBlock[]> | undefined,
  log: Logger | undefined,
  onProgress: ((s: { visited: number; queued: number; total: number }) => void) | undefined,
  concurrency: number,
): Promise<void> {
  // Start with every page we got from search. Pop ids, fetch their blocks,
  // pull child_page ids out, retrieve unknown ones, add to objects, queue
  // them for the next sweep. Stop when the queue is empty — the visited set
  // bounds total work to O(unique pages reachable from the seed set), so no
  // artificial cap is needed (cycles are handled by the queued/visited gate).
  const blockResolveCache = new Map<string, { type: string; id?: string }>();
  const queue: string[] = [];
  const queued = new Set<string>();
  for (const o of objects) {
    if (o.object === "page" && !queued.has(o.id)) {
      queue.push(o.id);
      queued.add(o.id);
    }
  }
  const visited = new Set<string>();
  let lastLog = Date.now();
  const total = () => objects.filter((o) => o.object === "page").length;
  const emit = () => onProgress?.({ visited: visited.size, queued: queue.length, total: total() });

  // Worker that pulls page ids off the shared queue, fetches their blocks,
  // and enqueues discovered children. Multiple workers run concurrently;
  // queue/visited/queued mutations are safe under JS's single-threaded
  // event loop because no `await` happens between the visited-set check
  // and the visited-set add.
  async function worker(): Promise<void> {
    while (true) {
      const id = queue.shift();
      if (!id) return;
      if (visited.has(id)) continue;
      visited.add(id);
      let blocks: NotionBlock[];
      try {
        blocks = await fetchBlocksRecursive(notion, id);
      } catch {
        continue;
      }
      if (blocksCache) blocksCache.set(id, blocks);
      await processPageBlocks(id, blocks);
    }
  }

  async function processPageBlocks(id: string, blocks: NotionBlock[]): Promise<void> {
    void id;
    // Pick up any child_database blocks too — empty/rowless databases never
    // surface via ensureParentDatabases (no rows to point at them) and will
    // otherwise render as "Untitled" page links.
    const { pages: childPageIds, databases: childDbIds } = collectChildItems(blocks);
    for (const dbId of childDbIds) {
      if (known.has(dbId)) continue;
      try {
        const db = (await notion.run((c) =>
          c.databases.retrieve({ database_id: dbId }),
        )) as unknown as DatabaseRetrieveResponse;
        const title = db.title?.map((t) => t.plain_text ?? "").join("") ?? "";
        const parent = db.parent
          ? normalizeParent({ object: "database", parent: db.parent } as SearchResult)
          : { type: "unknown" as const };
        const dbIcon = db.icon ? extractSearchIcon({ icon: db.icon } as SearchResult) : undefined;
        // Inline DBs are wrapped in column/toggle/callout — their parent is
        // block_id pointing at the wrapper. Walk up so hierarchy puts the DB
        // under the containing page instead of dumping it at the root.
        let resolvedParent = parent;
        if (resolvedParent.type === "block_id" && resolvedParent.id) {
          resolvedParent = await resolveContainer(notion, resolvedParent.id, blockResolveCache);
        }
        objects.push({
          id: dbId,
          object: "database",
          title: title || "(untitled database)",
          parent: resolvedParent,
          ...(db.url ? { url: db.url } : {}),
          ...(db.last_edited_time ? { lastEditedTime: db.last_edited_time } : {}),
          ...(dbIcon ? { icon: dbIcon } : {}),
        });
        known.add(dbId);
      } catch {
        // database may have been deleted or the integration lacks access
      }
    }
    const newIds = childPageIds.filter((cid) => !known.has(cid));
    // Periodic heartbeat — every 10 pages walked, OR every 5s, OR whenever we
    // pull in a fresh batch of subpages — so the operator can see progress
    // even if the TTY progress bar is suppressed.
    const now = Date.now();
    if (visited.size % 10 === 0 || newIds.length > 0 || now - lastLog > 5000) {
      log?.info(
        { visited: visited.size, queued: queue.length, total: total(), newSubpages: newIds.length },
        "crawl: expansion progress",
      );
      lastLog = now;
    }
    emit();
    if (newIds.length === 0) return;
    const retrieved = await Promise.all(
      newIds.map(async (cid) => {
        try {
          const page = (await notion.run((c) =>
            c.pages.retrieve({ page_id: cid }),
          )) as unknown as PageRetrieveResponse;
          return page;
        } catch {
          return null;
        }
      }),
    );
    for (const page of retrieved) {
      if (!page || known.has(page.id)) continue;
      const search: SearchResultPage = {
        object: "page",
        id: page.id,
        ...(page.url ? { url: page.url } : {}),
        ...(page.last_edited_time ? { last_edited_time: page.last_edited_time } : {}),
        parent: page.parent ?? { type: "unknown" },
        properties: page.properties,
        ...(page.icon !== undefined ? { icon: page.icon } : {}),
      };
      const icon = extractSearchIcon(search);
      const obj: DiscoveredObject = {
        id: page.id,
        object: "page",
        title: extractTitle(search),
        parent: normalizeParent(search),
        ...(page.url ? { url: page.url } : {}),
        ...(page.last_edited_time ? { lastEditedTime: page.last_edited_time } : {}),
        ...(icon ? { icon } : {}),
      };
      objects.push(obj);
      known.add(page.id);
      if (!queued.has(page.id)) {
        queue.push(page.id);
        queued.add(page.id);
      }
    }
  }

  // Spawn N workers up to `concurrency`. They drain the queue concurrently
  // (or sequentially when concurrency=1) and exit when the queue is empty.
  const workerCount = Math.max(1, concurrency);
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}

// Single pass collecting both child_page and child_database ids — the two
// were previously separate recursive walks over the same block tree.
function collectChildItems(
  blocks: NotionBlock[],
  out: { pages: string[]; databases: string[] } = { pages: [], databases: [] },
): { pages: string[]; databases: string[] } {
  for (const b of blocks) {
    if (b.type === "child_page") out.pages.push(b.id);
    else if (b.type === "child_database") out.databases.push(b.id);
    if (b.children?.length) collectChildItems(b.children, out);
  }
  return out;
}

async function ensureParentDatabases(
  notion: RateLimitedNotion,
  objects: DiscoveredObject[],
  known: Set<string>,
  blockCache: Map<string, { type: string; id?: string }>,
): Promise<void> {
  // Multiple sweeps because a fetched database may itself have an unknown
  // parent database (rare but possible). Cap iterations to avoid runaway loops.
  // Each sweep only scans objects appended since the previous sweep: once an
  // object has been checked its parent is either known or terminally
  // unfetchable, so re-scanning the whole array every sweep is wasted work.
  let scanFrom = 0;
  for (let sweep = 0; sweep < 4; sweep++) {
    const missing = new Set<string>();
    for (let i = scanFrom; i < objects.length; i++) {
      const o = objects[i];
      if (!o) continue;
      if (o.parent.type !== "database_id") continue;
      if (!o.parent.id) continue;
      if (known.has(o.parent.id)) continue;
      missing.add(o.parent.id);
    }
    scanFrom = objects.length;
    if (missing.size === 0) return;
    const fetched = await Promise.all(
      [...missing].map(async (id) => {
        try {
          const db = (await notion.run((c) =>
            c.databases.retrieve({ database_id: id }),
          )) as unknown as DatabaseRetrieveResponse;
          const title = db.title?.map((t) => t.plain_text ?? "").join("") ?? "";
          const parent = db.parent
            ? normalizeParent({ object: "database", parent: db.parent } as SearchResult)
            : { type: "unknown" as const };
          const icon = db.icon ? extractSearchIcon({ icon: db.icon } as SearchResult) : undefined;
          const obj: DiscoveredObject = {
            id,
            object: "database",
            title: title || "(untitled database)",
            parent,
            ...(db.url ? { url: db.url } : {}),
            ...(db.last_edited_time ? { lastEditedTime: db.last_edited_time } : {}),
            ...(icon ? { icon } : {}),
          };
          return obj;
        } catch {
          return null;
        }
      }),
    );
    let added = 0;
    for (const obj of fetched) {
      if (!obj) continue;
      // Inline databases are wrapped in column/toggle/callout blocks — their
      // parent.type is block_id pointing at the wrapper. Walk up to the page.
      if (obj.parent.type === "block_id" && obj.parent.id) {
        obj.parent = await resolveContainer(notion, obj.parent.id, blockCache);
      }
      objects.push(obj);
      known.add(obj.id);
      added++;
    }
    if (added === 0) return;
  }
}
