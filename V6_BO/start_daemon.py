# -*- coding: utf-8 -*-
# 量化看盘平台看门狗（v3）：pythonw 常驻监督 node
# - 单实例锁：锁文件记录运行中 PID，已有活实例则本实例立即退出（根治多实例拉扯/弹窗）
# - node 意外退出 -> 10秒后自动拉起（自愈）
# - 服务端口已在运行 -> 不重复启动，30秒后复检（防双实例/防风暴）
import atexit
import os
import socket
import subprocess
import time

# ⚠️ 别写死小版本：本机实测 22.22.2-3 被清理后，看门狗 Popen 抛 FileNotFoundError
#    → pythonw 无控制台，错误看不见，表现就是"服务莫名没了且不再自愈"。
#    这里改成自动挑一个实际存在的 node.exe。
import glob as _glob
NODE = (sorted(_glob.glob(r"C:\Users\28957\.workbuddy\binaries\node\versions\*\node.exe")) or [r"C:\Users\28957\.workbuddy\binaries\node\versions\22.22.2-5\node.exe"])[-1]
WORKDIR = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
PORT = 8787

# 日志输出到【部署目录之外】的同级工件目录。
# ⛔ 2026-10-23 事故：server.log 长期写在 WORKDIR 里（实测涨到 30MB+），而发布工具打包
#   整个 WORKDIR——日志每次发版都被重传；且截断旧日志会让还开着旧 fd 的进程按原偏移
#   继续写，变成 31MB 全 NUL 的稀疏文件（体积全假、内容空洞）。日志一律出栈。
LOGDIR = os.path.join(os.path.dirname(WORKDIR), "stock-dashboard-artifacts", "logs")
os.makedirs(LOGDIR, exist_ok=True)

DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
CREATE_NO_WINDOW = 0x08000000
SPAWN_FLAGS = DETACHED | CREATE_NO_WINDOW  # 彻底无控制台窗口（杜绝黑窗/崩溃弹窗）
log = open(os.path.join(LOGDIR, "server.log"), "ab", buffering=0)


def log_line(s):
    log.write(("\n[watchdog %s] %s\n" % (time.strftime("%m-%d %H:%M:%S"), s)).encode("utf-8"))


def _pid_alive(pid):
    """纯系统调用探测 PID 是否为存活的 python 进程（不依赖第三方库）"""
    try:
        k = subprocess.run(
            ["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"],
            capture_output=True, timeout=8, creationflags=SPAWN_FLAGS,
        )
        return (str(pid).encode() in (k.stdout or b"")) and b"python" in (k.stdout or b"").lower()
    except Exception:
        return True  # 探测失败宁可不接管，避免双实例


LOCK = os.path.join(WORKDIR, "watchdog.lock")
_already = False
try:
    old = open(LOCK).read().strip()
    if old.isdigit() and int(old) != os.getpid() and _pid_alive(int(old)):
        log_line("已有看门狗实例 PID=%s 运行中，本实例(%d)自动退出" % (old, os.getpid()))
        _already = True
except Exception:
    pass
if _already:
    raise SystemExit(0)
try:
    with open(LOCK, "w") as f:
        f.write(str(os.getpid()))
except Exception:
    pass


def _cleanup_lock():
    try:
        cur = open(LOCK).read().strip()
        if cur == str(os.getpid()):
            os.remove(LOCK)
    except Exception:
        pass


atexit.register(_cleanup_lock)


def port_open():
    try:
        s = socket.create_connection(("127.0.0.1", PORT), timeout=1.5)
        s.close()
        return True
    except Exception:
        return False


log_line("看门狗启动（自愈模式·单实例锁）")
fail_streak = 0
while True:
    if port_open():
        fail_streak = 0
        time.sleep(30)  # 服务健康：只做复检，绝不重复启动
        continue
    log_line("端口 %d 无服务，启动 node（第 %d 次）" % (PORT, fail_streak + 1))
    p = subprocess.Popen(
        [NODE, "server.js"],
        cwd=WORKDIR,
        stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=SPAWN_FLAGS,
        close_fds=True,
    )
    log_line("node 已脱离启动 PID=%d" % p.pid)
    # 监督该进程直到退出
    while True:
        rc = p.poll()
        if rc is not None:
            break
        time.sleep(5)
    fail_streak += 1
    wait = 10 if fail_streak < 5 else 60  # 连续失败拉长间隔，避免风暴
    log_line("node 退出 rc=%s，%d 秒后重启" % (rc, wait))
    time.sleep(wait)
