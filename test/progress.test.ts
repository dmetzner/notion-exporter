import { describe, expect, it } from "vitest";
import { createTtyRenderer } from "../src/progress.js";

function fakeStream(): NodeJS.WriteStream & { buf: string } {
  const buf = { v: "" };
  const stream = {
    isTTY: true,
    write(s: string) {
      buf.v += s;
      return true;
    },
    get buf() {
      return buf.v;
    },
  };
  return stream as unknown as NodeJS.WriteStream & { buf: string };
}

describe("progress renderer", () => {
  it("renders bar + counts + ETA in TTY mode", () => {
    const out = fakeStream();
    let t = 0;
    const r = createTtyRenderer({ out, enabled: true, now: () => t });
    r.handle({ kind: "start", total: 4, pages: 3, databases: 1 });
    t += 1000;
    r.handle({ kind: "page", done: 1, total: 4, title: "Hello" });
    t += 1000;
    r.handle({ kind: "page", done: 2, total: 4, title: "World" });
    r.bumpAsset();
    r.handle({ kind: "done", counts: { pages: 3, databases: 1, errors: 0 } });

    expect(out.buf).toContain("crawled 4");
    expect(out.buf).toContain("1/4");
    expect(out.buf).toContain("2/4");
    expect(out.buf).toContain("ETA");
    expect(out.buf).toContain("assets:1");
    expect(out.buf).toContain("✓ done");
    expect(out.buf).toContain("pages:3");
  });

  it("emits nothing when disabled", () => {
    const out = fakeStream();
    const r = createTtyRenderer({ out, enabled: false });
    r.handle({ kind: "start", total: 1, pages: 1, databases: 0 });
    r.handle({ kind: "page", done: 1, total: 1, title: "X" });
    r.handle({ kind: "done", counts: { pages: 1, databases: 0, errors: 0 } });
    expect(out.buf).toBe("");
  });

  it("prints error line and continues", () => {
    const out = fakeStream();
    const r = createTtyRenderer({ out, enabled: true, now: () => 0 });
    r.handle({ kind: "start", total: 2, pages: 2, databases: 0 });
    r.handle({ kind: "error", done: 1, total: 2, id: "p1", message: "boom" });
    r.handle({ kind: "page", done: 2, total: 2, title: "ok" });
    expect(out.buf).toContain("⚠ p1 — boom");
    expect(out.buf).toContain("errs:1");
  });
});
