import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import lunr from "lunr";
import { describe, expect, it } from "vitest";
import {
  BODY_INDEX_CAP,
  buildSearchIndex,
  jsonForScript,
  plainText,
  writeSearchIndex,
} from "../src/export/searchIndex.js";

describe("searchIndex", () => {
  it("plainText strips code, links, html, formatting", () => {
    const md =
      "# Title\n\nSome **bold** _it_ ~~strike~~ and `code` and ![alt](x.png) [a](b) `inline`.\n```js\nsecret()\n```\n";
    const t = plainText(md);
    expect(t).not.toContain("**");
    expect(t).not.toContain("`");
    expect(t).not.toContain("secret()");
    expect(t).not.toContain("](");
    expect(t).toContain("Title");
    expect(t).toContain("Some bold");
  });

  it("buildSearchIndex round-trips through lunr.Index.load", () => {
    const payload = buildSearchIndex([
      { id: "p1", title: "Hello", body: "world cup news", href: "p1.html", kind: "page" },
      { id: "p2", title: "Goodbye", body: "world weary", href: "p2.html", kind: "page" },
      { id: "d1", title: "Tasks", body: "tracker", href: "d1.html", kind: "database" },
    ]);
    const idx = lunr.Index.load(payload.index);
    const hits = idx.search("world").map((h) => h.ref);
    expect(hits.sort()).toEqual(["p1", "p2"]);
    expect(payload.docs.p1?.title).toBe("Hello");
    expect(payload.docs.d1?.kind).toBe("database");
    expect(payload.docs.p1?.snippet).toBe("world cup news");
  });

  it("writeSearchIndex writes a JS file that defines window.NE_SEARCH_DATA", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-search-"));
    const payload = buildSearchIndex([
      { id: "p1", title: "X", body: "y", href: "p1.html", kind: "page" },
    ]);
    const abs = await writeSearchIndex(tmp, payload);
    expect(abs).toBe(path.join(tmp, "search-index.js"));
    const raw = await fsp.readFile(abs, "utf8");
    expect(raw.startsWith("window.NE_SEARCH_DATA=")).toBe(true);
    const data = JSON.parse(raw.slice("window.NE_SEARCH_DATA=".length, -1));
    expect(data.docs.p1.title).toBe("X");
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("jsonForScript escapes </script>, -->, U+2028, U+2029", () => {
    const LS = " ";
    const PS = " ";
    const out = jsonForScript({
      a: "</script><img src=x onerror=alert(1)>",
      b: "<!-- foo --> bar",
      c: `line1${LS}line2${PS}line3`,
    });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("-->");
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(out).toContain("\\u003c/script>");
    expect(out).toContain("--\\u003e");
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    // Still valid JSON — the escaped sequences are JSON-valid unicode escapes.
    const parsed = JSON.parse(out) as { a: string; b: string; c: string };
    expect(parsed.a).toBe("</script><img src=x onerror=alert(1)>");
    expect(parsed.b).toBe("<!-- foo --> bar");
    expect(parsed.c).toBe(`line1${LS}line2${PS}line3`);
  });

  it("buildSearchIndex drops body from the shipped lookup (only title/href/kind/snippet survive)", () => {
    const longBody = "alpha bravo charlie ".repeat(500); // ~10kB
    const payload = buildSearchIndex([
      { id: "p1", title: "T", body: longBody, href: "p1.html", kind: "page" },
    ]);
    const entry = payload.docs.p1 as Record<string, unknown> | undefined;
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty("title");
    expect(entry).toHaveProperty("href");
    expect(entry).toHaveProperty("kind");
    expect(entry).toHaveProperty("snippet");
    // The runtime never reads body, so it should not be shipped.
    expect(entry).not.toHaveProperty("body");
    // Snippet is hard-capped at 160 chars (predates this change but verify).
    const snippet = (entry as Record<string, unknown>).snippet as string;
    expect(snippet.length).toBeLessThanOrEqual(160);
  });

  it("writeSearchIndex emits a much smaller payload after the body-cap (size regression guard)", async () => {
    // Build a corpus where every doc has a 10 kB body. The cap-on-index +
    // strip-body-from-docs combination should shrink the shipped file far
    // below the uncapped-naive size of N * 10 kB.
    const longBody = "alpha bravo charlie delta echo foxtrot ".repeat(300); // ~12kB
    const corpus = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      title: `Page ${i}`,
      body: longBody,
      href: `p${i}.html`,
      kind: "page" as const,
    }));
    const naiveBytes = corpus.reduce((n, d) => n + d.body.length, 0);
    expect(BODY_INDEX_CAP).toBeLessThan(longBody.length);

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-search-size-"));
    try {
      const payload = buildSearchIndex(corpus);
      const abs = await writeSearchIndex(tmp, payload);
      const { size } = await fsp.stat(abs);
      // Payload should be far less than the un-capped raw body footprint;
      // a >5× shrink is a conservative bound (acceptance criterion in the
      // story is >5× on the 900-page workspace).
      expect(size).toBeLessThan(naiveBytes / 5);

      // Sanity: the lunr index still resolves a top-K result for a query
      // that hits a token within the capped window.
      const raw = await fsp.readFile(abs, "utf8");
      const data = JSON.parse(raw.slice("window.NE_SEARCH_DATA=".length, -1));
      const idx = lunr.Index.load(data.index);
      expect(idx.search("alpha").length).toBeGreaterThan(0);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("writeSearchIndex escapes </script> in page titles so it cannot break out of the script tag", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-search-xss-"));
    const malicious = "</script><img src=x onerror=alert(1)>";
    const payload = buildSearchIndex([
      { id: "p1", title: malicious, body: "body --> end", href: "p1.html", kind: "page" },
    ]);
    const abs = await writeSearchIndex(tmp, payload);
    const raw = await fsp.readFile(abs, "utf8");

    // 1. No literal </script> or --> survives in the emitted JS source.
    expect(raw).not.toContain("</script>");
    expect(raw).not.toContain("-->");
    // 2. The < of the malicious title has been encoded (only `<` is escaped, `>` is left as-is).
    expect(raw).toContain("\\u003c/script>");
    // 3. The emitted file is still valid JS: parse it in a Function and read back the global.
    const globals: { NE_SEARCH_DATA?: SearchPayloadShape } = {};
    new Function("window", raw)(globals);
    expect(globals.NE_SEARCH_DATA).toBeDefined();
    expect(globals.NE_SEARCH_DATA?.docs.p1?.title).toBe(malicious);
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});

type SearchPayloadShape = {
  docs: Record<string, { title: string; href: string; kind: "page" | "database"; snippet: string }>;
};
