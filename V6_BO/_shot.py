# -*- coding: utf-8 -*-
"""纯 ctypes 截屏（无第三方依赖）：不依赖 PowerShell Add-Type，也不依赖 PIL。
输出：全屏 PNG + WorkBuddy 主窗口裁剪 PNG。
"""
import ctypes
import ctypes.wintypes as wt
import struct
import zlib
import os
import sys

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

SRCCOPY = 0x00CC0020
SM_XV = 76
SM_YV = 77
SM_CXV = 78
SM_CYV = 79
DIB_RGB_COLORS = 0


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


def enum_windows():
    out = []
    CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        out.append((hwnd, buf.value, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True

    user32.EnumWindows(CB(cb), 0)
    return out


def grab(x, y, w, h):
    hdc = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    ok = gdi32.BitBlt(mem, 0, 0, w, h, hdc, x, y, SRCCOPY)
    if not ok:
        raise RuntimeError("BitBlt failed")

    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.bmiHeader.biWidth = w
    bi.bmiHeader.biHeight = -h          # 负数 = 自上而下
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    bi.bmiHeader.biCompression = 0
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), DIB_RGB_COLORS)

    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(0, hdc)
    return buf.raw, w, h


def write_png(path, rgba, w, h):
    raw = bytearray()
    stride = w * 4
    for yy in range(h):
        raw.append(0)                                  # filter type 0
        raw += rgba[yy * stride:(yy + 1) * stride]

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)   # 8bit RGBA
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    # ⛔ 必须先把本进程设为 DPI 感知：否则 GDI 会给一份 1536x960 的"虚拟坐标"缩略图，
    #    窗口底部（侧边栏底栏/头像/连接移动端图标）会被裁在 960 以外，看起来像"没有底栏"。
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)     # PROCESS_PER_MONITOR_DPI_AWARE
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass

    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    vx, vy = user32.GetSystemMetrics(SM_XV), user32.GetSystemMetrics(SM_YV)
    vw, vh = user32.GetSystemMetrics(SM_CXV), user32.GetSystemMetrics(SM_CYV)

    target = None
    for hwnd, title, l, t, w, h in enum_windows():
        if "workbuddy" in title.lower() and w > 400 and h > 300:
            if target is None or w * h > target[4] * target[5]:
                target = (hwnd, title, l, t, w, h)
    if target:
        user32.SetForegroundWindow(target[0])
        user32.ShowWindow(target[0], 9)
        import time
        time.sleep(0.8)

    rgba, w, h = grab(vx, vy, vw, vh)
    p_full = os.path.join(outdir, "_shot_screen.png")
    write_png(p_full, rgba, w, h)
    print("full=%s %dx%d virtual=(%d,%d)" % (p_full, w, h, vx, vy))

    if target:
        _, title, l, t, tw, th = target
        cx0, cy0 = max(0, l - vx), max(0, t - vy)
        cx1, cy1 = min(w, cx0 + tw), min(h, cy0 + th)
        if cx1 > cx0 and cy1 > cy0:
            crop = bytearray()
            for yy in range(cy0, cy1):
                crop += rgba[(yy * w + cx0) * 4:(yy * w + cx1) * 4]
            p_win = os.path.join(outdir, "_shot_window.png")
            write_png(p_win, bytes(crop), cx1 - cx0, cy1 - cy0)
            print("window=%s %dx%d title=%s rect=(%d,%d)" % (p_win, cx1 - cx0, cy1 - cy0, title, l, t))
    else:
        print("window=none")


if __name__ == "__main__":
    main()
