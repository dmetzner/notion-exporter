import katex from "katex";
import { describe, expect, it, vi } from "vitest";
import type { ExportedDatabase, ExportedPage } from "../src/export/json.js";
import {
  collectPageMeta,
  databaseToMarkdown,
  pageToMarkdown,
  rt,
  safeLinkUrl,
} from "../src/export/markdown.js";
import type { NotionBlock } from "../src/notion/blocks.js";

function rtNode(text: string, annotations: Record<string, boolean> = {}) {
  return { plain_text: text, annotations };
}

describe("rt — Notion in-workspace href rewriting", () => {
  const id = "1234abcd5678ef901234abcd5678ef90";
  const uuid = "1234abcd-5678-ef90-1234-abcd5678ef90";
  const resolve = (x: string) =>
    x === uuid ? { href: "../Food.html", title: "Food", kind: "page" as const } : null;

  it("rewrites the /p/<id> short-link form to the local page", () => {
    // Regression: manual `↩️ Zurück` back-links use Notion's `/p/<id>` form,
    // which the original rewriter missed → href stayed `/p/...` → 404.
    const out = rt([{ plain_text: "Back", href: `/p/${id}`, annotations: {} }], resolve);
    expect(out).toContain("../Food.html");
    expect(out).not.toContain("/p/");
  });

  it("still rewrites bare /<id> and slug-<id> forms", () => {
    expect(rt([{ plain_text: "x", href: `/${id}`, annotations: {} }], resolve)).toContain(
      "../Food.html",
    );
    expect(
      rt([{ plain_text: "x", href: `/Some-Title-${id}`, annotations: {} }], resolve),
    ).toContain("../Food.html");
  });

  it("leaves the href untouched when the target isn't in the export", () => {
    const out = rt([{ plain_text: "x", href: `/p/${id}`, annotations: {} }], () => null);
    expect(out).toContain(`/p/${id}`);
  });
});

