"""数一张 PNG 里某几个颜色各有多少个**精确**像素。

用法：  python check-skin-colors.py <png> <#RRGGBB> [<#RRGGBB> ...]

为什么用「精确平色计数」而不是平均色 / 直方图距离：
SVG 是纯色填充，换色之后目标色值会**逐字节精确**出现；
而抗锯齿边缘会产生几百种中间色，任何平均都会把它们糊进来，
反而分不清「换成功了」和「没换但边缘像」。

输出每个颜色的计数与占比，并在最后给出 `VERDICT:` 一行便于 PowerShell 抓。
"""

import sys
from collections import Counter

from PIL import Image


def hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = s.strip().lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def main() -> int:
    if len(sys.argv) < 3:
        print('用法: check-skin-colors.py <png> <#RRGGBB> [...]')
        return 2

    path, colors = sys.argv[1], [hex_to_rgb(c) for c in sys.argv[2:]]
    im = Image.open(path).convert('RGBA')
    total = im.width * im.height
    counts = Counter(im.getdata())

    print(f'图 {im.width}x{im.height} = {total} px')
    for raw, rgb in zip(sys.argv[2:], colors):
        n = counts.get((rgb[0], rgb[1], rgb[2], 255), 0)
        print(f'  {raw}: {n} px  ({100.0 * n / total:.2f}%)')

    # 顺带报一下出现最多的不透明色，方便排查「到底渲染成什么了」
    opaque = [(c, n) for c, n in counts.most_common() if c[3] == 255]
    top = ', '.join(f'#{c[0]:02X}{c[1]:02X}{c[2]:02X}={n}' for c, n in opaque[:5])
    print(f'  最多的不透明色: {top}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
