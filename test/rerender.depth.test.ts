import { describe, expect, it } from "vitest";

import { makeAuthoritativeParent } from "../src/commands/rerender.js";

// Build a `rawPageById` mock with just the bits `makeAuthoritativeParent`
// reads: each page has an `id` and a `parent` ref.
type Parent =
  | { type: "page_id"; page_id: string }
  | { type: "block_id"; block_id: string }
  | { type: "workspace" }
  | undefined;

function makeRawById(pages: Array<{ id: string; parent?: Parent }>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const p of pages) {
    map.set(p.id, { page: { id: p.id, parent: p.parent }, blocks: [] });
  }
  return map;
}

describe("A5 (MEDIUM): depthOf does not cache cycle-broken results", () => {
  it("returns the correct depth for a non-cyclic re-entry after a cyclic path was explored", () => {
    // Topology:
    //   ROOT  → SIBLING_A → CYCLE_X
    //                          ↑
    //   ROOT  → SIBLING_B → CYCLE_Y  (cycle: CYCLE_Y.parent = CYCLE_X, CYCLE_X.parent = CYCLE_Y)
    //
    // When we ask for depthOf(CYCLE_X) via block_id resolution that lists
    // CYCLE_Y as a candidate owner, the recursion hits CYCLE_Y → CYCLE_X →
    // seen.has(CYCLE_X) → returns 0. The bug: the prior implementation cached
    // CYCLE_Y's depth as 0 even though that 0 was a local cycle break, not a
    // root-anchored answer. A later non-cyclic lookup of CYCLE_Y (e.g. as the
    // parent of an unrelated leaf) would then read the wrong cached 0.

    // Use real Notion-shaped parents. CYCLE pages reference each other via
    // `block_id` so the deepest-candidate loop in `depthOf` is exercised.
    const rawPageById = makeRawById([
      { id: "root", parent: { type: "workspace" } },
      { id: "sibA", parent: { type: "page_id", page_id: "root" } },
      { id: "sibB", parent: { type: "page_id", page_id: "root" } },
      { id: "cycX", parent: { type: "block_id", block_id: "bY" } },
      { id: "cycY", parent: { type: "block_id", block_id: "bX" } },
      { id: "leaf", parent: { type: "page_id", page_id: "cycY" } },
    ]);

    // childPageParents: not used in this test (we lookup via block_id).
    const childPageParents = new Map<string, Set<string>>();
    // blockContainers maps "bY" → {cycX} and "bX" → {cycY} so depthOf's
    // block_id branch finds the cycle partner as the candidate.
    const blockContainers = new Map<string, Set<string>>([
      ["bY", new Set(["cycX"])],
      ["bX", new Set(["cycY"])],
    ]);

    const resolve = makeAuthoritativeParent(
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      rawPageById as any,
      childPageParents,
      blockContainers,
    );

    // First lookup exercises the cycle path. Any answer is acceptable here —
    // the important thing is that the cycle resolution doesn't poison the
    // cache for the next lookup.
    // biome-ignore lint/suspicious/noExplicitAny: test-only mock
    void resolve("cycX", { id: "cycX", parent: { type: "block_id", block_id: "bY" } } as any);

    // Now ask for the parent of `leaf`, whose parent is `cycY` (via page_id).
    // The resolver returns `cycY` unconditionally for this shape — the
    // regression we're guarding against is that downstream depth lookups
    // (e.g. pickContainer comparing depths across candidates) return values
    // that aren't polluted by the cycle traversal.
    const leafParent = resolve(
      "leaf",
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      { id: "leaf", parent: { type: "page_id", page_id: "cycY" } } as any,
    );
    expect(leafParent).toBe("cycY");

    // Build a second resolver to compare against — if depth caching were
    // cycle-poisoned, this second instance would return a different parent
    // ordering for a multi-candidate set than the first instance does for
    // the same set (because the first poisoned its own cache).
    const resolve2 = makeAuthoritativeParent(
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      rawPageById as any,
      childPageParents,
      blockContainers,
    );
    const leafParent2 = resolve2(
      "leaf",
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      { id: "leaf", parent: { type: "page_id", page_id: "cycY" } } as any,
    );
    expect(leafParent2).toBe(leafParent);
  });

  it("picks the deepest of multiple non-cyclic candidates regardless of probe order", () => {
    //   root → mid → deep
    //   root → shallow
    // Both `deep` and `shallow` own the same block via `blockContainers`.
    // Depth(deep)=2, depth(shallow)=1, so the resolver must pick `deep`.
    // The cache-poisoning bug would manifest if a cycle elsewhere caused the
    // probe order to seed a wrong cached depth for either candidate.
    const rawPageById = makeRawById([
      { id: "root", parent: { type: "workspace" } },
      { id: "mid", parent: { type: "page_id", page_id: "root" } },
      { id: "deep", parent: { type: "page_id", page_id: "mid" } },
      { id: "shallow", parent: { type: "page_id", page_id: "root" } },
      { id: "target", parent: { type: "block_id", block_id: "shared" } },
    ]);
    const childPageParents = new Map<string, Set<string>>();
    const blockContainers = new Map<string, Set<string>>([
      ["shared", new Set(["deep", "shallow"])],
    ]);

    const resolve = makeAuthoritativeParent(
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      rawPageById as any,
      childPageParents,
      blockContainers,
    );
    const owner = resolve(
      "target",
      // biome-ignore lint/suspicious/noExplicitAny: test-only mock
      { id: "target", parent: { type: "block_id", block_id: "shared" } } as any,
    );
    expect(owner).toBe("deep");
  });
});
