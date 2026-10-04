"""分析设置窗口截图：确认 CSS 真的加载了、页面不是白屏/黑屏。

关键色都来自 settings.css，所以只要它们出现，就说明样式表生效了；
不同颜色数则用来排除「渲染成一块纯色」的情况。
"""
from collections import Counter
from PIL import Image
import sys

path = sys.argv[1] if len(sys.argv) > 1 else r"F:\piggy\_settings-shot.png"
im = Image.open(path).convert("RGB")
w, h = im.size
px = list(im.getdata())
c = Counter(px)

print(f"尺寸: {w}x{h}   像素数: {len(px)}")
print("\n最常见 6 种颜色:")
for col, n in c.most_common(6):
    print(f"  #{col[0]:02x}{col[1]:02x}{col[2]:02x}  {n:>8}  {100*n/len(px):5.1f}%")

TARGETS = {
    "背景 #1e1e22":     (0x1E, 0x1E, 0x22),
    "卡片 #26262c":     (0x26, 0x26, 0x2C),
    "标题强调 #ff9fa5": (0xFF, 0x9F, 0xA5),
    "开关强调 #e95892": (0xE9, 0x58, 0x92),
    "数值 #7ec8e3":     (0x7E, 0xC8, 0xE3),
    "正文 #e9e9ec":     (0xE9, 0xE9, 0xEC),
}


def near(a, b, tol=14):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


print("\n关键色（全部来自 settings.css）:")
ok = 0
for name, t in TARGETS.items():
    n = sum(1 for p in px if near(p, t))
    hit = n > 50
    ok += hit
    print(f"  {name:<18} {n:>7} 像素   {'✓' if hit else '✗'}")

uniq = len(c)
print(f"\n不同颜色数: {uniq}  ->  {'有内容' if uniq > 200 else '疑似空白'}")

print()
if ok >= 4 and uniq > 200:
    print(f"✅ 设置界面渲染正常：{ok}/{len(TARGETS)} 个样式关键色出现")
else:
    print(f"❌ 渲染可疑：只有 {ok}/{len(TARGETS)} 个关键色，{uniq} 种颜色")
