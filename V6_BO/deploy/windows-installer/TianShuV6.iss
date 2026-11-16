; 天枢智策 V6 · Windows native installer.
; This executable installs *application controls only*. WSL and account
; initialization require explicit confirmation in TianShu-FirstRun.ps1.
#ifndef SourceRoot
  #error SourceRoot must be supplied by a verified SHA-pinned CI bundle
#endif

[Setup]
AppId={{8EB4CD3A-D281-4A0B-A95F-89A5A7F9EF71}
AppName=天枢智策 V6
AppVersion=2026.11.16
AppPublisher=天枢智策 V6 工程
DefaultDirName={localappdata}\Programs\TianShuV6
DefaultGroupName=天枢智策 V6
DisableProgramGroupPage=yes
DisableDirPage=yes
UsePreviousAppDir=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
OutputBaseFilename=TianShuV6-Setup
Compression=lzma2
SolidCompression=yes
Uninstallable=yes
CloseApplications=no
RestartApplications=no
DisableReadyMemo=yes
ShowLanguageDialog=no
SetupLogging=yes
ChangesEnvironment=no
DisableWelcomePage=no
; No auto-update or account data removal on uninstall.
UninstallDisplayName=天枢智策 V6 安装程序

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\天枢智策 V6\继续安装或打开"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File ""{app}\runtime\TianShu-FirstRun.ps1"" -Mode Setup"; WorkingDir: "{app}\runtime"; Comment: "继续检查本机环境或打开现有服务"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File ""{app}\runtime\TianShu-FirstRun.ps1"" -Mode Setup"; Description: "检测运行环境、保留原账户并启动天枢智策"; WorkingDir: "{app}\runtime"; Flags: postinstall skipifsilent nowait runasoriginaluser
