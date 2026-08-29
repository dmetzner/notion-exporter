# Notion Export - tray/GUI app.
# A small WPF window (with system-tray icon) that drives core.ps1: live log,
# Update + Export buttons, Open-latest button, daily-schedule toggle, and tray
# notifications. Closing the window hides it to the tray; use Exit to quit.

param([switch]$StartHidden, [switch]$SelfTest)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing

$WinDir      = $PSScriptRoot
$LauncherDir = Split-Path $WinDir -Parent
$RepoDir     = Split-Path $LauncherDir -Parent   # launcher/ sits inside the repo
$Core        = Join-Path $WinDir 'core.ps1'
$IcoPath     = Join-Path $LauncherDir 'assets\notion-export.ico'
$LogDir      = Join-Path $LauncherDir 'logs'
$TaskName    = 'NotionExport-Daily'
$ScheduleHour = 13   # 1:00 PM daily
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$PSExe = Join-Path $PSHOME 'powershell.exe'

# ----------------------------- UI definition -----------------------------
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Notion Export" Height="640" Width="600"
        WindowStartupLocation="CenterScreen" Background="#1B1A18">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Background" Value="#2E2C29"/>
      <Setter Property="Foreground" Value="#EDEDED"/>
      <Setter Property="BorderBrush" Value="#4A4844"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="10,6"/>
      <Setter Property="Margin" Value="0,0,8,0"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>
  </Window.Resources>
  <Grid Margin="14">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <TextBlock Grid.Row="0" Text="Notion Export" FontSize="22" FontWeight="Bold"
               Foreground="#FFFFFF" Margin="0,0,0,8"/>

    <StackPanel Grid.Row="1" Orientation="Horizontal" Margin="0,0,0,10">
      <TextBlock Text="Status: " Foreground="#AFAFAF" FontSize="13"/>
      <TextBlock x:Name="lblStatus" Text="Idle" Foreground="#7FD17F" FontSize="13" FontWeight="Bold"/>
      <TextBlock Text="     Last run: " Foreground="#AFAFAF" FontSize="13"/>
      <TextBlock x:Name="lblLast" Text="never" Foreground="#CFCFCF" FontSize="13"/>
    </StackPanel>

    <Border Grid.Row="2" Background="#100F0E" BorderBrush="#3A3835" BorderThickness="1" CornerRadius="4">
      <TextBox x:Name="txtLog" IsReadOnly="True" Background="#100F0E" Foreground="#D7D2C8"
               BorderThickness="0" FontFamily="Consolas" FontSize="12"
               VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
               TextWrapping="NoWrap" Padding="8"/>
    </Border>

    <Grid Grid.Row="3" Margin="0,12,0,0">
      <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
        <Button x:Name="btnUpdate" Content="Update"/>
        <Button x:Name="btnExport" Content="Export Now"/>
        <Button x:Name="btnOpen" Content="Open Latest Export"/>
        <Button x:Name="btnFolder" Content="Open Folder"/>
      </StackPanel>
      <CheckBox x:Name="chkSchedule" Content="Run daily in background (1:00 PM)"
                Foreground="#CFCFCF" VerticalAlignment="Center" HorizontalAlignment="Right"/>
    </Grid>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$win = [Windows.Markup.XamlReader]::Load($reader)

$lblStatus   = $win.FindName('lblStatus')
$lblLast     = $win.FindName('lblLast')
$txtLog      = $win.FindName('txtLog')
$btnUpdate   = $win.FindName('btnUpdate')
$btnExport   = $win.FindName('btnExport')
$btnOpen     = $win.FindName('btnOpen')
$btnFolder   = $win.FindName('btnFolder')
$chkSchedule = $win.FindName('chkSchedule')

if (Test-Path $IcoPath) {
    try { $win.Icon = [Windows.Media.Imaging.BitmapFrame]::Create([Uri]$IcoPath) } catch {}
}

# ----------------------------- shared state ------------------------------
$script:proc        = $null
$script:reader      = $null
$script:timer       = $null
$script:reallyExit  = $false
$script:running     = $false
$script:currentMode = 'full'

# ----------------------------- helpers -----------------------------------
function Append-Log([string]$text) {
    if ($null -eq $text) { return }
    $txtLog.AppendText($text + "`r`n")
    $txtLog.ScrollToEnd()
}

