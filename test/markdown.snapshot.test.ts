import { describe, expect, it } from "vitest";
import type { ExportedPage } from "../src/export/json.js";
import { pageToMarkdown } from "../src/export/markdown.js";

describe("markdown snapshots", () => {
  it("kitchen-sink page", () => {
    const page: ExportedPage = {
      id: "00000000-0000-0000-0000-000000000001",
      title: "Kitchen Sink",
      page: {},
      blocks: [
        { id: "h1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Section" }] } },
        {
          id: "p1",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", plain_text: "Mix " },
              { type: "text", plain_text: "bold", annotations: { bold: true } },
              { type: "text", plain_text: " + " },
              { type: "text", plain_text: "italic", annotations: { italic: true } },
              { type: "text", plain_text: " + " },
              { type: "text", plain_text: "code", annotations: { code: true } },
              { type: "text", plain_text: " + " },
              {
                type: "mention",
                plain_text: "Friend",
                mention: { type: "page", page: { id: "friend-id" } },
              },
              { type: "text", plain_text: "." },
            ],
          },
        },
        {
          id: "l1",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ plain_text: "first" }] },
        },
        {
          id: "l2",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: [{ plain_text: "second" }] },
        },
        {
          id: "todo",
          type: "to_do",
          to_do: { rich_text: [{ plain_text: "done" }], checked: true },
        },
        {
          id: "q",
          type: "quote",
          quote: { rich_text: [{ plain_text: "a saying" }] },
        },
        {
          id: "code",
          type: "code",
          code: { rich_text: [{ plain_text: "print('hi')" }], language: "python" },
        },
        { id: "d", type: "divider", divider: {} },
        {
          id: "img",
          type: "image",
          image: {
            type: "file",
            file: { url: "https://signed/x.png" },
            local_path: "assets/abc.png",
            caption: [{ plain_text: "a cat" }],
          },
        },
        {
          id: "tbl",
          type: "table",
          table: { has_column_header: true },
          children: [
            {
              id: "r1",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]],
              },
            },
            {
              id: "r2",
              type: "table_row",
              table_row: {
                cells: [[{ plain_text: "1" }], [{ plain_text: "2" }]],
              },
            },
          ],
        },
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
                  id: "cp1",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "left" }] },
                },
              ],
            },
            {
              id: "c2",
              type: "column",
              column: {},
              children: [
                {
                  id: "cp2",
                  type: "paragraph",
                  paragraph: { rich_text: [{ plain_text: "right" }] },
                },
              ],
            },
          ],
        },
        {
          id: "ltp",
          type: "link_to_page",
          link_to_page: { type: "page_id", page_id: "friend-id" },
        },
      ],
    };

    const md = pageToMarkdown(page, {
      resolveLink: (id) =>
        id === "friend-id" ? { href: "Friend.md", title: "Friend", kind: "page" } : null,
      breadcrumbs: [{ href: "../Root.md", title: "Root", kind: "page" }],
      icon: { kind: "emoji", value: "🧪" },
      lastEditedTime: "2026-05-12T10:00:00Z",
      exportedAt: "2026-05-30T00:00:00Z",
      notionUrl: "https://notion.so/00000000000000000000000000000001",
    });

    expect(md).toMatchSnapshot();
  });
});
