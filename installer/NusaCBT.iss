#ifndef AppVersion
  #define AppVersion "1.0.1"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\portable"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist\release"
#endif

[Setup]
AppId={{9F8B6C4E-42A1-4D88-9F1E-6A4B3C8D1001}
AppName=NusaCBT Server
AppVersion={#AppVersion}
AppVerName=NusaCBT Server v{#AppVersion}
AppPublisher=NusaCBT
AppPublisherURL=https://github.com/addinseptyan/nusacbt
AppSupportURL=https://github.com/addinseptyan/nusacbt/issues
AppUpdatesURL=https://github.com/addinseptyan/nusacbt/releases
DefaultDirName={autopf}\NusaCBT
DefaultGroupName=NusaCBT Server
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
AppMutex=Local\NusaCBT_Server_Launcher_Mutex
OutputDir={#OutputDir}
OutputBaseFilename=NusaCBT-Setup-v{#AppVersion}-win64
SetupIconFile=..\public\favicon.ico
UninstallDisplayIcon={app}\NusaCBT-Server.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Buat ikon pintasan di Desktop"; GroupDescription: "Ikon Tambahan:"

[Files]
Source: "{#SourceDir}\NusaCBT-Server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\NusaCBT Server"; Filename: "{app}\NusaCBT-Server.exe"; IconFilename: "{app}\NusaCBT-Server.exe"
Name: "{group}\Uninstall NusaCBT Server"; Filename: "{uninstallexe}"
Name: "{autodesktop}\NusaCBT Server"; Filename: "{app}\NusaCBT-Server.exe"; IconFilename: "{app}\NusaCBT-Server.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\NusaCBT-Server.exe"; Description: "Jalankan NusaCBT Server sekarang"; Flags: nowait postinstall skipifsilent
