import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyRetention } from "../src/export/retention.js";
import { createLogger } from "../src/logger.js";

describe("retention", () => {
  it("keeps only N newest stamped dirs", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-ret-"));
    const stamps = [
      "2026-01-01T00-00-00Z",
      "2026-02-01T00-00-00Z",
      "2026-03-01T00-00-00Z",
      "2026-04-01T00-00-00Z",
    ];
    for (const s of stamps) await fsp.mkdir(path.join(tmp, s));
    await fsp.mkdir(path.join(tmp, "not-a-stamp"));

    const log = createLogger("error");
    const deleted = await applyRetention(tmp, 2, log);
    expect(deleted.sort()).toEqual(stamps.slice(0, 2).sort());

    const left = await fsp.readdir(tmp);
    expect(left.sort()).toEqual(
      ["2026-03-01T00-00-00Z", "2026-04-01T00-00-00Z", "not-a-stamp"].sort(),
    );
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("no-op when keep=0", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-ret0-"));
    await fsp.mkdir(path.join(tmp, "2026-01-01T00-00-00Z"));
    const deleted = await applyRetention(tmp, 0, createLogger("error"));
    expect(deleted).toEqual([]);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("no-op when fewer dirs than keep", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-retn-"));
    await fsp.mkdir(path.join(tmp, "2026-01-01T00-00-00Z"));
    const deleted = await applyRetention(tmp, 5, createLogger("error"));
    expect(deleted).toEqual([]);
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
