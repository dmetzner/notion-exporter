import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runExport } from "./commands/export.js";
import { runRepair } from "./commands/repair.js";
import { runRerender } from "./commands/rerender.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createTtyRenderer } from "./progress.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("notion-exporter")
    .description("Back up a Notion workspace to local JSON + Markdown + HTML")
    .version(VERSION);

  program
    .command("check")
    .description("Validate NOTION_TOKEN and report visible objects")
    .action(async () => {
      const cfg = loadConfig();
      const log = createLogger(cfg.log.level);
      await runCheck(cfg, log);
    });

  program
    .command("export")
    .description("Export the workspace to a timestamped directory")
    .option("--dry-run", "List object IDs without writing files", false)
    .option("--out <dir>", "Output directory (overrides OUT_DIR)")
    .option("--retention <n>", "Keep only the last N exports (0 = keep all)")
    .option("--no-incremental", "Re-fetch every page even if unchanged (disables default)")
    .option("--no-resume", "Start fresh instead of continuing a partial export (disables default)")
    .option(
      "-f, --force",
      "Full fresh export: ignore previous output, refetch everything (equivalent to --no-incremental --no-resume)",
      false,
    )
    .option("--no-progress", "Disable progress bar (use JSON logs only)")
    .action(async (opts) => {
      const cfg = loadConfig();
      const useProgress = opts.progress !== false && process.stderr.isTTY === true && !opts.dryRun;
      const log = createLogger(useProgress ? "warn" : cfg.log.level);
      const renderer = useProgress ? createTtyRenderer() : null;
      // Defaults: incremental + resume both ON. --force overrides both.
      const incremental = opts.force ? false : opts.incremental !== false;
      const resume = opts.force ? false : opts.resume !== false;
      try {
        const result = await runExport(cfg, log, {
          dryRun: !!opts.dryRun,
          outDir: opts.out,
          retention: opts.retention !== undefined ? Number(opts.retention) : undefined,
          incremental,
          resume,
          onProgress: renderer ? (e) => renderer.handle(e) : undefined,
          onAsset: renderer ? () => renderer.bumpAsset() : undefined,
        });
        if (!result.dryRun && result.exportRoot) {
          const indexUrl = pathToFileURL(
            path.resolve(result.exportRoot, "html", "index.html"),
          ).href;
          process.stdout.write(`\nIndex: ${indexUrl}\n`);
        }
      } finally {
        renderer?.finish();
      }
    });

  program
    .command("rerender")
    .description(
      "Regenerate md/html/sitemap/search from existing raw JSONs — no Notion API calls, no asset re-downloads. Use after changing the renderer.",
    )
    .option("--export <dir>", "Export directory to rerender (default: most recent under OUT_DIR)")
    .action(async (opts) => {
      const cfg = loadConfig();
      const log = createLogger(cfg.log.level);
      // commander silently swallows action rejections — make failures visible.
      try {
        const result = await runRerender(cfg, log, { exportRoot: opts.export });
        process.stdout.write(
          `\nRerender complete: ${result.pages} pages, ${result.databases} databases.\n`,
        );
      } catch (err) {
        log.error({ err: (err as Error).message }, "rerender failed");
        process.exit(1);
      }
    });

  program
    .command("repair")
    .description(
      "Retry assets that failed in the last export (re-signs expired Notion S3 URLs without re-fetching everything)",
    )
    .option("--export <dir>", "Export directory to repair (default: most recent under OUT_DIR)")
    .action(async (opts) => {
      const cfg = loadConfig();
      const log = createLogger(cfg.log.level);
      try {
        const result = await runRepair(cfg, log, { exportRoot: opts.export });
        process.stdout.write(
          `\nRepair complete: ${result.refreshed}/${result.scanned} refreshed, ${result.stillFailing} still failing.\n`,
        );
      } catch (err) {
        log.error({ err: (err as Error).message }, "repair failed");
        process.exit(1);
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
