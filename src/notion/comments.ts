// Page-level Notion comments.
//
// Notion exposes comments via `comments.list({ block_id })`. For page comments
// we pass the page id as the `block_id` (Notion treats a page as a block).
// The response paginates the same way blocks do — `has_more` + `next_cursor` —
// so we follow the cursor until exhausted.
//
// All requests go through `RateLimitedNotion#run` so the limiter and the
// 429/5xx retry/backoff apply (CLAUDE.md invariant).

import { paginate, type RateLimitedNotion } from "./client.js";

/**
 * Minimal shape of a Notion comment we render. Trimmed from the full SDK
 * response to just the fields that appear in the rendered output, so the raw
 * JSON we persist on disk stays small and round-trippable.
 */
export interface NotionComment {
  id: string;
  parent?: {
    type?: string;
    page_id?: string;
    block_id?: string;
  };
  discussion_id?: string;
  created_time?: string;
  last_edited_time?: string;
  created_by?: { id?: string; name?: string; object?: string };
  rich_text?: Array<Record<string, unknown>>;
}

/** Raw response shape from `comments.list`. Kept loose; we only read a few fields. */
interface CommentsListResponse {
  results: NotionComment[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Fetch all top-level comments for a page (block_id = pageId). Paginates
 * automatically via `paginate()` — the same helper used by `crawl.ts` — so
 * the cursor/has_more loop only lives in one place.
 *
 * Errors propagate — the caller decides whether to swallow them (a 404 for
 * pages with comments disabled is the typical case).
 */
export async function fetchPageComments(
  notion: RateLimitedNotion,
  pageId: string,
): Promise<NotionComment[]> {
  return paginate<NotionComment>(async (cursor) => {
    return (await notion.run((c) =>
      // The SDK types `block_id` on comments.list — page id is accepted because
      // Notion treats a page as a block in the comments API.
      c.comments.list({ block_id: pageId, start_cursor: cursor }),
    )) as unknown as CommentsListResponse;
  });
}
