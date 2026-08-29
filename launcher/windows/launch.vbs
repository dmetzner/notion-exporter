' Launches the Notion Export tray/GUI app with no console window flash.
' Self-locating: derives its own folder, so there are no hard-coded paths.
Dim fso, sh, here, ps
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
ps = "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File """ & here & "\gui.ps1"""
sh.Run ps, 0, False
