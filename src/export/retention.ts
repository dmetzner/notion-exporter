import fsp from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../logger.js";

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

export async function applyRetention(outDir: string, keep: number, log: Logger): Promise<string[]> {
  if (keep <= 0) return [];
  let entries: string[];
  try {
    entries = await fsp.readdir(outDir);
  } catch {
    return [];
  }
  const stamped = entries.filter((e) => STAMP_RE.test(e)).sort(); // ascending lexicographic = chronological
  if (stamped.length <= keep) return [];
  const toDelete = stamped.slice(0, stamped.length - keep);
  for (const d of toDelete) {
    const abs = path.join(outDir, d);
    await fsp.rm(abs, { recursive: true, force: true });
    log.info({ removed: abs }, "retention pruned old export");
  }
  return toDelete;
}
