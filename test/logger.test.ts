import { describe, expect, it } from "vitest";
import { safeErrSerializer } from "../src/logger.js";

// `safeErrSerializer` is the pino `err` serializer that guards the log
// stream against a future `@notionhq/client` regression attaching the
// outgoing request (with its `Authorization: Bearer secret_…` header) to
// thrown `APIError` objects. Belt-and-braces; the current SDK doesn't
// expose `Authorization` anywhere. We assert the three exit paths:
// `headers.authorization`, top-level `config`, top-level `request`.

describe("safeErrSerializer", () => {
  it("preserves error message + stack", () => {
    const err = new Error("boom");
    const out = safeErrSerializer(err);
    expect(out.message).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  it("strips Authorization header (preserves the rest)", () => {
    const err = Object.assign(new Error("boom"), {
      headers: {
        Authorization: "Bearer secret_TOKEN_DO_NOT_LEAK",
        "content-type": "application/json",
      },
    });
    const out = safeErrSerializer(err);
    const headers = out.headers as Record<string, unknown>;
    expect(headers).toBeDefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
    // And nothing in the serialized payload mentions the token.
    expect(JSON.stringify(out)).not.toContain("secret_TOKEN_DO_NOT_LEAK");
  });

  it("strips lowercase `authorization` header", () => {
    const err = Object.assign(new Error("boom"), {
      headers: { authorization: "Bearer secret_LOWER" },
    });
    const out = safeErrSerializer(err);
    expect(JSON.stringify(out)).not.toContain("secret_LOWER");
  });

  it("drops top-level `config` and `request` keys", () => {
    const err = Object.assign(new Error("boom"), {
      config: { headers: { Authorization: "Bearer secret_C" } },
      request: { headers: { Authorization: "Bearer secret_R" } },
    });
    const out = safeErrSerializer(err);
    expect(out.config).toBeUndefined();
    expect(out.request).toBeUndefined();
    const text = JSON.stringify(out);
    expect(text).not.toContain("secret_C");
    expect(text).not.toContain("secret_R");
  });
});
