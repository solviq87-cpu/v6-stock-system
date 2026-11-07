# -*- coding: utf-8 -*-
"""放大截取连接移动端面板里的两个开关，判定开/关（不移动鼠标，避免面板收起）。"""
import ctypes
import ctypes.wintypes as wt
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

out = os.path.dirname(os.path.abspath(__file__))
# 面板根: 上次 grab 起点 (60, 510)，开关在图内 x≈300-420, y≈380-470
bx, by = 60 + 290, 510 + 370
bw, bh = 200, 110
rgba, cw, ch = S.grab(bx, by, bw, bh)
print("grab %dx%d at (%d,%d)" % (cw, ch, bx, by))

# 3x 最近邻放大，方便看清圆点位置与配色
Z = 3
big = bytearray(cw * Z * ch * Z * 4)
for y in range(ch * Z):
    sy = y // Z
    for x in range(cw * Z):
        sx = x // Z
        si = (sy * cw + sx) * 4
        di = (y * cw * Z + x) * 4
        big[di:di + 4] = rgba[si:si + 4]
S.write_png(os.path.join(out, "_shot_toggles.png"), bytes(big), cw * Z, ch * Z)
print("saved _shot_toggles.png %dx%d" % (cw * Z, ch * Z))
