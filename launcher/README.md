# Notion Export launcher

Cross-platform automation that lives **inside** this fork of
[`dmetzner/notion-exporter`](https://github.com/dmetzner/notion-exporter): it
updates the code, builds it, runs the export, and opens the result. One repo,
clone it on any device.

```
notion-exporter/            the repo (this fork)
├─ src/ ...                 upstream exporter source
└─ launcher/                <- our tooling
   ├─ lib.mjs               shared helpers: repo + OUT_DIR + latest-export + open
   ├─ refresh.mjs           portable engine: update -> build -> export -> open
   ├─ tui.mjs               cross-platform terminal UI (hotkeys)
   ├─ refresh.sh            macOS / Linux launcher for refresh.mjs
   ├─ windows/
   │  ├─ core.ps1           thin wrapper: runs refresh.mjs, mirrors output to logs/
   │  ├─ gui.ps1            WPF tray app (Update / Export / Open / daily schedule)
   │  └─ launch.vbs         starts the tray app with no console flash (self-locating)
   ├─ assets/notion-export.ico
   └─ logs/                 run logs (git-ignored)
```

## One brain, many front-ends

All real work is in **`refresh.mjs`**, which operates on the repo it lives in.
Everything else just calls it:

| Front-end            | How to run (from `launcher/`)              | Platform |
|----------------------|--------------------------------------------|----------|
| Terminal UI          | `node tui.mjs`  (or `npm run tui`)         | any      |
| CLI (one-shot)       | `node refresh.mjs [flags]`                 | any      |
| CLI (mac/linux)      | `./refresh.sh [flags]`                     | mac/lin  |
| Tray app / desktop   | double-click `windows/launch.vbs` or icon  | Windows  |
| Daily schedule       | toggle in the tray app (runs `core.ps1`)   | Windows  |

### refresh.mjs flags

- `--no-open` - don't open the browser when done (used by scheduled/headless runs)
- `--no-update` - skip git/npm; just export with the current build
- `--no-export` - only update (git pull + build); don't export

## Configuration

Secrets and settings live in the repo's **`.env`** / `.env.local`
(`NOTION_TOKEN`, `OUT_DIR`, ...) - both git-ignored. No private paths or tokens
are hard-coded in these scripts. The engine assumes the repo root is the parent
of `launcher/`; override with the `NOTION_EXPORTER_DIR` env var if needed.