function Set-Status([string]$text, [string]$color) {
    $lblStatus.Text = $text
    $lblStatus.Foreground = (New-Object Windows.Media.BrushConverter).ConvertFromString($color)
}

function Get-OutDir {
    foreach ($f in @((Join-Path $RepoDir '.env.local'), (Join-Path $RepoDir '.env'))) {
        if (-not (Test-Path $f)) { continue }
        $m = Select-String -Path $f -Pattern '^\s*OUT_DIR\s*=\s*(.+?)\s*$' | Select-Object -First 1
        if ($m) {
            $val = $m.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
            if ($val) {
                if ([System.IO.Path]::IsPathRooted($val)) { return $val }
                return [System.IO.Path]::GetFullPath((Join-Path $RepoDir $val))
            }
        }
    }
    return (Join-Path $RepoDir 'exports')
}

function Get-LatestExport {
    $out = Get-OutDir
    if (-not (Test-Path $out)) { return $null }
    return Get-ChildItem -Path $out -Directory |
        Sort-Object Name -Descending |
        Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') } |
        Select-Object -First 1
}

function Open-Latest {
    $latest = Get-LatestExport
    if (-not $latest) { [System.Windows.MessageBox]::Show('No export found yet. Run an export first.','Notion Export') | Out-Null; return }
    $index = Join-Path $latest.FullName 'html\index.html'
    if (Test-Path $index) { Start-Process $index } else { Start-Process $latest.FullName }
}

function Open-Folder {
    $out = Get-OutDir
    if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out -Force | Out-Null }
    Start-Process $out
}

