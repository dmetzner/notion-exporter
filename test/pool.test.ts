import { describe, expect, it } from "vitest";
import { createPool } from "../src/util/pool.js";

describe("pool", () => {
  it("respects concurrency limit", async () => {
    const pool = createPool(3);
    let inFlight = 0;
    let peak = 0;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const tasks = Array.from({ length: 10 }, () =>
      pool.run(async () => {
        inFlight++;
        if (inFlight > peak) peak = inFlight;
        await wait(20);
        inFlight--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates errors and releases slot", async () => {
    const pool = createPool(1);
    await expect(
      pool.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // slot must be released — next task must run
    const ok = await pool.run(async () => "ok");
    expect(ok).toBe("ok");
  });

  it("processes all in order at concurrency 1", async () => {
    const pool = createPool(1);
    const order: number[] = [];
    await Promise.all([
      pool.run(async () => order.push(1)),
      pool.run(async () => order.push(2)),
      pool.run(async () => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});
