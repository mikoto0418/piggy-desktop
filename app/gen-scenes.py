#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 `src/assets/piglet.svg` 派生出 5 个动作场景的 SVG。

## 为什么是「派生」而不是「重画」

`piglet.svg` 是从参考图描出来的（原图 301×279 → 64 视框），身体、耳朵、鼻子、
卷尾巴的曲线都是一条条调过的。手写 5 只新猪必然会走形 —— 而且用户只认默认皮肤
这一只猪。所以这里**原样复用**基础 `<g>`，只做两件事：

1. **改表情**：把两个眼睛的 path 换成闭眼弧 / 半闭弧 / 加高光，吃的时候多一张嘴。
2. **加道具**：在基础 `<g>` **之后**追加一层，画碗、泡泡、皮球、爱心、睡觉的 z。

这样 6 张图的猪**逐位一致**，只有表情和道具不同。

## 美术硬约束（`实施计划.md` §1）

- `viewBox="0 0 64 64"`，透明背景
- 只允许 `<path>/<ellipse>/<circle>/<rect>/<polygon>`（`<g>` 用来分组）
- **禁止** `<image>`、`<text>`、渐变、滤镜
- 内容约占视框 90%，**零描边**（描边只用于耳朵/尾巴那种圆头线条）

用法：  python gen-scenes.py
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "src" / "assets"
BASE = ASSETS / "piglet.svg"

# 基础图里两个眼睛的原始 path —— 用它们做锚点来替换。
EYE1 = (
    '<path fill="#373A32" d="M91 130C84 129 79 136 80 144C80 151 85 155 92 154'
    'C99 153 103 147 102 140C102 134 98 130 91 130Z"/>'
)
EYE2 = (
    '<path fill="#373A32" d="M166 145C159 144 154 150 154 157C153 164 158 170 165 170'
    'C171 170 176 164 176 157C176 151 173 146 166 145Z"/>'
)

INK = "#373A32"

# ---------------------------------------------------------------- 表情

# 开心闭眼（^ ^）—— 吃饭 / 洗澡 / 摸头都用这个
HAPPY_EYES = (
    f'<path d="M79 147C84 132 99 132 104 147" fill="none" stroke="{INK}" '
    'stroke-width="5.5" stroke-linecap="round"/>',
    f'<path d="M152 160C157 145 172 145 177 160" fill="none" stroke="{INK}" '
    'stroke-width="5.5" stroke-linecap="round"/>',
)

# 半闭的放松眼 —— 打盹用，弧度更浅、更靠下
RELAX_EYES = (
    f'<path d="M80 149C85 140 98 140 103 149" fill="none" stroke="{INK}" '
    'stroke-width="5" stroke-linecap="round"/>',
    f'<path d="M153 162C158 153 171 153 176 162" fill="none" stroke="{INK}" '
    'stroke-width="5" stroke-linecap="round"/>',
)

# 睁大 + 高光 —— 玩耍用。保留原始眼睛，只加两点高光。
WIDE_EYES = (
    EYE1,
    '<circle cx="87" cy="137" r="4.2" fill="#FFFFFF" opacity=".92"/>',
    EYE2,
    '<circle cx="161" cy="152" r="4.2" fill="#FFFFFF" opacity=".92"/>',
)


# ---------------------------------------------------------------- 道具
# 下面全部是 64×64 视框坐标（不在基础 <g> 的变换里）。

# 吃饭：左下角一个食盆 + 张开的嘴
MOUTH_OPEN = (
    '<path fill="#8C3A52" d="M95 198C104 190 124 190 133 200C131 218 112 228 99 217'
    'C93 211 91 204 95 198Z"/>',
    '<path fill="#FF8195" d="M104 212C110 207 122 208 126 214C122 221 110 222 104 212Z"/>',
)
BOWL = (
    # 盆身（下窄上宽的梯形，底部圆角）
    '<path fill="#7EC8E3" d="M37 48H61L57.6 58.4C57.2 60.2 55.8 61 54 61H44C42.2 61 '
    '40.8 60.2 40.4 58.4Z"/>',
    # 盆口
    '<ellipse cx="49" cy="48" rx="12" ry="3" fill="#A8DDF0"/>',
    # 盆里的食物
    '<ellipse cx="49" cy="47.2" rx="9.6" ry="2.2" fill="#E8B77A"/>',
    '<circle cx="45.5" cy="46.8" r="1.5" fill="#D19A5C"/>',
    '<circle cx="51" cy="47.4" r="1.3" fill="#D19A5C"/>',
    '<circle cx="53.5" cy="46.6" r="1.1" fill="#D19A5C"/>',
)

# 洗澡：一圈泡泡 + 一颗水珠
BUBBLES = (
    '<circle cx="8.5" cy="17" r="4.6" fill="#BEE7F5" opacity=".85"/>',
    '<circle cx="6.8" cy="15.4" r="1.5" fill="#FFFFFF" opacity=".95"/>',
    '<circle cx="57" cy="24" r="3.6" fill="#BEE7F5" opacity=".85"/>',
    '<circle cx="55.7" cy="22.8" r="1.2" fill="#FFFFFF" opacity=".95"/>',
    '<circle cx="60" cy="38" r="2.6" fill="#BEE7F5" opacity=".8"/>',
    '<circle cx="11" cy="34" r="2.2" fill="#BEE7F5" opacity=".8"/>',
    '<circle cx="18" cy="10" r="2" fill="#BEE7F5" opacity=".75"/>',
    # 水珠
    '<path fill="#7EC8E3" d="M52 44C52 44 47.6 49.6 47.6 52.4C47.6 54.9 49.6 56.6 '
    '52 56.6C54.4 56.6 56.4 54.9 56.4 52.4C56.4 49.6 52 44 52 44Z"/>',
    '<circle cx="50.4" cy="52" r="1.4" fill="#FFFFFF" opacity=".8"/>',
)

