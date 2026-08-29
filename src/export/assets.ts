import crypto from "node:crypto";
import dns from "node:dns";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { URL } from "node:url";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import type { Logger } from "../logger.js";
import { FILE_BLOCK_TYPES, type NotionBlock, walkBlocks } from "../notion/blocks.js";

export function safeUrlForLog(u: string): string {
  // Notion S3 signed URLs carry HMAC signatures + security tokens in the
  // query string that grant time-limited read access to workspace media.
  // Strip query + fragment before logging so debug output is safe to share.
  try {
    const x = new URL(u);
    // Schemes without a real origin (file://, data:, javascript:) come back
    // with origin === "null" from the WHATWG parser — that's useless in a
    // log line. Reconstruct from protocol + host instead, falling back to a
    // plain query-strip when there's no host (data:, javascript:).
    if (x.origin === "null") {
      const noQuery = u.split("?")[0] ?? u;
      return noQuery.split("#")[0] ?? noQuery;
    }
    return `${x.origin}${x.pathname}`;
  } catch {
    const noQuery = u.split("?")[0] ?? u;
    return noQuery.split("#")[0] ?? noQuery;
  }
}

export class RedirectLoopError extends Error {
  readonly maxRedirects: number;
  constructor(maxRedirects: number) {
    super(`too many redirects (>${maxRedirects})`);
    this.name = "RedirectLoopError";
    this.maxRedirects = maxRedirects;
  }
}

export class SsrfBlockedError extends Error {
  readonly host: string;
  readonly address?: string;
  readonly reason: string;
  constructor(host: string, reason: string, address?: string) {
    super(
      address
        ? `SSRF blocked: ${reason} (host=${host}, address=${address})`
        : `SSRF blocked: ${reason} (host=${host})`,
    );
    this.name = "SsrfBlockedError";
    this.host = host;
    this.address = address;
    this.reason = reason;
  }
}

type DnsLookupImpl = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

