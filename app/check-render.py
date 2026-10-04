# 全屏截图并统计「猪的调色板」像素，客观判断是否真的渲染出来。
#
# 为什么必须全屏搜：PowerShell / 非 DPI-aware 进程拿到的窗口坐标是**虚拟化**的，
# 直接用 GetWindowRect 去 CopyFromScreen 会截到完全不相干的区域（踩过这个坑）。
# 全屏搜索 + 正确的 DPI 感知可以完全绕开坐标换算问题。
#
# 用法： python check-render.py [输出png路径]

import ctypes
import sys

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    pass

import numpy as np
from PIL import ImageGrab

PALETTE = {
    "body": (255, 209, 175),   # #FFD1AF 身体
    "ears": (233, 88, 146),    # #E95892 耳朵/尾巴
    "snout": (255, 129, 149),  # #FF8195 鼻子
    "farleg": (255, 159, 165), # #FF9FA5 远侧腿
    "blush": (255, 175, 172),  # #FFAFAC 腮红
}

out = sys.argv[1] if len(sys.argv) > 1 else None

im = ImageGrab.grab(all_screens=True).convert("RGB")
arr = np.asarray(im).astype(np.int16)
H, W = arr.shape[:2]

mask = np.zeros((H, W), dtype=bool)
for q in PALETTE.values():
    d = np.abs(arr - np.array(q, dtype=np.int16)).max(axis=2)
    mask |= d <= 22

total = int(mask.sum())
print(f"  screen={W}x{H}  pig_colored_px={total}")

if total > 0:
    ys, xs = np.nonzero(mask)
    minx, maxx = int(xs.min()), int(xs.max())
    miny, maxy = int(ys.min()), int(ys.max())
    print(f"  bbox=({minx},{miny})-({maxx},{maxy})  size={maxx-minx+1}x{maxy-miny+1}")

print("  RENDER:", "RENDERED" if total > 800 else "NOT RENDERED")

if out:
    im.save(out)
