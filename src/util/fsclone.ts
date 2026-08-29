import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Reproduce `srcAbs` at `dstAbs`. Tries `link` (hardlink, no extra disk),
 * falls back to `copyFile`. Missing parent dirs are created.
 * Silently returns false if the source doesn't exist.
 */
export async function cloneFile(srcAbs: string, dstAbs: string): Promise<boolean> {
  try {
    await fsp.access(srcAbs);
  } catch {
    return false;
  }
  await fsp.mkdir(path.dirname(dstAbs), { recursive: true });
  try {
    await fsp.link(srcAbs, dstAbs);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return true;
    if (code === "EXDEV" || code === "EPERM" || code === "ENOTSUP") {
      await fsp.copyFile(srcAbs, dstAbs);
      return true;
    }
    throw err;
  }
}
