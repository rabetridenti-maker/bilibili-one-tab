"""方案 C 定稿：圆环 + 播放三角 + 「1」徽章。
小尺寸（16/32）走简化版：加粗圆环、放大三角、去掉徽章（否则缩成一个灰糊点）。
"""
import os
from PIL import Image, ImageDraw

OUT = r"C:\Users\Administrator\AppData\Local\Temp\bst-icons"
SS = 8                     # 小尺寸用更高超采样
BLUE = (0, 161, 214)
PINK = (251, 114, 153)
WHITE = (255, 255, 255)


def bg(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (
                round(BLUE[0] + (PINK[0] - BLUE[0]) * t),
                round(BLUE[1] + (PINK[1] - BLUE[1]) * t),
                round(BLUE[2] + (PINK[2] - BLUE[2]) * t),
            )
    return img


def squircle_mask(size, ratio=0.225):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * ratio), fill=255)
    return m


def base(S, radius_ratio=0.225):
    layer = bg(S).convert("RGBA")
    layer.putalpha(squircle_mask(S, radius_ratio))
    return layer


def tri_layer(S, cx, cy, r, fill):
    p = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(p).polygon(
        [(cx - r * 0.52, cy - r), (cx - r * 0.52, cy + r), (cx + r * 0.78, cy)], fill=fill
    )
    return p


def ring_art(S, ring_r, stroke, tri_r, corner=0.225, badge=None):
    """badge: None 或 (中心x比例, 中心y比例, 半径比例)"""
    img = base(S, corner)
    cx = cy = S // 2
    r = int(S * ring_r)
    lw = int(S * stroke)
    l = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(l).ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    img = Image.alpha_composite(img, l)
    # 挖空内圈，露出渐变
    inner = base(S, corner)
    mask = Image.new("L", (S, S), 0)
    ir = r - lw
    ImageDraw.Draw(mask).ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=255)
    img.paste(inner, (0, 0), mask)
    img = Image.alpha_composite(img, tri_layer(S, cx, cy, int(ir * tri_r), PINK))

    if badge:
        bx = int(S * badge[0])
        by = int(S * badge[1])
        br = int(S * badge[2])
        l = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(l).ellipse([bx - br, by - br, bx + br, by + br], fill=WHITE)
        img = Image.alpha_composite(img, l)
        l2 = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(l2).ellipse(
            [bx - br + lw * 0.6, by - br + lw * 0.6, bx + br - lw * 0.6, by + br - lw * 0.6], fill=PINK
        )
        img = Image.alpha_composite(img, l2)
        h = int(br * 0.98)
        l3 = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(l3)
        d.rounded_rectangle(
            [bx - h * 0.115, by - h * 0.5, bx + h * 0.115, by + h * 0.5], radius=max(1, int(h * 0.1)), fill=WHITE
        )
        d.polygon(
            [(bx - h * 0.36, by - h * 0.2), (bx - h * 0.115, by - h * 0.5), (bx - h * 0.115, by - h * 0.04)],
            fill=WHITE,
        )
        img = Image.alpha_composite(img, l3)
    return img


def render(sz):
    S = sz * SS
    if sz <= 32:
        # 简化版：圆环占满、加粗、三角更大、无徽章
        art = ring_art(S, ring_r=0.315, stroke=0.105, tri_r=0.74, corner=0.22)
    elif sz <= 48:
        # 中间尺寸：带回徽章但缩小
        art = ring_art(S, ring_r=0.29, stroke=0.082, tri_r=0.70, corner=0.225, badge=(0.775, 0.775, 0.135))
    else:
        art = ring_art(S, ring_r=0.275, stroke=0.072, tri_r=0.66, corner=0.225, badge=(0.775, 0.775, 0.14))
    return art.resize((sz, sz), Image.LANCZOS)


sizes = [16, 32, 48, 128]
art = {s: render(s) for s in sizes}
art[300] = ring_art(300 * SS, ring_r=0.275, stroke=0.072, tri_r=0.66,
                    badge=(0.775, 0.775, 0.14)).resize((300, 300), Image.LANCZOS)

# 预览表
sheet = Image.new("RGB", (760, 300), (250, 250, 252))
d = ImageDraw.Draw(sheet)
x = 20
for s in sizes:
    mag = max(1, 128 // s)
    im = art[s].resize((s * mag, s * mag), Image.NEAREST if s < 48 else Image.LANCZOS)
    sheet.paste(im, (x, 30))
    d.text((x, 30 + im.height + 8), f"{s}px  x{mag}", fill=(20, 20, 20))
    x += im.width + 26
sheet.paste(art[300], (x + 10, 30))
d.text((x + 10, 30 + 300 + 8), "300px (商店)", fill=(20, 20, 20))
sheet.save(os.path.join(OUT, "final-preview.png"))

big = ring_art(1024, ring_r=0.275, stroke=0.072, tri_r=0.66, badge=(0.775, 0.775, 0.14)).resize(
    (512, 512), Image.LANCZOS
)

for name, im in list(art.items()):
    if name in (16, 32, 48, 128):
        im.save(os.path.join(OUT, f"final-{name}.png"))
big.save(os.path.join(OUT, "final-512.png"))
art[300].save(os.path.join(OUT, "final-300.png"))
print("ok")
for f in ["final-16.png", "final-32.png", "final-48.png", "final-128.png", "final-512.png", "final-300.png"]:
    p = os.path.join(OUT, f)
    print(" ", f, os.path.getsize(p))
