import fsp from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlVerified,
  createAssetCollector,
  RedirectLoopError,
  rewriteBlocksWithAssets,
  SsrfBlockedError,
  safeUrlForLog,
} from "../src/export/assets.js";
import { createLogger } from "../src/logger.js";

const publicDns = async (_host: string, _opts: { all: true }) => [
  { address: "93.184.216.34", family: 4 },
];

function fakeFetch(map: Record<string, { body: Buffer; contentType?: string; status?: number }>) {
  return async (url: string) => {
    const entry = map[url];
    if (!entry)
      return {
        ok: false,
        status: 404,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
        headers: { get: () => null },
      } as unknown as Response;
    return {
      ok: (entry.status ?? 200) < 400,
      status: entry.status ?? 200,
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

describe("assets", () => {
  it("downloads, dedupes, and writes to assets dir", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-assets-"));
    const log = createLogger("error");
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        "https://x/y.png": { body: Buffer.from([1, 2, 3]), contentType: "image/png" },
      }),
    });
    const r1 = await collector.collect("https://x/y.png");
    const r2 = await collector.collect("https://x/y.png");
    expect(r1.localPath).toBe(r2.localPath);
    expect(r1.bytes).toBe(3);
    expect(r1.sha256).toHaveLength(64);
    expect(collector.records()).toHaveLength(1);
    const stat = await fsp.stat(path.join(tmp, r1.localPath));
    expect(stat.isFile()).toBe(true);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("tracks failures with status code", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-fail-"));
    const log = createLogger("error");
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        "https://x/403.jpg": { body: Buffer.from(""), status: 403 },
      }),
    });
    await expect(collector.collect("https://x/403.jpg")).rejects.toThrow(/403/);
    const fails = collector.failures();
    expect(fails).toHaveLength(1);
    expect(fails[0]!.url).toBe("https://x/403.jpg");
    expect(fails[0]!.status).toBe(403);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // Notion S3 signed URLs must not leak via Error.message or the
  // manifest.failedAssets[].url field. Both surfaces must be scrubbed.
  it("strips S3 signature/security-token from failedAssets and Error.message", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-m2-"));
    const log = createLogger("error");
    const signedUrl =
      "https://prod-files-secure.s3.amazonaws.com/abc/def.png" +
      "?X-Amz-Signature=DEADBEEFDEADBEEFDEADBEEF" +
      "&X-Amz-Credential=AKIAFAKE/20260101/us-west-2/s3/aws4_request" +
      "&X-Amz-Security-Token=FAKE-STS-TOKEN-PAYLOAD";
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        [signedUrl]: { body: Buffer.from(""), status: 403 },
      }),
    });
    let caught: Error | null = null;
    await collector.collect(signedUrl).catch((e: Error) => {
      caught = e;
    });
    expect(caught).not.toBeNull();
    // Error.message must NOT contain the signature/credential/token query params.
    expect(caught!.message).not.toMatch(/X-Amz-Signature/);
    expect(caught!.message).not.toMatch(/X-Amz-Security-Token/);
    expect(caught!.message).not.toMatch(/DEADBEEFDEADBEEFDEADBEEF/);
    // Manifest record (collector.failures()) must NOT carry the signature.
    const fails = collector.failures();
    expect(fails.length).toBeGreaterThanOrEqual(1);
    for (const f of fails) {
      expect(f.url).not.toMatch(/X-Amz-Signature/);
      expect(f.url).not.toMatch(/X-Amz-Security-Token/);
      expect(f.url).not.toMatch(/DEADBEEFDEADBEEFDEADBEEF/);
      // The scrubbed form should still preserve enough of the URL to be useful:
      // scheme + host + pathname.
      expect(f.url).toBe("https://prod-files-secure.s3.amazonaws.com/abc/def.png");
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  describe("SSRF gate", () => {
    it("rejects non-http(s) schemes (file://)", async () => {
      await expect(assertPublicHttpUrl("file:///etc/passwd", publicDns)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      await expect(assertPublicHttpUrl("file:///etc/passwd", publicDns)).rejects.toThrow(
        /disallowed scheme file:/,
      );
    });

    it("rejects data:, ftp:, and javascript: schemes", async () => {
      await expect(assertPublicHttpUrl("data:text/plain,hi", publicDns)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      await expect(assertPublicHttpUrl("ftp://example.com/x", publicDns)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      await expect(assertPublicHttpUrl("javascript:alert(1)", publicDns)).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    });

    it("rejects literal loopback http://127.0.0.1/", async () => {
      await expect(assertPublicHttpUrl("http://127.0.0.1/", publicDns)).rejects.toThrow(
        /loopback 127\.0\.0\.0\/8/,
      );
    });

    it("rejects AWS metadata http://169.254.169.254/", async () => {
      await expect(assertPublicHttpUrl("http://169.254.169.254/", publicDns)).rejects.toThrow(
        /link-local 169\.254\.0\.0\/16/,
      );
    });

    it("rejects RFC1918 http://10.0.0.1/", async () => {
      await expect(assertPublicHttpUrl("http://10.0.0.1/", publicDns)).rejects.toThrow(
        /private 10\.0\.0\.0\/8/,
      );
    });

    it("rejects 192.168/16, 172.16/12, CGNAT, and IPv6 ranges", async () => {
      await expect(assertPublicHttpUrl("http://192.168.1.1/", publicDns)).rejects.toThrow(
        /192\.168/,
      );
      await expect(assertPublicHttpUrl("http://172.16.5.5/", publicDns)).rejects.toThrow(/172\.16/);
      await expect(assertPublicHttpUrl("http://100.64.0.1/", publicDns)).rejects.toThrow(/CGNAT/);
      await expect(assertPublicHttpUrl("http://[::1]/", publicDns)).rejects.toThrow(/loopback/);
      await expect(assertPublicHttpUrl("http://[fe80::1]/", publicDns)).rejects.toThrow(
        /link-local fe80/,
      );
      await expect(assertPublicHttpUrl("http://[fc00::1]/", publicDns)).rejects.toThrow(/ULA/);
      // IPv4-mapped IPv6 to a private v4 → rejected.
      await expect(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/", publicDns)).rejects.toThrow(
        /IPv4-mapped/,
      );
    });

    it("rejects hostnames that resolve to private addresses", async () => {
      const privateDns = async (_h: string, _o: { all: true }) => [
        { address: "10.1.2.3", family: 4 },
      ];
      await expect(assertPublicHttpUrl("http://internal.corp/", privateDns)).rejects.toThrow(
        /private 10\.0\.0\.0\/8/,
      );
    });

    it("allows hostnames that resolve to public addresses", async () => {
      const u = await assertPublicHttpUrl("https://example.com/path", publicDns);
      expect(u.hostname).toBe("example.com");
    });

    it("blocks SSRF URLs via collector without fetching, records failure", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-ssrf-"));
      const log = createLogger("error");
      let fetched = 0;
      const collector = createAssetCollector({
        assetsDir: path.join(tmp, "assets"),
        exportRoot: tmp,
        log,
        dnsLookupImpl: publicDns,
        fetchImpl: (async () => {
          fetched++;
          return new Response("", { status: 200 });
        }) as unknown as typeof fetch,
      });
      await expect(collector.collect("file:///etc/passwd")).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      await expect(collector.collect("http://127.0.0.1/")).rejects.toBeInstanceOf(SsrfBlockedError);
      await expect(collector.collect("http://169.254.169.254/")).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      await expect(collector.collect("http://10.0.0.1/")).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(fetched).toBe(0);
      const fails = collector.failures();
      expect(fails.map((f) => f.url).sort()).toEqual(
        [
          "file:///etc/passwd",
          "http://10.0.0.1/",
          "http://127.0.0.1/",
          "http://169.254.169.254/",
        ].sort(),
      );
      for (const f of fails) expect(f.message).toMatch(/SSRF blocked/);
      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("allows public URL through the collector with mocked DNS", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-ssrf-ok-"));
      const log = createLogger("error");
      const collector = createAssetCollector({
        assetsDir: path.join(tmp, "assets"),
        exportRoot: tmp,
        log,
        dnsLookupImpl: publicDns,
        fetchImpl: (async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          })) as unknown as typeof fetch,
      });
      const rec = await collector.collect("https://cdn.example.com/x.png");
      expect(rec.bytes).toBe(3);
      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("pins the verified IP against DNS rebinding (TOCTOU)", async () => {
      // Simulate an attacker that swaps DNS between gate-check and fetch's
      // internal resolution. The first lookup returns a public address; any
      // subsequent lookup returns 127.0.0.1. Our fix resolves DNS exactly
      // ONCE per fetch and pins that answer into the connect — so even though
      // the rebound answer is loopback, the connect never goes there.
      let calls = 0;
      const flippingDns = async (
        _host: string,
        _opts: { all: true },
      ): Promise<Array<{ address: string; family: number }>> => {
        calls++;
        if (calls === 1) return [{ address: "93.184.216.34", family: 4 }]; // public
        return [{ address: "127.0.0.1", family: 4 }]; // rebound to loopback
      };
      const v = await assertPublicHttpUrlVerified("http://victim.test/", flippingDns);
      expect(v.pinnedAddress).toEqual({ address: "93.184.216.34", family: 4 });
      // The gate only resolves once per request, so `calls` stays at 1. The
      // pinned IP is what the connector will use; a racing rebinding has no
      // effect on the actual TCP destination.
      expect(calls).toBe(1);
    });

    it("pinned dispatcher routes connect to verified IP, preserves Host header", async () => {
      // Stand up an actual HTTP server on 127.0.0.1, then make a request to a
      // hostname that doesn't resolve in the real DNS. The dispatcher built
      // from `assertPublicHttpUrlVerified` pins the connect to the server's
      // address. If pinning works, the server receives the request with the
      // original Host header intact; if it didn't work, the fetch would fail
      // to resolve "verified-pin.test".
      const seenHosts: string[] = [];
      const server = http.createServer((req, res) => {
        seenHosts.push(req.headers.host ?? "");
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from([7, 7, 7]));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as AddressInfo).port;
      try {
        // The collector treats fetch as the gate-controlled path. We mock DNS
        // for the gate to return our local server's IP (which would be private
        // — so we use 8.8.8.8 as the gate's "answer" then the pinned dispatcher
        // would point there, which is wrong). Instead, the simplest direct
        // assertion is: gate sees public IP, dispatcher gets a verified
        // override pointing at our loopback for THIS test only. We exercise
        // this by going through `undiciFetch` directly with a built dispatcher.
        const { Agent: UndiciAgent, buildConnector, fetch: undiciFetch } = await import("undici");
        const connector = buildConnector({
          lookup: (
            _hostname: string,
            options: { all?: boolean; family?: number },
            cb: (
              err: Error | null,
              addressOrList: string | Array<{ address: string; family: number }>,
              family?: number,
            ) => void,
          ) => {
            if (options?.all) cb(null, [{ address: "127.0.0.1", family: 4 }]);
            else cb(null, "127.0.0.1", 4);
          },
        });
        const dispatcher = new UndiciAgent({ connect: connector });
        const res = await undiciFetch(`http://verified-pin.test:${port}/x.png`, {
          dispatcher,
        });
        expect(res.status).toBe(200);
        const buf = Buffer.from(await res.arrayBuffer());
        expect(buf.length).toBe(3);
        // Host header must reflect the ORIGINAL hostname, not the pinned IP.
        expect(seenHosts[0]).toBe(`verified-pin.test:${port}`);
        await dispatcher.close();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("blocks at a redirect hop to a private address", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-redir-"));
      const log = createLogger("error");
      // First call returns 302 → http://127.0.0.1/. Second call should never happen.
      let call = 0;
      const fetchImpl = (async (url: string) => {
        call++;
        if (call === 1 && url === "https://cdn.example.com/start") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/secret" },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;
      const collector = createAssetCollector({
        assetsDir: path.join(tmp, "assets"),
        exportRoot: tmp,
        log,
        dnsLookupImpl: publicDns,
        fetchImpl,
      });
      await expect(collector.collect("https://cdn.example.com/start")).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
      expect(call).toBe(1);
      const fails = collector.failures();
      expect(fails).toHaveLength(1);
      expect(fails[0]!.message).toMatch(/loopback/);
      await fsp.rm(tmp, { recursive: true, force: true });
    });
  });

  describe("safeUrlForLog", () => {
    it("strips S3 signature and security token query params", () => {
      const signed =
        "https://s3.us-west-2.amazonaws.com/secure.notion-static.com/abc-123/image.png" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIA%2F20260531%2Fus-west-2%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20260531T000000Z" +
        "&X-Amz-Expires=3600" +
        "&X-Amz-Signature=deadbeefcafebabefeedfacefacefeedcafebabe" +
        "&X-Amz-Security-Token=FwoGZXIvYXdzEJr%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEa";
      const out = safeUrlForLog(signed);
      expect(out).not.toMatch(/X-Amz-Signature/);
      expect(out).not.toMatch(/X-Amz-Security-Token/);
      expect(out).not.toMatch(/deadbeef/);
      expect(out).not.toMatch(/FwoGZ/);
      expect(out).toBe(
        "https://s3.us-west-2.amazonaws.com/secure.notion-static.com/abc-123/image.png",
      );
    });

    it("falls back gracefully for malformed URLs", () => {
      expect(safeUrlForLog("not a url?X-Amz-Signature=secret")).toBe("not a url");
    });
  });

  it("rewrites blocks with local_path", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-rw-"));
    const log = createLogger("error");
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        "https://signed/img.png": { body: Buffer.from("abc"), contentType: "image/png" },
        "https://signed/doc.pdf": { body: Buffer.from("pdf"), contentType: "application/pdf" },
      }),
    });
    const blocks = [
      {
        id: "b1",
        type: "image",
        image: { type: "file", file: { url: "https://signed/img.png", expiry_time: "soon" } },
      },
      {
        id: "b2",
        type: "pdf",
        pdf: { type: "file", file: { url: "https://signed/doc.pdf" } },
      },
      {
        id: "b3",
        type: "paragraph",
        paragraph: { rich_text: [] },
        has_children: true,
        children: [
          {
            id: "b4",
            type: "image",
            image: { type: "file", file: { url: "https://signed/img.png" } }, // dedup
          },
        ],
      },
    ];
    await rewriteBlocksWithAssets(blocks, collector, log);
    const img = blocks[0]!.image as { local_path?: string };
    const pdf = blocks[1]!.pdf as { local_path?: string };
    expect(img.local_path).toMatch(/^assets\//);
    expect(pdf.local_path).toMatch(/^assets\//);
    expect(collector.records()).toHaveLength(2);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // The AssetRecord written to manifest.json must not carry the raw signed
  // S3 URL — sharing the manifest within the ~1h signature TTL would
  // otherwise leak valid AWS credentials.
  it("scrubs signed S3 query params from AssetRecord.originalUrl", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-f7-"));
    const log = createLogger("error");
    const signedUrl =
      "https://prod-files-secure.s3.amazonaws.com/foo/bar.png" +
      "?X-Amz-Signature=DEADBEEFCAFE" +
      "&X-Amz-Security-Token=STS-LEAKED-TOKEN";
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: fakeFetch({
        [signedUrl]: { body: Buffer.from([1, 2, 3]), contentType: "image/png" },
      }),
    });
    const rec = await collector.collect(signedUrl);
    expect(rec.originalUrl).not.toMatch(/X-Amz-Signature/);
    expect(rec.originalUrl).not.toMatch(/X-Amz-Security-Token/);
    expect(rec.originalUrl).not.toMatch(/DEADBEEFCAFE/);
    expect(rec.originalUrl).toBe("https://prod-files-secure.s3.amazonaws.com/foo/bar.png");
    // collector.records() reflects the on-disk shape that goes to manifest.json.
    for (const r of collector.records()) {
      expect(r.originalUrl).not.toMatch(/X-Amz-Signature/);
      expect(r.originalUrl).not.toMatch(/X-Amz-Security-Token/);
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("dedupes by the raw URL even though originalUrl is scrubbed", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-f7-dedup-"));
    const log = createLogger("error");
    const signedUrl =
      "https://prod-files-secure.s3.amazonaws.com/dup/img.png" +
      "?X-Amz-Signature=AAAA&X-Amz-Security-Token=BBBB";
    let fetchCount = 0;
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl: (async () => {
        fetchCount++;
        return new Response(new Uint8Array([9, 9, 9]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }) as unknown as typeof fetch,
    });
    const r1 = await collector.collect(signedUrl);
    const r2 = await collector.collect(signedUrl);
    expect(r1.localPath).toBe(r2.localPath);
    expect(r1.sha256).toBe(r2.sha256);
    expect(collector.records()).toHaveLength(1);
    // Only one network fetch should have happened — dedup kicked in.
    expect(fetchCount).toBe(1);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // Redirect loops are deterministic; the throw must be a RedirectLoopError
  // so fetchWithRetry doesn't waste cycles retrying it (a plain Error would
  // get retried 3×, ~6 redirect-hops/attempt).
  it("throws RedirectLoopError after >5 redirects (not plain Error)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-f6-"));
    const log = createLogger("error");
    let calls = 0;
    // Infinite redirect chain: every response is 302 → /next/N
    const fetchImpl = (async (url: string) => {
      calls++;
      const u = new URL(url);
      const next = `https://cdn.example.com${u.pathname}/next`;
      return new Response(null, {
        status: 302,
        headers: { location: next },
      });
    }) as unknown as typeof fetch;
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl,
    });
    let caught: unknown;
    await collector.collect("https://cdn.example.com/start").catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(RedirectLoopError);
    // 6 hops per attempt (hop 0..5) and NO retry → exactly 6 fetches.
    // If RedirectLoopError were treated as transient, we'd see ~18.
    expect(calls).toBe(6);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // The SSRF reason raised by the refresh-then-retry path must reach
  // manifest.failedAssets — a prior catch only logged debug and fell through
  // to a generic "HTTP <status>".
  // Page-icon URLs sourced from the crawl's `search` payload can expire
  // between crawl and `prefetchPageIcons` (a common case with incremental
  // exports that resume an hour-old run). The collector's refresh callback
  // path is what re-signs them. Exercise the happy 403 → refresh → 200
  // sequence to lock in the wiring.
  it("retries icon download with refreshed URL on 403 (page-icon refresh path)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-icon-refresh-"));
    const log = createLogger("error");
    const expired = "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/icon.png?expired=1";
    const fresh = "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/icon.png?fresh=1";
    let refreshCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (url === expired) return new Response(null, { status: 403 });
      if (url === fresh) {
        return new Response(Buffer.from([0xde, 0xad, 0xbe, 0xef]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl,
    });
    const rec = await collector.collect(expired, {
      refresh: async () => {
        refreshCalls += 1;
        return fresh;
      },
    });
    expect(refreshCalls).toBe(1);
    expect(rec.bytes).toBe(4);
    expect(rec.localPath).toMatch(/^assets\//);
    // No persisted failures — the refresh succeeded.
    expect(collector.failures()).toHaveLength(0);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("surfaces SsrfBlockedError from the refresh path to failedAssets", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-f1-"));
    const log = createLogger("error");
    const original = "https://cdn.example.com/expired.png";
    // First fetch returns 403 (signed URL expired). The refresh callback
    // produces a private-address URL, which the SSRF gate must reject — and
    // that rejection must bubble out, not be swallowed.
    const fetchImpl = (async (url: string) => {
      if (url === original) {
        return new Response(null, { status: 403 });
      }
      // No other fetches expected — refresh URL is gated before fetch.
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const collector = createAssetCollector({
      assetsDir: path.join(tmp, "assets"),
      exportRoot: tmp,
      log,
      dnsLookupImpl: publicDns,
      fetchImpl,
    });
    let caught: unknown;
    await collector
      .collect(original, {
        refresh: async () => "http://127.0.0.1/refreshed.png",
      })
      .catch((e) => {
        caught = e;
      });
    expect(caught).toBeInstanceOf(SsrfBlockedError);
    const fails = collector.failures();
    // The failure recorded for this URL should carry the SSRF reason, not
    // a generic "HTTP 403" message.
    const ssrfFail = fails.find((f) => /SSRF blocked/.test(f.message));
    expect(ssrfFail).toBeDefined();
    expect(ssrfFail!.message).toMatch(/loopback/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
