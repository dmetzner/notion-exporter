import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * `fs.readdir` that swallows ENOENT/permission errors and returns `[]`.
 * Used by the export commands when probing an export sub-tree that may not
 * exist yet (e.g. a fresh root before raw/pages has been written).
 */
export async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Resolve `candidate` against `root` and assert the result is contained within
 * `root`. Throws on traversal attempts (e.g. "../../etc/passwd") or absolute
 * paths that escape the root. Returns the resolved absolute path on success.
 *
 * Used at every site that joins a trusted root with an untrusted path drawn
 * from `manifest.json` or `raw/**\/*.json` — those files ship as plain text and
 * a malicious edit must not be able to read/write outside the export root.
 */
export function assertWithinRoot(root: string, candidate: string): string {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(rootResolved, candidate);
  const relative = path.relative(rootResolved, candidateResolved);

  // Empty relative === same path (root itself), which is allowed.
  const escapes =
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    // Windows: candidate's drive may differ from root's drive even when the
    // relative path looks benign. path.parse(<drive-letter path>).root is the
    // drive prefix on win32; "" elsewhere.
    (process.platform === "win32" &&
      path.parse(candidate).root !== "" &&
      path.parse(candidate).root.toLowerCase() !== path.parse(rootResolved).root.toLowerCase());

  if (escapes) {
    throw new Error(`path traversal blocked: ${candidate} escapes ${root}`);
  }
  return candidateResolved;
}

/**
 * Realpath-aware variant of {@link assertWithinRoot}. After the lexical gate
 * passes, both `root` and the resolved candidate are run through
 * `fsp.realpath` and containment is re-asserted. This blocks a symlink planted
 * inside the export tree from pointing at e.g. `/etc/passwd` or
 * `~/.aws/credentials` — the lexical check alone would pass.
 *
 * If the candidate doesn't exist yet (ENOENT — common for not-yet-written
 * output files) we fall back to the lexical resolution; pre-write callers
 * should keep using the sync `assertWithinRoot`.
 */
export async function assertWithinRootAsync(root: string, candidate: string): Promise<string> {
  const lexical = assertWithinRoot(root, candidate);
  try {
    const real = await fsp.realpath(lexical);
    const rootReal = await fsp.realpath(path.resolve(root));
    const rel = path.relative(rootReal, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `path traversal blocked (symlink): ${candidate} resolves to ${real}, outside ${rootReal}`,
      );
    }
    return real;
  } catch (err) {
    // ENOENT is expected for not-yet-written files — fall back to the lexical
    // result. Any other error (EACCES, the symlink-escape we just threw, etc.)
    // is propagated.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return lexical;
    throw err;
  }
}

/**
 * Read a file under `root` atomically — opens the file with `O_NOFOLLOW` so
 * the **leaf path component cannot be a symlink** (defeats the TOCTOU window
 * the old `assertWithinRootAsync` + `readFile` pattern leaves open: an
 * attacker can swap a regular file for a symlink between the gate and the
 * caller's reopen). After the open succeeds we still realpath-validate the
 * resolved path to catch a parent-directory symlink that points outside the
 * root.
 *
 * Callers that previously did
 *   `const p = await assertWithinRootAsync(root, rel); JSON.parse(await fsp.readFile(p, 'utf8'))`
 * should switch to this helper — there is no second open by path, so the
 * inode read is the same inode we validated.
 *
 * Tradeoffs:
 *  - `O_NOFOLLOW` is POSIX-portable and supported on macOS + Linux. On
 *    Windows the flag is silently ignored by libuv; the realpath check still
 *    runs but the gate degrades to the same TOCTOU window as before (we
 *    accept this — the target deployment is macOS/Linux per CLAUDE.md).
 *  - Parent-directory symlinks still rely on the realpath gate (Node has no
 *    cross-platform `openat`/`O_NOFOLLOW`-per-segment). The window between
 *    realpath and the prior `open` collapses to "the parent component is a
 *    symlink AND the attacker re-points it AND the kernel resolves the open
 *    after we realpath" — narrower than the old "any swap between
 *    realpath-of-path and readFile-by-path".
 */
/**
 * Variant of {@link readFileWithinRootAsync} that also returns the validated
 * absolute path — used by callers (e.g. `repair.ts`) that need the path for a
 * subsequent write. The path is the post-realpath value, so any later
 * `fsp.writeFile(path, …)` writes to the same inode we just read.
 */
export async function readFileWithinRootAsyncWithPath(
  root: string,
  candidate: string,
  encoding: BufferEncoding = "utf8",
): Promise<{ path: string; data: string }> {
  const { path: p, data } = await openAndReadAtomic(root, candidate, encoding);
  return { path: p, data };
}

export async function readFileWithinRootAsync(
  root: string,
  candidate: string,
  encoding: BufferEncoding = "utf8",
): Promise<string> {
  const { data } = await openAndReadAtomic(root, candidate, encoding);
  return data;
}

async function openAndReadAtomic(
  root: string,
  candidate: string,
  encoding: BufferEncoding,
): Promise<{ path: string; data: string }> {
  const lexical = assertWithinRoot(root, candidate);
  // Open first (atomic with respect to symlink-leaf swaps), then realpath the
  // path AND fstat the open handle to confirm we read the same inode that
  // realpath resolved.
  let fh: fsp.FileHandle;
  try {
    fh = await fsp.open(lexical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ELOOP / EMLINK: the leaf is a symlink and O_NOFOLLOW refused it.
    // Surface as a containment failure — a tampered export tree should never
    // contain a symlinked raw JSON file.
    if (code === "ELOOP" || code === "EMLINK") {
      throw new Error(
        `path traversal blocked (symlink leaf): ${candidate} is a symlink (refused via O_NOFOLLOW)`,
      );
    }
    throw err;
  }
  try {
    // Validate containment via realpath — catches a parent-component symlink
    // pointing outside the root. The leaf is guaranteed non-symlink by the
    // O_NOFOLLOW open above (on platforms that honor it).
    const real = await fsp.realpath(lexical);
    const rootReal = await fsp.realpath(path.resolve(root));
    const rel = path.relative(rootReal, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `path traversal blocked (symlink): ${candidate} resolves to ${real}, outside ${rootReal}`,
      );
    }
    // Read through the already-open fd — no second path-based open.
    const data = await fh.readFile({ encoding });
    return { path: real, data };
  } finally {
    await fh.close().catch(() => {});
  }
}
