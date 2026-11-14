' 量化看盘平台静默启动器：cmd 追加重定向，无窗口后台运行（路径均无空格）
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard && C:\Users\28957\.workbuddy\binaries\node\versions\22.22.2-3\node.exe server.js >> server.log 2>&1", 0, False
