import { describe, expect, it } from "vitest";
import { extractIcon, extractIconUrlForDownload } from "../src/notion/meta.js";

// `extractIcon` must return null when a file-type icon hasn't
// been localized yet. The remote Notion S3 URL carries `X-Amz-Signature`
// and expires after ~1h; leaking it into the page-icon `<img src>` ships
// a credentialed URL into static HTML. Mirrors `rebuildIconMeta`. The
// download path uses the dedicated `extractIconUrlForDownload` extractor.

describe("extractIcon", () => {
  it("returns null when file icon lacks local_path", () => {
    const page = {
      icon: {
        type: "file",
        file: { url: "https://prod-files-secure.s3.amazonaws.com/x?X-Amz-Signature=y" },
      },
    };
    expect(extractIcon(page)).toBeNull();
  });

  it("returns the local_path when present", () => {
    const page = {
      icon: {
        type: "file",
        file: { url: "https://x", local_path: "assets/abc.png" },
      },
    };
    expect(extractIcon(page)).toEqual({ kind: "file", value: "assets/abc.png" });
  });

  it("returns emoji icons unchanged", () => {
    expect(extractIcon({ icon: { type: "emoji", emoji: "📚" } })).toEqual({
      kind: "emoji",
      value: "📚",
    });
  });

  it("returns external icons (URL is the canonical address)", () => {
    expect(
      extractIcon({ icon: { type: "external", external: { url: "https://cdn/x.png" } } }),
    ).toEqual({ kind: "external", value: "https://cdn/x.png" });
  });
});

describe("extractIconUrlForDownload", () => {
  it("returns the remote URL for file icons (download side needs it)", () => {
    expect(
      extractIconUrlForDownload({
        icon: { type: "file", file: { url: "https://x.s3/y?sig=z" } },
      }),
    ).toBe("https://x.s3/y?sig=z");
  });

  it("returns the URL for external icons", () => {
    expect(
      extractIconUrlForDownload({ icon: { type: "external", external: { url: "https://e/x" } } }),
    ).toBe("https://e/x");
  });

  it("returns null for emoji icons", () => {
    expect(extractIconUrlForDownload({ icon: { type: "emoji", emoji: "📚" } })).toBeNull();
  });

  it("returns null when icon is missing", () => {
    expect(extractIconUrlForDownload({})).toBeNull();
    expect(extractIconUrlForDownload(null)).toBeNull();
  });
});
