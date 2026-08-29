import { describe, expect, it } from "vitest";
import { buildRerenderIndexes } from "../src/commands/rerender.js";
import type { NotionBlock } from "../src/notion/blocks.js";

// Fixture mirrors the shape `loadRawData` populates: a Map<pageId, RawPage>.
// RawPage exposes `.page` + `.blocks`; only those are read by the fused
// indexer. Using `as any` for the page payload is fine — the function reads
// nothing inside it for the position/container indexes.
type RawPage = {
  page: { id: string; parent: { type: "workspace"; workspace: true } } | null;
  blocks: NotionBlock[];
};

// Reference implementations — verbatim copies of the OLD `buildPositionIndex`
// and `buildContainerIndexes`. We assert the fused builder's output is
// byte-for-byte identical to running these two side by side.
function refPositionIndex(rawPageById: Map<string, RawPage>): Map<string, number> {
  const childOrderByParent = new Map<string, string[]>();
  function* walk(blocks: NotionBlock[]): Generator<NotionBlock> {
    for (const b of blocks) {
      yield b;
      if (b.children?.length) yield* walk(b.children);
    }
  }
  for (const [containerId, data] of rawPageById) {
    const ordered: string[] = [];
    for (const b of walk(data.blocks ?? [])) {
      if (b.type === "child_page" || b.type === "child_database") ordered.push(b.id);
    }
    if (ordered.length > 0) childOrderByParent.set(containerId, ordered);
  }
  const positionById = new Map<string, number>();
  for (const ordered of childOrderByParent.values()) {
    ordered.forEach((cid, i) => {
      if (!positionById.has(cid)) positionById.set(cid, i);
    });
  }
  return positionById;
}

function refContainerIndexes(rawPageById: Map<string, RawPage>): {
  childPageParents: Map<string, Set<string>>;
  blockContainers: Map<string, Set<string>>;
} {
  const childPageParents = new Map<string, Set<string>>();
  const blockContainers = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, val: string): void => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(val);
  };
  function* walk(blocks: NotionBlock[]): Generator<NotionBlock> {
    for (const b of blocks) {
      yield b;
      if (b.children?.length) yield* walk(b.children);
    }
  }
  for (const [containerId, data] of rawPageById) {
    for (const b of walk(data.blocks ?? [])) {
      if (b.id) add(blockContainers, b.id, containerId);
      if (b.type === "child_page" || b.type === "child_database") {
        add(childPageParents, b.id, containerId);
      }
    }
  }
  return { childPageParents, blockContainers };
}

function sortedSets(m: Map<string, Set<string>>): Array<[string, string[]]> {
  return [...m.entries()]
    .map(([k, v]) => [k, [...v].sort()] as [string, string[]])
    .sort(([a], [b]) => a.localeCompare(b));
}

describe("buildRerenderIndexes (fused single-DFS)", () => {
  it("produces output identical to the previous two-pass implementation", () => {
    // Fixture with nesting + multiple parents + a synced child_page that
    // appears under two containers — exercises first-wins position, the
    // multi-valued childPageParents/blockContainers maps, and recursion
    // into block.children at the same time.
    const sharedChild: NotionBlock = {
      id: "shared-child",
      type: "child_page",
      has_children: false,
      child_page: { title: "Shared" },
    } as unknown as NotionBlock;

    const pageA: RawPage = {
      page: { id: "page-a", parent: { type: "workspace", workspace: true } },
      blocks: [
        {
          id: "a-block-1",
          type: "paragraph",
          has_children: false,
          paragraph: { rich_text: [] },
        } as unknown as NotionBlock,
        sharedChild,
        {
          id: "a-block-2",
          type: "toggle",
          has_children: true,
          toggle: { rich_text: [] },
          children: [
            {
              id: "a-nested-cp",
              type: "child_page",
              has_children: false,
              child_page: { title: "Nested" },
            } as unknown as NotionBlock,
            {
              id: "a-nested-db",
              type: "child_database",
              has_children: false,
              child_database: { title: "NestedDB" },
            } as unknown as NotionBlock,
          ],
        } as unknown as NotionBlock,
      ],
    };

    const pageB: RawPage = {
      page: { id: "page-b", parent: { type: "workspace", workspace: true } },
      blocks: [
        sharedChild,
        {
          id: "b-block-1",
          type: "paragraph",
          has_children: false,
          paragraph: { rich_text: [] },
        } as unknown as NotionBlock,
      ],
    };

    const pageC: RawPage = {
      page: { id: "page-c", parent: { type: "workspace", workspace: true } },
      blocks: [],
    };

    const rawPageById = new Map<string, RawPage>([
      ["page-a", pageA],
      ["page-b", pageB],
      ["page-c", pageC],
    ]);

    const fused = buildRerenderIndexes(rawPageById);
    const refPos = refPositionIndex(rawPageById);
    const refCont = refContainerIndexes(rawPageById);

    expect([...fused.positionById.entries()].sort()).toEqual([...refPos.entries()].sort());
    expect(sortedSets(fused.childPageParents)).toEqual(sortedSets(refCont.childPageParents));
    expect(sortedSets(fused.blockContainers)).toEqual(sortedSets(refCont.blockContainers));

    // Spot-check the load-bearing invariants the orchestrator depends on:
    //  • Shared child's position is from its FIRST owner — page-a, where it
    //    is the 0th child_page (a-block-1 is a paragraph and doesn't count
    //    toward the position counter).
    //  • Shared child appears under BOTH containers in childPageParents.
    expect(fused.positionById.get("shared-child")).toBe(0);
    expect(fused.childPageParents.get("shared-child")).toEqual(new Set(["page-a", "page-b"]));
    // Nested child_page resolves to its outer container (page-a), not the
    // toggle that wraps it — DFS recurses through `b.children`.
    expect(fused.childPageParents.get("a-nested-cp")).toEqual(new Set(["page-a"]));
    expect(fused.blockContainers.get("a-nested-cp")).toEqual(new Set(["page-a"]));
  });

  it("handles empty input cleanly", () => {
    const out = buildRerenderIndexes(new Map());
    expect(out.positionById.size).toBe(0);
    expect(out.childPageParents.size).toBe(0);
    expect(out.blockContainers.size).toBe(0);
  });
});
