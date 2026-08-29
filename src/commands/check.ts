import type { Config } from "../config.js";
import { requireToken } from "../config.js";
import type { Logger } from "../logger.js";
import { RateLimitedNotion } from "../notion/client.js";
import { crawlAll } from "../notion/crawl.js";

export interface CheckResult {
  ok: boolean;
  user: { id: string; name: string | null; type: string } | null;
  visibleObjects: number;
  warnings: string[];
}

export async function runCheck(cfg: Config, log: Logger): Promise<CheckResult> {
  const token = requireToken(cfg);
  const notion = new RateLimitedNotion({ token, log });

  let me: { id: string; name: string | null; type: string } | null = null;
  try {
    const user = (await notion.run((c) => c.users.me({}))) as {
      id: string;
      name?: string | null;
      type?: string;
    };
    me = { id: user.id, name: user.name ?? null, type: user.type ?? "bot" };
    log.info({ user: me }, "token valid");
  } catch (err) {
    log.error({ err: (err as Error).message }, "token invalid");
    return { ok: false, user: null, visibleObjects: 0, warnings: ["token invalid"] };
  }

  const objects = await crawlAll(notion);
  const warnings: string[] = [];
  if (objects.length === 0) {
    warnings.push(
      "0 visible objects. Share at least one page/database with the integration (··· → Connections).",
    );
    log.warn(warnings[0]!);
  } else {
    log.info({ count: objects.length }, "visible objects");
  }

  return { ok: true, user: me, visibleObjects: objects.length, warnings };
}
