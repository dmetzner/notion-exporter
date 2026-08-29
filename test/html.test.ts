import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetPrefix,
  indexPrefix,
  injectSidebars,
  renderHtml,
  type SitemapEntry,
  writeSitemap,
  writeStylesheet,
} from "../src/export/html.js";

describe("html", () => {
  it("renders markdown to html with escape + correct asset + index paths", () => {
    const html = renderHtml("Hi & Bye", "# Hello\n\n![x](assets/a.png)", {
      assetPrefix: "../",
      indexPrefix: "",
    });
    expect(html).toContain("<title>Hi &amp; Bye</title>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('src="../assets/a.png"');
    expect(html).toContain('href="index.html"');
    expect(html).toContain('<link rel="stylesheet" href="style.css">');
  });

  it("computes asset vs index prefix per subdir depth", () => {
    expect(assetPrefix("")).toBe("../");
    expect(indexPrefix("")).toBe("");
    expect(assetPrefix("sub")).toBe("../../");
    expect(indexPrefix("sub")).toBe("../");
    expect(assetPrefix("sub/deep")).toBe("../../../");
    expect(indexPrefix("sub/deep")).toBe("../../");
  });

  it("renders nested page with correct index link", () => {
    const html = renderHtml("Nested", "hi", {
      assetPrefix: assetPrefix("sub"),
      indexPrefix: indexPrefix("sub"),
    });
    expect(html).toContain('href="../index.html"');
    expect(html).toContain('href="../style.css"');
  });

  it("writeStylesheet creates style.css next to index", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-css-"));
    const abs = await writeStylesheet(tmp);
    expect(abs).toBe(path.join(tmp, "style.css"));
    const content = await fsp.readFile(abs, "utf8");
    expect(content).toContain("--accent");
    expect(content).toContain("ul.tree");
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  // v7-iter-14 (MED): the empty-DB variant rules (placeholder + named) must
  // out-specify the parent `section.inline-db` block so their dashed border /
  // transparent background / tightened margin actually take effect. A bare
  // `.inline-db-empty-*` selector has (0,1,0) specificity and loses to
  // `section.inline-db` (0,1,1) — `section.inline-db.inline-db-empty-*` lifts
  // to (0,2,1) and wins. Lock the qualified form so a future refactor that
  // drops the `section.inline-db` prefix is caught here.
  it("empty-DB variant selectors out-specify the parent section.inline-db rule", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-css-specificity-"));
    const abs = await writeStylesheet(tmp);
    const content = await fsp.readFile(abs, "utf8");
    expect(content).toContain("section.inline-db.inline-db-empty-placeholder");
    expect(content).toContain("section.inline-db.inline-db-empty-named");
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("writes sitemap as a tree with parent → child nesting", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-html-"));
    const abs = await writeSitemap(
      tmp,
      [
        { id: "1", title: "Root", href: "Root.html", kind: "page" },
        { id: "2", title: "Child", href: "Root/Child.html", kind: "page", parentId: "1" },
        { id: "3", title: "DB", href: "DB.html", kind: "database" },
      ],
      "2026-05-29T14:00:00Z",
    );
    const content = await fsp.readFile(abs, "utf8");
    expect(content).toMatch(/<dt>Pages<\/dt><dd>2<\/dd>/);
    expect(content).toMatch(/<dt>Databases<\/dt><dd>1<\/dd>/);
    expect(content).toContain("Root");
    expect(content).toContain("Child");
    expect(content).toContain("Your Notion archive");
    expect(content).toContain("notion-exporter");
    expect(content).toContain('class="tree"');
    expect(content).toContain("branch-toggle");
    expect(content).toContain('class="caret"');
    // Root appears before Child in DOM order (parent → child)
    expect(content.indexOf("Root.html")).toBeLessThan(content.indexOf("Root/Child.html"));
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("nests sidebar tree as <ul><li><ul>… not <ul><ul>… (v3 H2)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-html-nest-"));
    const abs = await writeSitemap(
      tmp,
      [
        { id: "root", title: "Root", href: "Root.html", kind: "page" },
        { id: "child", title: "Child", href: "Child.html", kind: "page", parentId: "root" },
        { id: "grand", title: "Grand", href: "Grand.html", kind: "page", parentId: "child" },
      ],
      "2026-05-29T14:00:00Z",
    );
    const content = await fsp.readFile(abs, "utf8");
    // Both `tree` and `children` lists must be present.
    expect(content).toContain('<ul class="tree">');
    expect(content).toContain('<ul class="children">');
    // A `<ul>` may not directly contain another `<ul>` (HTML5 content model:
    // nested <ul> must live inside an <li>). Pre-fix this regex matched the
    // emitted markup; after the fix it must NOT match.
    expect(content).not.toMatch(/<ul[^>]*>\s*<ul/);
    // The valid shape: `<ul class="children">` is preceded by `</span>`
    // (closing the row inside its <li>) — i.e. it lives inside an <li>.
    expect(content).toMatch(/<\/span><ul class="children">/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("injectSidebars produces <ul><li><ul>… nesting in injected sidebars (v3 H2)", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-html-nest-sb-"));
    const entries: SitemapEntry[] = [
      { id: "root", title: "Root", href: "Root.html", kind: "page" },
      { id: "child", title: "Child", href: "Child.html", kind: "page", parentId: "root" },
      { id: "grand", title: "Grand", href: "Grand.html", kind: "page", parentId: "child" },
    ];
    for (const e of entries) {
      await fsp.writeFile(
        path.join(tmp, e.href),
        `<html><body><nav><!--NE_SIDEBAR--></nav></body></html>`,
      );
    }
    await injectSidebars(tmp, entries);
    const grandHtml = await fsp.readFile(path.join(tmp, "Grand.html"), "utf8");
    // No <ul> may directly contain another <ul>: nested lists must live in <li>.
    expect(grandHtml).not.toMatch(/<ul[^>]*>\s*<ul/);
    expect(grandHtml).toMatch(/<\/span><ul class="children">/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("injectSidebars marks the active link and pre-expands ancestor toggles", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-inject-"));
    const entries: SitemapEntry[] = [
      { id: "root", title: "Root", href: "Root.html", kind: "page" },
      { id: "child", title: "Child", href: "Child.html", kind: "page", parentId: "root" },
      { id: "grand", title: "Grand", href: "Grand.html", kind: "page", parentId: "child" },
      { id: "sib", title: "Sib", href: "Sib.html", kind: "page", parentId: "root" },
    ];
    for (const e of entries) {
      await fsp.writeFile(
        path.join(tmp, e.href),
        `<html><body><nav><!--NE_SIDEBAR--></nav></body></html>`,
      );
    }
    await injectSidebars(tmp, entries);
    const grandHtml = await fsp.readFile(path.join(tmp, "Grand.html"), "utf8");
    // Active page link has both markers.
    expect(grandHtml).toMatch(
      /<a href="Grand\.html" class="active" aria-current="page" data-id="grand"/,
    );
    // Ancestor branches (root, child) are pre-expanded; sibling stays collapsed.
    expect(grandHtml).toMatch(/id="sb-root" data-id="root" type="checkbox" hidden checked>/);
    expect(grandHtml).toMatch(/id="sb-child" data-id="child" type="checkbox" hidden checked>/);
    // Sib has no children so renders as a leaf without a toggle — confirm
    // it isn't accidentally marked active.
    expect(grandHtml).not.toMatch(/data-id="sib"[^>]*class="active"/);
    expect(grandHtml).not.toMatch(/<a [^>]*data-id="sib"[^>]*aria-current/);

    // On Sib's own page, only Root's branch is open and Sib is active.
    const sibHtml = await fsp.readFile(path.join(tmp, "Sib.html"), "utf8");
    expect(sibHtml).toMatch(/id="sb-root" data-id="root" type="checkbox" hidden checked>/);
    expect(sibHtml).toMatch(/id="sb-child" data-id="child" type="checkbox" hidden(?! checked)>/);
    expect(sibHtml).toMatch(/<a href="Sib\.html" class="active" aria-current="page" data-id="sib"/);

    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("injectSidebars stays linear on a 500-entry sitemap", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-inject-perf-"));
    // Synthetic tree: 10 top-level "section" branches, each with 49 child
    // pages, for 500 entries total. Wide-and-shallow stresses the old
    // O(N²) `containsId` walk the most.
    const entries: SitemapEntry[] = [];
    for (let s = 0; s < 10; s++) {
      const sid = `sec-${s}`;
      entries.push({ id: sid, title: `Section ${s}`, href: `${sid}.html`, kind: "page" });
      for (let c = 0; c < 49; c++) {
        const cid = `pg-${s}-${c}`;
        entries.push({
          id: cid,
          title: `Page ${s}.${c}`,
          href: `${cid}.html`,
          kind: "page",
          parentId: sid,
        });
      }
    }
    expect(entries.length).toBe(500);
    for (const e of entries) {
      await fsp.writeFile(
        path.join(tmp, e.href),
        `<html><body><nav><!--NE_SIDEBAR--></nav></body></html>`,
      );
    }
    const t0 = Date.now();
    await injectSidebars(tmp, entries);
    const elapsed = Date.now() - t0;
    // Generous bound — locally completes in well under 1s. The old O(N³)
    // path would push past 5s on the same tree.
    expect(elapsed).toBeLessThan(5000);
    // Sanity: at least one file was rewritten correctly.
    const sample = await fsp.readFile(path.join(tmp, "pg-3-7.html"), "utf8");
    expect(sample).toContain('data-id="pg-3-7"');
    expect(sample).toContain('class="active"');
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('rewrites PDF <object data="assets/…"> with the assetPrefix at depth', () => {
    // PDF embeds use `<object data=…>`, so the html-rewrite regex must
    // match `data=` (not just `src|href`) — otherwise PDFs on nested pages
    // 404. Markdown is passed through marked, so emit raw HTML so the body
    // contains the literal `<object data="assets/foo.pdf">` token.
    const md =
      '<figure class="pdf-preview"><object type="application/pdf" data="assets/foo.pdf"></object></figure>';
    const html = renderHtml("PDF", md, {
      assetPrefix: assetPrefix("sub/deep"), // depth 2 → ../../../
      indexPrefix: indexPrefix("sub/deep"),
    });
    expect(html).toContain('data="../../../assets/foo.pdf"');
    expect(html).not.toContain('data="assets/foo.pdf"');
  });

  it("asset-prefix rewrite is tag-boundary anchored — does NOT rewrite `metadata=`", () => {
    // Without a boundary anchor, the body-replace regex
    // `(src|href|data)="assets/…"` would partial-match `metadata="assets/foo"`
    // and corrupt the attribute. The lookbehind `(?<=[\s<])` ensures only
    // genuine attributes get rewritten.
    const md =
      '<div itemscope itemtype="x" metadata="assets/keep.txt"><object type="application/pdf" data="assets/foo.pdf"></object></div>';
    const html = renderHtml("Anchored", md, {
      assetPrefix: assetPrefix("deep"),
      indexPrefix: indexPrefix("deep"),
    });
    // The genuine `data="assets/…"` attribute IS rewritten.
    expect(html).toContain('data="../../assets/foo.pdf"');
    // The `metadata="assets/keep.txt"` attribute is NOT corrupted — its value
    // stays intact and is not prefixed.
    expect(html).toContain('metadata="assets/keep.txt"');
  });

  it("escapes operator-controlled EXPORT_ICON in sidebar img and SVG favicon", () => {
    // Simulates EXPORT_ICON="x" onerror="alert(1)" reaching the renderer
    // both as a URL-looking string (renderArchiveIcon → <img src=…>) and as
    // an emoji glyph (renderFavicon → inline SVG data: URI).
    const malicious = 'https://example.com/x.png" onerror="alert(1)';
    const html = renderHtml("t", "hi", {
      assetPrefix: "../",
      indexPrefix: "",
      archiveIcon: malicious,
      favicon: { kind: "emoji", value: "<script>alert(1)</script>" },
    });
    // Neither raw attribute breakout nor the script tag survives unescaped.
    expect(html).not.toMatch(/onerror="alert/);
    expect(html).not.toContain("<script>alert(1)</script>");
    // The escaped form is still present somewhere (sanity: the value did get rendered).
    expect(html).toContain("&quot;");
  });

  it("escapes EXPORT_ICON when used as sitemap hero image src", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-html-icon-"));
    const abs = await writeSitemap(
      tmp,
      [{ id: "1", title: "X", href: "X.html", kind: "page" }],
      "2026-05-29T14:00:00Z",
      { archiveIcon: 'https://example.com/x.png" onerror="alert(1)' },
    );
    const content = await fsp.readFile(abs, "utf8");
    expect(content).not.toMatch(/onerror="alert/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("sitemap includes search wiring when searchIndexPath given", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ne-html-search-"));
    const abs = await writeSitemap(
      tmp,
      [{ id: "1", title: "X", href: "X.html", kind: "page" }],
      "t",
      { searchIndexPath: path.join(tmp, "search-index.json") },
    );
    const content = await fsp.readFile(abs, "utf8");
    expect(content).toContain('id="ne-search"');
    expect(content).toContain("lunr.min.js");
    expect(content).toContain("search.js");
    expect(content).toContain("search-index.js");
    // Search input must not autofocus (scrolls past hero on load).
    expect(content).not.toMatch(/<input[^>]*\bautofocus\b/);
    await fsp.rm(tmp, { recursive: true, force: true });
  });
});
