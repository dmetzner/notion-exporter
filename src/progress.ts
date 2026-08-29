import type { ProgressEvent } from "./export/json.js";

export interface ProgressRenderer {
  handle(e: ProgressEvent): void;
  bumpAsset(): void;
  finish(): void;
}

export interface RendererOpts {
  out?: NodeJS.WriteStream;
  enabled?: boolean;
  now?: () => number;
}

export function createTtyRenderer(opts: RendererOpts = {}): ProgressRenderer {
  const out = opts.out ?? process.stderr;
  const enabled = opts.enabled ?? out.isTTY === true;
  const now = opts.now ?? (() => Date.now());
  const start = now();
  const state = { last: "", assets: 0, errors: 0, lastTitle: "" };
  let lastDone = 0;
  let lastTotal = 0;

  function write(line: string): void {
    if (!enabled) return;
    const padded = line.padEnd(state.last.length, " ");
    out.write(`\r${padded}`);
    state.last = line;
  }

  function bar(done: number, total: number, width = 20): string {
    if (total === 0) return "";
    const ratio = Math.min(1, done / total);
    const fill = Math.round(ratio * width);
    return `[${"█".repeat(fill)}${"·".repeat(width - fill)}]`;
  }

  function fmt(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function eta(done: number, total: number): string {
    if (done === 0) return "--:--";
    const elapsed = (now() - start) / 1000;
    const per = elapsed / done;
    return fmt(Math.max(0, (total - done) * per));
  }

  function redraw(): void {
    const truncated =
      state.lastTitle.length > 48 ? `${state.lastTitle.slice(0, 45)}…` : state.lastTitle;
    write(
      `${bar(lastDone, lastTotal)} ${lastDone}/${lastTotal}  errs:${state.errors}  assets:${state.assets}  ETA ${eta(lastDone, lastTotal)}  ${truncated}`,
    );
  }

  return {
    handle(e: ProgressEvent): void {
      switch (e.kind) {
        case "crawl": {
          // Live "discovering subpages" line while crawlAll walks block trees.
          // The export root + per-page progress haven't started yet, so we
          // overwrite a dedicated single-line ticker.
          if (!enabled) return;
          const msg = `discovering pages… visited:${e.visited} queued:${e.queued} total:${e.total}`;
          out.write(`\r${" ".repeat(state.last.length)}\r${msg}`);
          state.last = msg;
          return;
        }
        case "start":
          if (enabled) out.write(`crawled ${e.total} (${e.pages} pages, ${e.databases} dbs)\n`);
          state.last = "";
          lastTotal = e.total;
          return;
        case "page":
          state.lastTitle = `📄 ${e.title}`;
          lastDone = e.done;
          redraw();
          return;
        case "database":
          state.lastTitle = `🗂  ${e.title} (${e.rows} rows)`;
          lastDone = e.done;
          redraw();
          return;
        case "error":
          state.errors++;
          if (enabled) out.write(`\n  ⚠ ${e.id} — ${e.message}\n`);
          state.last = "";
          lastDone = e.done;
          redraw();
          return;
        case "done": {
          const elapsed = fmt((now() - start) / 1000);
          if (enabled) {
            out.write(
              `\r${" ".repeat(state.last.length)}\r✓ done in ${elapsed} · pages:${e.counts.pages} dbs:${e.counts.databases} errors:${e.counts.errors} assets:${state.assets}\n`,
            );
          }
          state.last = "";
        }
      }
    },
    bumpAsset(): void {
      state.assets++;
      if (state.last) redraw();
    },
    finish(): void {
      if (enabled && state.last) out.write("\n");
    },
  };
}
