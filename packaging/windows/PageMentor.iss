; PageMentor-Installer (Inno Setup 6)
; Installation pro Benutzer, Ort wählbar (Standard %LOCALAPPDATA%\Programs\PageMentor); die Engine-Festplatte
; liegt im Programmordner unter engine\disk und zieht mit
; Nutzerdaten wählbar (Standard Dokumente\PageMentor), werden nie gelöscht
; Bauen: ISCC.exe /DAppVersion=1.2.3 /DSourceDir=..\..\dist\PageMentor PageMentor.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\PageMentor"
#endif
#define Distro "PageMentor-Engine"
; Kennung der Werkzeuge (ffmpeg, Poppler, AtomicParsley): bin\ nur entpacken, wenn sie sich ändert
#define ToolsVerFile SourceDir + "\bin\tools.version"
#if FileExists(ToolsVerFile)
  #define ToolsVer Trim(FileRead(FileOpen(ToolsVerFile)))
#else
  #define ToolsVer ""
#endif

[Setup]
AppId={{6D8E1F0A-6E2B-4C55-9A5E-3F1B2C4D5E6F}
AppName=PageMentor
AppVersion={#AppVersion}
AppPublisher=PageMentor
DefaultDirName={localappdata}\Programs\PageMentor
; Ort immer wählbar, beim Update mit dem bisherigen vorbelegt
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=PageMentor-Setup-{#AppVersion}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\PageMentor.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
de.Desktop=Verknüpfung auf dem Desktop
en.Desktop=Desktop shortcut
de.Autostart=Mit Windows starten
en.Autostart=Start with Windows
de.NoNvidia=Es wurde kein NVIDIA-Treiber gefunden.%n%nPageMentor braucht für Sprachmodell und Vorlesestimme eine NVIDIA-Grafikkarte mit aktuellem Treiber. Trotzdem fortfahren?
en.NoNvidia=No NVIDIA driver was found.%n%nPageMentor needs an NVIDIA graphics card with a current driver for the language model and the reading voice. Continue anyway?
de.WslNeeded=PageMentor braucht das Windows-Subsystem für Linux (WSL).%n%nEs wird jetzt einmalig eingeschaltet. Windows fragt dafür nach Administratorrechten. Danach ist eventuell ein Neustart nötig, PageMentor startet dann automatisch weiter.
en.WslNeeded=PageMentor needs the Windows Subsystem for Linux (WSL).%n%nIt will be enabled once now. Windows will ask for administrator rights. A restart may be needed afterwards, PageMentor then continues automatically.
de.WslFailed=WSL konnte nicht eingeschaltet werden (Code %1). PageMentor zeigt beim Start eine Anleitung.
en.WslFailed=WSL could not be enabled (code %1). PageMentor shows instructions on start.
de.RemoveEngine=Auch die Engine-Umgebung mit Sprachmodellen und Programmpaketen löschen?%n%nIhre Dokumente, Karten und Hörbücher im Datenordner bleiben in jedem Fall erhalten.
en.RemoveEngine=Also delete the engine environment with language models and packages?%n%nYour documents, cards and audiobooks in the data folder are kept in any case.
de.Launch=PageMentor jetzt starten
en.Launch=Start PageMentor now
de.DataTitle=Datenordner
en.DataTitle=Data folder
de.DataSub=Wo sollen Dokumente, Karten, Hörbücher und die Wissensdatenbank liegen?
en.DataSub=Where should documents, cards, audiobooks and the knowledge base live?
de.DataText=Der Ordner wächst mit Ihren Heften und Hörbüchern. Er wird beim Deinstallieren nicht gelöscht.
en.DataText=The folder grows with your booklets and audiobooks. It is kept when uninstalling.
de.MoveData=Im bisherigen Datenordner liegen schon Daten:%n%1%n%nJetzt in den neuen Ordner verschieben?%n%2
en.MoveData=The previous data folder already contains data:%n%1%n%nMove it to the new folder now?%n%2
de.MoveFailed=Die Daten konnten nicht vollständig verschoben werden (robocopy %1). Bitte den Ordner von Hand verschieben.
en.MoveFailed=The data could not be moved completely (robocopy %1). Please move the folder manually.

[Tasks]
Name: "desktop"; Description: "{cm:Desktop}"
Name: "autostart"; Description: "{cm:Autostart}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; Excludes: "\bin"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Eigener Block am Ende: unverändert wird er übersprungen und nicht einmal entpackt
Source: "{#SourceDir}\bin\*"; DestDir: "{app}\bin"; Flags: ignoreversion recursesubdirs createallsubdirs solidbreak; Check: ToolsChanged

[UninstallDelete]
; Browser-Daten des App-Fensters
Type: filesandordirs; Name: "{app}\PageMentor.exe.WebView2"
Type: files; Name: "{app}\datadir.txt"

[Icons]
Name: "{userprograms}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"; Tasks: desktop
Name: "{userstartup}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\PageMentor.exe"; Description: "{cm:Launch}"; Flags: postinstall nowait skipifsilent
; Update aus der App (still mit /RESTART=1): danach wieder starten
Filename: "{app}\PageMentor.exe"; Flags: nowait; Check: RestartAfterUpdate

[Code]
var
  WslEnabledNow: Boolean;
  WslNeedsReboot: Boolean;
  RemoveEngine: Boolean;
  DataDirPage: TInputDirWizardPage;

function ToolsChanged(): Boolean;
var
  Installed: AnsiString;
begin
  Result := True;
  if ('{#ToolsVer}' <> '') and LoadStringFromFile(ExpandConstant('{app}\bin\tools.version'), Installed) then
    Result := Trim(String(Installed)) <> '{#ToolsVer}';
end;

// Bisheriger Datenordner aus der Registry, sonst Dokumente\PageMentor
function PreviousDataDir(): String;
begin
  if not RegQueryStringValue(HKCU, 'Software\PageMentor', 'DataDir', Result) or (Result = '') then
    Result := ExpandConstant('{userdocs}\PageMentor');
end;

function DataDir(): String;
begin
  Result := RemoveBackslashUnlessRoot(DataDirPage.Values[0]);
end;

procedure InitializeWizard();
begin
  DataDirPage := CreateInputDirPage(wpSelectDir, CustomMessage('DataTitle'), CustomMessage('DataSub'), CustomMessage('DataText'), False, '');
  DataDirPage.Add('');
  DataDirPage.Values[0] := PreviousDataDir();
end;

// Datenordner merken (Registry für das nächste Setup, datadir.txt für die App); bei Wechsel Daten mitnehmen
procedure ApplyDataDir();
var
  Old, New: String;
  Code: Integer;
  Lines: TArrayOfString;
begin
  Old := RemoveBackslashUnlessRoot(PreviousDataDir());
  New := DataDir();
  if (CompareText(Old, New) <> 0) and FileExists(Old + '\pagementor.db') and not FileExists(New + '\pagementor.db') then
    if SuppressibleMsgBox(FmtMessage(CustomMessage('MoveData'), [Old, New]), mbConfirmation, MB_YESNO, IDYES) = IDYES then
    begin
      Exec(ExpandConstant('{sys}\robocopy.exe'), '"' + Old + '" "' + New + '" /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS', '', SW_HIDE, ewWaitUntilTerminated, Code);
      Log('robocopy Daten: ' + IntToStr(Code));
      if Code >= 8 then
        SuppressibleMsgBox(FmtMessage(CustomMessage('MoveFailed'), [IntToStr(Code)]), mbError, MB_OK, IDOK);
    end;
  ForceDirectories(New + '\logs');
  RegWriteStringValue(HKCU, 'Software\PageMentor', 'DataDir', New);
  SetArrayLength(Lines, 1);
  Lines[0] := New;
  SaveStringsToUTF8File(ExpandConstant('{app}\datadir.txt'), Lines, False);
  Log('Datenordner: ' + New);
end;

function RunHidden(const Exe, Params: String; var Code: Integer): Boolean;
begin
  Result := Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function WslReady(): Boolean;
var
  Code: Integer;
begin
  Result := RunHidden(ExpandConstant('{sys}\wsl.exe'), '--status', Code) and (Code = 0);
end;

// Schon installiert: Update, dann ohne Rückfragen und Aufgabenseite
function IsUpdate(): Boolean;
begin
  Result := RegKeyExists(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6D8E1F0A-6E2B-4C55-9A5E-3F1B2C4D5E6F}_is1');
end;

function RestartAfterUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:RESTART|0}') = '1';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpdate() and ((PageID = wpSelectTasks) or (PageID = wpReady));
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  Log('Windows-Version: ' + GetWindowsVersionString());
  if IsUpdate() then
  begin
    Log('Update einer vorhandenen Installation');
    exit;
  end;
  if not FileExists(ExpandConstant('{sys}\nvidia-smi.exe')) then
  begin
    Log('Kein nvidia-smi.exe gefunden');
    Result := SuppressibleMsgBox(CustomMessage('NoNvidia'), mbConfirmation, MB_YESNO, IDYES) = IDYES;
  end;
end;

// App vor Installation beenden, sonst sind Dateien gesperrt
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  RunHidden(ExpandConstant('{sys}\taskkill.exe'), '/F /IM PageMentor.exe', Code);
  Result := '';
end;

procedure EnableWsl();
var
  Code: Integer;
begin
  // /NOWSL=1 für automatische Tests
  if ExpandConstant('{param:NOWSL|0}') = '1' then
  begin
    Log('WSL-Schritt übersprungen (/NOWSL=1)');
    exit;
  end;
  if WslReady() then
  begin
    Log('WSL ist bereit');
    exit;
  end;
  SuppressibleMsgBox(CustomMessage('WslNeeded'), mbInformation, MB_OK, IDOK);
  // Admin-Abfrage nur für diesen einen Schritt
  if ShellExec('runas', ExpandConstant('{sys}\wsl.exe'), '--install --no-distribution', '', SW_SHOW, ewWaitUntilTerminated, Code) then
  begin
    Log('wsl --install beendet mit Code ' + IntToStr(Code));
    WslEnabledNow := True;
    WslNeedsReboot := not WslReady();
  end
  else
  begin
    Log('wsl --install fehlgeschlagen: ' + IntToStr(Code));
    SuppressibleMsgBox(FmtMessage(CustomMessage('WslFailed'), [IntToStr(Code)]), mbError, MB_OK, IDOK);
  end;
end;

procedure CopySetupLog();
var
  Dest: String;
begin
  Dest := DataDir() + '\logs\install-' + GetDateTimeString('yyyy-mm-dd-hhnnss', '-', '-') + '.log';
  if CopyFile(ExpandConstant('{log}'), Dest, False) then
    Log('Setup-Log kopiert nach ' + Dest);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    ApplyDataDir();
    EnableWsl();
    // Nach Neustart automatisch weitermachen
    if WslNeedsReboot then
      RegWriteStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'PageMentor', '"' + ExpandConstant('{app}\PageMentor.exe') + '"');
  end;
  if CurStep = ssDone then
    CopySetupLog();
end;

function NeedRestart(): Boolean;
begin
  Result := WslNeedsReboot;
end;

function InitializeUninstall(): Boolean;
var
  Code: Integer;
begin
  RunHidden(ExpandConstant('{sys}\taskkill.exe'), '/F /IM PageMentor.exe', Code);
  RemoveEngine := SuppressibleMsgBox(CustomMessage('RemoveEngine'), mbConfirmation, MB_YESNO, IDNO) = IDYES;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if (CurUninstallStep = usUninstall) and RemoveEngine then
  begin
    // Erst abmelden, sonst ist die Disk gesperrt
    RunHidden(ExpandConstant('{sys}\wsl.exe'), '--unregister {#Distro}', Code);
    Log('wsl --unregister: ' + IntToStr(Code));
  end;
  if (CurUninstallStep = usPostUninstall) and RemoveEngine then
    DelTree(ExpandConstant('{app}\engine'), True, True, True);
end;
