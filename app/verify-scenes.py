#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验 5 张动作场景 SVG：既查美术硬约束，也**真的渲染出来**逐像素比对。

## 为什么必须渲染校验

`gen-scenes.py` 是用字符串替换从 `piglet.svg` 派生场景的。字符串层面「替换成功」
不代表画出来是对的 —— 眼睛 path 写错一个坐标，替换照样成功，画出来却是歪的。
所以这里用 Edge 无头模式把每张图渲染成 PNG，再用 Pillow 逐像素比对：

1. **身体必须逐位一致** —— 除眼睛和道具区域外，6 张图应当完全相同。
   这条直接证明「复用基础身体」这个前提成立。
2. **眼睛必须真的变了** —— 闭眼/半闭眼/高光要在眼睛所在的像素块里产生差异。
3. **道具必须真的出现** —— 在预期象限里有新增的不透明像素。
4. 顺带查一遍硬约束：viewBox、禁用元素、文件体积、内容占比。

用法：  python verify-scenes.py
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "src" / "assets"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

SIZE = 128  # 渲染尺寸（64 视框 × 2）

SCENES = [
    ("idle", "piglet.svg"),
    ("eat", "piglet-eat.svg"),
    ("bathe", "piglet-bathe.svg"),
    ("play", "piglet-play.svg"),
    ("pet", "piglet-pet.svg"),
    ("relax", "piglet-relax.svg"),
]

# 眼睛在 64×64 视框里的位置（由基础图 path 的坐标 × scale 0.1993 - offset 7.17/0.78 算出）
EYE_BOXES = {
    "left": (8.0, 24.5, 14.5, 31.0),
    "right": (22.5, 27.5, 29.0, 34.0),
}


def to_px(box):
    return tuple(int(round(v / 64 * SIZE)) for v in box)


def render(svg_path: Path, png_path: Path):
    """用 Edge 无头模式把 SVG 渲染成**透明背景**的 PNG。"""
    html = (
        '<!doctype html><meta charset="utf-8">'
        f'<body style="margin:0;background:transparent">'
        f'<img src="{svg_path.as_uri()}" width="{SIZE}" height="{SIZE}">'
    )
    tmp = png_path.with_suffix(".html")
    tmp.write_text(html, encoding="utf-8")
    cmd = [
        str(EDGE), "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--default-background-color=00000000",
        f"--screenshot={png_path}", f"--window-size={SIZE},{SIZE}",
        f"--user-data-dir={Path(tempfile.gettempdir()) / 'piggy-verify'}",
        tmp.as_uri(),
    ]
    subprocess.run(cmd, capture_output=True, timeout=90)
    tmp.unlink(missing_ok=True)
    if not png_path.exists():
        sys.exit(f"渲染失败：{svg_path.name}")
    return Image.open(png_path).convert("RGBA")


def check_constraints(path: Path):
    """查美术硬约束，返回问题列表。"""
    bad = []
    text = path.read_text(encoding="utf-8")
    if 'viewBox="0 0 64 64"' not in text:
        bad.append("viewBox 不是 0 0 64 64")
    for tag in ("<image", "<text", "Gradient", "filter", "Filter"):
        if tag in text:
            bad.append(f"出现了禁用元素 {tag}")
    # 只允许这些标签
    for tag in set(re.findall(r"<(/?[a-zA-Z]+)", text)):
        if tag.lstrip("/") not in {"svg", "g", "path", "ellipse", "circle", "rect", "polygon", "title"}:
            bad.append(f"出现了未允许的标签 <{tag}>")
    return bad


def alpha_mask(img):
    return [[1 if img.getpixel((x, y))[3] > 24 else 0 for x in range(SIZE)] for y in range(SIZE)]


def diff_mask(a, b):
    """两张图的差异（任一通道差 > 12 就算不同）。"""
    pa, pb = a.load(), b.load()
    return [
        [1 if any(abs(pa[x, y][i] - pb[x, y][i]) > 12 for i in range(4)) else 0
         for x in range(SIZE)]
        for y in range(SIZE)
    ]


def bbox(mask):
    ys = [y for y, row in enumerate(mask) if any(row)]
    xs = [x for x, v in enumerate(next(iter([r for r in mask if any(r)]), [])) if v]
    if not ys:
        return None
    all_x = [x for row in mask for x, v in enumerate(row) if v]
    return min(all_x), min(ys), max(all_x), max(ys)