describe("markdown", () => {
  it("collectPageMeta gathers headings + child_page/database ids in one pass", () => {
    const blocks: NotionBlock[] = [
      { id: "h1", type: "heading_1", heading_1: { rich_text: [rtNode("Top")] } },
      {
        id: "toggle",
        type: "toggle",
        toggle: { rich_text: [rtNode("More")] },
        children: [
          { id: "h2", type: "heading_2", heading_2: { rich_text: [rtNode("Sub")] } },
          { id: "cp-a", type: "child_page", child_page: { title: "Sub Page" } },
        ],
      },
      { id: "cp-b", type: "child_page", child_page: { title: "Top Page" } },
      { id: "cd-1", type: "child_database", child_database: { title: "Things" } },
      // Heading repeated → exercises slug disambiguation.
      { id: "h3", type: "heading_1", heading_1: { rich_text: [rtNode("Top")] } },
    ];
    const meta = collectPageMeta(blocks, undefined);
    expect(meta.headings.map((h) => h.id)).toEqual(["top", "sub", "top-1"]);
    expect(meta.headings.map((h) => h.level)).toEqual([1, 2, 1]);
    expect([...meta.childPageIds].sort()).toEqual(["cp-a", "cp-b"]);
    expect([...meta.childDbIds]).toEqual(["cd-1"]);
  });

  it("converts headings + paragraph + lists", () => {
    const page: ExportedPage = {
      id: "p1",
      title: "My Page",
      page: {},
      blocks: [
        { id: "1", type: "heading_1", heading_1: { rich_text: [rtNode("Title")] } },
        {
          id: "2",
          type: "paragraph",
          paragraph: { rich_text: [rtNode("Hello "), rtNode("world", { bold: true })] },
        },
        { id: "3", type: "bulleted_list_item", bulleted_list_item: { rich_text: [rtNode("one")] } },
        { id: "4", type: "numbered_list_item", numbered_list_item: { rich_text: [rtNode("two")] } },
        { id: "5", type: "to_do", to_do: { rich_text: [rtNode("done")], checked: true } },
        { id: "6", type: "code", code: { rich_text: [rtNode("x=1")], language: "python" } },
        { id: "7", type: "divider", divider: {} },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("# My Page");
    expect(md).toContain('<h1 id="title">Title</h1>');
    expect(md).toContain("Hello <strong>world</strong>");
    expect(md).toContain("- one");
    expect(md).toContain("1. two");
    expect(md).toContain("- [x] done");
    expect(md).toContain("```python\nx=1\n```");
    expect(md).toContain("---");
  });

  it("uses local_path for images when set", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "img",
          type: "image",
          image: {
            type: "file",
            file: { url: "https://signed/expired" },
            local_path: "assets/abc.png",
            caption: [{ plain_text: "cap" }],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("![cap](assets/abc.png)");
    expect(md).not.toContain("expired");
  });

  it("renders child_page / child_database / link_to_page via resolveLink", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Parent",
      page: {},
      blocks: [
        { id: "child-id-1", type: "child_page", child_page: { title: "Sub Page" } },
        { id: "child-db-1", type: "child_database", child_database: { title: "Tasks DB" } },
        { id: "ltp", type: "link_to_page", link_to_page: { type: "page_id", page_id: "p-other" } },
      ],
    };
    const md = pageToMarkdown(page, {
      resolveLink: (id) => {
        if (id === "child-id-1") return { href: "Sub Page.md", title: "Sub Page", kind: "page" };
        if (id === "child-db-1")
          return { href: "Tasks DB.md", title: "Tasks DB", kind: "database" };
        if (id === "p-other") return { href: "../Other.md", title: "Other", kind: "page" };
        return null;
      },
    });
    expect(md).toContain('class="page-link" href="Sub%20Page.md"');
    expect(md).toContain("Sub Page</span>");
    expect(md).toContain('class="page-link" href="Tasks%20DB.md"');
    expect(md).toContain("Tasks DB</span>");
    expect(md).toContain('class="page-link" href="../Other.md"');
    expect(md).toContain("Other</span>");
  });

  it("flattens column_list to sequential blocks", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Cols",
      page: {},
      blocks: [
        {
          id: "cl",
          type: "column_list",
          column_list: {},
          children: [
            {
              id: "c1",
              type: "column",
              column: {},
              children: [
                {
                  id: "p1",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "Left side" }] },
                },
              ],
            },
            {
              id: "c2",
              type: "column",
              column: {},
              children: [
                {
                  id: "p2",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "Right side" }] },
                },
              ],
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("Left side");
    expect(md).toContain("Right side");
    expect(md).not.toContain("unsupported block: column");
  });

  it("renders a simple table with header row", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "t",
          type: "table",
          table: { table_width: 2, has_column_header: true },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "Name" }], [{ plain_text: "Status" }]],
              },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "A" }], [{ plain_text: "OK" }]],
              },
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("| Name | Status |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| A | OK |");
  });

  it("resolves page mentions via resolveLink", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", plain_text: "See " },
              {
                type: "mention",
                plain_text: "ignored",
                mention: { type: "page", page: { id: "target-id" } },
              },
            ],
          },
        },
      ],
    };
    const md = pageToMarkdown(page, {
      resolveLink: (id) =>
        id === "target-id" ? { href: "Target.md", title: "Target", kind: "page" } : null,
    });
    // B2: page mentions now emit `<a>` HTML directly (not `[title](href)`
    // markdown) so a `]` in the resolved title can't truncate downstream
    // `mdLinksToAnchors` regex round-trips.
    expect(md).toContain('See <a href="Target.md">Target</a>');
  });

  it("links a callout cover image to its sibling child_page (cover-card pattern)", () => {
    const calloutCard = (withChildPage: boolean): ExportedPage => ({
      id: "p",
      title: "Cards",
      page: {},
      blocks: [
        {
          id: "c1",
          type: "callout",
          callout: { rich_text: [], color: "default" },
          children: [
            {
              id: "img1",
              type: "image",
              image: { caption: [], type: "file", file: {}, local_path: "assets/x.png" },
            },
            ...(withChildPage
              ? [{ id: "cp1", type: "child_page", child_page: { title: "Sub" } }]
              : []),
          ],
        },
      ] as unknown as NotionBlock[],
    });
    const resolveLink = (id: string) =>
      id === "cp1" ? { href: "Sub.md", title: "Sub", kind: "page" as const } : null;

    const linked = pageToMarkdown(calloutCard(true), { resolveLink });
    expect(linked).toContain("[![](assets/x.png)](Sub.md)");

    // No child_page in the callout → cover stays a plain (unlinked) image.
    const plain = pageToMarkdown(calloutCard(false), { resolveLink });
    expect(plain).toContain("![](assets/x.png)");
    expect(plain).not.toContain("](Sub.md)");
  });

  it("DB row table resolves relation property to linked title", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: { properties: { Name: { type: "title" }, Related: { type: "relation" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Related: { type: "relation", relation: [{ id: "rel-1" }, { id: "rel-2" }] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db, {
      resolveLink: (id) =>
        id === "rel-1"
          ? { href: "A.md", title: "Alpha", kind: "page" }
          : id === "rel-2"
            ? { href: "B.md", title: "Beta", kind: "page" }
            : null,
    });
    // The renderer now produces an interactive inline-db section; relations
    // are still formatted as a comma-joined list of links inside a <td>.
    expect(md).toContain("Alpha");
    expect(md).toContain("Beta");
  });

  it("renders page property row above body", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Row",
      page: {},
      blocks: [{ id: "x", type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } }],
    };
    const md = pageToMarkdown(page, {
      properties: [
        { name: "Status", value: "Active" },
        { name: "Due", value: "2026-06-01" },
      ],
    });
    expect(md).toContain('<table class="page-props">');
    expect(md).toContain("<th>Status</th><td>Active</td>");
    expect(md).toContain("<th>Due</th><td>2026-06-01</td>");
    const propsIdx = md.indexOf("page-props");
    const bodyIdx = md.indexOf("body");
    expect(propsIdx).toBeLessThan(bodyIdx);
  });

  it("renders icon prefix, cover, breadcrumbs, footer", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Hello",
      page: {},
      blocks: [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } }],
    };
    const md = pageToMarkdown(page, {
      icon: { kind: "emoji", value: "📘" },
      coverSrc: "../assets/cover.jpg",
      breadcrumbs: [
        { href: "../root.md", title: "Root", kind: "page" },
        { href: "../sub.md", title: "Sub", kind: "page" },
      ],
      lastEditedTime: "2026-05-12T10:00:00Z",
      exportedAt: "2026-05-30T08:00:00Z",
      notionUrl: "https://notion.so/abc",
    });
    expect(md).toContain("# 📘 Hello");
    expect(md).toContain('<img src="../assets/cover.jpg"');
    expect(md).toContain('class="breadcrumbs"');
    expect(md).toContain("Root</a>");
    expect(md).toContain('href="../root.md"');
    expect(md).toContain("Last edited 2026-05-12");
    expect(md).toContain("Exported 2026-05-30");
    expect(md).toContain('href="https://notion.so/abc"');
    expect(md).toContain(">Open in Notion");
    // The "Open in Notion" footer link must carry rel="noopener" +
    // target="_blank" to mitigate tab-nabbing on the external Notion URL.
    expect(md).toMatch(
      /<a href="https:\/\/notion\.so\/abc" rel="noopener" target="_blank">Open in Notion/,
    );
  });

  it("renders image icon when icon is a URL", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Iconed",
      page: {},
      blocks: [],
    };
    const md = pageToMarkdown(page, {
      icon: { kind: "image", value: "../assets/icon.png" },
    });
    expect(md).toContain('<img class="page-icon" src="../assets/icon.png"');
  });

  it("ignores opts.children (we no longer emit a 'Children' section)", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Hub",
      page: {},
      blocks: [{ id: "x", type: "paragraph", paragraph: { rich_text: [] } }],
    };
    const md = pageToMarkdown(page, {
      children: [
        { href: "a.md", title: "Alpha", kind: "page" },
        { href: "b.md", title: "Beta DB", kind: "database" },
      ],
    });
    expect(md).not.toContain("## Children");
  });

  it("databaseToMarkdown renders a table with schema column order", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Done: { type: "checkbox" },
          Tags: { type: "multi_select" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Done: { type: "checkbox", checkbox: true },
            Tags: { type: "multi_select", multi_select: [{ name: "x" }, { name: "y" }] },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Done: { type: "checkbox", checkbox: false },
            Tags: { type: "multi_select", multi_select: [] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain("# DB");
    // New interactive view: row count + sortable headers + rows in <td>s.
    expect(md).toContain('class="inline-db-count">2 rows');
    expect(md).toContain("<th");
    expect(md).toContain(">Name<");
    expect(md).toContain(">Done<");
    expect(md).toContain(">Tags<");
    expect(md).toContain(">Row1<");
    expect(md).toContain(">Row2<");
  });

  it("databaseToMarkdown puts title column first", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Status: { type: "select" },
          Name: { type: "title" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Status: { type: "select", select: { name: "Active" } },
            Name: { type: "title", title: [{ plain_text: "Hello" }] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // Title column appears before status in the table head. The filter strip
    // may surface the Status label earlier in the document, so we anchor on
    // the `<th …>Name<` / `<th …>Status<` table-head emission.
    const nameIdx = md.indexOf('data-col-name="Name"');
    const statusIdx = md.indexOf('data-col-name="Status"');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThan(nameIdx);
  });

  it("inline DB table view wraps the title cell in <a> using rowHrefs (v3 H1)", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Has Inline DB",
      page: {},
      blocks: [{ id: "cdb-id", type: "child_database", child_database: { title: "Produkte" } }],
    };
    const childDatabases = new Map<string, import("../src/export/markdown.js").ChildDatabaseData>();
    childDatabases.set("cdb-id", {
      title: "Produkte",
      database: { properties: { Name: { type: "title" }, Note: { type: "rich_text" } } },
      rows: [
        {
          id: "row-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Royal Canin" }] },
            Note: { type: "rich_text", rich_text: [{ plain_text: "dry" }] },
          },
        },
        {
          id: "row-2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Frontline Combo" }] },
            Note: { type: "rich_text", rich_text: [{ plain_text: "" }] },
          },
        },
      ],
      rowHrefs: new Map([
        ["row-1", "Produkte/Royal%20Canin.row-1.md"],
        ["row-2", "Produkte/Frontline%20Combo.row-2.md"],
      ]),
    });
    const md = pageToMarkdown(page, { childDatabases });
    // Title cell carries a <td class="db-row-title-cell"> with an <a class="db-row-link">.
    expect(md).toContain('class="db-row-title-cell"');
    expect(md).toContain(
      '<a class="db-row-link" href="Produkte/Royal%20Canin.row-1.md">Royal Canin</a>',
    );
    expect(md).toContain(
      '<a class="db-row-link" href="Produkte/Frontline%20Combo.row-2.md">Frontline Combo</a>',
    );
    // Non-title cells must NOT get wrapped in db-row-link.
    expect(md).not.toMatch(/<td><a class="db-row-link"[^>]*>dry/);
  });

  it("inline DB table view leaves title cell unwrapped when no rowHref is known (v3 H1)", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Has Inline DB",
      page: {},
      blocks: [{ id: "cdb-id", type: "child_database", child_database: { title: "Loose" } }],
    };
    const childDatabases = new Map<string, import("../src/export/markdown.js").ChildDatabaseData>();
    childDatabases.set("cdb-id", {
      title: "Loose",
      database: { properties: { Name: { type: "title" } } },
      rows: [
        {
          id: "row-1",
          properties: { Name: { type: "title", title: [{ plain_text: "Inertbear" }] } },
        },
      ],
      // rowHrefs intentionally omitted
    });
    const md = pageToMarkdown(page, { childDatabases });
    expect(md).not.toContain("db-row-link");
    expect(md).toContain("Inertbear");
  });

  it("table block without column header emits no <thead> (v3 M2)", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "t",
          type: "table",
          table: { table_width: 2, has_column_header: false },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "A" }], [{ plain_text: "OK" }]],
              },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "B" }], [{ plain_text: "no" }]],
              },
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page);
    // Raw HTML <tbody> path — no <thead> tag must appear anywhere in the
    // emitted markup, and we must NOT emit a row of empty header cells.
    expect(md).not.toMatch(/<thead/);
    expect(md).toContain("<table");
    expect(md).toContain("<tbody>");
    expect(md).toContain("<td>A</td>");
    expect(md).toContain("<td>OK</td>");
    expect(md).toContain("<td>B</td>");
    expect(md).toContain("<td>no</td>");
    // The previous renderer emitted `|| | | | |` markdown which marked
    // turned into `<thead><tr><th></th>…</tr></thead>`. Guard against that
    // shape leaking back.
    expect(md).not.toMatch(/<th>\s*<\/th>/);
  });

  it("DB title cell with an href renders as <a>, not literal [text](url)", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "Produkte",
      database: { properties: { Name: { type: "title" }, Notes: { type: "rich_text" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: {
              type: "title",
              title: [
                {
                  type: "text",
                  plain_text: "Mjamjam Rind und Kürbis",
                  href: "https://example.com/mjamjam",
                  annotations: { bold: true },
                  text: {
                    content: "Mjamjam Rind und Kürbis",
                    link: { url: "https://example.com/mjamjam" },
                  },
                },
              ],
            },
            Notes: {
              type: "rich_text",
              rich_text: [
                {
                  type: "text",
                  plain_text: "see details",
                  href: "https://example.com/details",
                },
              ],
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // Anchor present, with proper styled inner content preserved.
    expect(md).toContain('<a href="https://example.com/mjamjam"');
    expect(md).toContain("<strong>Mjamjam Rind und Kürbis</strong>");
    expect(md).toContain('<a href="https://example.com/details">see details</a>');
    // No literal markdown link syntax should leak into the rendered HTML.
    expect(md).not.toMatch(/\]\(https:\/\/example\.com/);
    expect(md).not.toContain("[**Mjamjam");
  });

  describe("safeLinkUrl", () => {
    it("blocks javascript: scheme", () => {
      expect(safeLinkUrl("javascript:alert(1)")).toBe("#");
    });
    it("blocks vbscript: scheme", () => {
      expect(safeLinkUrl("vbscript:msgbox(1)")).toBe("#");
    });
    it("blocks data: scheme", () => {
      expect(safeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    });
    it("blocks file: scheme", () => {
      expect(safeLinkUrl("file:///etc/passwd")).toBe("#");
    });
    it("blocks percent-encoded javascript scheme (decoded form rejected)", () => {
      // `JAVA%53CRIPT:` decodes to `JAVASCRIPT:`. We don't percent-decode,
      // but the percent character makes the scheme invalid per RFC 3986,
      // so it must still be rejected.
      expect(safeLinkUrl("JAVA%53CRIPT:alert(1)")).toBe("#");
    });
    it("blocks entity-encoded javascript scheme", () => {
      // `java&#x73;cript:` → `javas:cript:` after our colon-entity decode is
      // not how this attack works; the real bypass is `javascript&#x3A;…`,
      // i.e. encoding the COLON. Verify both shapes are blocked.
      expect(safeLinkUrl("javascript&#x3A;alert(1)")).toBe("#");
      expect(safeLinkUrl("javascript&#58;alert(1)")).toBe("#");
      expect(safeLinkUrl("javascript&colon;alert(1)")).toBe("#");
      // The literal "java&#x73;cript:alert(1)" doesn't contain a real colon
      // bypass — its only `:` is after `cript`, so the scheme parses as
      // `java&#x73;cript` which fails the RFC 3986 charset check anyway.
      expect(safeLinkUrl("java&#x73;cript:alert(1)")).toBe("#");
    });
    it("keeps http(s) URLs", () => {
      expect(safeLinkUrl("http://example.com")).toBe("http://example.com");
      expect(safeLinkUrl("https://example.com/path?q=1#frag")).toBe(
        "https://example.com/path?q=1#frag",
      );
    });
    it("keeps mailto: URLs", () => {
      expect(safeLinkUrl("mailto:foo@bar")).toBe("mailto:foo@bar");
    });
    it("keeps tel: URLs", () => {
      expect(safeLinkUrl("tel:+1234")).toBe("tel:+1234");
    });
    it("keeps notion: URLs", () => {
      expect(safeLinkUrl("notion://page/abc")).toBe("notion://page/abc");
    });
    it("keeps anchor-only hrefs", () => {
      expect(safeLinkUrl("#anchor")).toBe("#anchor");
    });
    it("keeps relative hrefs", () => {
      expect(safeLinkUrl("./relative.html")).toBe("./relative.html");
      expect(safeLinkUrl("../up/rel.html")).toBe("../up/rel.html");
      expect(safeLinkUrl("/abs/path")).toBe("/abs/path");
      expect(safeLinkUrl("foo.html")).toBe("foo.html");
    });
    it("falls back to # for empty / nullish input", () => {
      expect(safeLinkUrl("")).toBe("#");
      expect(safeLinkUrl(undefined)).toBe("#");
      expect(safeLinkUrl(null)).toBe("#");
    });
  });

  it("rich_text javascript: href becomes #", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                plain_text: "click me",
                href: "javascript:alert(1)",
              },
            ],
          },
        },
      ],
    };
    const md = pageToMarkdown(page);
    expect(md).not.toContain("javascript:");
    expect(md).toContain("[click me](#)");
  });

  it("bookmark with dangerous url renders link target as #", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "bm",
          type: "bookmark",
          bookmark: { url: "vbscript:msgbox(1)" },
        },
      ],
    };
    const md = pageToMarkdown(page);
    // The visible label still shows the original URL (so the reader sees what
    // was there), but the anchor's href must be sanitized to `#`.
    expect(md).toContain('href="#"');
    expect(md).toContain("vbscript:msgbox(1)</span>");
    expect(md).not.toMatch(/href="vbscript:/);
  });

  it("renders audio + video blocks as inline players", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Media",
      page: {},
      blocks: [
        {
          id: "a",
          type: "audio",
          audio: {
            type: "file",
            file: { url: "https://signed/expired.mp3" },
            local_path: "assets/clip.mp3",
            caption: [{ plain_text: "intro" }],
          },
        },
        {
          id: "v",
          type: "video",
          video: {
            type: "external",
            external: { url: "https://example.com/demo.mp4" },
            caption: [],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<figure class="media audio">');
    expect(md).toContain('<audio controls preload="metadata" src="assets/clip.mp3"></audio>');
    expect(md).toContain("<figcaption>intro</figcaption>");
    expect(md).toContain('<figure class="media video">');
    expect(md).toContain(
      '<video controls preload="metadata" src="https://example.com/demo.mp4"></video>',
    );
    // No caption → no figcaption inside the video figure.
    expect(md).not.toContain(
      '<figure class="media video"><video controls preload="metadata" src="https://example.com/demo.mp4"></video><figcaption>',
    );
  });

  it("audio block with javascript: src is neutralized to #", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "a",
          type: "audio",
          audio: {
            type: "external",
            external: { url: "javascript:alert(1)" },
            caption: [],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<audio controls preload="metadata" src="#"></audio>');
    expect(md).not.toContain("javascript:");
  });

  it("video block with data: src is neutralized to #", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "v",
          type: "video",
          video: {
            type: "external",
            external: { url: "data:text/html,<script>alert(1)</script>" },
            caption: [],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<video controls preload="metadata" src="#"></video>');
    expect(md).not.toContain("data:text/html");
  });

  it("image block with javascript: src is neutralized to #", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "i",
          type: "image",
          image: {
            type: "external",
            external: { url: "javascript:alert(1)" },
            caption: [],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("](#)");
    expect(md).not.toContain("javascript:");
  });

  it("normal asset srcs pass through safeLinkUrl unchanged", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "i",
          type: "image",
          image: {
            type: "file",
            file: { url: "https://signed/expired.png" },
            local_path: "assets/abc.png",
            caption: [],
          },
        },
        {
          id: "a",
          type: "audio",
          audio: {
            type: "file",
            file: { url: "https://signed/expired.mp3" },
            local_path: "assets/clip.mp3",
            caption: [],
          },
        },
        {
          id: "v",
          type: "video",
          video: {
            type: "file",
            file: { url: "https://signed/expired.mp4" },
            local_path: "assets/clip.mp4",
            caption: [],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("](assets/abc.png)");
    expect(md).toContain('<audio controls preload="metadata" src="assets/clip.mp3"></audio>');
    expect(md).toContain('<video controls preload="metadata" src="assets/clip.mp4"></video>');
  });

  it("pdf with local asset renders as an <object> preview + fallback link", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "f",
          type: "pdf",
          pdf: {
            type: "file",
            file: { url: "https://example.com/foo.pdf" },
            local_path: "assets/foo.pdf",
            caption: [],
            name: "foo.pdf",
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<figure class="pdf-preview">');
    // F3: `<object type="application/pdf">` — browsers refuse to render
    // the embed when the response MIME doesn't match, dropping to the
    // nested `<a>` fallback.
    expect(md).toContain('<object type="application/pdf" data="assets/foo.pdf"');
    expect(md).toContain('title="foo.pdf"');
    expect(md).toContain('<a href="assets/foo.pdf">foo.pdf</a>');
    expect(md).not.toContain("<video");
    expect(md).not.toContain("<audio");
  });

  it("pdf with external URL (no local asset) renders fallback link only — no iframe", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "f",
          type: "pdf",
          pdf: {
            type: "external",
            external: { url: "https://example.com/remote.pdf" },
            caption: [],
            name: "remote.pdf",
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).not.toContain("<iframe");
    expect(md).not.toContain("pdf-preview");
    expect(md).toContain('<a href="https://example.com/remote.pdf">remote.pdf</a>');
  });

  it("pdf with javascript: external url emits neutralised fallback link, never an iframe", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "f",
          type: "pdf",
          pdf: {
            type: "external",
            external: { url: "javascript:alert(1)" },
            caption: [],
            name: "evil.pdf",
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).not.toContain("<iframe");
    expect(md).toMatch(/<a href="#"/);
    expect(md).not.toMatch(/javascript:/);
  });

  it("file block (non-pdf) still renders as a plain link", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "f",
          type: "file",
          file: {
            type: "file",
            file: { url: "https://example.com/notes.txt" },
            local_path: "assets/notes.txt",
            caption: [],
            name: "notes.txt",
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<a href="assets/notes.txt">notes.txt</a>');
    expect(md).not.toContain("<iframe");
    expect(md).not.toContain("pdf-preview");
  });

  it("column width_ratio is rounded to 4 decimals — no 16-digit float noise", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "cl",
          type: "column_list",
          column_list: {},
          children: [
            {
              id: "c1",
              type: "column",
              // Notion returns this exact float for an even-split column edit.
              column: { width_ratio: 0.5000000000000001 },
              children: [
                {
                  id: "p1",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "left" }] },
                },
              ],
            },
            {
              id: "c2",
              type: "column",
              column: { width_ratio: 0.3333333333333333 },
              children: [
                {
                  id: "p2",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "right" }] },
                },
              ],
            },
          ],
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('style="flex:0.5;"');
    expect(md).toContain('style="flex:0.3333;"');
    // No 16-digit floats anywhere in the rendered output.
    expect(md).not.toMatch(/flex:0\.\d{15,}/);
  });

  it("file/pdf block with javascript: external url has its href neutralized", () => {
    const page: ExportedPage = {
      page: {
        object: "page",
        id: "p1",
        properties: { title: { type: "title", title: [{ plain_text: "T", type: "text" }] } },
      } as never,
      blocks: [
        {
          id: "f1",
          type: "file",
          file: {
            type: "external",
            external: { url: "javascript:alert(1)" },
            caption: [],
            name: "evil",
          },
        } as unknown as NotionBlock,
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    // The href must NOT carry the javascript: scheme — it should be neutralized to `#`.
    expect(md).toMatch(/<a href="#"/);
    expect(md).not.toMatch(/<a href="javascript:/);
  });

  it("renders equation blocks with KaTeX", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Math",
      page: {},
      blocks: [
        {
          id: "eq",
          type: "equation",
          equation: { expression: "\\sum_{i=1}^n i" },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<div class="katex-block">');
    // KaTeX output is wrapped in spans with class "katex".
    expect(md).toMatch(/class="katex/);
    expect(md).not.toContain("$$\\sum");
  });

  it("renders inline equation rich_text with KaTeX", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Math",
      page: {},
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", plain_text: "Cost: " },
              { type: "equation", plain_text: "x^2", equation: { expression: "x^2" } },
            ],
          },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<span class="katex-inline">');
    expect(md).toMatch(/class="katex/);
  });

  it("renders YouTube embed as a no-cookie iframe", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "e",
          type: "embed",
          embed: { url: "https://www.youtube.com/watch?v=abc123" },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<figure class="embed video-embed">');
    expect(md).toContain("youtube-nocookie.com/embed/abc123");
    expect(md).toContain('loading="lazy"');
    expect(md).toContain('referrerpolicy="no-referrer"');
    expect(md).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"',
    );
    expect(md).toContain('allow="autoplay; encrypted-media; picture-in-picture; fullscreen"');
  });

  it("sandboxes Vimeo and Loom iframes", () => {
    const vimeoPage: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [{ id: "e", type: "embed", embed: { url: "https://vimeo.com/123456789" } }],
      rawPath: "",
    };
    const loomPage: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "e",
          type: "embed",
          embed: { url: "https://www.loom.com/share/abcdef0123456789abcdef0123456789" },
        },
      ],
      rawPath: "",
    };
    for (const md of [pageToMarkdown(vimeoPage), pageToMarkdown(loomPage)]) {
      expect(md).toContain(
        'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"',
      );
      expect(md).toContain('allow="autoplay; encrypted-media; picture-in-picture; fullscreen"');
    }
  });

  it("renders youtu.be short link as YouTube iframe", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [{ id: "e", type: "embed", embed: { url: "https://youtu.be/xyz789" } }],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("youtube-nocookie.com/embed/xyz789");
  });

  it("renders generic bookmark as a link card", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "bm",
          type: "bookmark",
          bookmark: { url: "https://example.com/some/path", caption: [{ plain_text: "see docs" }] },
        },
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain('<figure class="link-card">');
    expect(md).toContain("example.com</span>");
    expect(md).toContain("https://example.com/some/path</span>");
    expect(md).toContain("see docs</span>");
    expect(md).toContain('rel="noopener"');
    expect(md).toContain('target="_blank"');
  });

  it("renders page-level comments section when comments are provided", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Discussed",
      page: {},
      blocks: [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } }],
    };
    const md = pageToMarkdown(page, {
      comments: [
        {
          id: "c1",
          created_time: "2026-05-20T08:30:00Z",
          created_by: { id: "u1", name: "Alice" },
          rich_text: [{ type: "text", plain_text: "First comment" }],
        },
        {
          id: "c2",
          created_time: "2026-05-21T14:00:00Z",
          created_by: { id: "u2", name: "Bob" },
          rich_text: [
            { type: "text", plain_text: "Line one\nLine two", annotations: { bold: true } },
          ],
        },
      ],
    });
    expect(md).toContain('<section class="page-comments">');
    expect(md).toContain('<h2 class="page-comments-title">Comments</h2>');
    expect(md).toContain('<ul class="comments">');
    expect(md).toContain('class="comment-author">Alice<');
    expect(md).toContain('class="comment-author">Bob<');
    expect(md).toContain("2026-05-20");
    expect(md).toContain("2026-05-21");
    expect(md).toContain("First comment");
    // Bold + newline handling: rt() converts `\n` to `<br>` inside styled runs.
    expect(md).toContain("<strong>Line one</strong><br><strong>Line two</strong>");
    // Section should sit AFTER the body but BEFORE the footer (when present).
    const bodyIdx = md.indexOf("body");
    const commentsIdx = md.indexOf("page-comments");
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(commentsIdx).toBeGreaterThan(bodyIdx);
  });

  it("escapes HTML in comment author names", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [],
    };
    const md = pageToMarkdown(page, {
      comments: [
        {
          id: "c1",
          created_by: { name: "<script>alert(1)</script>" },
          rich_text: [{ type: "text", plain_text: "hi" }],
        },
      ],
    });
    expect(md).toContain('class="comment-author">&lt;script&gt;');
    expect(md).not.toContain("<script>alert(1)</script>");
  });

  it("omits the page-comments section when no comments are provided", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Quiet",
      page: {},
      blocks: [{ id: "b", type: "paragraph", paragraph: { rich_text: [{ plain_text: "body" }] } }],
    };
    const mdEmpty = pageToMarkdown(page, { comments: [] });
    expect(mdEmpty).not.toContain("page-comments");
    const mdMissing = pageToMarkdown(page);
    expect(mdMissing).not.toContain("page-comments");
  });

  it("caches KaTeX renders so repeat expressions reuse the cached HTML", () => {
    // First render warms the cache; the next two renders (display + inline)
    // for the same expressions must reuse cached HTML and NOT call back into
    // `katex.renderToString`. Identical output is the contract — the cache
    // is a pure memoization layer.
    const page = (expr: string, inline: boolean): ExportedPage => ({
      id: "p",
      title: "Math",
      page: {},
      blocks: inline
        ? [
            {
              id: "p1",
              type: "paragraph",
              paragraph: {
                rich_text: [{ type: "equation", plain_text: expr, equation: { expression: expr } }],
              },
            },
          ]
        : [{ id: "eq", type: "equation", equation: { expression: expr } }],
      rawPath: "",
    });

    // Warm the cache.
    const first = pageToMarkdown(page("x^2", false));
    const firstInline = pageToMarkdown(page("x^2", true));

    const spy = vi.spyOn(katex, "renderToString");
    try {
      const second = pageToMarkdown(page("x^2", false));
      const secondInline = pageToMarkdown(page("x^2", true));
      expect(second).toBe(first);
      expect(secondInline).toBe(firstInline);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("inline code annotations emit raw <code> so apostrophes don't double-escape", () => {
    const page: ExportedPage = {
      page: {
        object: "page",
        id: "p",
        properties: { title: { type: "title", title: [{ plain_text: "T", type: "text" }] } },
      } as never,
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", plain_text: "It's ", annotations: {} },
              { type: "text", plain_text: "it's", annotations: { code: true } },
            ],
          },
        } as unknown as NotionBlock,
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("<code>it&#39;s</code>");
    expect(md).not.toContain("`it&#39;s`");
  });

  it("pdf with .html-named asset falls back to link, not <object> embed", () => {
    const page: ExportedPage = {
      page: {
        object: "page",
        id: "p",
        properties: { title: { type: "title", title: [{ plain_text: "T", type: "text" }] } },
      } as never,
      blocks: [
        {
          id: "p1",
          type: "pdf",
          pdf: {
            type: "external",
            external: { url: "https://example.com/foo.html" },
            local_path: "assets/abc123.html",
            caption: [],
          },
        } as unknown as NotionBlock,
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    expect(md).not.toMatch(/<object[^>]*data="assets\/abc123\.html"/);
    expect(md).not.toMatch(/<iframe[^>]*src="assets\/abc123\.html"/);
    expect(md).toMatch(/<a href="assets\/abc123\.html"/);
  });

  it("pdf <object> declares type=application/pdf so MIME mismatch falls back to <a> (F3)", () => {
    const page: ExportedPage = {
      page: {
        object: "page",
        id: "p",
        properties: { title: { type: "title", title: [{ plain_text: "T", type: "text" }] } },
      } as never,
      blocks: [
        {
          id: "p1",
          type: "pdf",
          pdf: {
            type: "file",
            file: { url: "https://signed/abc.pdf" },
            local_path: "assets/abc123.pdf",
            caption: [],
          },
        } as unknown as NotionBlock,
      ],
      rawPath: "",
    };
    const md = pageToMarkdown(page);
    // F3: switched from <iframe sandbox=...> to <object type=...>. The
    // MIME-type guarantee is the primary defense: browsers refuse to
    // render an <object> whose response Content-Type doesn't match the
    // declared `type`. The nested `<a>` shows up when the embed is
    // refused.
    expect(md).toMatch(/<object type="application\/pdf"[^>]*data="assets\/abc123\.pdf"/);
    expect(md).not.toContain("<iframe");
    // Nested fallback anchor inside the <object> body.
    expect(md).toMatch(/<object[^>]*>[^<]*<a href="assets\/abc123\.pdf"/);
  });

  // Zero-row Untitled inline DBs render as a muted placeholder card (not the
  // empty string) so column_list spacing is preserved and operators can see
  // that an empty lookup-table stub exists. Named empty DBs render as a
  // compact muted card (see below).
  it("renders a muted placeholder for zero-row Untitled inline DB (empty title)", () => {
    const db: ExportedDatabase = {
      id: "untitled-1",
      title: "",
      database: { properties: { Name: { type: "title" } } },
      rows: [],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain("inline-db-empty-placeholder");
    expect(md).toContain("inline-db-empty-placeholder-text");
    expect(md).toContain(">Empty<");
    // Layout placeholder doesn't carry the inline-db header chrome or the
    // "No rows." note — that's the whole point.
    expect(md).not.toContain("inline-db-head");
    expect(md).not.toContain("No rows.");
    // And the block id must NOT leak into the markup.
    expect(md).not.toContain("untitled-1");
  });

  // Named zero-row inline DBs render as a compact muted card (title +
  // "Empty"), aligning visually with the Untitled placeholder while keeping
  // the title visible. No filter strip, no "Open full view" link, no
  // "No rows." note — the chrome that the empty case never needed.
  it("named zero-row inline DB renders as a compact 'Empty' card", () => {
    const db: ExportedDatabase = {
      id: "inv-1",
      title: "Inventory",
      database: { properties: { Name: { type: "title" } } },
      rows: [],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain("inline-db-empty-named");
    expect(md).toContain("inline-db-empty-named-title");
    expect(md).toContain("Inventory");
    expect(md).toContain(">Empty<");
    // The verbose chrome is gone.
    expect(md).not.toContain("No rows.");
    expect(md).not.toContain("inline-db-head");
    expect(md).not.toContain("Open full view");
    // Different shape from the Untitled placeholder — the title would be lost
    // there.
    expect(md).not.toContain("inline-db-empty-placeholder");
  });

  it("one-row inline DB with an Untitled title is unaffected by the placeholder path", () => {
    const db: ExportedDatabase = {
      id: "untitled-2",
      title: "Untitled",
      database: { properties: { Name: { type: "title" } } },
      rows: [
        {
          id: "row-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "First row" }] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).not.toContain("inline-db-empty-placeholder");
    expect(md).toContain("First row");
  });

  it("omits filter input when a named inline DB has zero rows", () => {
    // Filter input on a 0-row table is a no-op. The entire chrome
    // collapses to a compact empty card, so `data-inline-db-filter` and
    // friends naturally drop off.
    const db: ExportedDatabase = {
      id: "d",
      title: "Named Empty DB",
      database: { properties: { Name: { type: "title" } } },
      rows: [],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain("Named Empty DB");
    expect(md).not.toContain("data-inline-db-filter");
    expect(md).not.toContain("inline-db-filter");
  });

  // ── kanban heuristic + render ───────────────────────────────────────────
  function makeKanbanDb(rowCount: number, statuses: string[]): ExportedDatabase {
    const rows = [];
    for (let i = 0; i < rowCount; i++) {
      const st = statuses[i % statuses.length];
      rows.push({
        id: `r${i}`,
        properties: {
          Name: { type: "title", title: [{ plain_text: `Row ${i}` }] },
          Status: { type: "status", status: st ? { name: st, color: "default" } : null },
        },
      });
    }
    return {
      id: "d",
      title: "Sprint",
      database: {
        properties: {
          Name: { type: "title" },
          Status: { type: "status" },
        },
      },
      rows,
    };
  }

  it("auto-renders DB as kanban when the heuristic matches", () => {
    // 6 rows × 3 status buckets → meets the 2-12 unique + ≥6 rows + ≥80%
    // populated thresholds.
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db);
    expect(md).toContain('section class="inline-db kanban"');
    expect(md).toContain('class="kanban-columns"');
    // One column per unique status, in first-seen order.
    expect(md).toContain('data-status="Todo"');
    expect(md).toContain('data-status="Doing"');
    expect(md).toContain('data-status="Done"');
    // Each status has 2 rows in this rotation; assert the per-column count
    // header is emitted.
    const colCounts = md.match(/class="kanban-col-count">2</g) ?? [];
    expect(colCounts.length).toBe(3);
  });

  it("falls back to table when row count is below the kanban threshold", () => {
    // 2 rows — fails the ≥3 rows check.
    const db = makeKanbanDb(2, ["Todo", "Done"]);
    const md = databaseToMarkdown(db);
    expect(md).not.toContain('class="inline-db kanban"');
    expect(md).toContain("inline-db-table");
  });

  it("EXPORT_DB_VIEW=table forces table view even on kanban-shaped DBs", () => {
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db, { dbView: "table" });
    expect(md).not.toContain("kanban-columns");
    expect(md).toContain("inline-db-table");
  });

  it("EXPORT_DB_VIEW=kanban forces kanban + buckets unstatused rows", () => {
    // Single row → would never meet the auto heuristic, but the explicit
    // override must still produce a kanban — with the empty status grouped
    // under "No status".
    const db: ExportedDatabase = {
      id: "d",
      title: "Solo",
      database: { properties: { Name: { type: "title" } } },
      rows: [
        {
          id: "r1",
          properties: { Name: { type: "title", title: [{ plain_text: "Only" }] } },
        },
      ],
    };
    const md = databaseToMarkdown(db, { dbView: "kanban" });
    expect(md).toContain('class="inline-db kanban"');
    expect(md).toContain('data-status="No status"');
  });

  it("kanban column count matches unique status buckets including the empty one", () => {
    // 6 rows, statuses cycle through Todo/Doing/Done, plus 2 rows with NO
    // status — the empty rows must land in a "No status" bucket. 6 statused
    // out of 8 = 75% populated, which is < the 80% threshold, so we use
    // EXPORT_DB_VIEW=kanban to force the layout.
    const rows = [];
    const cycle = ["Todo", "Doing", "Done", "Todo", "Doing", "Done"];
    for (let i = 0; i < 6; i++) {
      rows.push({
        id: `r${i}`,
        properties: {
          Name: { type: "title", title: [{ plain_text: `R${i}` }] },
          Status: { type: "status", status: { name: cycle[i], color: "default" } },
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      rows.push({
        id: `u${i}`,
        properties: {
          Name: { type: "title", title: [{ plain_text: `U${i}` }] },
          Status: { type: "status", status: null },
        },
      });
    }
    const db: ExportedDatabase = {
      id: "d",
      title: "Mixed",
      database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
      rows,
    };
    const md = databaseToMarkdown(db, { dbView: "kanban" });
    expect(md).toContain('data-status="Todo"');
    expect(md).toContain('data-status="Doing"');
    expect(md).toContain('data-status="Done"');
    expect(md).toContain('data-status="No status"');
  });

  // ── filter widgets ─────────────────────────────────────────────────────
  it("emits chip filter widgets for select/status columns", () => {
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db, { dbView: "table" });
    // Filter strip emits a chip per distinct status, with data-filter-col
    // and data-filter-type so the client JS can wire them up.
    expect(md).toContain('data-filter-col="Status"');
    expect(md).toContain('data-filter-type="select"');
    expect(md).toContain('class="db-filter-chip" data-filter-value="Todo"');
    expect(md).toContain('class="db-filter-chip" data-filter-value="Doing"');
    expect(md).toContain('class="db-filter-chip" data-filter-value="Done"');
  });

  it("emits date-range and number-range widgets for date/number columns", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Due: { type: "date" },
          Price: { type: "number" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "A" }] },
            Due: { type: "date", date: { start: "2025-01-01" } },
            Price: { type: "number", number: 12 },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('data-filter-col="Due"');
    expect(md).toContain('data-filter-type="date"');
    expect(md).toContain('data-filter-col="Price"');
    expect(md).toContain('data-filter-type="number"');
    // Bounds inputs carry data-filter-bound="from"/"to" so the client JS can
    // distinguish the two without relying on DOM order.
    expect(md).toContain('data-filter-bound="from"');
    expect(md).toContain('data-filter-bound="to"');
  });

  it("emits a sort dropdown when there are ≥2 sortable columns", () => {
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db, { dbView: "table" });
    expect(md).toContain("data-filter-sort");
    // Both columns produce up/down options.
    expect(md).toContain('value="Name:asc"');
    expect(md).toContain('value="Status:desc"');
  });

  it("emits empty-state + clear-filters affordances", () => {
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db, { dbView: "table" });
    expect(md).toContain("data-empty-state");
    expect(md).toContain("data-empty-clear");
    expect(md).toContain("data-filter-clear");
  });

  it("table view tags td cells with data-col + filter data attributes", () => {
    const db = makeKanbanDb(6, ["Todo", "Doing", "Done"]);
    const md = databaseToMarkdown(db, { dbView: "table" });
    expect(md).toContain('data-col="Status"');
    expect(md).toContain('data-filter-values="Todo"');
  });

  it("escapes pipe + newline in Notion table cells so the GFM grid stays intact", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "t",
          type: "table",
          table: { table_width: 2, has_column_header: true },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "Name" }], [{ plain_text: "Notes" }]],
              },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: {
                // `code` annotation keeps `\n` inside `rt()` output — that
                // newline would otherwise terminate the row, so mdCell must
                // collapse it. The plain pipe in the first cell exercises
                // the `\|` escape path.
                cells: [
                  [{ plain_text: "A | B" }],
                  [{ plain_text: "line1\nline2", annotations: { code: true } }],
                ],
              },
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page);
    // Cell `A | B` must escape the pipe so GFM doesn't see a third column.
    expect(md).toContain("\\| B ");
    // The full row must remain on a single line — the embedded newline in
    // the second cell is collapsed to a space, never leaking into a real
    // newline that would prematurely terminate the row.
    const rowLine = md.split("\n").find((l) => l.includes("A \\| B"));
    expect(rowLine).toBeDefined();
    expect(rowLine).not.toMatch(/\n/);
    expect(rowLine).toContain("line1");
    expect(rowLine).toContain("line2");
  });

  it("relation with `]` in target title renders a clickable anchor", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: { properties: { Name: { type: "title" }, Related: { type: "relation" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Related: { type: "relation", relation: [{ id: "rel-1" }] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db, {
      resolveLink: (id) =>
        id === "rel-1" ? { href: "foo.md", title: "[Draft] Foo", kind: "page" } : null,
    });
    // The relation cell ends up in a `<td>`. The anchor must be a real
    // `<a>` tag — not literal `[ [Draft] Foo ](foo.md)` markdown — so it
    // renders as a clickable link in the DB row table.
    expect(md).toMatch(/<a href="foo\.md">\[Draft\] Foo<\/a>/);
    // And it must NOT leak as a half-converted markdown link with the
    // closing bracket of the title chewed up by the regex round-trip.
    expect(md).not.toContain("](foo.md)");
  });

  it("custom-emoji local_path with javascript: scheme is neutralised by safeLinkUrl", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "mention",
                plain_text: ":evil:",
                mention: {
                  type: "custom_emoji",
                  custom_emoji: {
                    name: "evil",
                    url: "https://example.com/evil.png",
                    // Tampered raw JSON: a hostile local_path that bypasses
                    // every other src-emit's safeLinkUrl gate.
                    local_path: "javascript:alert(1)",
                  } as { name: string; url: string; local_path: string },
                },
              },
            ],
          },
        },
      ],
    };
    const md = pageToMarkdown(page);
    // safeLinkUrl returns "#" for `javascript:` — the rendered <img>
    // must carry that neutralised src, NOT the original payload.
    expect(md).toContain('src="#"');
    expect(md).not.toContain("javascript:alert(1)");
  });

  it("databaseToMarkdown escapes pipes in cells", () => {
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: { properties: { Name: { type: "title" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "a | b" }] },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // Cells now live in <td>s, so the pipe is no longer interpreted as a
    // delimiter — it survives as-is in the cell content.
    expect(md).toMatch(/<td[^>]*>a \| b<\/td>/);
  });

  it("rollup-of-relations renders clickable <a> tags, not escaped HTML text (B1)", () => {
    // Repro: a rollup whose array contains relation entries. `formatProp`
    // emits raw `<a>` HTML for each relation; the rollup branch joins
    // those pieces. The renderPropertyValue tail used to push that
    // through `escapeHtmlText`, surfacing literal `&lt;a&gt;` text in the
    // cell. The fix routes "rollup" to a no-escape path.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Linked: { type: "rollup" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Linked: {
              type: "rollup",
              rollup: {
                type: "array",
                array: [
                  { type: "relation", relation: [{ id: "rel-a" }] },
                  { type: "relation", relation: [{ id: "rel-b" }] },
                ],
              },
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db, {
      resolveLink: (id) =>
        id === "rel-a"
          ? { href: "a.md", title: "Alpha", kind: "page" }
          : id === "rel-b"
            ? { href: "b.md", title: "Beta", kind: "page" }
            : null,
    });
    // Real clickable anchors in the cell — not literal escaped HTML.
    expect(md).toMatch(/<a href="a\.md">Alpha<\/a>/);
    expect(md).toMatch(/<a href="b\.md">Beta<\/a>/);
    expect(md).not.toContain("&lt;a");
    expect(md).not.toContain("&gt;Alpha");
  });

  it("page mention with `]` in title survives mdLinksToAnchors round-trip (B2)", () => {
    // Repro: a title-cell rich_text contains a page mention whose target
    // title has a literal `]`. The old `[escape(title)](href)` markdown
    // intermediate got run through `mdLinksToAnchors` in the title-cell
    // path; the `[^\]]+` capture truncated at the inner `]`, leaking
    // half-converted markdown. The fix emits `<a>` HTML directly.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: { properties: { Name: { type: "title" } } },
      rows: [
        {
          id: "r1",
          properties: {
            Name: {
              type: "title",
              title: [
                {
                  type: "mention",
                  plain_text: "[Draft] Bug",
                  mention: { type: "page", page: { id: "p-x" } },
                  annotations: {},
                },
              ],
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db, {
      resolveLink: (id) =>
        id === "p-x" ? { href: "x.md", title: "[Draft] Bug", kind: "page" } : null,
    });
    // A real anchor — title text intact, no half-converted markdown.
    expect(md).toMatch(/<a href="x\.md">\[Draft\] Bug<\/a>/);
    expect(md).not.toContain("](x.md)");
  });

  it("multi_select option names with `|` round-trip via encodeURIComponent (A6)", () => {
    // Contract: server encodeURIComponent-encodes each option name before
    // joining with `|`; client decodeURIComponent's each split piece. A
    // raw `|` in an option name must NOT split into two false-matchable
    // values.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Tags: { type: "multi_select" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Tags: {
              type: "multi_select",
              multi_select: [{ name: "Priority|High" }, { name: "Status:OK" }],
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // The literal `|` in "Priority|High" must be percent-encoded — the
    // surrounding HTML attribute should contain the encoded form, not a
    // raw `|` between two option-name fragments.
    expect(md).toMatch(/data-filter-values="[^"]*Priority%7CHigh[^"]*"/);
    // The second name has a `:` which encodeURIComponent leaves alone —
    // useful sanity that we're encoding minimally and not e.g. fully
    // base64-ing.
    expect(md).toMatch(/data-filter-values="[^"]*Status%3AOK[^"]*"/);
    // No raw literal `Priority|High` in the attr (would mean the encoder
    // is skipped).
    expect(md).not.toMatch(/data-filter-values="[^"]*Priority\|High/);
  });

  it("rollup of people with HTML-bearing member names escapes inner brackets (B4)", () => {
    // Repro: a rollup's `array` contains people entries. `formatProp(item)`
    // emits raw user names; the joined result lands in a `<td>` verbatim
    // (renderPropertyValue skips the tail-escape for rollups). Without
    // per-item escape, a member named `Bob <Admin>` would surface
    // unescaped `<Admin>` in the cell — XSS.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Owners: { type: "rollup" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Owners: {
              type: "rollup",
              rollup: {
                type: "array",
                array: [
                  { type: "people", people: [{ name: "Bob <Admin>" }] },
                  { type: "people", people: [{ name: "Alice" }] },
                ],
              },
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // The literal `<Admin>` from the member name must be HTML-escaped.
    expect(md).toContain("Bob &lt;Admin&gt;");
    expect(md).not.toContain("Bob <Admin>");
    // Other inner names render normally.
    expect(md).toContain("Alice");
  });

  it("rollup of rich_text with href emits inline <a>, not literal [text](url)", () => {
    // Repro: a rollup whose array contains rich_text items whose runs carry
    // an `href`. `rt()` emits `[text](url)` markdown for the href annotation;
    // the rollup branch in renderPropertyValue used to return `formatProp(p)`
    // directly without running it through `mdLinksToAnchors`, so users saw
    // literal brackets in DB cells.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          Refs: { type: "rollup" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Refs: {
              type: "rollup",
              rollup: {
                type: "array",
                array: [
                  {
                    type: "rich_text",
                    rich_text: [
                      {
                        type: "text",
                        plain_text: "docs",
                        href: "https://example.com/docs",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    expect(md).toContain('<a href="https://example.com/docs">docs</a>');
    // No literal `[text](url)` markdown leaking into the rendered cell.
    expect(md).not.toContain("[docs](https://example.com/docs)");
  });

  it("status option name with `|` round-trips through chip filter (A7)", () => {
    // Repro: a status option named `Blocked|Waiting`. The server emits the
    // option name twice — once inside the chip's `data-filter-value` (the
    // human-readable name the client adds to `wanted`) and once inside the
    // row's `data-filter-values` (which the client splits on `|` and
    // decodes). Before the fix, select/status emitted unencoded option
    // names while multi_select encoded; the client's unconditional
    // decodeURIComponent meant `Blocked|Waiting` split into two false
    // matches. Encoding all three the same way fixes the round-trip.
    const db: ExportedDatabase = {
      id: "d",
      title: "DB",
      database: {
        properties: {
          Name: { type: "title" },
          State: { type: "status" },
        },
      },
      rows: [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            State: { type: "status", status: { name: "Blocked|Waiting" } },
          },
        },
      ],
    };
    const md = databaseToMarkdown(db);
    // Encoded form sits on the row cell.
    expect(md).toMatch(/data-filter-values="Blocked%7CWaiting"/);
    // The chip carries the raw name (matches what the client puts in `wanted`).
    expect(md).toMatch(/data-filter-value="Blocked\|Waiting"/);
    // Decoding split-on-`|` of the row attr must produce the raw chip value
    // — exactly one piece, matching the chip.
    const m = md.match(/data-filter-values="([^"]+)"/);
    expect(m).toBeTruthy();
    const decoded = (m?.[1] ?? "").split("|").map((s) => decodeURIComponent(s));
    expect(decoded).toEqual(["Blocked|Waiting"]);
  });

  it("mdCell preserves `|` inside `<a>` anchor bodies", () => {
    // Repro: a markdown table row whose cell rich_text mentions a page
    // titled `Roadmap | Q4`. `rt()` emits `<a href="…">Roadmap | Q4</a>`.
    // The naive `replace(/\|/g, "\\|")` would backslash-escape the `|`
    // inside the anchor body, surfacing as visible `\|` in the rendered
    // cell. Tag-aware mdCell skips pipes inside `<…>` boundaries.
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "t",
          type: "table",
          table: { has_column_header: true },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "Header" }]],
              },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: {
                cells: [
                  [
                    {
                      type: "mention",
                      plain_text: "Roadmap | Q4",
                      mention: { type: "page", page: { id: "p-rm" } },
                      annotations: {},
                    },
                  ],
                ],
              },
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page, {
      resolveLink: (id) =>
        id === "p-rm" ? { href: "rm.md", title: "Roadmap | Q4", kind: "page" } : null,
    });
    // The `|` inside the anchor body must survive without being
    // backslash-escaped — the rendered cell carries the real anchor.
    expect(md).toContain('<a href="rm.md">Roadmap | Q4</a>');
    expect(md).not.toContain("Roadmap \\| Q4");
  });

  // ── %%notion-exporter db-view config fence ──────────────────────────────
  describe("db-view config", () => {
    function configDb(opts: {
      configJson: string;
      rows?: ExportedDatabase["rows"];
      properties?: Record<string, { type?: string }>;
    }): ExportedDatabase {
      const properties = opts.properties ?? {
        Name: { type: "title" },
        Status: { type: "status" },
      };
      const description = [{ plain_text: `%%notion-exporter\n${opts.configJson}\n%%` }];
      // 2 rows → would NOT auto-kanban (heuristic needs ≥3 rows)
      const rows = opts.rows ?? [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "A" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "B" }] },
            Status: { type: "status", status: { name: "Done", color: "default" } },
          },
        },
      ];
      return {
        id: "d",
        title: "DB",
        database: { id: "d", description, properties },
        rows,
      };
    }

    it("A) view=kanban forces kanban even on a 2-row DB", () => {
      const db = configDb({ configJson: '{"view":"kanban"}' });
      const md = databaseToMarkdown(db);
      expect(md).toContain('class="inline-db kanban"');
      expect(md).not.toContain("inline-db-table");
    });

    it("B) view=table forces table even on a kanban-shaped DB", () => {
      // 6 rows × 3 buckets — would auto-kanban without the override.
      const rows: ExportedDatabase["rows"] = [];
      const buckets = ["Todo", "Doing", "Done"];
      for (let i = 0; i < 6; i++) {
        rows.push({
          id: `r${i}`,
          properties: {
            Name: { type: "title", title: [{ plain_text: `Row ${i}` }] },
            Status: {
              type: "status",
              status: { name: buckets[i % buckets.length], color: "default" },
            },
          },
        });
      }
      const db = configDb({ configJson: '{"view":"table"}', rows });
      const md = databaseToMarkdown(db);
      expect(md).not.toContain('class="inline-db kanban"');
      expect(md).toContain("inline-db-table");
    });

    it("C) view=gallery renders a gallery", () => {
      const db = configDb({ configJson: '{"view":"gallery"}' });
      const md = databaseToMarkdown(db);
      expect(md).toContain("inline-db-gallery");
      expect(md).toContain("db-card");
    });

    it("D) order=[…] reorders kanban columns deterministically", () => {
      // 3 rows, ordering arrived alphabetically by status would put Done first.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "A" }] },
            Status: { type: "status", status: { name: "Done", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "B" }] },
            Status: { type: "status", status: { name: "In progress", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "C" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
          },
        },
      ];
      const db = configDb({
        configJson: '{"view":"kanban","order":["Done","In progress","Todo"]}',
        rows,
      });
      const md = databaseToMarkdown(db);
      const doneIdx = md.indexOf('data-status="Done"');
      const inProgIdx = md.indexOf('data-status="In progress"');
      const todoIdx = md.indexOf('data-status="Todo"');
      expect(doneIdx).toBeGreaterThan(-1);
      expect(inProgIdx).toBeGreaterThan(doneIdx);
      expect(todoIdx).toBeGreaterThan(inProgIdx);
    });

    it("E) hideFilters=true emits no .db-filters-wrap", () => {
      const db = configDb({ configJson: '{"hideFilters":true}' });
      const md = databaseToMarkdown(db);
      expect(md).not.toContain("db-filters-wrap");
    });

    it("F) view=kanban + cardMeta=[] suppresses kanban-card-meta on cards", () => {
      // Single row → forced kanban via view config; default heuristic would
      // pick a date/people/multi_select for meta if available. Give the row a
      // date column so the heuristic would normally fire — assert cardMeta=[]
      // suppresses it.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Only" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
            Due: { type: "date", date: { start: "2026-06-01" } },
          },
        },
      ];
      const db = configDb({
        configJson: '{"view":"kanban","cardMeta":[]}',
        properties: { Name: { type: "title" }, Status: { type: "status" }, Due: { type: "date" } },
        rows,
      });
      const md = databaseToMarkdown(db);
      expect(md).toContain('class="inline-db kanban"');
      expect(md).not.toContain("kanban-card-meta");
    });

    it("G) cardMeta=['Deadline'] surfaces the named column on kanban cards", () => {
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Task" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
            Deadline: { type: "date", date: { start: "2026-06-01" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Task2" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
            Deadline: { type: "date", date: { start: "2026-07-01" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Task3" }] },
            Status: { type: "status", status: { name: "Doing", color: "default" } },
            Deadline: { type: "date", date: { start: "2026-08-01" } },
          },
        },
      ];
      const db = configDb({
        configJson: '{"view":"kanban","cardMeta":["Deadline"]}',
        properties: {
          Name: { type: "title" },
          Status: { type: "status" },
          Deadline: { type: "date" },
        },
        rows,
      });
      const md = databaseToMarkdown(db);
      expect(md).toContain("kanban-card-meta");
      expect(md).toContain(">Deadline<");
      expect(md).toContain("2026-06-01");
    });

    it("H) groupBy=NonExistent logs a warn and falls back to auto", () => {
      // 6 rows × 3 buckets so the auto group key (Status) still kanbans.
      const rows: ExportedDatabase["rows"] = [];
      const buckets = ["Todo", "Doing", "Done"];
      for (let i = 0; i < 6; i++) {
        rows.push({
          id: `r${i}`,
          properties: {
            Name: { type: "title", title: [{ plain_text: `Row ${i}` }] },
            Status: {
              type: "status",
              status: { name: buckets[i % buckets.length], color: "default" },
            },
          },
        });
      }
      const db = configDb({ configJson: '{"groupBy":"NonExistent"}', rows });
      const warn = vi.fn();
      const log = {
        warn,
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
      };
      const md = databaseToMarkdown(db, { log: log as never });
      // Warning emitted.
      expect(warn).toHaveBeenCalled();
      const warnArgs = warn.mock.calls.map((c) => JSON.stringify(c));
      expect(warnArgs.some((s) => s.includes("NonExistent"))).toBe(true);
      // Falls back to auto — Status is the auto pick, so we get a kanban with
      // the three buckets.
      expect(md).toContain('class="inline-db kanban"');
      expect(md).toContain('data-status="Todo"');
    });
  });

  // ── dataSource canonical option order ───────────────────────────────────
  describe("dataSource schema", () => {
    function makeOption(name: string) {
      return { id: `o-${name}`, name, color: "default" };
    }

    it("A) dataSource option order wins over first-occurrence for kanban columns", () => {
      // Schema declares A, B, C; rows arrive in B, A, C order — without the
      // dataSource hint, columns would render in row-occurrence order. With
      // it, the workspace order A→B→C must win.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Status: { type: "status", status: { name: "B", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Status: { type: "status", status: { name: "A", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row3" }] },
            Status: { type: "status", status: { name: "C", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
        rows,
        dataSource: {
          id: "ds-1",
          properties: {
            Name: { id: "n", name: "Name", type: "title" },
            Status: {
              id: "s",
              name: "Status",
              type: "status",
              status: {
                options: [makeOption("A"), makeOption("B"), makeOption("C")],
                groups: [],
              },
            },
          },
        },
      };
      const md = databaseToMarkdown(db, { dbView: "kanban" });
      const aIdx = md.indexOf('data-status="A"');
      const bIdx = md.indexOf('data-status="B"');
      const cIdx = md.indexOf('data-status="C"');
      expect(aIdx).toBeGreaterThan(-1);
      expect(bIdx).toBeGreaterThan(aIdx);
      expect(cIdx).toBeGreaterThan(bIdx);
    });

    it("B) without dataSource, falls back to STATUS_RANK + first-occurrence", () => {
      // Status names hit STATUS_RANK ("Todo"=0, "In progress"=2, "Done"=3) so
      // the legacy heuristic produces Todo → In progress → Done.
      const rows: ExportedDatabase["rows"] = [];
      const cycle = ["Done", "In progress", "Todo"];
      for (let i = 0; i < 6; i++) {
        rows.push({
          id: `r${i}`,
          properties: {
            Name: { type: "title", title: [{ plain_text: `Row${i}` }] },
            Status: {
              type: "status",
              status: { name: cycle[i % 3], color: "default" },
            },
          },
        });
      }
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
        rows,
        // dataSource intentionally omitted.
      };
      const md = databaseToMarkdown(db);
      const todoIdx = md.indexOf('data-status="Todo"');
      const inProgIdx = md.indexOf('data-status="In progress"');
      const doneIdx = md.indexOf('data-status="Done"');
      expect(todoIdx).toBeGreaterThan(-1);
      expect(inProgIdx).toBeGreaterThan(todoIdx);
      expect(doneIdx).toBeGreaterThan(inProgIdx);
    });

    it("C) filter chips for select/status emit in dataSource option order", () => {
      // Rows touch Z, A, M — without dataSource the chips would alphabetize
      // (A, M, Z). With a dataSource declaring Z, M, A in that order, the
      // chips must come out Z, M, A.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Tag: { type: "select", select: { name: "Z", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Tag: { type: "select", select: { name: "A", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row3" }] },
            Tag: { type: "select", select: { name: "M", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Tag: { type: "select" } } },
        rows,
        dataSource: {
          id: "ds-1",
          properties: {
            Name: { id: "n", name: "Name", type: "title" },
            Tag: {
              id: "t",
              name: "Tag",
              type: "select",
              select: {
                options: [makeOption("Z"), makeOption("M"), makeOption("A")],
              },
            },
          },
        },
      };
      // Force table view so filter chips show without kanban confusion.
      const md = databaseToMarkdown(db, { dbView: "table" });
      const zIdx = md.indexOf('data-filter-value="Z"');
      const mIdx = md.indexOf('data-filter-value="M"');
      const aIdx = md.indexOf('data-filter-value="A"');
      expect(zIdx).toBeGreaterThan(-1);
      expect(mIdx).toBeGreaterThan(zIdx);
      expect(aIdx).toBeGreaterThan(mIdx);
    });

    it("D) config.order overrides dataSource order (operator override wins)", () => {
      // dataSource declares A, B, C — but operator-set order=["C","A","B"]
      // must win.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Status: { type: "status", status: { name: "A", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Status: { type: "status", status: { name: "B", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row3" }] },
            Status: { type: "status", status: { name: "C", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: {
          id: "d",
          description: [
            { plain_text: '%%notion-exporter\n{"view":"kanban","order":["C","A","B"]}\n%%' },
          ],
          properties: { Name: { type: "title" }, Status: { type: "status" } },
        },
        rows,
        dataSource: {
          id: "ds-1",
          properties: {
            Name: { id: "n", name: "Name", type: "title" },
            Status: {
              id: "s",
              name: "Status",
              type: "status",
              status: {
                options: [makeOption("A"), makeOption("B"), makeOption("C")],
                groups: [],
              },
            },
          },
        },
      };
      const md = databaseToMarkdown(db);
      const cIdx = md.indexOf('data-status="C"');
      const aIdx = md.indexOf('data-status="A"');
      const bIdx = md.indexOf('data-status="B"');
      expect(cIdx).toBeGreaterThan(-1);
      expect(aIdx).toBeGreaterThan(cIdx);
      expect(bIdx).toBeGreaterThan(aIdx);
    });

    // When the workspace dataSource carries options that no row currently
    // uses (e.g. an unused "Done" stage on a new sprint board), the kanban
    // must still render those columns. Operators rely on the empty stages
    // to see at-a-glance where work isn't happening.
    it("kanban seeds columns from dataSource options even when no rows occupy them", () => {
      // 4 declared options; only 2 (Todo, Doing) have rows.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "A" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "B" }] },
            Status: { type: "status", status: { name: "Doing", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "C" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "Sprint",
        database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
        rows,
        dataSource: {
          id: "ds-1",
          properties: {
            Name: { id: "n", name: "Name", type: "title" },
            Status: {
              id: "s",
              name: "Status",
              type: "status",
              status: {
                options: [
                  makeOption("Backlog"),
                  makeOption("Todo"),
                  makeOption("Doing"),
                  makeOption("Done"),
                ],
                groups: [],
              },
            },
          },
        },
      };
      // Force kanban so heuristic row-count thresholds don't gate the test.
      const md = databaseToMarkdown(db, { dbView: "kanban" });
      // All four declared options render columns, including the two with
      // zero rows.
      expect(md).toContain('data-status="Backlog"');
      expect(md).toContain('data-status="Todo"');
      expect(md).toContain('data-status="Doing"');
      expect(md).toContain('data-status="Done"');
      // Per-column count headers. Backlog and Done are empty (0); Todo (2)
      // and Doing (1) have rows.
      const zeroCounts = md.match(/class="kanban-col-count">0</g) ?? [];
      expect(zeroCounts.length).toBe(2);
      expect(md).toContain('class="kanban-col-count">2<');
      expect(md).toContain('class="kanban-col-count">1<');
      // Empty columns still emit a `<ul class="kanban-cards">` (even if empty)
      // so the column carries layout structure for the head + body.
      const emptyUl = md.match(/<ul class="kanban-cards"><\/ul>/g) ?? [];
      expect(emptyUl.length).toBe(2);
    });
  });

  // ── compact card-list for small inline DBs in column_list ──────────────
  function makeColumnListPage(childDb: import("../src/export/markdown.js").ChildDatabaseData): {
    page: ExportedPage;
    childDatabases: Map<string, import("../src/export/markdown.js").ChildDatabaseData>;
  } {
    const page: ExportedPage = {
      id: "p",
      title: "Container",
      page: {},
      blocks: [{ id: "cdb-id", type: "child_database", child_database: { title: childDb.title } }],
    };
    const childDatabases = new Map<string, import("../src/export/markdown.js").ChildDatabaseData>();
    childDatabases.set("cdb-id", childDb);
    return { page, childDatabases };
  }

  function makeRows(
    count: number,
    extraProp?: { name: string; type: string; value: (i: number) => unknown },
  ): Array<{ id: string; properties: Record<string, unknown> }> {
    const rows: Array<{ id: string; properties: Record<string, unknown> }> = [];
    for (let i = 0; i < count; i++) {
      const props: Record<string, unknown> = {
        Name: { type: "title", title: [{ plain_text: `Item ${i}` }] },
      };
      if (extraProp) {
        props[extraProp.name] = { type: extraProp.type, [extraProp.type]: extraProp.value(i) };
      }
      rows.push({ id: `r${i}`, properties: props });
    }
    return rows;
  }

  it("compact A: inColumnList + ≤8 rows + no covers → compact list view", () => {
    const { page, childDatabases } = makeColumnListPage({
      title: "Schrank 1",
      database: {
        properties: { Name: { type: "title" }, Tag: { type: "select" } },
      },
      rows: makeRows(4, {
        name: "Tag",
        type: "select",
        value: (i) => ({ name: `t${i}`, color: "default" }),
      }),
      inColumnList: true,
    });
    const md = pageToMarkdown(page, { childDatabases });
    expect(md).toContain('class="inline-db inline-db-compact"');
    expect(md).toContain('class="db-compact-list"');
    expect(md).toContain('class="db-compact-row"');
    expect(md).toContain('class="inline-db-compact-title">Schrank 1<');
    expect(md).toContain('class="inline-db-compact-count">4<');
    // Compact path bypasses the full inline-db chrome.
    expect(md).not.toContain("inline-db-table");
    expect(md).not.toContain('class="inline-db kanban"');
    expect(md).not.toContain('class="db-cards"');
    expect(md).not.toContain("inline-db-open");
    expect(md).not.toContain("data-inline-db-filter");
    expect(md).not.toContain("db-filters-wrap");
  });

  it("compact B: inColumnList but rows > 8 → falls through to table view", () => {
    const { page, childDatabases } = makeColumnListPage({
      title: "Many",
      database: { properties: { Name: { type: "title" } } },
      rows: makeRows(12),
      inColumnList: true,
    });
    const md = pageToMarkdown(page, { childDatabases });
    expect(md).not.toContain("inline-db-compact");
    expect(md).not.toContain("db-compact-list");
    expect(md).toContain("inline-db-table");
  });

  it("compact C: inColumnList + small rows WITH covers → gallery wins (covers > compact)", () => {
    const rowCovers = new Map<string, string>([["r0", "assets/cover0.png"]]);
    const { page, childDatabases } = makeColumnListPage({
      title: "Visual",
      database: { properties: { Name: { type: "title" } } },
      rows: makeRows(4),
      rowCovers,
      inColumnList: true,
    });
    const md = pageToMarkdown(page, { childDatabases });
    expect(md).not.toContain("inline-db-compact");
    expect(md).not.toContain("db-compact-list");
    expect(md).toContain("inline-db-gallery");
  });

  it("compact D: inColumnList:false (default) → current heuristic, no compact", () => {
    const { page, childDatabases } = makeColumnListPage({
      title: "Loose",
      database: { properties: { Name: { type: "title" } } },
      rows: makeRows(4),
      // inColumnList omitted → falsy
    });
    const md = pageToMarkdown(page, { childDatabases });
    expect(md).not.toContain("inline-db-compact");
    expect(md).not.toContain("db-compact-list");
    expect(md).toContain("inline-db-table");
  });

  it("compact E: explicit dbView:'kanban' beats compact even when inColumnList", () => {
    const { page, childDatabases } = makeColumnListPage({
      title: "Forced",
      database: {
        properties: { Name: { type: "title" }, Status: { type: "status" } },
      },
      rows: makeRows(4, {
        name: "Status",
        type: "status",
        value: (i) => ({ name: i % 2 === 0 ? "Todo" : "Done", color: "default" }),
      }),
      inColumnList: true,
    });
    const md = pageToMarkdown(page, { childDatabases, dbView: "kanban" });
    expect(md).toContain('class="inline-db kanban"');
    expect(md).not.toContain("inline-db-compact");
    expect(md).not.toContain("db-compact-list");
  });

  // ── filter-chip STATUS_RANK fallback when no dataSource ────────────────
  describe("filter chip ordering", () => {
    it("status chips order via STATUS_RANK when no dataSource is present", () => {
      // Rows arrive "In progress" first, "Not started" second. Without
      // dataSource, kanban columns sort by STATUS_RANK (Not started before
      // In progress). The filter chip order must agree — same sort.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Status: { type: "status", status: { name: "In progress", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Status: { type: "status", status: { name: "Not started", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Status: { type: "status" } } },
        rows,
      };
      // Force table view so we always emit the filter strip.
      const md = databaseToMarkdown(db, { dbView: "table" });
      const notStartedIdx = md.indexOf('data-filter-value="Not started"');
      const inProgIdx = md.indexOf('data-filter-value="In progress"');
      expect(notStartedIdx).toBeGreaterThan(-1);
      expect(inProgIdx).toBeGreaterThan(notStartedIdx);
    });

    it("non-status select chips keep alphabetic order without dataSource", () => {
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Tag: { type: "select", select: { name: "Zeta", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Tag: { type: "select", select: { name: "Alpha", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Tag: { type: "select" } } },
        rows,
      };
      const md = databaseToMarkdown(db, { dbView: "table" });
      const aIdx = md.indexOf('data-filter-value="Alpha"');
      const zIdx = md.indexOf('data-filter-value="Zeta"');
      expect(aIdx).toBeGreaterThan(-1);
      expect(zIdx).toBeGreaterThan(aIdx);
    });
  });

  // ── pickKanbanCardMeta hoist correctness ───────────────────────────────
  describe("kanban card meta hoist", () => {
    it("renders date meta per-row even with hoisted key picks", () => {
      // The hoisted candidate keys (date/people/multi_select) come from
      // schema; the per-row predicate (does the row carry this property?)
      // still gates emission. This test forces both row presence and absence
      // and asserts independent rendering.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
            Due: { type: "date", date: { start: "2026-06-01" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Status: { type: "status", status: { name: "Todo", color: "default" } },
            // No Due property → hoisted dateKey exists but row lacks it.
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: {
          properties: {
            Name: { type: "title" },
            Status: { type: "status" },
            Due: { type: "date" },
          },
        },
        rows,
      };
      const md = databaseToMarkdown(db, { dbView: "kanban" });
      // Row 1 should have a card-date span.
      expect(md).toMatch(/kanban-card-date/);
      // There should be exactly one date meta block (row 2 must skip it).
      const occurrences = md.match(/kanban-card-date/g)?.length ?? 0;
      expect(occurrences).toBe(1);
    });
  });

  // ── uniqueOptions O(1) Set lookup ──────────────────────────────────────
  describe("uniqueOptions Set-based unknown filter", () => {
    it("emits unknown row-only options after schema-known ones (Set-deduped)", () => {
      // dataSource declares A, B. Rows include A, B, plus archived-option C
      // (in rows but not schema). Expected chip order: A, B, then C.
      const rows: ExportedDatabase["rows"] = [
        {
          id: "r1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row1" }] },
            Tag: { type: "select", select: { name: "C", color: "default" } },
          },
        },
        {
          id: "r2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row2" }] },
            Tag: { type: "select", select: { name: "B", color: "default" } },
          },
        },
        {
          id: "r3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Row3" }] },
            Tag: { type: "select", select: { name: "A", color: "default" } },
          },
        },
      ];
      const db: ExportedDatabase = {
        id: "d",
        title: "DB",
        database: { properties: { Name: { type: "title" }, Tag: { type: "select" } } },
        rows,
        dataSource: {
          id: "ds-1",
          properties: {
            Name: { id: "n", name: "Name", type: "title" },
            Tag: {
              id: "t",
              name: "Tag",
              type: "select",
              select: {
                options: [
                  { id: "o-A", name: "A", color: "default" },
                  { id: "o-B", name: "B", color: "default" },
                ],
              },
            },
          },
        },
      };
      const md = databaseToMarkdown(db, { dbView: "table" });
      const aIdx = md.indexOf('data-filter-value="A"');
      const bIdx = md.indexOf('data-filter-value="B"');
      const cIdx = md.indexOf('data-filter-value="C"');
      expect(aIdx).toBeGreaterThan(-1);
      expect(bIdx).toBeGreaterThan(aIdx);
      expect(cIdx).toBeGreaterThan(bIdx);
    });
  });

  it("mdCell still escapes `|` outside HTML tags", () => {
    // Sanity: the tag-aware mdCell must still escape pipes in plain cell
    // text — otherwise GFM table parsing would see a phantom column.
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "t",
          type: "table",
          table: { has_column_header: true },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: { cells: [[{ plain_text: "Header" }]] },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: { cells: [[{ plain_text: "a | b" }]] },
            },
          ],
        },
      ],
    };
    const md = pageToMarkdown(page);
    expect(md).toContain("a \\| b");
  });

  // ---- renderer XSS bundle (M1–M5) ----

  it("M1: cover-image src goes through safeLinkUrl", () => {
    // Tampered raw JSON could plant a `javascript:` scheme into the hero
    // cover URL. The renderer must neutralise it like every other src emit.
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [],
    };
    const md = pageToMarkdown(page, { coverSrc: "javascript:alert('cover')" });
    expect(md).toContain('<img src="#" alt="">');
    expect(md).not.toContain("javascript:alert");
    // Safe relative paths still flow through unchanged.
    const ok = pageToMarkdown(page, { coverSrc: "../assets/cover.jpg" });
    expect(ok).toContain('<img src="../assets/cover.jpg" alt="">');
  });

  it("M2: page-icon image src goes through safeLinkUrl", () => {
    const page: ExportedPage = { id: "p", title: "T", page: {}, blocks: [] };
    const md = pageToMarkdown(page, {
      icon: { kind: "image", value: "javascript:alert('icon')" },
    });
    expect(md).toContain('<img class="page-icon" src="#" alt="">');
    expect(md).not.toContain("javascript:alert");
    // Safe URLs unchanged.
    const ok = pageToMarkdown(page, {
      icon: { kind: "image", value: "../assets/icon.png" },
    });
    expect(ok).toContain('<img class="page-icon" src="../assets/icon.png" alt="">');
  });

  it("M3a: callout emoji icon body is HTML-escaped", () => {
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "callout",
          callout: {
            icon: { type: "emoji", emoji: "<script>alert(1)</script>" },
            rich_text: [{ plain_text: "hi" }],
          },
        },
      ],
    };
    const md = pageToMarkdown(page);
    // The tampered emoji must be escaped — never rendered as raw HTML.
    expect(md).toContain('<span class="callout-icon">&lt;script&gt;alert(1)&lt;/script&gt;</span>');
    expect(md).not.toContain("<script>alert(1)</script>");
    // Real emoji glyphs pass through unchanged (round-trip).
    const okPage: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "callout",
          callout: {
            icon: { type: "emoji", emoji: "💡" },
            rich_text: [{ plain_text: "hi" }],
          },
        },
      ],
    };
    expect(pageToMarkdown(okPage)).toContain('<span class="callout-icon">💡</span>');
  });

  it("M3b: page-link emoji icon body is HTML-escaped", () => {
    const page: ExportedPage = {
      id: "p",
      title: "Hub",
      page: {},
      blocks: [{ id: "x", type: "paragraph", paragraph: { rich_text: [] } }],
    };
    const md = pageToMarkdown(page, {
      children: [
        {
          href: "child.md",
          title: "Child",
          kind: "page",
          icon: { kind: "emoji", value: "<img onerror=alert(1)>" },
        },
      ],
    });
    expect(md).toContain('<span class="page-link-icon">&lt;img onerror=alert(1)&gt;</span>');
    expect(md).not.toContain("<img onerror=alert(1)>");
    // Real emoji round-trips.
    const ok = pageToMarkdown(page, {
      children: [{ href: "c.md", title: "C", kind: "page", icon: { kind: "emoji", value: "📄" } }],
    });
    expect(ok).toContain('<span class="page-link-icon">📄</span>');
  });

  it("M5: custom-emoji renders literal :slug: when local_path is missing", () => {
    // The fallback to the signed Notion S3 URL is gone — that URL would
    // ship `X-Amz-Signature` into HTML and expire within ~1h. Renderer
    // now emits the literal shortcode text instead.
    const page: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "mention",
                plain_text: ":wave:",
                mention: {
                  type: "custom_emoji",
                  custom_emoji: {
                    name: "wave",
                    url: "https://prod-files-secure.s3.amazonaws.com/abc?X-Amz-Signature=xyz",
                    // No `local_path` — the fallback path under test.
                  } as { name: string; url: string },
                },
              },
            ],
          },
        },
      ],
    };
    const md = pageToMarkdown(page);
    // No remote URL leak — neither raw nor inside an <img> src.
    expect(md).not.toContain("prod-files-secure");
    expect(md).not.toContain("X-Amz-Signature");
    expect(md).not.toContain('class="custom-emoji"');
    // Renderer falls back to the literal `:slug:` shortcode (escaped).
    expect(md).toContain(":wave:");
    // And the slug is escaped so a hostile `name` can't smuggle markup.
    const evilPage: ExportedPage = {
      id: "p",
      title: "T",
      page: {},
      blocks: [
        {
          id: "b",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "mention",
                plain_text: ":<x>:",
                mention: {
                  type: "custom_emoji",
                  custom_emoji: { name: "<x>", url: "https://x.s3.amazonaws.com/a" } as {
                    name: string;
                    url: string;
                  },
                },
              },
            ],
          },
        },
      ],
    };
    const evilMd = pageToMarkdown(evilPage);
    expect(evilMd).toContain(":&lt;x&gt;:");
    expect(evilMd).not.toContain(":<x>:");
  });
});
