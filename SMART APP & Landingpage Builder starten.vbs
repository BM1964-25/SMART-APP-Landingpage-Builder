Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = projectDir & "\logs"
logFile = logDir & "\landingpage-builder-server.log"

If Not fso.FolderExists(logDir) Then
  fso.CreateFolder(logDir)
End If

cmd = "cmd /c cd /d """ & projectDir & """ && set PORT=8173&& npm start >> """ & logFile & """ 2>&1"
shell.Run cmd, 0, False
WScript.Sleep 1500
shell.Run "http://127.0.0.1:8173/", 1, False
