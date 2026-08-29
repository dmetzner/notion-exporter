#!/usr/bin/env node
// Notion Export - cross-platform terminal UI (Windows / macOS / Linux).
// Pure Node, no dependencies. Drives refresh.mjs with a live log and hotkeys.
//
//   U = Update (git pull + npm install + build)
//   E = Export now
//   A = Update AND export (full)
//   O = Open latest export       F = Open export folder
//   Q / Ctrl+C = Quit
//
// Run with:  node tui.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { findLatestExport, launcherDir, openTarget, readOutDir, repoDir } from "./lib.mjs";

const refresh = path.join(launcherDir, "refresh.mjs");
const outDir = readOutDir();

// ANSI helpers
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const out = (s) => process.stdout.write(s);

// Seed lastRun from the newest finished export on disk, so the banner shows
// real history instead of "never" until this session runs something.
function seedLastRun() {
  const latest = findLatestExport(outDir);
  if (!latest) return "never";
  // Dir name is a stamp like 2026-06-15T06-49-12Z -> "2026-06-15 06:49".
  const m = path.basename(latest).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : "never";
}

let status = "Idle";
let statusColor = C.green;
let lastRun = seedLastRun();
let child = null; // running child process, or null

function setStatus(s, color) {
  status = s;
  statusColor = color;
}

function hints() {
  out(
    `  ${C.bold}[U]${C.reset}pdate  ${C.bold}[E]${C.reset}xport  ${C.bold}[A]${C.reset}ll  ` +
      `${C.bold}[O]${C.reset}pen latest  ${C.bold}[F]${C.reset}older  ${C.bold}[Q]${C.reset}uit\n`,
  );
}

function banner() {
  out("\x1b[2J\x1b[H"); // clear screen, home cursor
  const line = "=".repeat(64);
  out(`${C.cyan}${line}${C.reset}\n`);
  out(`  ${C.bold}NOTION EXPORT${C.reset}  ${C.gray}- terminal UI${C.reset}\n`);
  out(`  Status: ${statusColor}${status}${C.reset}    Last run: ${lastRun}\n`);
  out(`  ${C.gray}Export to: ${outDir}${C.reset}\n`);
  out(`${C.cyan}${"-".repeat(64)}${C.reset}\n`);
  hints();
  out(`${C.cyan}${line}${C.reset}\n\n`);
}

function run(mode) {
  if (child) {
    out(`${C.yellow}A run is already in progress.${C.reset}\n`);
    return;
  }
  const flags = ["--no-open"];
  if (mode === "update") flags.push("--no-export");
  if (mode === "export") flags.push("--no-update");
  const label = mode === "update" ? "UPDATE" : mode === "export" ? "EXPORT" : "FULL";
  setStatus(`${label} running...`, C.yellow);
  out(`\n${C.cyan}========== ${label} ==========${C.reset}\n`);

  child = spawn(process.execPath, [refresh, ...flags], { cwd: repoDir });
  child.stdout.on("data", (d) => out(d.toString()));
  child.stderr.on("data", (d) => out(`${C.red}${d.toString()}${C.reset}`));
  child.on("close", (code) => {
    child = null;
    lastRun = new Date().toISOString().replace("T", " ").slice(0, 16);
    if (code === 0) {
      setStatus(`${label} OK`, C.green);
      out(`\n${C.green}Done.${C.reset}\n`);
    } else {
      setStatus(`${label} FAILED`, C.red);
      out(`\n${C.red}Failed (exit ${code}). See log above.${C.reset}\n`);
    }
    out(`  ${C.gray}Status: ${status}  |  Last run: ${lastRun}${C.reset}\n`);
    hints();
  });
}

function openLatest() {
  const latest = findLatestExport(outDir);
  if (!latest) {
    out(`${C.yellow}No export found under ${outDir}.${C.reset}\n`);
    return;
  }
  const index = path.join(latest, "html", "index.html");
  const target = existsSync(index) ? index : latest;
  out(`Opening ${target}\n`);
  openTarget(target);
}

function quit() {
  if (child) {
    try {
      child.kill();
    } catch {}
  }
  out("\nBye.\n");
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {}
  process.exit(0);
}

// --- input ---
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("keypress", (str, key) => {
  if (key?.ctrl && key.name === "c") return quit();
  switch ((str || "").toLowerCase()) {
    case "q":
      return quit();
    case "u":
      return run("update");
    case "e":
      return run("export");
    case "a":
      return run("full");
    case "o":
      return openLatest();
    case "f":
      return openTarget(outDir);
    default:
      return;
  }
});

banner();
