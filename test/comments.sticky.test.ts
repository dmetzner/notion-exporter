import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Sticky-disable comments fetch after first 403.
//
// The integration may lack the "Read comments" capability. The first call
// returns `restricted_resource`; from that point on we must NOT call
// `comments.list` again for any subsequent page in the same run.

const commentsList = vi.fn(async () => {
  const err = new Error("API token does not have access to comments");
  (err as unknown as { code: string }).code = "restricted_resource";
  throw err;
});

vi.mock("@notionhq/client", () => {
  const search = vi.fn(async () => ({
    results: [
      {
        object: "page",
        id: "page-a",
        url: "https://notion/page-a",
        parent: { type: "workspace", workspace: true },
        properties: { Name: { type: "title", title: [{ plain_text: "A" }] } },
      },
      {
        object: "page",
        id: "page-b",
        url: "https://notion/page-b",
        parent: { type: "workspace", workspace: true },
        properties: { Name: { type: "title", title: [{ plain_text: "B" }] } },
      },
      {
        object: "page",
        id: "page-c",
        url: "https://notion/page-c",
        parent: { type: "workspace", workspace: true },
        properties: { Name: { type: "title", title: [{ plain_text: "C" }] } },
      },
    ],
    has_more: false,
    next_cursor: null,
  }));

  class Client {
    search = search;
    pages = {
      retrieve: vi.fn(async ({ page_id }: { page_id: string }) => ({
        id: page_id,
        object: "page",
        properties: { Name: { type: "title", title: [{ plain_text: `Page ${page_id}` }] } },
      })),
    };
    blocks = {
      children: {
        list: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
      },
    };
    databases = { retrieve: vi.fn() };
    dataSources = { query: vi.fn() };
    users = { me: vi.fn(async () => ({ id: "u1", name: "Bot", type: "bot" })) };
    comments = { list: commentsList };
  }
  return { Client };
});

describe("comments: sticky-disable after restricted_resource", () => {
  it("calls comments.list once then skips all remaining pages", async () => {
    // Import lazily so the SDK mock above is wired before the orchestrator
    // imports `@notionhq/client`.
    const { runExport } = await import("../src/commands/export.js");
    const { loadConfig } = await import("../src/config.js");
    const { createLogger } = await import("../src/logger.js");

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-comments-"));
    // Force serial page processing so the sticky flag set by the first
    // page's 403 is observable to the next page. With the default
    // PAGE_CONCURRENCY=4 all three pages would race and each hit the
    // endpoint before the flag flips — that's tolerable in production
    // (still ~saves 938/941 calls) but makes the assertion flaky.
    const cfg = loadConfig({ NOTION_TOKEN: "secret_x", OUT_DIR: tmp, PAGE_CONCURRENCY: "1" });
    const log = createLogger("error");
    try {
      const result = await runExport(cfg, log, { dryRun: false });
      expect(result.pages).toBe(3);
      // First page triggers the 403 with code=restricted_resource; the
      // sticky flag prevents calls for page-b and page-c. Exactly ONE call.
      expect(commentsList).toHaveBeenCalledTimes(1);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});
