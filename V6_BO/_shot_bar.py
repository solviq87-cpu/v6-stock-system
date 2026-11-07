# -*- coding: utf-8 -*-
"""只截侧边栏底栏区域（不改窗口），用于核对「连接移动端」图标与面板开关状态。"""
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


def find_app():
    best = None
    for hwnd, title, l, t, w, h in S.enum_windows():
        if "workbuddy" in title.lower() and w > 500 and h > 400:
            if best is None or w * h > best[4] * best[5]:
                best = (hwnd, title, l, t, w, h)
    return best


app = find_app()
if not app:
    print("NO_WINDOW")
    sys.exit(0)
hwnd, title, l, t, w, h = app
r = wt.RECT()
user32.GetWindowRect(hwnd, ctypes.byref(r))
print("window=(%d,%d)-(%d,%d) %dx%d" % (r.left, r.top, r.right, r.bottom,
                                        r.right - r.left, r.bottom - r.top))

out = os.path.dirname(os.path.abspath(__file__))

# 1) 侧边栏底栏全宽（含内边距），高度 140
bx, by = r.left, r.bottom - 140
bw, bh = 340, 140
rgba, cw, ch = S.grab(bx, by, bw, bh)
S.write_png(os.path.join(out, "_shot_bottombar.png"), rgba, cw, ch)
print("bottombar saved %dx%d at (%d,%d)" % (cw, ch, bx, by))

# 2) 把鼠标停在底栏右侧（图标区），用键盘无关方式触发悬停面板
hx, hy = r.left + 300, r.bottom - 46
user32.SetCursorPos(hx, hy)
time.sleep(1.2)
rgba2, w2, h2 = S.grab(bx, max(0, by - 420), 420, 560)
S.write_png(os.path.join(out, "_shot_panel_now.png"), rgba2, w2, h2)
print("panel saved %dx%d hover=(%d,%d)" % (w2, h2, hx, hy))
