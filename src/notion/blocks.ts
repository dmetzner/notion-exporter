import type { RateLimitedNotion } from "./client.js";
import { asPaginatedList, paginate } from "./client.js";

export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [k: string]: unknown;
}

export async function fetchBlockChildren(
  notion: RateLimitedNotion,
  blockId: string,
): Promise<NotionBlock[]> {
  return paginate<NotionBlock>(async (cursor) =>
    asPaginatedList<NotionBlock>(
      await notion.run((c) =>
        c.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 }),
      ),
    ),
  );
}

// For a synced_block COPY (one duplicated to another page), Notion stores the
// reference in `synced_block.synced_from.block_id`. Fetching children by the
// copy's own id sometimes returns an empty list, so we follow the pointer to
// the source block and fetch its children instead.
function syncedSourceId(block: NotionBlock): string | null {
  if (block.type !== "synced_block") return null;
  const sb = block.synced_block as { synced_from?: { block_id?: string } | null } | undefined;
  return sb?.synced_from?.block_id ?? null;
}

export async function fetchBlocksRecursive(
  notion: RateLimitedNotion,
  blockId: string,
  visited = new Set<string>(),
): Promise<NotionBlock[]> {
  if (visited.has(blockId)) return [];
  visited.add(blockId);

  const root = await fetchBlockChildren(notion, blockId);
  const blocksWithChildren = root.filter((b) => b.has_children);

  if (blocksWithChildren.length > 0) {
    await Promise.all(
      blocksWithChildren.map(async (block) => {
        const fetchFrom = syncedSourceId(block) ?? block.id;
        block.children = await fetchBlocksRecursive(notion, fetchFrom, visited);
      }),
    );
  }

  return root;
}

/**
 * Pre-order DFS over a block tree. Yields every block, then recurses into
 * `children`. Shared by every site that needs to scan all blocks regardless of
 * nesting (asset collection, custom emoji harvesting, container indexes, etc.).
 *
 * Pre-order matches the user-visible top-to-bottom Notion sequence — callers
 * that care about ordering (e.g. sidebar position index) can rely on that.
 */
export function* walkBlocks(blocks: NotionBlock[]): Generator<NotionBlock> {
  for (const b of blocks) {
    yield b;
    if (b.children?.length) yield* walkBlocks(b.children);
  }
}

/**
 * Walk a block tree and collect every `child_database` block id, in
 * document order. Used by the rendering pipeline to look up inline DB
 * row data when emitting child_database tables/galleries on a parent page.
 */
export function collectChildDbIds(blocks: NotionBlock[], out: string[] = []): string[] {
  for (const b of walkBlocks(blocks)) {
    if (b.type === "child_database") out.push(b.id);
  }
  return out;
}

/**
 * Notion block types whose payload carries an uploaded file URL.
 * Shared so asset-handling sites can't drift if Notion adds a new media type.
 */
export const FILE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "image",
  "file",
  "pdf",
  "video",
  "audio",
]);
