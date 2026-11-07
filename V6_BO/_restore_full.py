# -*- coding: utf-8 -*-
"""
一键从「完整版源码包」恢复（不需要懂代码，双击 一键从完整备份恢复.bat 即可）

做什么：
  在本目录找最新的 `量化看盘平台_源码_<版本>.zip`（排除"去凭据版"），
  解压到一个新目录 `_restored\\<版本>\\`，解压完即可直接跑。

为什么用"完整版"而不是 Gitee 仓库：
  Gitee 上只有代码（config/access/holdings 全被 .gitignore 红线排除）。
  完整版 zip 里带飞书机器人配置、口令、持仓、业务数据 —— 解压即可用，不用填任何东西。

⛔ 解压出来的目录含真实凭据（口令/持仓金额），只在自己电脑上用，别外发、别上传。
"""
import os
import re
import sys
import zipfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_BASE = os.path.join(ROOT, "_restored")


def list_full_zips():
    out = []
    # 源码包 2026-10-23 起输出到部署目录之外的同级工件目录（发布包体事故，见 _build_zip.py），
    # 恢复工具两个位置都找：工件目录优先，兼容堆在 ROOT 的历史包。
    search_dirs = [os.path.join(os.path.dirname(ROOT), "stock-dashboard-artifacts", "源码包"), ROOT]
    for d in search_dirs:
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if not fn.endswith(".zip"):
                continue
            if "去凭据版" in fn:          # 安全版：没有配置和持仓，不能用来恢复
                continue
            m = re.search(r"_(\d{8}[a-z]{0,3})\.zip$", fn)
            if not m:
                continue
            out.append((m.group(1), os.path.join(d, fn)))
    out.sort()                        # 版本号是 年月日+字母，字典序 = 时间序
    return out


def main():
    zips = list_full_zips()
    if not zips:
        print("!")
        print("! 没找到完整版源码包（量化看盘平台_源码_*.zip）。")
        print("! 目录：%s" % ROOT)
        print("! 如果电脑整个换了，请看 RESTORE.md 第 3 节：从 Gitee 拿代码 + 从线上拉数据。")
        return 1

    ver, fn = zips[-1]
    src = os.path.join(ROOT, fn)

    stamp = time.strftime("%m%d%H%M")
    dst = os.path.join(OUT_BASE, "%s_%s" % (ver, stamp))
    os.makedirs(dst, exist_ok=True)

    print("=" * 62)
    print(" 量化看盘平台 · 一键恢复")
    print("=" * 62)
    print(" 源包：%s" % fn)
    print(" 版本：%s" % ver)
    print(" 解压到：%s" % dst)
    print("-" * 62)

    n = 0
    with zipfile.ZipFile(src) as z:
        for name in z.namelist():
            z.extract(name, dst)
            n += 1

    # 现写一个「就地启动」的 bat：源码包里原有的启动脚本写死了老目录的绝对路径，
    # 直接双击会去启老目录那份，等于没恢复 —— 必须就地生成一份新的。
    starter = os.path.join(dst, "_启动这里.bat")
    with open(starter, "w", encoding="ascii", errors="ignore") as f:
        f.write("\r\n".join([
            "@echo off",
            "cd /d \"%~dp0\"",
            "set \"NODE=\"",
            "for /f \"delims=\" %%i in ('where node 2^>nul') do if not defined NODE set \"NODE=%%i\"",
            "if not defined NODE set \"NODE=C:\\Users\\28957\\.workbuddy\\binaries\\node\\versions\\22.22.2-5\\node.exe\"",
            "set PORT=8787",
            "netstat -ano | findstr \":8787\" | findstr \"LISTENING\" >nul",
            "if not errorlevel 1 set PORT=8789",
            "echo Starting quant dashboard on port %PORT% ...",
            "start \"\" /B \"%NODE%\" server.js",
            "ping -n 6 127.0.0.1 >nul",
            "start \"\" http://127.0.0.1:%PORT%",
            "echo.",
            "echo  Running on http://127.0.0.1:%PORT%",
            "echo  To stop: Task Manager -^> node.exe  (closing this window keeps it running)",
            "pause",
            "",
        ]))
    print(" 已解压 %d 个文件，并生成启动器 _启动这里.bat" % n)
    print("=" * 62)
    print()
    print(" 接下来（照抄就行）：")
    print()
    print("   1) 打开那个目录，双击  _启动这里.bat")
    print("      （8787 被占会自动改用 8789，窗口会打印实际端口）")
    print()
    print("   2) 浏览器会自动打开 http://127.0.0.1:8787（或 8789）")
    print("      登录口令就是你在用的那个开发者口令。")
    print("      忘了？登录页点「忘记密码」，验证码会推到你的飞书机器人。")
    print()
    print("   3) 确认面板里「我的持仓」和推送都在 → 恢复完成。")
    print()
    print(" 目录：%s" % dst)
    print()
    print(" ⛔ 这个目录含真实口令和持仓金额，别外发、别上传网盘。")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