# ----------------------------- run engine --------------------------------
function Start-Run([string]$Mode = 'full') {
    if ($script:running) { return }
    $script:running = $true
    $script:currentMode = $Mode
    $btnUpdate.IsEnabled = $false
    $btnExport.IsEnabled = $false
    $label = switch ($Mode) { 'update' { 'Updating...' } 'export' { 'Exporting...' } default { 'Running...' } }
    Set-Status $label '#E6C84F'
    Append-Log ''
    Append-Log ('========== {0} ==========' -f $Mode.ToUpper())

    $stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outFile = Join-Path $LogDir "run-$stamp.out"
    Set-Content -Path $outFile -Value '' -Encoding UTF8

    # Single quoted string (not an array): PowerShell 5.1's Start-Process does
    # NOT auto-quote array elements, so a -File path containing spaces (e.g.
    # "...\Notion Export\...") would be split at the space. Quote it explicitly.
    $psArgs = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode {1}' -f $Core, $Mode
    $script:proc = Start-Process -FilePath $PSExe -ArgumentList $psArgs -WorkingDirectory $LauncherDir `
        -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError "$outFile.err" -PassThru

    $fs = [System.IO.FileStream]::new($outFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $script:reader = [System.IO.StreamReader]::new($fs)

    $script:timer = New-Object System.Windows.Threading.DispatcherTimer
    $script:timer.Interval = [TimeSpan]::FromMilliseconds(400)
    $script:timer.add_Tick({
        try {
            $chunk = $script:reader.ReadToEnd()
            if ($chunk) { $txtLog.AppendText($chunk); $txtLog.ScrollToEnd() }
        } catch {}
        if ($script:proc.HasExited) {
            $script:timer.Stop()
            Start-Sleep -Milliseconds 100
            try { $tail = $script:reader.ReadToEnd(); if ($tail) { $txtLog.AppendText($tail); $txtLog.ScrollToEnd() } } catch {}
            try { $script:reader.Dispose() } catch {}
            $errFile = "$outFile.err"
            if ((Test-Path $errFile) -and (Get-Item $errFile).Length -gt 0) {
                Append-Log (Get-Content -Raw $errFile)
            }
            $code = $script:proc.ExitCode
            $now = Get-Date -Format 'yyyy-MM-dd HH:mm'
            $what = switch ($script:currentMode) { 'update' { 'Update' } 'export' { 'Export' } default { 'Run' } }
            if ($code -eq 0) {
                $lblLast.Text = $now
                Set-Status ("Idle ($what OK)") '#7FD17F'
                $script:notify.ShowBalloonTip(5000, 'Notion Export', "$what finished successfully.", [System.Windows.Forms.ToolTipIcon]::Info)
            } else {
                Set-Status ("Idle ($what FAILED)") '#E07B7B'
                $script:notify.ShowBalloonTip(7000, 'Notion Export', "$what failed - open the app to see the log.", [System.Windows.Forms.ToolTipIcon]::Error)
            }
            $btnUpdate.IsEnabled = $true
            $btnExport.IsEnabled = $true
            $script:running = $false
        }
    })
    $script:timer.Start()
}

# ----------------------------- scheduling --------------------------------
function Test-ScheduleEnabled {
    try { return ((Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State -ne 'Disabled') }
    catch { return $false }
}

function Enable-Schedule {
    $argStr = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Core
    $action    = New-ScheduledTaskAction -Execute $PSExe -Argument $argStr -WorkingDirectory $LauncherDir
    $trigger   = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($ScheduleHour))
    $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

function Disable-Schedule {
    try { Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null } catch {}
}

# ----------------------------- tray icon ---------------------------------
$script:notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $IcoPath) { $script:notify.Icon = New-Object System.Drawing.Icon($IcoPath) }
else { $script:notify.Icon = [System.Drawing.SystemIcons]::Application }
$script:notify.Text = 'Notion Export'
$script:notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miUpd  = $menu.Items.Add('Update (pull + build)'); $miUpd.add_Click({ Start-Run 'update' })
$miExp  = $menu.Items.Add('Export Now');            $miExp.add_Click({ Start-Run 'export' })
$miOpen = $menu.Items.Add('Open Latest Export');    $miOpen.add_Click({ Open-Latest })
$miShow = $menu.Items.Add('Show Window');           $miShow.add_Click({ $win.Show(); $win.WindowState = 'Normal'; $win.Activate() })
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$miExit = $menu.Items.Add('Exit');                  $miExit.add_Click({ $script:reallyExit = $true; try { $script:notify.Visible = $false; $script:notify.Dispose() } catch {}; try { if ($script:timer) { $script:timer.Stop() } } catch {}; $script:app.Shutdown() })
$script:notify.ContextMenuStrip = $menu
$script:notify.add_MouseDoubleClick({ $win.Show(); $win.WindowState = 'Normal'; $win.Activate() })

# ----------------------------- wire events -------------------------------
$btnUpdate.add_Click({ Start-Run 'update' })
$btnExport.add_Click({ Start-Run 'export' })
$btnOpen.add_Click({ Open-Latest })
$btnFolder.add_Click({ Open-Folder })

$script:suppress = $true
$chkSchedule.IsChecked = (Test-ScheduleEnabled)
$script:suppress = $false
$chkSchedule.add_Checked({   if (-not $script:suppress) { Enable-Schedule;  Append-Log 'Daily background schedule ENABLED (1:00 PM).' } })
$chkSchedule.add_Unchecked({ if (-not $script:suppress) { Disable-Schedule; Append-Log 'Daily background schedule DISABLED.' } })

$win.add_Closing({
    param($s, $e)
    # Closing the window just hides it to the tray; real quit goes through Exit.
    if (-not $script:reallyExit) {
        $e.Cancel = $true
        $win.Hide()
        $script:notify.ShowBalloonTip(2000, 'Notion Export', 'Still running in the tray. Right-click the icon for options.', [System.Windows.Forms.ToolTipIcon]::Info)
    }
})

Append-Log 'Notion Export ready.'
Append-Log ("Repo:      {0}" -f $RepoDir)
Append-Log ("Export to: {0}" -f (Get-OutDir))
Append-Log 'Update = git pull + build. Export = run the backup. Or enable the daily schedule.'

if ($SelfTest) {
    foreach ($n in 'lblStatus','lblLast','txtLog','btnUpdate','btnExport','btnOpen','btnFolder','chkSchedule') {
        if ($null -eq $win.FindName($n)) { Write-Output "MISSING CONTROL: $n" }
    }
    try { $script:notify.Visible = $false; $script:notify.Dispose() } catch {}
    Write-Output 'SELFTEST OK'
    return
}

# Tray app: keep running even when the window is hidden/closed. Quit via Exit.
$script:app = New-Object System.Windows.Application
$script:app.ShutdownMode = [System.Windows.ShutdownMode]::OnExplicitShutdown
if (-not $StartHidden) { $win.Show() }
$script:app.Run() | Out-Null
