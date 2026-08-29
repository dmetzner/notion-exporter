import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAssetCollector } from "../src/export/assets.js";
import { createLogger } from "../src/logger.js";
import { fetchCustomEmojis, type RawPageLike } from "../src/notion/customEmojis.js";

// Same shape as `test/assets.test.ts` — keeps SSRF gate happy with a fake
// public DNS resolver so the fake fetch never reaches the network.
const publicDns = async (_host: string, _opts: { all: true }) => [
  { address: "93.184.216.34", family: 4 },
];

function fakeFetch(map: Record<string, { body: Buffer; contentType?: string }>) {
  return async (url: string) => {
    const entry = map[url];
    if (!entry) {
      return {
        ok: false,
        status: 404,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
        headers: { get: () => null },
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return entry.body.buffer.slice(
          entry.body.byteOffset,
          entry.body.byteOffset + entry.body.byteLength,
        ) as ArrayBuffer;
      },
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type" ? (entry.contentType ?? null) : null,
      },
    } as unknown as Response;
  };
}

function mention(name: string, url: string, localPath?: string) {
  return {
    type: "mention",
    mention: {
      type: "custom_emoji",
      custom_emoji: { name, url, ...(localPath ? { local_path: localPath } : {}) },
    },
    plain_text: `:${name}:`,
  };
}

describe("fetchCustomEmojis (shared helper)", () => {
  it("walks multiple pages' rich_text + properties and downloads missing emojis", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-emoji-"));
    const log = createLogger("error");
    const assets = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        "https://x/dog.png": { body: Buffer.from([1, 2, 3]), contentType: "image/png" },
        "https://x/cat.png": { body: Buffer.from([4, 5, 6]), contentType: "image/png" },
      }),
    });

    // Page A — `:dog:` in title rich_text.
    const pageA: RawPageLike = {
      page: {
        properties: {
          title: { title: [mention("dog", "https://x/dog.png")] },
        },
      },
      blocks: [],
    };
    // Page B — `:cat:` inside a paragraph block's rich_text.
    const pageB: RawPageLike = {
      page: { properties: {} },
      blocks: [
        {
          id: "b1",
          type: "paragraph",
          paragraph: { rich_text: [mention("cat", "https://x/cat.png")] },
        } as unknown as import("../src/notion/blocks.js").NotionBlock,
      ],
    };

    const result = await fetchCustomEmojis([pageA, pageB], assets, log);
    expect(result.get("dog")).toMatch(/^assets\/[0-9a-f]+\.png$/);
    expect(result.get("cat")).toMatch(/^assets\/[0-9a-f]+\.png$/);
    expect(result.size).toBe(2);

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("preserves already-localized mentions without re-downloading", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-emoji-skip-"));
    const log = createLogger("error");
    // fetchImpl intentionally returns 404 for everything — any attempted
    // download would surface as a warn + drop the mention from the result.
    const assets = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({}),
    });

    const page: RawPageLike = {
      page: {
        properties: {
          title: {
            title: [mention("rocket", "https://x/rocket.png", "assets/preexisting.png")],
          },
        },
      },
      blocks: [],
    };

    const result = await fetchCustomEmojis([page], assets, log);
    expect(result.get("rocket")).toBe("assets/preexisting.png");

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("accumulates additions into a caller-supplied Map across calls", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-emoji-acc-"));
    const log = createLogger("error");
    const assets = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        "https://x/one.png": { body: Buffer.from([1]), contentType: "image/png" },
        "https://x/two.png": { body: Buffer.from([2]), contentType: "image/png" },
      }),
    });

    const acc = new Map<string, string>();
    await fetchCustomEmojis(
      [
        {
          page: { properties: { title: { title: [mention("one", "https://x/one.png")] } } },
          blocks: [],
        },
      ],
      assets,
      log,
      acc,
    );
    expect(acc.get("one")).toBeDefined();

    // Second call — same Map ref — accumulates a new emoji while preserving
    // the prior entry. This is the contract export.ts relies on for the
    // accumulate-during-fetch path.
    await fetchCustomEmojis(
      [
        {
          page: { properties: { title: { title: [mention("two", "https://x/two.png")] } } },
          blocks: [],
        },
      ],
      assets,
      log,
      acc,
    );
    expect(acc.get("one")).toBeDefined();
    expect(acc.get("two")).toBeDefined();
    expect(acc.size).toBe(2);

    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
