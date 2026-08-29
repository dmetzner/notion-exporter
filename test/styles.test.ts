import { describe, expect, it } from "vitest";
import { STYLE_CSS } from "../src/export/styles.js";

describe("STYLE_CSS", () => {
  it("forces [hidden] to win over layout display so filter-hiding works", () => {
    // Regression: the inline-db filter JS hides rows via `unit.hidden = true`.
    // Gallery cards set `.db-card { display: flex }`, which would override the
    // UA `[hidden] { display: none }` rule and leave filtered cards visible.
    // This global reset must stay so filtering actually hides gallery cards.
    expect(STYLE_CSS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});
