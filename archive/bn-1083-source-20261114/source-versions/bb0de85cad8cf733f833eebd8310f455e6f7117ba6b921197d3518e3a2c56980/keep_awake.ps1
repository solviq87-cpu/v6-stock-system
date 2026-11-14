# 量化看盘·交易时段防休眠（工作日 08:00-15:30，由计划任务 QuantDashboard-KeepAwake 触发）
# 背景：线上托管容器一旦被回收，只有外部请求能把它拉回；本机副本(node)每3分钟ping线上是
#       唯一外置叫醒器。但电脑若在无人值守的上午自动休眠 → 副本被挂起 → 线上整段没人叫醒
#       （2026-10-16 周五 05:47~11:57 空窗7小时、错过竞价/大单，根因即此）。
# 做法：本进程存活期间持续持有 ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_AWAYMODE_REQUIRED，
#       阻止"系统"休眠（屏幕仍可正常关闭，不费显示）。到 15:30 或进程结束即自动释放。
#       ⛔ 不改任何电源计划 / 不改休眠超时设置 —— 纯粹靠"执行状态标志"，完全可逆、无持久改动。
# 卸载：删除计划任务 QuantDashboard-KeepAwake 即可（Unregister-ScheduledTask），本文件可一并删。

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class Awake {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS        = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED   = 0x00000001;
    public const uint ES_AWAYMODE_REQUIRED = 0x00000040;
}
'@
try { Add-Type -TypeDefinition $sig -ErrorAction Stop } catch { exit 3 }

# 今天 15:30 收工；已过点则立即退出（不无故占着）
$end = (Get-Date).Date.AddHours(15).AddMinutes(30)
if ((Get-Date) -ge $end) { exit 0 }

# 持有保持清醒标志，直到 15:30。每 50 秒续一次（ES_CONTINUOUS 下持续有效，续签只为稳妥）
$flags = [uint32](0x80000000 -bor 0x00000001 -bor 0x00000040)
while ((Get-Date) -lt $end) {
    [Awake]::SetThreadExecutionState($flags) | Out-Null
    Start-Sleep -Seconds 50
}
# 到点：单独发 ES_CONTINUOUS 清除本线程的执行要求，恢复正常休眠策略
[Awake]::SetThreadExecutionState([uint32]0x80000000) | Out-Null
