#!/usr/bin/env node
// Notion Export - portable refresh engine (Windows / macOS / Linux).
//
// Steps: git checkout main -> git pull -> npm install -> npm run build ->
// notion-exporter export. Then (unless --no-open) opens the newest export's
// HTML index in the default browser. All work happens in the upstream repo
// (its location is resolved by lib.mjs).
//
// Flags:
//   --no-open     do not open the browser when done (use for scheduled runs)
//   --no-update   skip git/npm; just export with the current build
//   --no-export   only update (git pull + build); do not run the export
//
// Exit code: 0 if the export step succeeded (or was skipped), 1 otherwise.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findLatestExport, isWin, openTarget, readOutDir, repoDir } from "./lib.mjs";

process.chdir(repoDir);

const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const noUpdate = args.includes("--no-update");
const noExport = args.includes("--no-export");

const pnpmCmd = isWin ? "pnpm.cmd" : "pnpm";
const npmCmd = isWin ? "npm.cmd" : "npm";
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => process.stdout.write(`[${stamp()}] ${m}\n`);

const issues = [];

function have(cmd) {
  return spawnSync(isWin ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
}

function step(name, cmd, cmdArgs) {
  log(`>> ${name}`);
  // Node 18.20+/20.12+/24 on Windows throws EINVAL when spawning a .cmd/.bat
  // (e.g. npm.cmd) without a shell (CVE-2024-27980 hardening). Run those via a
  // shell, passing one command string (args here are static, no spaces) to
  // avoid the args-array+shell deprecation. .exe commands (git, node) spawn
  // directly and may contain spaces, so they must NOT go through the shell.
  const useShell = isWin && /\.(cmd|bat)$/i.test(cmd);
  const res = useShell
    ? spawnSync([cmd, ...cmdArgs].join(" "), { stdio: "inherit", shell: true })
    : spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (res.error) {
    log(`   [FAIL] ${name}: ${res.error.message}`);
    issues.push(name);
    return false;
  }
  if (res.status !== 0) {
    log(`   [FAIL] ${name} (exit ${res.status})`);
    issues.push(name);
    return false;
  }
  log(`   [OK] ${name}`);
  return true;
}

log("================ Notion Export run starting ================");
log(`platform: ${process.platform}, node: ${process.version}`);
log(`repo: ${repoDir}`);

if (!noUpdate) {
  if (have("git")) {
    step("git checkout main", "git", ["checkout", "main"]);
    step("git pull", "git", ["pull", "--ff-only"]);
  } else {
    log(">> git not found - skipping source update");
    issues.push("git not found");
  }
  // This is a pnpm project (pnpm lockfile + tsup build). Prefer pnpm so a
  // clean install matches the committed lockfile; fall back to npm if pnpm
  // isn't installed (npm runs the same scripts, just risks lockfile drift).
  if (have(pnpmCmd)) {
    step("pnpm install", pnpmCmd, ["install"]);
    step("pnpm build", pnpmCmd, ["run", "build"]);
  } else if (have(npmCmd)) {
    log(">> pnpm not found - falling back to npm (may drift from pnpm lockfile)");
    step("npm install", npmCmd, ["install", "--no-audit", "--no-fund"]);
    step("npm run build", npmCmd, ["run", "build"]);
  } else {
    log(">> no package manager (pnpm/npm) found - skipping install/build");
    issues.push("no package manager found");
  }
}

const cli = path.join(repoDir, "dist", "cli.js");
let exportOk;
if (noExport) {
  log(">> export skipped (--no-export)");
  exportOk = true;
} else if (!existsSync(cli)) {
  log("FATAL: dist/cli.js missing - cannot export.");
  issues.push("dist/cli.js missing");
  exportOk = false;
} else {
  exportOk = step("notion-exporter export", process.execPath, [cli, "export"]);
}

if (!noOpen) {
  const latest = findLatestExport();
  if (latest) {
    const index = path.join(latest, "html", "index.html");
    const target = existsSync(index) ? index : latest;
    log(`Opening: ${target}`);
    openTarget(target);
  } else {
    log(`No export found under ${readOutDir()} - check NOTION_TOKEN in .env`);
  }
}

if (exportOk && issues.length === 0) {
  log("RESULT: SUCCESS");
  process.exit(0);
} else if (exportOk) {
  log(`RESULT: SUCCESS (with ${issues.length} warning(s))`);
  process.exit(0);
} else {
  log(`RESULT: FAILED (${issues.length} issue(s))`);
  for (const i of issues) log(`   - ${i}`);
  process.exit(1);
}