# 玩耍：右下角一个弹起来的皮球 + 两条速度线
BALL = (
    '<path d="M16 6H23" stroke="#FFAFAC" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>',
    '<path d="M14 11H20" stroke="#FFAFAC" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>',
    '<circle cx="52" cy="52" r="8.4" fill="#FF9FA5"/>',
    '<path d="M46.4 45.6C49.6 49 52.6 53.4 54.4 58.6" fill="none" stroke="#E95892" '
    'stroke-width="2" opacity=".85"/>',
    '<circle cx="49" cy="48.6" r="2.6" fill="#FFFFFF" opacity=".8"/>',
)

# 摸头：两颗飘起来的爱心
HEART = (
    "M0 2.6C-1.2 0.4-4.6-0.2-4.6 2.4C-4.6 4.8-2 6.8 0 9"
    "C2 6.8 4.6 4.8 4.6 2.4C4.6-0.2 1.2 0.4 0 2.6Z"
)
HEARTS = (
    f'<g transform="translate(16 9) scale(1.15)"><path fill="#FF8195" d="{HEART}"/></g>',
    f'<g transform="translate(27 4) scale(0.8)"><path fill="#FFAFAC" d="{HEART}"/></g>',
    f'<g transform="translate(6 20) scale(0.6)"><path fill="#FFAFAC" d="{HEART}" opacity=".8"/></g>',
)

# 打盹：两个 z（**画成 path，不能用 <text>**）+ 眯眼线
ZED = (
    '<path d="M45 12H55L45 21H55" fill="none" stroke="#9AA0A6" stroke-width="2.6" '
    'stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M56 4H62L56 10H62" fill="none" stroke="#9AA0A6" stroke-width="2" '
    'stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>',
)


# ---------------------------------------------------------------- 场景定义
# (输出文件名, 眼睛, 追加道具, 无障碍标签)
SCENES = [
    ("piglet-eat.svg", HAPPY_EYES, MOUTH_OPEN + BOWL, "小猪在吃饭"),
    ("piglet-bathe.svg", HAPPY_EYES, BUBBLES, "小猪在洗澡"),
    ("piglet-play.svg", WIDE_EYES, BALL, "小猪在玩球"),
    ("piglet-pet.svg", HAPPY_EYES, HEARTS, "小猪被摸头，很开心"),
    ("piglet-relax.svg", RELAX_EYES, ZED, "小猪在打盹"),
]


def load_base():
    """读出基础图，返回 (头部属性, <g> 内容, 结尾)。"""
    text = BASE.read_text(encoding="utf-8")
    m = re.search(r"(<g\b[^>]*>)(.*?)(</g>)", text, re.S)
    if not m:
        sys.exit("基础图里找不到 <g> 块，piglet.svg 结构变了？")
    return m.group(1), m.group(2), m.group(3)


def build(name, eyes, props, label, g_open, g_body, g_close):
    """把基础身体 + 换掉的眼睛 + 道具拼成一张完整 SVG。"""
    if g_body.count(EYE1) != 1 or g_body.count(EYE2) != 1:
        sys.exit(f"基础图里两个眼睛的 path 不各出现一次（piglet.svg 被改过了？）")

    if len(eyes) == 2:
        # 完全替换两只眼睛（闭眼弧 / 半闭弧）
        body = g_body.replace(EYE1, eyes[0]).replace(EYE2, eyes[1])
    elif len(eyes) == 4:
        # 保留原始眼睛，各自后面插一条高光
        body = g_body.replace(EYE1, EYE1 + "\n    " + eyes[1])
        body = body.replace(EYE2, EYE2 + "\n    " + eyes[3])
    else:
        sys.exit(f"{name}: 眼睛定义个数不对（{len(eyes)}，应为 2 或 4）")

    prop_layer = "\n  ".join(props)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="{label}">
  <title>{label}</title>
  <!-- 由 gen-scenes.py 从 piglet.svg 派生：身体逐位复用，只换表情、加道具。 -->
  {g_open}{body}{g_close}
  <g>
  {prop_layer}
  </g>
</svg>
"""


def main():
    if not BASE.exists():
        sys.exit(f"找不到基础图：{BASE}")
    g_open, g_body, g_close = load_base()
    for name, eyes, props, label in SCENES:
        svg = build(name, eyes, props, label, g_open, g_body, g_close)
        out = ASSETS / name
        out.write_text(svg, encoding="utf-8")
        print(f"  {name:22s} {len(svg.encode('utf-8')):5d} B")
    total = sum((ASSETS / s[0]).stat().st_size for s in SCENES) + BASE.stat().st_size
    print(f"  {'合计（含 idle）':20s} {total:5d} B  / 预算 30720 B")


if __name__ == "__main__":
    main()
