; PageMentor-Installer (Inno Setup 6)
; Installation pro Benutzer nach %LOCALAPPDATA%\Programs\PageMentor
; Nutzerdaten in Dokumente\PageMentor, werden nie gelöscht
; Bauen: ISCC.exe /DAppVersion=1.2.3 /DSourceDir=..\..\dist\PageMentor PageMentor.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\PageMentor"
#endif
#define Distro "PageMentor-Engine"

[Setup]
AppId={{6D8E1F0A-6E2B-4C55-9A5E-3F1B2C4D5E6F}
AppName=PageMentor
AppVersion={#AppVersion}
AppPublisher=PageMentor
DefaultDirName={localappdata}\Programs\PageMentor
DisableDirPage=yes
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
de.RemoveEngine=Auch die Engine-Umgebung mit Sprachmodellen und Programmpaketen löschen?%n%nIhre Dokumente, Karten und Hörbücher in Dokumente\PageMentor bleiben in jedem Fall erhalten.
en.RemoveEngine=Also delete the engine environment with language models and packages?%n%nYour documents, cards and audiobooks in Documents\PageMentor are kept in any case.
de.Launch=PageMentor jetzt starten
en.Launch=Start PageMentor now

[Tasks]
Name: "desktop"; Description: "{cm:Desktop}"
Name: "autostart"; Description: "{cm:Autostart}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{userdocs}\PageMentor"; Flags: uninsneveruninstall
Name: "{userdocs}\PageMentor\logs"; Flags: uninsneveruninstall

[UninstallDelete]
; Browser-Daten des App-Fensters
Type: filesandordirs; Name: "{app}\PageMentor.exe.WebView2"

[Icons]
Name: "{userprograms}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"; Tasks: desktop
Name: "{userstartup}\PageMentor"; Filename: "{app}\PageMentor.exe"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\PageMentor.exe"; Description: "{cm:Launch}"; Flags: postinstall nowait skipifsilent

[Code]
var
  WslEnabledNow: Boolean;
  WslNeedsReboot: Boolean;
  RemoveEngine: Boolean;

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

function InitializeSetup(): Boolean;
begin
  Result := True;
  Log('Windows-Version: ' + GetWindowsVersionString());
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
  Dest := ExpandConstant('{userdocs}\PageMentor\logs\install-') + GetDateTimeString('yyyy-mm-dd-hhnnss', '-', '-') + '.log';
  if FileCopy(ExpandConstant('{log}'), Dest, False) then
    Log('Setup-Log kopiert nach ' + Dest);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
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
