import { setTimeout as sleep } from "node:timers/promises";
import { Client, type LogLevel } from "@notionhq/client";
import Bottleneck from "bottleneck";
import type { Logger } from "../logger.js";

export { sleep };

export interface RateLimitedClientOptions {
  token: string;
  minTime?: number; // ms between requests; default 150 (~6 req/s) overshoots Notion's ~3/s, so 429s are expected and absorbed by retry. Raise to ~350 to mostly stay under.
  maxConcurrent?: number; // default 4; 429 retry handles overshoot
  maxRetries?: number; // default 8 — Notion bursts can produce long Retry-After
  reservoir?: number | null;
  log?: Logger;
}

interface NotionApiError {
  status?: number;
  code?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function getRetryAfterMs(err: unknown): number | null {
  const e = err as NotionApiError;
  const headers = e?.headers ?? {};
  const ra = headers["retry-after"] ?? headers["Retry-After"];
  if (!ra) return null;
  const v = Array.isArray(ra) ? ra[0] : ra;
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export function isRateLimitError(err: unknown): boolean {
  const e = err as NotionApiError;
  return e?.status === 429 || e?.code === "rate_limited";
}

export function isRetryableError(err: unknown): boolean {
  const e = err as NotionApiError;
  if (isRateLimitError(err)) return true;
  if (typeof e?.status === "number" && e.status >= 500 && e.status < 600) return true;
  return false;
}

export class RateLimitedNotion {
  readonly client: Client;
  readonly limiter: Bottleneck;
  private readonly maxRetries: number;
  private readonly log: Logger | undefined;

  constructor(opts: RateLimitedClientOptions) {
    // We own retry/backoff (see attempt() below), so silence the SDK's own
    // per-request WARN logs for handled 429/5xx; genuine errors still surface.
    // Literal (= LogLevel.ERROR) keeps this a type-only import, so test mocks
    // of @notionhq/client need not also export the LogLevel enum.
    this.client = new Client({ auth: opts.token, logLevel: "error" as LogLevel });
    this.limiter = new Bottleneck({
      minTime: opts.minTime ?? 150,
      maxConcurrent: opts.maxConcurrent ?? 4,
      reservoir: opts.reservoir ?? null,
    });
    this.maxRetries = opts.maxRetries ?? 8;
    this.log = opts.log;
  }

  async run<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return this.limiter.schedule(() => this.attempt(fn, 0));
  }

  private async attempt<T>(fn: (c: Client) => Promise<T>, attempt: number): Promise<T> {
    for (let i = attempt; i <= this.maxRetries; i++) {
      try {
        return await fn(this.client);
      } catch (err) {
        if (!isRetryableError(err) || i >= this.maxRetries) throw err;
        const retryAfter = getRetryAfterMs(err);
        const backoff = retryAfter ?? Math.min(30_000, 500 * 2 ** i);
        this.log?.warn({ attempt: i + 1, backoffMs: backoff }, "notion request failed, retrying");
        await sleep(backoff);
      }
    }
    throw new Error("unreachable");
  }
}

/** Shape `paginate` consumes from every Notion list/query endpoint. */
export interface PaginatedList<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Narrow a loosely-typed Notion list/query response to {@link PaginatedList}.
 *
 * The v5 SDK types its list responses as broad unions that don't structurally
 * match the concrete `{ results, next_cursor, has_more }` shape we read, so
 * call sites used to reach for `as unknown as { results: … }`. This is the one
 * place that cast lives: it narrows `unknown` and degrades a malformed page to
 * an empty, terminal result rather than letting a bad shape crash mid-walk.
 */
export function asPaginatedList<T>(res: unknown): PaginatedList<T> {
  const r = res as Partial<PaginatedList<T>> | null | undefined;
  return {
    results: Array.isArray(r?.results) ? (r.results as T[]) : [],
    next_cursor: typeof r?.next_cursor === "string" ? r.next_cursor : null,
    has_more: r?.has_more === true,
  };
}

export async function paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<PaginatedList<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const r of page.results) all.push(r);
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return all;
}