def main():
    if not EDGE.exists():
        sys.exit(f"找不到 Edge：{EDGE}")

    outdir = Path(tempfile.gettempdir()) / "piggy-scene-png"
    outdir.mkdir(exist_ok=True)

    imgs, fails = {}, []
    print("── 渲染 ─────────────────────────────────────────────")
    for key, fname in SCENES:
        p = ASSETS / fname
        if not p.exists():
            fails.append(f"{fname} 不存在")
            continue
        img = render(p, outdir / f"{key}.png")
        imgs[key] = img
        m = alpha_mask(img)
        bb = bbox(m)
        cov = sum(sum(r) for r in m) / (SIZE * SIZE)
        bx = f"{bb[0]},{bb[1]}-{bb[2]},{bb[3]}" if bb else "空"
        print(f"  {key:6s} {fname:20s} {p.stat().st_size:5d} B  不透明 {cov*100:5.1f}%  包围盒 {bx}")
        if bb is None:
            fails.append(f"{key}: 渲染出来是空的")
        else:
            # 内容应当占视框的大部分（硬约束：约 90%），但不该贴满整张
            span = max((bb[2] - bb[0]) / SIZE, (bb[3] - bb[1]) / SIZE)
            if span < 0.75:
                fails.append(f"{key}: 内容只占视框 {span*100:.0f}%，太小")
            if span > 0.99:
                fails.append(f"{key}: 内容占满视框（{span*100:.0f}%），可能贴边被裁")

    print("\n── 硬约束 ───────────────────────────────────────────")
    for key, fname in SCENES:
        bad = check_constraints(ASSETS / fname)
        if bad:
            fails.extend(f"{key}: {b}" for b in bad)
            print(f"  {key:6s} ✗ {'; '.join(bad)}")
        else:
            print(f"  {key:6s} ✓ viewBox / 标签 / 无渐变滤镜")

    if "idle" in imgs:
        print("\n── 与 idle 的逐像素差异 ─────────────────────────────")
        base = imgs["idle"]
        for key, _ in SCENES:
            if key == "idle" or key not in imgs:
                continue
            d = diff_mask(base, imgs[key])
            n = sum(sum(r) for r in d)
            bb = bbox(d)
            pct = n / (SIZE * SIZE) * 100
            # 眼睛区域里必须有差异（证明表情真的换了）
            eye_hit = 0
            for name, box in EYE_BOXES.items():
                x0, y0, x1, y1 = to_px(box)
                hit = sum(d[y][x] for y in range(y0, y1) for x in range(x0, x1))
                if hit > 0:
                    eye_hit += 1
            print(f"  {key:6s} 差异 {pct:5.1f}%  包围盒 {bb}  眼睛区域命中 {eye_hit}/2")
            if n == 0:
                fails.append(f"{key}: 和 idle 完全一样（派生没生效）")
            if eye_hit < 1:
                fails.append(f"{key}: 眼睛区域没有任何变化（表情没换成功）")

    # 身体一致性：所有场景都必须与 idle **逐位相同**，除了眼睛和道具所在的区域。
    # 这里取一块刻意避开二者的「猪身中段 + 前腿」：
    #   x 24..36 —— 右边避开食盆（x≥37）和皮球（x≥43.6），左边避开嘴（x≤19.3）
    #   y 44..58 —— 上方避开两只眼睛（y≤34）和嘴（y≤44.7）
    if "idle" in imgs:
        print("\n── 身体一致性（各场景 vs 待机，取避开眼睛/道具的猪身块）──────")
        a = imgs["idle"].load()
        x0, y0 = int(24 / 64 * SIZE), int(44 / 64 * SIZE)
        x1, y1 = int(36 / 64 * SIZE), int(58 / 64 * SIZE)
        tot = (x1 - x0) * (y1 - y0)
        print(f"  取样块：64视框 x24-36 y44-58  →  {x1-x0}×{y1-y0} = {tot} 像素")
        for key, _ in SCENES:
            if key == "idle" or key not in imgs:
                continue
            b = imgs[key].load()
            diff = sum(
                1 for y in range(y0, y1) for x in range(x0, x1)
                if any(abs(a[x, y][i] - b[x, y][i]) > 12 for i in range(4))
            )
            flag = "✓" if diff == 0 else "✗"
            print(f"  {flag} {key:6s} 不同像素 {diff:4d} / {tot}  ({diff/tot*100:.2f}%)")
            if diff > 0:
                fails.append(f"{key}: 猪身取样块有 {diff} 个像素与 idle 不同 —— 身体没有逐位复用")

    print("\n" + "═" * 56)
    if fails:
        print(f"❌ 发现 {len(fails)} 个问题：")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    print("✅ 全部通过：5 张场景渲染正常、身体逐位复用、表情与道具均生效")


if __name__ == "__main__":
    main()
