# -*- coding: utf-8 -*-
"""发布后的两个必补动作（漏一个就出事，别省）

① machineKey 随 access.json 被覆盖 → 线上已签发的令牌全部失效。
   重新用开发者密码换一个【92 位 deviceToken】，写回本地 config.json 的 syncUpstream.token，
   否则本地实例的写操作转发到线上会 401 —— 手机上改持仓会失败。
   ⚠️ 必须是 deviceToken（92 位），不是 token（48 位）。

② 只读「世代号」被重置回 0 → 之前作废的旧只读令牌复活。
   再调一次 /api/lock/change（role=view，密码不变）把世代号 +1。
"""
import json, os, sys, urllib.request, urllib.parse

ROOT = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard"
ONLINE = "https://quant-dashboard-77614.app.workbuddy.host"
DEV_PWD = "Qdjs2026@Lock"  # js 轮（2026-10-22）经用户要求更换；线上已生效（gen=5），旧口令 Libao1314 作废
VIEW_PWD = "QD410816"


def post(path, obj, token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["x-device-token"] = token
    req = urllib.request.Request(ONLINE + path, data=json.dumps(obj).encode("utf-8"),
                                 method="POST", headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    # ① 重签 deviceToken
    tr = post("/api/lock/trust", {"password": DEV_PWD, "name": "发布后重签", "role": "edit", "fp": "FPUBLISH01"})
    if not tr.get("ok"):
        raise SystemExit("线上登录失败: %s" % tr.get("error"))
    tok = tr.get("deviceToken") or ""
    if len(tok) < 80:
        raise SystemExit("拿到的是短令牌(%d 位)，不是 deviceToken —— 已中止，别写坏本地配置" % len(tok))
    print("① 已签发 deviceToken（%d 位）" % len(tok))

    cfgp = os.path.join(ROOT, "config.json")
    cfg = json.load(open(cfgp, encoding="utf-8"))
    su = cfg.setdefault("syncUpstream", {})
    su["token"] = tok
    su["enabled"] = True
    su["url"] = ONLINE
    cfg["pushRole"] = "replica"
    with open(cfgp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("② 已写回本地 syncUpstream.token，且保持 pushRole=replica")

    # ② 只读世代号 +1
    ch = post("/api/lock/change", {"role": "view", "newPassword": VIEW_PWD, "token": tok})
    print("③ /api/lock/change(role=view) →", json.dumps(ch, ensure_ascii=False)[:200])

    # ③ 自检
    # ⚠️ /api/state 是受门禁保护的：不带上一步拿到的 deviceToken，服务端直接回
    #    {locked:true,needPassword:true} —— 这一路自检会永远打印 appVer=None，
    #    看上去"发布成功但读不到版本"，其实是自己没带凭证（2026-10-02 查实）。
    st = json.load(urllib.request.urlopen(ONLINE + "/api/state?token=" + urllib.parse.quote(tok), timeout=40))
    _role = json.load(urllib.request.urlopen(ONLINE + "/api/lock/status?token=" + urllib.parse.quote(tok), timeout=30))
    # ⚠️ appVer 在 /api/lock/status 里，**不在 /api/state**（那里返回 None），别读错接口。
    print("\n线上自检: appVer=%s  pushRole=%s  令牌身份=%s  世代号(dev/view)=%s/%s"
          % (_role.get("appVer"), st.get("pushRole"), _role.get("role"),
             _role.get("gen"), _role.get("viewGen")))
    # ⚠️⚠️ 2026-10-03 修：这里原先写的是 st.get("appVer")（/api/state），但上面第 61 行注释
    #    已经写得很清楚 —— appVer 在 /api/lock/status，state 里压根没有这个字段。
    #    结果每次发布完都必定打印"⚠️ 线上版本与本地不一致"，看着像滚动更新没完成，
    #    其实是自检脚本自己读错了接口。改成 _role.get("appVer") 后才是真比对。
    if _role.get("appVer") != open(os.path.join(ROOT, "server.js"), encoding="utf-8").read().split("APP_VER = '")[1].split("'")[0]:
        print("   ⚠️ 线上版本与本地 server.js 不一致 —— 可能还在滚动更新，稍等 30 秒再看")

    # ④ 从线上拉持仓覆盖本地（用户要求「发布后覆盖本地」）
    #    方向严格单向：线上 → 本地。绝不反向（铁律：持仓以线上为准，本地是开发副本）。
    try:
        h = json.loads(urllib.request.urlopen(
            ONLINE + "/api/holdings?token=" + urllib.parse.quote(tok), timeout=40).read())
        if h.get("ok"):
            data = h.get("data") if isinstance(h.get("data"), dict) else h
            items = (data or {}).get("items", []) if isinstance(data, dict) else (h.get("items") or [])
            local_h = json.load(open(os.path.join(ROOT, "holdings.json"), encoding="utf-8"))
            local_h["items"] = items
            with open(os.path.join(ROOT, "holdings.json"), "w", encoding="utf-8") as f:
                json.dump(local_h, f, ensure_ascii=False, indent=2)
            print("④ 本地持仓已从线上同步：", len(items), "条")
        else:
            print("④ 线上持仓接口未返回 ok，跳过同步：", h.get("error"))
    except Exception as e:
        print("④ 同步持仓失败（不影响发布）：", e)

    # ⑤ 重新生成桌面快捷方式（用户要求「每次发布后重新生成快捷方式放桌面并删旧的」）
    #    本机桌面是 OneDrive 重定向路径（C:\Users\28957\Desktop 用户看不到）。
    #    用 .url（InternetShortcut）格式 —— 最稳，双击直接开浏览器。
    try:
        import glob as _glob
        desktop = r"C:\Users\28957\OneDrive\Desktop"
        if not os.path.isdir(desktop):
            desktop = r"C:\Users\28957\Desktop"   # 兜底
        # 删旧的量化看盘快捷方式（按命名约定）
        removed = 0
        for old in _glob.glob(os.path.join(desktop, "量化看盘*.url")):
            try: os.remove(old); removed += 1
            except Exception: pass
        link = ONLINE + "/"
        url_path = os.path.join(desktop, "量化看盘.url")
        with open(url_path, "w", encoding="utf-8") as f:
            f.write("[InternetShortcut]\r\n")
            f.write("URL=" + link + "\r\n")
            f.write("IconFile=" + link + "favicon.ico\r\n")
            f.write("IDList=\r\n")
        print("⑤ 桌面快捷方式已重生成（删旧 %d 个 → 新建「量化看盘.url」）" % removed)
        print("   位置：" + url_path)
    except Exception as e:
        print("⑤ 生成快捷方式失败（不影响发布）：", e)

    # ⑥ 每次发版后自动重新打包源码（带版本号）
    #    用户 2026-10-18 要求「源码不用发在桌面上了」；2026-10-23 起产物也不落回 ROOT
    #    （堆在 ROOT 会被发布工具整包上传，冲爆 CloudStudio 网关 800MiB 上限，见 _build_zip.py），
    #    统一输出到部署目录之外的同级工件目录 stock-dashboard-artifacts/源码包/。
    #    完整版文件名带版本号 → 每次生成新文件，不会覆盖旧包（可留档追溯）；
    #    去凭据版文件名固定 → 会被覆盖（已剔除 config/access 及含明文口令的文件，可安全外传）。
    try:
        import subprocess
        ver = open(os.path.join(ROOT, "server.js"), encoding="utf-8").read().split("APP_VER = '")[1].split("'")[0]
        r = subprocess.run([sys.executable, os.path.join(ROOT, "_build_zip.py"), ver],
                           cwd=ROOT, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "").strip()[:200])
        art = os.path.join(os.path.dirname(ROOT), "stock-dashboard-artifacts", "源码包")
        names = ["量化看盘平台_源码_%s.zip" % ver, "量化看盘平台_源码_去凭据版.zip"]
        copied = [n for n in names if os.path.isfile(os.path.join(art, n))]
        print("⑥ 源码包已重打并保留在工件目录（版本 %s）：%s" % (ver, "、".join(copied) or "无"))
        print("   位置：%s" % art)
    except Exception as e:
        print("⑥ 打包源码失败（不影响发布）：", e)


    # ⑦ 发版后自动同步源码到 Gitee 私有仓库（用户要求"每次发版都上传"，作源码备份）
    #    仅提交源码与守门测试；凭证/数据/缓存/临时产物已被 .gitignore 拦住，绝不会入库。
    #    推送失败只告警，不影响发布结果。
    try:
        import subprocess as _sp
        ver = open(os.path.join(ROOT, "server.js"), encoding="utf-8").read().split("APP_VER = '")[1].split("'")[0]
        sp = _sp.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        if not sp.stdout.strip():
            print("⑦ Gitee：本次无源码改动，跳过")
        else:
            _sp.run(["git", "add", "-A"], cwd=ROOT, check=True, capture_output=True, text=True, timeout=60)
            cm = _sp.run(["git", "commit", "-m", ver + "：源码同步（发版自动上传）"], cwd=ROOT, capture_output=True, text=True, timeout=60)
            if cm.returncode != 0:
                print("⑦ Gitee 提交未产生变更：", (cm.stderr or cm.stdout or "").strip()[:160])
            else:
                ps = _sp.run(["git", "push", "gitee", "master"], cwd=ROOT, capture_output=True, text=True, timeout=120)
                if ps.returncode != 0:
                    print("⑦ Gitee 推送失败（不影响发布）：", (ps.stderr or ps.stdout or "").strip()[:160])
                else:
                    print("⑦ 已同步到 Gitee（%s）：源码 + 守门测试" % ver)
    except Exception as e:
        print("⑦ Gitee 同步异常（不影响发布）：", e)

    # ⑧ 源码包同步发到私密通道（2026-10-05 用户要求「私密通道可以同步发源码」）
    #    去凭据版源码包 → base64 → 上传线上 → 线上生成随机令牌下载链接 → 只推本人私密机器人。
    #    ⛔ 群机器人永不收到源码包链接：服务端硬闸，没配私密通道就直接不外发。
    #    ⛔ 只传【去凭据版】：完整版含 config/access 凭据，只留在桌面，绝不上网。
    try:
        import base64
        # 这里自己读一遍版本号：⑥⑦ 都在各自的 try 里赋值，万一它们先炸了 ver 就不存在
        ver = open(os.path.join(ROOT, "server.js"), encoding="utf-8").read().split("APP_VER = '")[1].split("'")[0]
        # 源码包自 ju 后续轮起输出到部署目录之外的同级工件目录（见 _build_zip.py 事故注释），
        # 但兼容仍在 ROOT 的旧包：两边都找，优先工件目录。
        zp_art = os.path.join(os.path.dirname(ROOT), "stock-dashboard-artifacts", "源码包", "量化看盘平台_源码_去凭据版.zip")
        zp = zp_art if os.path.isfile(zp_art) else os.path.join(ROOT, "量化看盘平台_源码_去凭据版.zip")
        if not os.path.isfile(zp):
            print("⑧ 未找到去凭据版源码包，跳过（第⑥步可能失败了）")
        else:
            size = os.path.getsize(zp)
            if size > 30 * 1024 * 1024:
                print("⑧ 源码包 %.1f MB 过大，跳过上传" % (size / 1048576.0))
            else:
                with open(zp, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                # 令牌两头都给（body + x-device-token 头）：线上走反代，两种取法都留条路
                r = post("/api/srcpkg", {"token": tok, "b64": b64, "ver": ver,
                                         "name": "量化看盘平台_源码_%s_去凭据版.zip" % ver}, tok)
                if r.get("ok"):
                    if r.get("sent"):
                        print("⑧ 源码包已发私密机器人（%.1f MB）：%s" % (size / 1048576.0, r.get("url")))
                    else:
                        print("⑧ 源码包已上传但【未外发】：%s" % (r.get("note") or r.get("error") or "未知原因"))
                else:
                    print("⑧ 源码包上传失败：%s" % (r.get("error") or r))
    except Exception as e:
        print("⑧ 源码包同步失败（不影响发布）：", e)

    # ⑨ 本机跟进（2026-10-05 用户要求「本地记得自动覆盖」）
    #    发版只保证线上是新的；本机不管就会一直停在旧进程上（实测本机曾停在 3 天前的进程，
    #    面板显示旧逻辑，还会被误判成"改了没生效"）。这一步：线上数据覆盖本地 → 重启本机 → 校验版本。
    #    具体数据一律**以线上为准**（用户明确要求），本地旧的/残缺的一律让位。
    #    跳过开关：环境变量 QD_SKIP_LOCAL_SYNC=1
    try:
        import subprocess as _sp2
        if os.environ.get("QD_SKIP_LOCAL_SYNC") == "1":
            print("⑨ 本机跟进：按 QD_SKIP_LOCAL_SYNC 跳过")
        else:
            r = _sp2.run([sys.executable, os.path.join(ROOT, "_sync_local_after_publish.py")],
                         cwd=ROOT, capture_output=True, timeout=240)
            # ⛔ 别用 text=True：中文 Windows 子进程输出是 GBK，utf-8 解码会抛（netstat/taskkill 都踩过）
            out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "ignore")
            for line in out.strip().splitlines()[-9:]:
                print("⑨ " + line)
    except Exception as e:
        print("⑨ 本机跟进失败（不影响发布）：", e)

    # ⑩ 发布说明文档（2026-10-28 用户立规：每发布一个版本，必须出一份项目文档——改了什么/好处/弊端）
    #    改动清单自动从 git 区间提取（上一版 release 提交 → HEAD）；「好处/弊端」由发布出口人工核定后
    #    写 notes.json 再重跑补上，未补的模块会显式标「待补」，绝不编造。
    #    只生成不阻断：失败不影响发布结果。
    #    跳过开关：环境变量 QD_SKIP_RELEASE_NOTES=1
    try:
        import subprocess as _sp3
        if os.environ.get("QD_SKIP_RELEASE_NOTES") == "1":
            print("⑩ 发布说明：按 QD_SKIP_RELEASE_NOTES 跳过")
        else:
            r = _sp3.run(["node", os.path.join(ROOT, "_release_notes.js")],
                         cwd=ROOT, capture_output=True, timeout=180)
            out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "ignore")
            for line in out.strip().splitlines()[-6:]:
                print("⑩ " + line)
    except Exception as e:
        print("⑩ 发布说明生成失败（不影响发布）：", e)


if __name__ == "__main__":
    main()
