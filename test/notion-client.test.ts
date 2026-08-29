import { describe, expect, it } from "vitest";
import {
  isRateLimitError,
  isRetryableError,
  paginate,
  RateLimitedNotion,
} from "../src/notion/client.js";

describe("notion client helpers", () => {
  it("detects 429 as rate limit", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ code: "rate_limited" })).toBe(true);
    expect(isRateLimitError({ status: 400 })).toBe(false);
  });

  it("treats 5xx as retryable", () => {
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 404 })).toBe(false);
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it("paginate follows has_more cursor until exhausted", async () => {
    const pages = [
      { results: [1, 2], has_more: true, next_cursor: "a" },
      { results: [3], has_more: true, next_cursor: "b" },
      { results: [4, 5], has_more: false, next_cursor: null },
    ];
    let i = 0;
    const all = await paginate<number>(async () => pages[i++]!);
    expect(all).toEqual([1, 2, 3, 4, 5]);
  });

  it("retries 429 then succeeds", async () => {
    const notion = new RateLimitedNotion({ token: "t", minTime: 1, maxRetries: 3 });
    let calls = 0;
    const result = await notion.run(async () => {
      calls++;
      if (calls < 2) {
        const err: { status: number; headers: Record<string, string> } = {
          status: 429,
          headers: { "retry-after": "0" },
        };
        throw err;
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after maxRetries", async () => {
    const notion = new RateLimitedNotion({ token: "t", minTime: 1, maxRetries: 2 });
    await expect(
      notion.run(async () => {
        throw { status: 500 };
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
