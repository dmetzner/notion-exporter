import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("version", () => {
  it("matches package.json", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await fsp.readFile(path.join(here, "..", "package.json"), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
