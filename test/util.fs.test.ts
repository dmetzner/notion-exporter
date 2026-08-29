import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertWithinRoot,
  assertWithinRootAsync,
  readFileWithinRootAsync,
  readFileWithinRootAsyncWithPath,
} from "../src/util/fs.js";

describe("assertWithinRoot", () => {
  it("returns the resolved path for a simple relative candidate", () => {
    expect(assertWithinRoot("/a/b", "c/d")).toBe(path.resolve("/a/b", "c/d"));
  });

  it("allows a './'-prefixed relative path", () => {
    expect(assertWithinRoot("/a/b", "./safe")).toBe(path.resolve("/a/b", "safe"));
  });

  it("rejects parent-directory traversal", () => {
    expect(() => assertWithinRoot("/a/b", "../etc/passwd")).toThrow(/path traversal blocked/);
  });

  it("rejects an absolute candidate outside the root", () => {
    expect(() => assertWithinRoot("/a/b", "/etc/passwd")).toThrow(/path traversal blocked/);
  });

  it("rejects deeply nested traversal that escapes via .. segments", () => {
    expect(() => assertWithinRoot("/a/b", "c/../../d")).toThrow(/path traversal blocked/);
  });

  it("allows nested relative paths that stay inside the root", () => {
    expect(assertWithinRoot("/a/b", "c/d/../e")).toBe(path.resolve("/a/b", "c/e"));
  });
});

describe("assertWithinRootAsync", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    // Real temp dirs — the realpath gate is the whole point, so mocking fs
    // would hide the regression. macOS routes /tmp through /private/tmp, so
    // resolve `root`/`outside` themselves up-front to avoid spurious mismatches.
    const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "notion-fs-")));
    root = path.join(base, "root");
    outside = path.join(base, "outside");
    await fsp.mkdir(root, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    // Clean up both siblings — `path.dirname(root)` is the mkdtemp base.
    await fsp.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("rejects a symlink inside the root that points outside", async () => {
    const secret = path.join(outside, "secret.txt");
    await fsp.writeFile(secret, "top secret");
    const link = path.join(root, "escape.txt");
    await fsp.symlink(secret, link);

    await expect(assertWithinRootAsync(root, "escape.txt")).rejects.toThrow(
      /path traversal blocked \(symlink\)/,
    );
  });

  it("falls back to the lexical resolution for a not-yet-written path (ENOENT)", async () => {
    const out = await assertWithinRootAsync(root, "does/not/exist.json");
    // Lexical resolution joins under root — no realpath because target is absent.
    expect(out).toBe(path.resolve(root, "does/not/exist.json"));
  });

  it("returns the realpath for an existing in-root file", async () => {
    const file = path.join(root, "ok.txt");
    await fsp.writeFile(file, "ok");
    const out = await assertWithinRootAsync(root, "ok.txt");
    expect(out).toBe(await fsp.realpath(file));
  });

  it("re-throws lexical traversal attempts before touching the filesystem", async () => {
    await expect(assertWithinRootAsync(root, "../etc/passwd")).rejects.toThrow(
      /path traversal blocked/,
    );
  });
});

// The helper closes the realpath→reopen TOCTOU by opening once with
// O_NOFOLLOW and reading through the same fd.
describe("readFileWithinRootAsync", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "ne-fs-atomic-")));
    root = path.join(base, "root");
    outside = path.join(base, "outside");
    await fsp.mkdir(root, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("reads a regular in-root file via fd (no reopen by path)", async () => {
    const file = path.join(root, "ok.json");
    await fsp.writeFile(file, '{"hello":"world"}');
    const data = await readFileWithinRootAsync(root, "ok.json");
    expect(JSON.parse(data)).toEqual({ hello: "world" });
  });

  it("refuses a symlink-leaf via O_NOFOLLOW (the TOCTOU surface)", async () => {
    const secret = path.join(outside, "secret.txt");
    await fsp.writeFile(secret, "top secret");
    const link = path.join(root, "escape.json");
    await fsp.symlink(secret, link);

    await expect(readFileWithinRootAsync(root, "escape.json")).rejects.toThrow(
      /path traversal blocked \(symlink leaf\)/,
    );
  });

  it("rejects lexical traversal before opening anything", async () => {
    await expect(readFileWithinRootAsync(root, "../escape.json")).rejects.toThrow(
      /path traversal blocked/,
    );
  });

  it("readFileWithinRootAsyncWithPath returns the validated realpath for writeback", async () => {
    const file = path.join(root, "ok.json");
    await fsp.writeFile(file, "ok");
    const { path: p, data } = await readFileWithinRootAsyncWithPath(root, "ok.json");
    expect(data).toBe("ok");
    expect(p).toBe(await fsp.realpath(file));
  });
});
