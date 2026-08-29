import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MANIFEST_SCHEMA_VERSION, readManifest, writeManifest } from "../src/export/manifest.js";

describe("manifest", () => {
  it("hashes entries + counts", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-man-"));
    const f1 = path.join(tmp, "raw", "pages", "a.json");
    await fsp.mkdir(path.dirname(f1), { recursive: true });
    await fsp.writeFile(f1, JSON.stringify({ a: 1 }));
    const f2 = path.join(tmp, "raw", "databases", "b.json");
    await fsp.mkdir(path.dirname(f2), { recursive: true });
    await fsp.writeFile(f2, JSON.stringify({ b: 1 }));

    const m = await writeManifest({
      exportRoot: tmp,
      manifestPath: path.join(tmp, "manifest.json"),
      version: "0.1.0",
      timestamp: "2026-05-29T14:00:00Z",
      entries: [
        { id: "p1", kind: "page", title: "A", rawAbs: f1 },
        { id: "d1", kind: "database", title: "B", rawAbs: f2 },
      ],
      assets: [
        { originalUrl: "https://x", localPath: "assets/x.png", bytes: 3, sha256: "deadbeef" },
      ],
    });

    expect(m.counts).toEqual({ pages: 1, databases: 1, assets: 1 });
    expect(m.entries[0]!.sha256).toHaveLength(64);
    expect(m.tool).toEqual({ name: "notion-exporter", version: "0.1.0" });
    const onDisk = JSON.parse(await fsp.readFile(path.join(tmp, "manifest.json"), "utf8"));
    expect(onDisk.counts.pages).toBe(1);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  describe("schemaVersion", () => {
    it("writes + round-trips current schemaVersion (v2)", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-man-sv-"));
      const f1 = path.join(tmp, "raw", "pages", "a.json");
      await fsp.mkdir(path.dirname(f1), { recursive: true });
      await fsp.writeFile(f1, JSON.stringify({ a: 1 }));
      const manifestPath = path.join(tmp, "manifest.json");

      const written = await writeManifest({
        exportRoot: tmp,
        manifestPath,
        version: "0.1.0",
        timestamp: "2026-05-31T00:00:00Z",
        entries: [{ id: "p1", kind: "page", title: "A", rawAbs: f1 }],
        assets: [],
      });
      expect(written.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
      expect(written.schemaVersion).toBe(2);

      const onDisk = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
      expect(onDisk.schemaVersion).toBe(2);

      const read = await readManifest(manifestPath);
      expect(read?.schemaVersion).toBe(2);

      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("reads a v1 manifest (older schemaVersion) with a best-effort fallback log", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-man-v1-"));
      const manifestPath = path.join(tmp, "manifest.json");
      const v1 = {
        schemaVersion: 1,
        tool: { name: "notion-exporter", version: "0.0.1" },
        timestamp: "2026-05-30T00:00:00Z",
        counts: { pages: 0, databases: 0, assets: 0 },
        entries: [],
        assets: [],
      };
      await fsp.writeFile(manifestPath, JSON.stringify(v1));

      const infoCalls: unknown[] = [];
      const log = { info: (obj: unknown) => infoCalls.push(obj) };

      const read = await readManifest(manifestPath, { log });
      expect(read).not.toBeNull();
      expect(read?.schemaVersion).toBe(1);
      expect(infoCalls.length).toBe(1);

      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("reads a v0 manifest (no schemaVersion) without throwing and logs info", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-man-v0-"));
      const manifestPath = path.join(tmp, "manifest.json");
      // Synthesize a pre-versioning manifest.
      const v0 = {
        tool: { name: "notion-exporter", version: "0.0.1" },
        timestamp: "2026-05-30T00:00:00Z",
        counts: { pages: 0, databases: 0, assets: 0 },
        entries: [],
        assets: [],
      };
      await fsp.writeFile(manifestPath, JSON.stringify(v0));

      const infoCalls: unknown[] = [];
      const log = { info: (obj: unknown) => infoCalls.push(obj) };

      const read = await readManifest(manifestPath, { log });
      expect(read).not.toBeNull();
      expect(read?.schemaVersion).toBe(0);
      expect(read?.tool.version).toBe("0.0.1");
      expect(infoCalls.length).toBe(1);

      await fsp.rm(tmp, { recursive: true, force: true });
    });

    it("throws an upgrade error for newer schemaVersion", async () => {
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-man-vnew-"));
      const manifestPath = path.join(tmp, "manifest.json");
      const future = {
        schemaVersion: 999,
        tool: { name: "notion-exporter", version: "9.9.9" },
        timestamp: "2099-01-01T00:00:00Z",
        counts: { pages: 0, databases: 0, assets: 0 },
        entries: [],
        assets: [],
      };
      await fsp.writeFile(manifestPath, JSON.stringify(future));

      await expect(readManifest(manifestPath)).rejects.toThrow(
        /schemaVersion 999.*supports 2.*Upgrade notion-exporter/,
      );

      await fsp.rm(tmp, { recursive: true, force: true });
    });
  });
});
