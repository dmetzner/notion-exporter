# Notion Export - Windows engine (thin wrapper around the portable Node core).
# Delegates all logic to ..\refresh.mjs so Windows / macOS / Linux share one
# brain. Mirrors output to a rolling log file. Exit code follows the Node script.
#
# Used by gui.ps1 (captures stdout live) and the daily scheduled task.

param(
    [ValidateSet('full','update','export')]
    [string]$Mode = 'full',
    [string]$LogFile
)

$LauncherDir = Split-Path $PSScriptRoot -Parent
$Refresh = Join-Path $LauncherDir 'refresh.mjs'

$LogDir = Join-Path $LauncherDir 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
if (-not $LogFile) { $LogFile = Join-Path $LogDir 'notion-export.log' }

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) {
    $msg = '[{0}] FATAL: Node.js not found. Install Node 20+.' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    [Console]::Out.WriteLine($msg); Add-Content -Path $LogFile -Value $msg -Encoding UTF8
    exit 1
}

# Map mode -> engine flags. --no-open always: the GUI has its own Open button
# and scheduled runs are headless.
$flags = switch ($Mode) {
    'update' { @('--no-export') }
    'export' { @('--no-update') }
    default  { @() }
}
$flags += '--no-open'

# Run the portable engine; mirror every line to stdout + the log file.
& $node $Refresh @flags 2>&1 | ForEach-Object {
    $t = $_.ToString()
    [Console]::Out.WriteLine($t); [Console]::Out.Flush()
    Add-Content -Path $LogFile -Value $t -Encoding UTF8
}
exit $LASTEXITCODE