const DEFAULT_DNS_LOOKUP: DnsLookupImpl = (hostname, options) =>
  dns.promises.lookup(hostname, options);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/**
 * Blocked IPv4 ranges, each as a { network, mask } pair. An address is in the
 * range when `(addr & mask) === (network & mask)`. Named so the cascade below
 * reads as the CIDR list it represents rather than a wall of hex literals; the
 * numeric values are unchanged from the prior inline form.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<{ network: number; mask: number; reason: string }> = [
  // 0.0.0.0/8 — "this network" / unspecified
  { network: 0x00000000, mask: 0xff000000, reason: "unspecified 0.0.0.0/8" },
  // 10.0.0.0/8 — RFC 1918 private
  { network: 0x0a000000, mask: 0xff000000, reason: "private 10.0.0.0/8" },
  // 127.0.0.0/8 — loopback
  { network: 0x7f000000, mask: 0xff000000, reason: "loopback 127.0.0.0/8" },
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  { network: 0xa9fe0000, mask: 0xffff0000, reason: "link-local 169.254.0.0/16" },
  // 172.16.0.0/12 — RFC 1918 private
  { network: 0xac100000, mask: 0xfff00000, reason: "private 172.16.0.0/12" },
  // 192.168.0.0/16 — RFC 1918 private
  { network: 0xc0a80000, mask: 0xffff0000, reason: "private 192.168.0.0/16" },
  // 100.64.0.0/10 — RFC 6598 carrier-grade NAT
  { network: 0x64400000, mask: 0xffc00000, reason: "CGNAT 100.64.0.0/10" },
];

function isPrivateIPv4(ip: string): { blocked: boolean; reason?: string } {
  const n = ipv4ToInt(ip);
  if (n === null) return { blocked: false };
  for (const range of BLOCKED_IPV4_RANGES) {
    if ((n & range.mask) === (range.network & range.mask)) {
      return { blocked: true, reason: range.reason };
    }
  }
  return { blocked: false };
}

function normalizeIPv6(ip: string): number[] | null {
  // Strip zone id (e.g. fe80::1%eth0).
  const noZone = ip.split("%")[0] ?? ip;
  const halves = noZone.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  // Embedded IPv4 in the last group: e.g. ::ffff:1.2.3.4
  const last = tail[tail.length - 1] ?? head[head.length - 1];
  let v4Bytes: number[] | null = null;
  if (last?.includes(".")) {
    const n = ipv4ToInt(last);
    if (n === null) return null;
    v4Bytes = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    if (tail.length) tail.pop();
    else head.pop();
  }
  const explicitGroups = head.length + tail.length + (v4Bytes ? 2 : 0);
  if (halves.length === 1 && explicitGroups !== 8) return null;
  const fill = 8 - explicitGroups;
  if (fill < 0) return null;
  const groups: string[] = [...head, ...new Array(fill).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >>> 8) & 0xff, v & 0xff);
  }
  if (v4Bytes) bytes.push(...v4Bytes);
  if (bytes.length !== 16) return null;
  return bytes;
}

function isPrivateIPv6(ip: string): { blocked: boolean; reason?: string; mappedV4?: string } {
  const bytes = normalizeIPv6(ip);
  if (!bytes) return { blocked: false };
  // ::1 loopback
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1)
    return { blocked: true, reason: "IPv6 loopback ::1" };
  // ::ffff:0:0/96 — IPv4-mapped
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const mapped = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    const v4 = isPrivateIPv4(mapped);
    if (v4.blocked) return { blocked: true, reason: `IPv4-mapped ${v4.reason}`, mappedV4: mapped };
    return { blocked: false, mappedV4: mapped };
  }
  // fc00::/7 (ULA)
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return { blocked: true, reason: "ULA fc00::/7" };
  // fe80::/10 (link-local)
  if ((bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80)
    return { blocked: true, reason: "link-local fe80::/10" };
  // unspecified ::
  if (bytes.every((b) => b === 0)) return { blocked: true, reason: "unspecified ::" };
  return { blocked: false };
}

function checkAddress(addr: string, family: number): { blocked: boolean; reason?: string } {
  if (family === 4 || net.isIPv4(addr)) {
    return isPrivateIPv4(addr);
  }
  if (family === 6 || net.isIPv6(addr)) {
    const r = isPrivateIPv6(addr);
    return { blocked: r.blocked, reason: r.reason };
  }
  return { blocked: false };
}

export interface VerifiedUrl {
  url: URL;
  /**
   * Address pinned for the subsequent fetch. `null` when the gate could not
   * resolve an address (e.g. ENOTFOUND / EAI_AGAIN) — callers should fall
   * back to the system resolver and let fetch surface the connect error.
   */
  pinnedAddress: { address: string; family: 4 | 6 } | null;
}

export async function assertPublicHttpUrlVerified(
  rawUrl: string,
  lookup: DnsLookupImpl = DEFAULT_DNS_LOOKUP,
): Promise<VerifiedUrl> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "invalid URL");
  }
  const proto = u.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:") {
    throw new SsrfBlockedError(u.host || rawUrl, `disallowed scheme ${proto}`);
  }
  // Strip brackets for IPv6 literals like [::1].
  let host = u.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) throw new SsrfBlockedError(rawUrl, "missing host");

  const literalFamily = net.isIP(host);
  if (literalFamily) {
    const check = checkAddress(host, literalFamily);
    if (check.blocked) {
      throw new SsrfBlockedError(host, check.reason ?? "private address", host);
    }
    return { url: u, pinnedAddress: { address: host, family: literalFamily as 4 | 6 } };
  }
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch (err) {
    // ENOTFOUND / EAI_AGAIN: the host has no DNS record, so a real fetch
    // would fail anyway. Don't synthesise an SSRF block — let fetch surface
    // the underlying connection error.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { url: u, pinnedAddress: null };
    throw new SsrfBlockedError(host, `DNS lookup failed: ${(err as Error).message}`);
  }
  if (!addrs.length) return { url: u, pinnedAddress: null };
  for (const a of addrs) {
    const check = checkAddress(a.address, a.family);
    if (check.blocked) {
      throw new SsrfBlockedError(host, check.reason ?? "private address", a.address);
    }
  }
  // Pin the first verified address. All addresses passed the gate, so this is
  // safe — and undici's connector only takes a single answer anyway.
  const first = addrs[0]!;
  const family = (first.family === 6 ? 6 : 4) as 4 | 6;
  return { url: u, pinnedAddress: { address: first.address, family } };
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  lookup: DnsLookupImpl = DEFAULT_DNS_LOOKUP,
): Promise<URL> {
  const v = await assertPublicHttpUrlVerified(rawUrl, lookup);
  return v.url;
}

