# -*- coding: utf-8 -*-
"""
从「线上实例」把业务数据拉回本地（换电脑 / 本机数据丢了 用这个）。

拉回什么：
  holdings.json  持仓（成本·股数·金额）
  config.json    飞书机器人·推送门槛·pushRole 等配置
  paper.json     模拟盘
  stats.json     命中率统计
  news.json      利好利空归档
  learnall.json  全 A 股学习库（很宝贵，重建要很久）
  pushlog.json   推送流水
  .holdings_ops.json 持仓变更流水
  access.json    登录凭据 + 已授权设备台账（由 accessAuth + machineKey 组装）

怎么用：
  python _fetch_online_data.py                 # 会提示输入开发者口令
  python _fetch_online_data.py --token e4_xxx  # 已有长期设备令牌时直接用
  python _fetch_online_data.py --out D:\\tmp   # 先落到别的目录看看

⛔ 拿回来的东西含真实凭据，只在自己电脑上用。
"""
import argparse
import getpass
import json
import os
import ssl
import sys
import urllib.request

HOST = os.environ.get("QD_HOST", "https://quant-dashboard-77614.app.workbuddy.host").rstrip("/")
FP = "FRESTORE01"          # 可读指纹，方便事后在面板里认出并撤销这一条


def _post(host, path, obj):
    req = urllib.request.Request(
        host + path,
        data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(host, path):
    req = urllib.request.Request(host + path, headers={"Connection": "close"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def login(host, pwd):
    r = _post(host, "/api/lock/unlock", {"password": pwd, "role": "auto", "fp": FP, "name": "restore"})
    if not r.get("ok"):
        raise SystemExit("登录失败：%s" % (r.get("error") or r))
    if r.get("role") != "edit":
        raise SystemExit("这个口令是「观看」权限，拉不回数据。请用开发者口令。")
    return r.get("deviceToken") or r.get("token")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default="", help="长期设备令牌，不给就用口令登录")
    ap.add_argument("--password", default="", help="开发者口令（不给就交互式输入）")
    ap.add_argument("--out", default=".", help="写到哪个目录，默认当前目录")
    ap.add_argument("--replica", action="store_true",
                    help="把 config.json 改成 pushRole=replica（第二台机器必加，否则两台抢着推送）")
    ap.add_argument("--host", default=HOST, help="线上域名，默认已填好")
    a = ap.parse_args()
    host = a.host.rstrip("/")

    tok = (a.token or "").strip()
    if not tok:
        pwd = a.password or getpass.getpass("开发者口令（输入不显示）：")
        tok = login(host, pwd.strip())
        print("登录成功，已取得令牌")

    print("正在从 %s 拉取业务数据 ..." % HOST)
    d = _get(host, "/api/sync/export?token=" + tok)
    if not d.get("ok"):
        raise SystemExit("导出失败：%s" % (d.get("error") or "需要开发者权限"))

    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    files = d.get("files") or {}
    n = 0
    for name, val in files.items():
        if val is None:
            print("  跳过 %s（线上也没有）" % name)
            continue
        p = os.path.join(out, name)
        if os.path.exists(p):
            try:
                os.replace(p, p + ".bak")
            except Exception:
                pass
        with open(p, "w", encoding="utf-8") as f:
            json.dump(val, f, ensure_ascii=False, indent=2)
        n += 1
        print("  %s" % name)

    aa = d.get("accessAuth")
    mk = d.get("machineKey")
    if aa:
        acc = dict(aa)
        if mk:
            acc["machineKey"] = mk
        p = os.path.join(out, "access.json")
        if os.path.exists(p):
            try:
                os.replace(p, p + ".bak")
            except Exception:
                pass
        with open(p, "w", encoding="utf-8") as f:
            json.dump(acc, f, ensure_ascii=False, indent=2)
        n += 1
        print("  access.json（登录凭据 + 设备台账）")
    else:
        print("  ⚠ 没拿到 accessAuth：口令/权限不足，access.json 没动")

    # 线上那份 config.json 的 pushRole 是 primary。原样落到第二台机器上，
    # 两台都会往你手机发推送 —— 这是最容易踩的坑，所以显式改掉。
    if a.replica:
        p = os.path.join(out, "config.json")
        try:
            c = json.load(open(p, encoding="utf-8"))
            c["pushRole"] = "replica"
            if isinstance(c.get("syncUpstream"), dict):
                c["syncUpstream"]["enabled"] = False
            json.dump(c, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            print("  已把 config.json 改成 pushRole=replica（不会跟线上抢推送）")
        except Exception as e:
            print("  ⚠ 改 pushRole 失败：%s" % e)
    elif (files.get("config") or {}).get("pushRole") != "replica":
        print()
        print("  ⚠ 拉回来的 config.json 是 pushRole=primary。")
        print("     如果这是第二台机器，务必改成 replica，否则两台都往你手机发推送：")
        print("       python _fetch_online_data.py --replica")

    print()
    print("完成：%d 个文件 → %s" % (n, out))
    print("线上版本：%s" % d.get("appVer", "?"))
    print()
    print("注意：access.json 里的「找回手机号」不在导出范围内（涉及隐私），")
    print("      恢复后请在面板「开发者锁」里重新绑定一次，否则「忘记密码」用不了。")
    print()
    print("注意：这次登录会在线上设备台账留一条 " + FP + "，用完记得在面板里撤销掉。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
