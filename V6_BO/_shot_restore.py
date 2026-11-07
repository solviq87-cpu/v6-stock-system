# -*- coding: utf-8 -*-
"""把 WorkBuddy 主窗口从"最大化压住任务栏"的状态还原成一个留出底边的窗口，
然后截图确认侧边栏底部（连接移动端图标所在）已经露出来。"""
import ctypes
import ctypes.wintypes as wt
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _shot as S

user32 = ctypes.windll.user32

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

SW_RESTORE = 9
SW_SHOW = 5


def find_app():
    best = None
    for hwnd, title, l, t, w, h in S.enum_windows():
        if "workbuddy" in title.lower() and w > 500 and h > 400:
            if best is None or w * h > best[4] * best[5]:
                best = (hwnd, title, l, t, w, h)
    return best


def main():
    app = find_app()
    if not app:
        print("NO_WINDOW")
        return
    hwnd, title, l, t, w, h = app
    scr_w = user32.GetSystemMetrics(0)
    scr_h = user32.GetSystemMetrics(1)

    user32.ShowWindow(hwnd, SW_RESTORE)      # 退出最大化
    time.sleep(0.5)
    # 目标：宽 1400 / 高 = 屏幕高 - 160（给任务栏 + 标题栏都留余量），左上留 60,40
    tw, th = 1400, scr_h - 170
    tx, ty = 60, 40
    user32.MoveWindow(hwnd, tx, ty, tw, th, True)
    user32.SetForegroundWindow(hwnd)
    user32.ShowWindow(hwnd, SW_SHOW)
    time.sleep(0.8)

    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    print("screen=%dx%d window=(%d,%d)-(%d,%d) size=%dx%d title=%s"
          % (scr_w, scr_h, r.left, r.top, r.right, r.bottom,
             r.right - r.left, r.bottom - r.top, title))

    rgba, cw, ch = S.grab(max(0, r.left), max(0, r.top),
                          min(scr_w, r.right) - max(0, r.left),
                          min(scr_h, r.bottom) - max(0, r.top))
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_shot_restored.png")
    S.write_png(p, rgba, cw, ch)
    print("saved=%s %dx%d" % (p, cw, ch))

    # 把鼠标停在侧边栏底部居中位置，让"悬停才出现"的图标/提示露出来（不点击）
    side_w = 300
    hx = r.left + 60
    hy = r.bottom - 40
    user32.SetCursorPos(hx, hy)
    time.sleep(0.9)
    rgba2, w2, h2 = S.grab(max(0, r.left), max(0, r.bottom - 260), side_w, 260)
    p2 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_shot_hover.png")
    S.write_png(p2, rgba2, w2, h2)
    print("hover_cursor=(%d,%d) saved=%s %dx%d" % (hx, hy, p2, w2, h2))


if __name__ == "__main__":
    main()
