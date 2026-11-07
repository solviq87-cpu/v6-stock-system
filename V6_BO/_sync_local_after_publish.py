# -*- coding: utf-8 -*-
"""
发版后「本机跟进」：自动覆盖本地 + 自动重启本机服务 + 校验版本。

为什么需要它（2026-10-05 实测踩到）：
  发版只保证【线上】是新的。本机那份要是不管，就会一直停在旧进程上 ——
  实测本机 node 是 Oct-3 起的，/api/lock/status 报 appVer=20261002db，
  而磁盘上的 server.js 早已是 20261005ag。用户在本地面板上看到的其实是旧逻辑，
  还会误以为"我改了怎么没生效"。

三件事：
  ① 用线上最新业务数据覆盖本地（线上是唯一真相源）
  ② 重启本机 8787（taskkill → 看门狗 start_daemon.py 约 10 秒自动拉起）
  ③ 轮询校验本机 appVer 与磁盘 server.js 的 APP_VER 一致

可单独跑：python _sync_local_after_publish.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
LOCAL = "http://127.0.0.1:8787"
PORT = 8787

# 只用线上覆盖这些业务数据。config/access 单独处理（见下）。
DATA_FILES = ["holdings.json", "paper.json", "stats.json", "news.json",
              "learnall.json", "pushlog.json", ".holdings_ops.json"]


def _post(path, obj):
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _get(path):
    with urllib.request.urlopen(ONLINE + path, timeout=60) as r:
        return json.load(r)


def _local_get(path):
    with urllib.request.urlopen(LOCAL + path, timeout=15) as r:
        return json.load(r)


def disk_ver():
    try:
        return open(os.path.join(ROOT, "server.js"), encoding="utf-8").read().split("APP_VER = '")[1].split("'")[0]
    except Exception:
        return ""


def login(pwd):
    r = _post("/api/lock/unlock", {"password": pwd, "role": "auto", "fp": "FPUB_SYNC02", "name": "本机副本同步"})
    if not r.get("ok"):
        raise SystemExit("线上登录失败：%s" % (r.get("error") or r))
    return r.get("deviceToken") or r.get("token")


def cover_local(tok):
    """① 线上业务数据覆盖本地（每个文件先留 .bak）"""
    exp = _get("/api/sync/export?token=" + urllib.parse.quote(tok))
    if not exp.get("ok"):
        print("   ⚠️ 线上数据导出失败，跳过覆盖：%s" % (exp.get("error") or ""))
        return 0
    files = exp.get("files") or {}
    n = 0
    for name in DATA_FILES:
        val = files.get(name)
        if not val:
            continue
        p = os.path.join(ROOT, name)
        try:
            if os.path.exists(p):
                shutil.copy2(p, p + ".bak")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(val, f, ensure_ascii=False, indent=2)
            n += 1
        except Exception as e:
            print("   ⚠️ 覆盖 %s 失败：%s" % (name, e))
    # config.json 特殊处理：采纳线上推送设置，但**保住本地的副本身份与转发令牌**
    cfg_on = files.get("config.json")
    if cfg_on:
        try:
            p = os.path.join(ROOT, "config.json")
            cur = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
            keep_sync = cur.get("syncUpstream")
            shutil.copy2(p, p + ".bak")
            cfg_on["pushRole"] = "replica"          # ⛔ 本机永远是副本，绝不能和线上抢推送
            if keep_sync:
                cfg_on["syncUpstream"] = keep_sync
            with open(p, "w", encoding="utf-8") as f:
                json.dump(cfg_on, f, ensure_ascii=False, indent=2)
            n += 1
        except Exception as e:
            print("   ⚠️ 覆盖 config.json 失败（保持原样）：%s" % e)
    print("   ① 已用线上数据覆盖本地 %d 个文件（原文件留 .bak）" % n)
    return n


def pid_on_port():
    try:
        # ⛔ 别用 text=True：中文 Windows 的 netstat 输出是 GBK，utf-8 解码直接抛
        #    UnicodeDecodeError → stdout 变 None → 后面 splitlines 炸。这里容错解码。
        raw = subprocess.run(["netstat", "-ano"], capture_output=True, timeout=20).stdout or b""
        out = raw.decode("utf-8", "ignore") or raw.decode("gbk", "ignore")
    except Exception:
        return None
    for line in out.splitlines():
        if ":%d" % PORT in line and "LISTENING" in line.upper():
            parts = line.split()
            if parts and parts[-1].isdigit():
                return parts[-1]
    return None


def restart_local():
    """② 杀掉本机 node，看门狗会自动拉起"""
    pid = pid_on_port()
    if not pid:
        print("   ② 本机 8787 没在跑，跳过重启（要开就双击桌面「本地看盘」）")
        return False
    # ⛔ 同理别加 text=True：taskkill 的「成功: 已终止 PID…」是 GBK，utf-8 解码会抛
    subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, timeout=20)
    print("   ② 已终止旧进程 %s，等看门狗拉起…" % pid)
    return True


def wait_ready(ver, timeout=75):
    """③ 轮询本机，直到 appVer 与磁盘一致"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(3)
        try:
            st = _local_get("/api/lock/status")
            got = st.get("appVer")
            if got == ver:
                print("   ③ 本机已就绪：appVer=%s  pushRole=%s（%.0fs）"
                      % (got, st.get("pushRole"), time.time() - t0))
                return True
        except Exception:
            pass
    print("   ⚠️ 等了 %ds 本机还没起来/版本不对 —— 手动双击桌面「本地看盘」" % timeout)
    return False


def main():
    print("=" * 62)
    print(" 发版后 · 本机跟进（自动覆盖 + 自动重启 + 校验）")
    print("=" * 62)
    ver = disk_ver()
    print(" 磁盘版本：%s" % ver)

    pwd = os.environ.get("QD_DEV_PWD") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not pwd:
        # 复用发版脚本里那份明文口令，避免每次手输
        try:
            src = open(os.path.join(ROOT, "_post_publish.py"), encoding="utf-8").read()
            pwd = src.split('DEV_PWD = "')[1].split('"')[0]
        except Exception:
            pwd = ""
    if not pwd:
        print(" ⚠️ 拿不到开发者口令，跳过数据覆盖（加参数：python _sync_local_after_publish.py <口令>）")
        tok = None
    else:
        tok = login(pwd)

    if tok:
        cover_local(tok)

    if restart_local():
        wait_ready(ver)
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