/**
 * Build a one-shot undici Agent that pins the TCP connect to a pre-verified
 * IP, closing the DNS-rebinding TOCTOU between gate-check and fetch's own
 * resolution. TLS SNI / Host header still use the original hostname because
 * undici only consults `lookup` for the IP — the hostname/servername stays
 * intact.
 */
// Reuse a single pinned Agent per resolved IP across all downloads. Avoids
// killing keep-alive between the ~9k S3/notion-static asset fetches per export.
// Closed at process exit.
const pinnedAgents = new Map<string, Agent>();
process.once("exit", () => {
  for (const a of pinnedAgents.values()) a.close().catch(() => {});
});

function pinnedDispatcher(verified: { address: string; family: 4 | 6 }): Agent {
  const key = `${verified.family}:${verified.address}`;
  const cached = pinnedAgents.get(key);
  if (cached) return cached;
  const agent = buildPinnedAgent(verified);
  pinnedAgents.set(key, agent);
  return agent;
}

function buildPinnedAgent(verified: { address: string; family: 4 | 6 }): Agent {
  // undici's connector invokes `lookup` like `dns.lookup`: when `all: true`,
  // the callback receives an array of `{ address, family }`; otherwise it
  // receives positional `(err, address, family)`. undici 8 calls with
  // `all: true`, so we must answer in the array form or the connect aborts
  // with ERR_INVALID_IP_ADDRESS.
  const answerAll = [{ address: verified.address, family: verified.family }];
  const connector = buildConnector({
    lookup: (
      _hostname: string,
      options: dns.LookupOptions,
      cb: (
        err: NodeJS.ErrnoException | null,
        addressOrList: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ) => {
      if (options?.all) cb(null, answerAll);
      else cb(null, verified.address, verified.family);
    },
  });
  return new Agent({ connect: connector });
}

export interface AssetRecord {
  originalUrl: string;
  localPath: string; // relative to export root
  bytes: number;
  sha256: string;
}

export interface AssetFailure {
  url: string;
  status?: number;
  message: string;
}

export interface CollectOptions {
  /** Optional hint for filename extension (used when URL/content-type don't reveal one). */
  hint?: string;
  /** Called on 403/410 to fetch a fresh URL — Notion's S3 signed URLs expire
   * after ~1h, so a long crawl can outlive its own URLs. The collector retries
   * the download once with the refreshed URL. */
  refresh?: () => Promise<string | null>;
}

export interface AssetCollector {
  collect(url: string, opts?: CollectOptions | string): Promise<AssetRecord>;
  records(): AssetRecord[];
  failures(): AssetFailure[];
}

interface CreateOpts {
  assetsDir: string;
  exportRoot: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  /** Override DNS lookups (tests only). */
  dnsLookupImpl?: DnsLookupImpl;
  concurrency?: number;
  onDownloaded?: (rec: AssetRecord) => void;
}

// Capture the platform's original `fetch` at module load so we can detect
// when a test has monkey-patched `globalThis.fetch`. We must yield to that
// patch (otherwise existing tests that stub `global.fetch` would break), but
// when no patch is in effect we route through undici's fetch with a pinned
// dispatcher to close the DNS-rebinding TOCTOU.
const ORIGINAL_GLOBAL_FETCH = globalThis.fetch;

export function createAssetCollector(opts: CreateOpts): AssetCollector {
  const fetchImpl = opts.fetchImpl;
  const lookupImpl = opts.dnsLookupImpl ?? DEFAULT_DNS_LOOKUP;
  const inFlight = new Map<string, Promise<AssetRecord>>();
  const recs: AssetRecord[] = [];
  // Dedup index keyed by the RAW (unscrubbed) original URL. We must not put
  // the raw signed URL into AssetRecord.originalUrl — those records are
  // written verbatim to manifest.json, which would leak the S3 signature.
  // The on-disk shape stores the scrubbed form while this in-memory map
  // keeps the raw → record association for dedup.
  const byOriginalUrl = new Map<string, AssetRecord>();
  const fails: AssetFailure[] = [];
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
  }

  function release(): void {
    active--;
    const next = waiters.shift();
    if (next) next();
  }

  async function fetchOnceWithRedirects(url: string): Promise<Response> {
    // Manual redirect handling: each hop must pass the SSRF gate.
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "image/*,application/pdf,*/*;q=0.5",
    };
    const maxRedirects = 5;
    let currentUrl = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Validate the URL AND pin the resolved IP for this hop's connect, so a
      // racing DNS swap between gate-check and TCP connect can't redirect us
      // to a private address (TOCTOU rebinding).
      const verified = await assertPublicHttpUrlVerified(currentUrl, lookupImpl);
      // Decide whether to route through undici with a pinned dispatcher.
      // - Explicit fetchImpl override (asset tests): respect it.
      // - globalThis.fetch monkey-patched (other tests): respect it.
      // - Production path: pin the verified IP via undici's connector.
      const patchedGlobalFetch =
        !fetchImpl && globalThis.fetch !== ORIGINAL_GLOBAL_FETCH ? globalThis.fetch : null;
      let res: Response;
      if (!fetchImpl && !patchedGlobalFetch && verified.pinnedAddress) {
        const dispatcher = pinnedDispatcher(verified.pinnedAddress);
        // Pinned agents are pooled by IP and reused across hops/downloads —
        // closing per-hop would kill keep-alive across the 9k+ asset fetches.
        // The pool is closed at process exit.
        res = (await undiciFetch(currentUrl, {
          headers,
          redirect: "manual",
          dispatcher,
        })) as unknown as Response;
      } else {
        // Test-injected fetch, monkey-patched global fetch, or no pinned
        // address (ENOTFOUND fallback to system resolver).
        const f = fetchImpl ?? patchedGlobalFetch ?? fetch;
        res = await f(currentUrl, { headers, redirect: "manual" });
      }
      const status = res.status;
      const isRedirect = status >= 300 && status < 400 && status !== 304;
      if (!isRedirect) return res;
      const location = res.headers.get("location") ?? res.headers.get("Location");
      if (!location) return res;
      if (hop >= maxRedirects) {
        throw new RedirectLoopError(maxRedirects);
      }
      currentUrl = new URL(location, currentUrl).toString();
    }
    // Unreachable, but satisfies TS.
    throw new Error("redirect loop");
  }

  async function fetchWithRetry(url: string): Promise<Response> {
    // Send a browser-y UA — several CDNs (incl. instagram, some fileadmin
    // installs) 403 default fetch agents. Retry transient failures (network
    // errors, 5xx, 429) up to 3 times with exponential backoff; 403/404 etc.
    // are permanent and short-circuit immediately.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchOnceWithRedirects(url);
        if (res.ok) return res;
        const transient = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!transient) return res;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        // SSRF blocks and redirect loops are deterministic — no point retrying.
        if (err instanceof SsrfBlockedError) throw err;
        if (err instanceof RedirectLoopError) throw err;
        lastErr = err;
      }
      if (attempt < 2) {
        const backoff = 400 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  async function download(url: string, optsOrHint?: CollectOptions | string): Promise<AssetRecord> {
    const collectOpts: CollectOptions =
      typeof optsOrHint === "string" ? { hint: optsOrHint } : (optsOrHint ?? {});
    const hint = collectOpts.hint;
    const refresh = collectOpts.refresh;
    const existing = inFlight.get(url);
    if (existing) return existing;

    const task = (async () => {
      try {
        await acquire();
        // Check again after acquiring lock, in case another task for the same URL finished/started
        const currentRec = byOriginalUrl.get(url);
        if (currentRec) return currentRec;

        await fsp.mkdir(opts.assetsDir, { recursive: true });
        let res: Response;
        try {
          res = await fetchWithRetry(url);
        } catch (err) {
          if (err instanceof SsrfBlockedError) {
            const safe = safeUrlForLog(url);
            const failure: AssetFailure = { url: safe, message: err.message };
            if (!fails.some((f) => f.url === safe)) fails.push(failure);
            opts.log.warn(
              { url: safe, reason: err.reason, host: err.host },
              "asset blocked by SSRF gate",
            );
            throw err;
          }
          throw err;
        }
        let attemptedUrl = url;
        // Notion S3 signed URLs expire after ~1h. On 401/403/410 ask the
        // caller for a fresh URL (re-retrieve the source block/page) and try
        // once more. If the refresh callback isn't supplied we fall through.
        const expiredStatus = res.status === 401 || res.status === 403 || res.status === 410;
        if (!res.ok && expiredStatus && refresh) {
          try {
            const fresh = await refresh();
            if (fresh && fresh !== url) {
              opts.log.debug(
                { url: safeUrlForLog(url), fresh: safeUrlForLog(fresh) },
                "asset url refreshed",
              );
              res = await fetchWithRetry(fresh);
              attemptedUrl = fresh;
            }
          } catch (err) {
            // Don't swallow SSRF blocks raised by the refreshed URL. If we
            // let the catch fall through, the outer `!res.ok` branch would
            // record a generic "HTTP <status>" failure and the SSRF reason
            // would never reach manifest.failedAssets. Re-throw so the outer
            // handler at the call site records it properly — matches the
            // behavior of fetchWithRetry's own SsrfBlockedError short-circuit
            // above.
            if (err instanceof SsrfBlockedError) throw err;
            opts.log.debug({ err: (err as Error).message }, "asset url refresh failed");
          }
        }
        if (!res.ok) {
          // SECURITY: Notion S3 signed URLs carry `X-Amz-Signature` +
          // `X-Amz-Security-Token` in the query string that grant ~1h read
          // access to workspace media. Scrub both the manifest record AND the
          // thrown Error message before they hit disk (manifest.failedAssets)
          // or the warn log (which is itself often shipped/copied).
          const safeAttempted = safeUrlForLog(attemptedUrl);
          const failure: AssetFailure = {
            url: safeAttempted,
            status: res.status,
            message: `HTTP ${res.status}`,
          };
          fails.push(failure);
          throw new Error(`asset download failed (${res.status}): ${safeAttempted}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        const ext = guessExt(url, res.headers.get("content-type"), hint);
        const filename = `${sha.slice(0, 16)}${ext}`;
        const abs = path.join(opts.assetsDir, filename);
        await fsp.writeFile(abs, buf);
        // POSIX-separated: local_path is stored in raw JSON / manifest and used
        // as a web src, so it must use "/" even when the export runs on Windows.
        const rel = path.relative(opts.exportRoot, abs).split(path.sep).join("/");
        const rec: AssetRecord = {
          // SECURITY: never store the raw signed S3 URL in the on-disk
          // record. manifest.json is part of the export tarball — a user
          // sharing it within the ~1h signature TTL would otherwise leak
          // valid X-Amz-Signature + X-Amz-Security-Token credentials. The
          // in-memory `byOriginalUrl` map below keeps the raw → record
          // association needed for dedup.
          originalUrl: safeUrlForLog(url),
          localPath: rel,
          bytes: buf.length,
          sha256: sha,
        };
        recs.push(rec);
        byOriginalUrl.set(url, rec);
        opts.onDownloaded?.(rec);
        opts.log.debug(
          { url: safeUrlForLog(url), localPath: rel, bytes: buf.length },
          "asset downloaded",
        );
        return rec;
      } catch (err) {
        inFlight.delete(url); // Allow retry if it failed
        // Scrub for the manifest record (M2): err.message may itself carry
        // the post-refresh signed URL if it bubbled from the !res.ok branch
        // above (now also scrubbed), but defend in depth in case a different
        // upstream throw leaked the URL into the message.
        const safe = safeUrlForLog(url);
        if (!fails.some((f) => f.url === safe)) {
          fails.push({ url: safe, message: (err as Error).message });
        }
        // SSRF blocks already logged their own warn at the fetch seam above;
        // logging again here would just double up. Everything else (HTTP
        // errors, network failures, write errors) was only recorded into the
        // failures array — surface it so a silently-dropped asset is visible.
        if (!(err instanceof SsrfBlockedError)) {
          opts.log.warn({ url: safe, err: (err as Error).message }, "asset download failed");
        }
        throw err;
      } finally {
        release();
      }
    })();
    inFlight.set(url, task);
    return task;
  }

  return {
    collect: download,
    records: () => recs.slice(),
    failures: () => fails.slice(),
  };
}

function guessExt(url: string, contentType: string | null, hint?: string): string {
  const fromUrl = extOf(url);
  if (fromUrl) return fromUrl;
  if (hint) {
    const h = extOf(hint);
    if (h) return h;
  }
  const ct = contentType?.split(";")[0]?.trim();
  return ct ? (CT_EXT[ct] ?? ".bin") : ".bin";
}

function extOf(s: string): string | null {
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,8})$/);
    return m?.[1] ? `.${m[1].toLowerCase()}` : null;
  } catch {
    const m = s.match(/\.([a-zA-Z0-9]{1,8})$/);
    return m?.[1] ? `.${m[1].toLowerCase()}` : null;
  }
}

const CT_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/json": ".json",
};

function getFileUrl(block: NotionBlock): string | null {
  if (!FILE_BLOCK_TYPES.has(block.type)) return null;
  const payload = block[block.type] as
    | { type?: "external" | "file"; external?: { url: string }; file?: { url: string } }
    | undefined;
  if (payload?.type === "file" && payload.file?.url) return payload.file.url;
  if (payload?.type === "external" && payload.external?.url) return payload.external.url;
  return null;
}

function collectMediaBlocks(blocks: NotionBlock[]): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const b of walkBlocks(blocks)) {
    if (getFileUrl(b)) out.push(b);
  }
  return out;
}

interface CustomEmojiMention {
  type: "custom_emoji";
  custom_emoji: { id?: string; name?: string; url: string; local_path?: string };
}

function collectCustomEmojis(blocks: NotionBlock[]): CustomEmojiMention[] {
  const out: CustomEmojiMention[] = [];
  for (const b of walkBlocks(blocks)) {
    const data = b[b.type] as { rich_text?: Array<{ mention?: unknown }> } | undefined;
    const items = data?.rich_text;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const m = item?.mention as CustomEmojiMention | undefined;
      if (m?.type === "custom_emoji" && m.custom_emoji?.url) out.push(m);
    }
  }
  return out;
}

export async function rewriteBlocksWithAssets(
  blocks: NotionBlock[],
  collector: AssetCollector,
  log: Logger,
  refreshBlock?: (blockId: string) => Promise<NotionBlock | null>,
): Promise<void> {
  const media = collectMediaBlocks(blocks);
  // Custom emoji URLs are also Notion S3 URLs — download them up-front so the
  // page can render `<img class="custom-emoji">` from a local file path.
  const emojis = collectCustomEmojis(blocks);
  await Promise.all(
    emojis.map(async (m) => {
      try {
        const rec = await collector.collect(m.custom_emoji.url, { hint: ".png" });
        m.custom_emoji.local_path = rec.localPath;
      } catch (err) {
        log.warn({ err: (err as Error).message }, "custom emoji download failed");
      }
    }),
  );
  await Promise.all(
    media.map(async (block) => {
      try {
        const url = getFileUrl(block);
        if (!url) return;
        const rec = await collector.collect(url, {
          refresh: refreshBlock
            ? async () => {
                const fresh = await refreshBlock(block.id);
                if (!fresh) return null;
                // Notion mutates these in place — copy the latest payload so
                // subsequent reads (e.g. raw JSON write) reflect the fresh URL.
                const freshPayload = fresh[fresh.type] as
                  | { type?: string; external?: { url?: string }; file?: { url?: string } }
                  | undefined;
                const blockPayload = block[block.type] as
                  | { type?: string; external?: { url?: string }; file?: { url?: string } }
                  | undefined;
                if (freshPayload && blockPayload) {
                  if (freshPayload.file?.url && blockPayload.file)
                    blockPayload.file.url = freshPayload.file.url;
                  if (freshPayload.external?.url && blockPayload.external)
                    blockPayload.external.url = freshPayload.external.url;
                }
                return getFileUrl(fresh);
              }
            : undefined,
        });
        const payload = block[block.type] as { local_path?: string } | undefined;
        if (payload) {
          payload.local_path = rec.localPath;
        } else {
          log.warn({ blockId: block.id, type: block.type }, "block payload missing for asset");
        }
      } catch (err) {
        log.warn({ err: (err as Error).message, blockId: block.id }, "asset failed");
      }
    }),
  );
}
