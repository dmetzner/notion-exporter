import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("CLI", () => {
  it("exposes name + version", () => {
    const p = buildProgram();
    expect(p.name()).toBe("notion-exporter");
    expect(p.version()).toBe("0.1.0");
  });

  it("registers check and export commands", () => {
    const p = buildProgram();
    const names = p.commands.map((c) => c.name());
    expect(names).toContain("check");
    expect(names).toContain("export");
  });

  it("export command has --dry-run, --out, --retention, --no-progress", () => {
    const p = buildProgram();
    const exp = p.commands.find((c) => c.name() === "export")!;
    const flags = exp.options.map((o) => o.long);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--dry-run",
        "--out",
        "--retention",
        "--no-incremental",
        "--no-resume",
        "--force",
        "--no-progress",
      ]),
    );
  });
});
