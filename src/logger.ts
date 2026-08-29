import pino from "pino";

// Defense-in-depth: a future `@notionhq/client` regression
// could start attaching the outgoing request (with its `Authorization:
// Bearer secret_…` header) to thrown `APIError` objects. Today's SDK
// doesn't, but the pino `err` serializer is the natural choke point —
// strip `config`, `request`, and any `authorization` header on the way
// out so a token can't reach the log stream regardless of error shape.
export function safeErrSerializer(err: unknown): Record<string, unknown> {
  const base = pino.stdSerializers.err(err as Error);
  const e = err as { headers?: Record<string, unknown> };
  const headers = e?.headers;
  let safeHeaders: Record<string, unknown> | undefined;
  if (headers && typeof headers === "object") {
    safeHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "authorization") continue;
      safeHeaders[k] = v;
    }
  }
  const { config: _config, request: _request, ...rest } = base as Record<string, unknown>;
  return safeHeaders ? { ...rest, headers: safeHeaders } : rest;
}

export function createLogger(level = "info") {
  const isTTY = process.stdout.isTTY;
  return pino({
    level,
    serializers: { err: safeErrSerializer },
    ...(isTTY
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
