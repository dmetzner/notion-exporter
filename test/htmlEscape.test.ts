import { describe, expect, it } from "vitest";
import { escapeHtmlText, mdUrl } from "../src/export/htmlEscape.js";

// Direct coverage for the invariant #8 primitive. `escapeHtmlText` is the one
// helper threaded into every operator-untrusted HTML *and* attribute context
// (titles, captions, emoji slugs, property values), so its contract — all five
// of `& < > " '`, ampersand first, no double-escape — is load-bearing for XSS
// containment. Previously only exercised transitively through html/markdown
// snapshots; a regression there could pass if a snapshot was regenerated.

describe("escapeHtmlText", () => {
  it("escapes all five entities", () => {
    expect(escapeHtmlText(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("escapes ampersand FIRST so entities aren't double-escaped", () => {
    // If `<` were replaced before `&`, the `&lt;` would become `&amp;lt;`.
    expect(escapeHtmlText("<")).toBe("&lt;");
    expect(escapeHtmlText("a & b")).toBe("a &amp; b");
    // An already-escaped-looking input must round to a single extra `&amp;`,
    // proving each source char is touched exactly once.
    expect(escapeHtmlText("&lt;")).toBe("&amp;lt;");
  });

  it("neutralizes an attribute-breakout XSS payload", () => {
    // The classic title="…" breakout: a stray quote + tag. Escaping " and <
    // means the payload can't close the attribute or open a tag.
    const payload = `"><img src=x onerror=alert(1)>`;
    const escaped = escapeHtmlText(payload);
    expect(escaped).not.toContain('"');
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).toBe("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes the single quote (attribute-delimiter safety)", () => {
    expect(escapeHtmlText("it's")).toBe("it&#39;s");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtmlText("plain text 123")).toBe("plain text 123");
    expect(escapeHtmlText("")).toBe("");
  });
});

describe("mdUrl", () => {
  it("percent-encodes chars that break a markdown link target or href attr", () => {
    expect(mdUrl(" ")).toBe("%20");
    expect(mdUrl("(")).toBe("%28");
    expect(mdUrl(")")).toBe("%29");
    expect(mdUrl("<")).toBe("%3C");
    expect(mdUrl(">")).toBe("%3E");
    expect(mdUrl('"')).toBe("%22");
    expect(mdUrl("`")).toBe("%60");
  });

  it("leaves URL-legitimate chars as-is (query/fragment must survive)", () => {
    // ? # & ' are intentionally NOT encoded — encoding them breaks query
    // strings and fragments.
    const url = "https://x.test/a?b=1&c=2#frag's";
    expect(mdUrl(url)).toBe(url);
  });

  it("encodes a spaced URL without mangling the rest", () => {
    expect(mdUrl("https://x.test/a b?q=1")).toBe("https://x.test/a%20b?q=1");
  });
});
