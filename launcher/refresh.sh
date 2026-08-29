#!/usr/bin/env bash
# Notion Export - launcher for macOS / Linux.
# Runs the portable Node engine (update -> build -> export -> open).
# Usage: ./refresh.sh [--no-open] [--no-update] [--no-export]
set -euo pipefail
cd "$(dirname "$0")"
exec node refresh.mjs "$@"
