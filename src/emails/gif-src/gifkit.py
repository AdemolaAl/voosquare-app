"""Small toolkit for drawing VooSquare email GIFs with Pillow at 2x, downscaling per frame."""
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

S = 2  # supersampling
OUT_W = 600
FPS_MS = 60  # frame duration in ms (~16.7 fps)

GREEN = (0, 168, 107)
GREEN2 = (18, 199, 132)
DEEP = (0, 119, 75)
LIME = (201, 246, 91)
NIGHT = (10, 22, 17)
NIGHT2 = (15, 46, 32)
WHITE = (255, 255, 255)
OUTER = (243, 246, 244)
GOLD = (245, 197, 66)
GOLD_D = (201, 150, 24)
RED = (229, 50, 45)
INK = (16, 24, 20)

SKINS = [(141, 85, 36), (198, 134, 66), (92, 58, 30), (224, 172, 105), (59, 34, 25), (168, 107, 60), (107, 66, 38), (241, 194, 125)]
SHIRTS = [(0, 168, 107), (91, 63, 232), (238, 90, 47), (61, 107, 242), (232, 174, 24), (17, 19, 18), (232, 69, 139), (15, 118, 110)]
HAIRS = [(27, 18, 12), (59, 34, 25), (107, 66, 38), (201, 162, 39), (154, 163, 173)]

FONT_PATHS = {
    'xb': '/usr/share/fonts/opentype/inter/InterDisplay-ExtraBold.otf',
    'b': '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf',
    'sb': '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',
    'md': '/usr/share/fonts/opentype/inter/Inter-Medium.otf',
    'mono': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    'serif': '/usr/share/fonts/truetype/google-fonts/Lora-Italic-Variable.ttf',
}
_fc = {}


def F(kind, size):
    k = (kind, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONT_PATHS[kind], int(round(size * S)))
    return _fc[k]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def prog(t, start, dur):
    return clamp((t - start) / dur)


def ease_out(p):
    return 1 - (1 - p) ** 3


def ease_in_out(p):
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def ease_back(p, s=1.70158):
    if p <= 0:
        return 0.0
    if p >= 1:
        return 1.0
    p -= 1
    return p * p * ((s + 1) * p + s) + 1


def bounce(p):
    n1, d1 = 7.5625, 2.75
    if p < 1 / d1:
        return n1 * p * p
    if p < 2 / d1:
        p -= 1.5 / d1
        return n1 * p * p + 0.75
    if p < 2.5 / d1:
        p -= 2.25 / d1
        return n1 * p * p + 0.9375
    p -= 2.625 / d1
    return n1 * p * p + 0.984375


def mix(c1, c2, p):
    return tuple(int(round(a + (b - a) * p)) for a, b in zip(c1, c2))


def sc(v):
    return [x * S for x in v]


# --- drawing primitives in display units -------------------------------------------------
def rr(d, box, r, fill=None, outline=None, width=0):
    d.rounded_rectangle(sc(box), radius=r * S, fill=fill, outline=outline, width=int(round(width * S)))


def el(d, box, fill=None, outline=None, width=0):
    d.ellipse(sc(box), fill=fill, outline=outline, width=int(round(width * S)))


def circ(d, cx, cy, r, fill=None, outline=None, width=0):
    el(d, (cx - r, cy - r, cx + r, cy + r), fill, outline, width)


def line(d, pts, fill, width, round_caps=True):
    p = [(x * S, y * S) for x, y in pts]
    d.line(p, fill=fill, width=int(round(width * S)), joint='curve')
    if round_caps:
        r = width / 2
        for x, y in (pts[0], pts[-1]):
            circ(d, x, y, r, fill=fill)


def poly(d, pts, fill):
    d.polygon([(x * S, y * S) for x, y in pts], fill=fill)


def text(d, xy, s, font, fill, anchor='la', spacing=0):
    if spacing:
        x, y = xy
        if anchor[0] == 'm':
            x -= text_w(s, font, spacing) / 2
            anchor = 'l' + anchor[1]
        elif anchor[0] == 'r':
            x -= text_w(s, font, spacing)
            anchor = 'l' + anchor[1]
        for ch in s:
            d.text((x * S, y * S), ch, font=font, fill=fill, anchor=anchor)
            x += font.getlength(ch) / S + spacing
        return
    d.text((xy[0] * S, xy[1] * S), s, font=font, fill=fill, anchor=anchor)


def text_w(s, font, spacing=0):
    return font.getlength(s) / S + spacing * max(0, len(s) - 1)


def tight_text(d, xy, s, font, fill, track=-0.03, anchor='ls'):
    """Draw text with negative tracking (letter-spacing as a fraction of size)."""
    size = font.size / S
    text(d, xy, s, font, fill, anchor=anchor, spacing=track * size)


def layer(size):
    return Image.new('RGBA', size, (0, 0, 0, 0))


def comp(base, lay, alpha=1.0):
    if alpha <= 0:
        return
    if alpha < 1:
        a = lay.getchannel('A').point(lambda v: int(v * alpha))
        lay = lay.copy()
        lay.putalpha(a)
    base.alpha_composite(lay)


def paste_scaled(base, sprite, cx, cy, scale, alpha=1.0):
    """Paste an RGBA sprite (2x pixels) centred at display (cx, cy) with scale and alpha."""
    if scale <= 0.01 or alpha <= 0:
        return
    w, h = sprite.size
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    sp = sprite.resize((nw, nh), Image.LANCZOS) if (nw, nh) != (w, h) else sprite
    if alpha < 1:
        sp = sp.copy()
        sp.putalpha(sp.getchannel('A').point(lambda v: int(v * alpha)))
    lay = layer(base.size)
    lay.paste(sp, (int(cx * S - nw / 2), int(cy * S - nh / 2)), sp)
    base.alpha_composite(lay)


def glow(size, cx, cy, rx, ry, color, alpha, blur):
    lay = layer(size)
    d = ImageDraw.Draw(lay)
    el(d, (cx - rx, cy - ry, cx + rx, cy + ry), fill=color + (alpha,))
    return lay.filter(ImageFilter.GaussianBlur(blur * S))


def vgrad(size, c1, c2, horizontal=False, diag=False):
    w, h = size
    import numpy as np
    if diag:
        yy, xx = np.mgrid[0:h, 0:w]
        p = (xx / w + yy / h) / 2
    elif horizontal:
        p = np.tile(np.linspace(0, 1, w), (h, 1))
    else:
        p = np.tile(np.linspace(0, 1, h)[:, None], (1, w))
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    for i in range(3):
        arr[..., i] = (c1[i] + (c2[i] - c1[i]) * p).astype(np.uint8)
    arr[..., 3] = 255
    return Image.fromarray(arr, 'RGBA')


def round_top_corners(img, r=24, color=OUTER):
    """Bake the card's rounded top corners (display radius r) using the outer background colour."""
    w, h = img.size
    mask = Image.new('L', (w * 4, h * 4), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w * 4 - 1, h * 4 + r * 8], radius=r * 4, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    bg = Image.new('RGB', (w, h), color)
    bg.paste(img, (0, 0), mask)
    return bg


# --- characters ----------------------------------------------------------------------------
def person(d, cx, cy, r, skin, shirt, hair, style=0, blink=False, mouth=0, body=True, glasses=False):
    """Cartoon bust in the style of the site avatars. (cx, cy) is the head centre."""
    if body:
        rr(d, (cx - 1.25 * r, cy + 0.95 * r, cx + 1.25 * r, cy + 3.4 * r), 0.95 * r, fill=shirt)
        rr(d, (cx - 0.3 * r, cy + 0.55 * r, cx + 0.3 * r, cy + 1.2 * r), 0.2 * r, fill=mix(skin, (0, 0, 0), 0.12))
    if style == 3:  # afro
        el(d, (cx - 1.32 * r, cy - 1.55 * r, cx + 1.32 * r, cy + 0.55 * r), fill=hair)
    if style == 1:  # bun
        circ(d, cx, cy - 1.3 * r, 0.45 * r, fill=hair)
    el(d, (cx - r, cy - 1.12 * r, cx + r, cy + 1.12 * r), fill=skin)
    if style in (0, 1):
        d.chord(sc((cx - 1.05 * r, cy - 1.27 * r, cx + 1.05 * r, cy + 0.45 * r)), 180, 360, fill=hair)
    elif style == 2:
        d.chord(sc((cx - 1.03 * r, cy - 1.22 * r, cx + 1.03 * r, cy + 0.05 * r)), 180, 360, fill=hair)
    elif style == 3:
        d.chord(sc((cx - 1.08 * r, cy - 1.3 * r, cx + 1.08 * r, cy + 0.2 * r)), 180, 360, fill=hair)
    elif style == 4:  # cap
        d.chord(sc((cx - 1.06 * r, cy - 1.3 * r, cx + 1.06 * r, cy + 0.35 * r)), 180, 360, fill=shirt)
        rr(d, (cx, cy - 0.55 * r, cx + 1.5 * r, cy - 0.38 * r), 0.1 * r, fill=shirt)
    ex, ey = 0.36 * r, 0.08 * r
    ink = (20, 12, 8)
    for sx in (-1, 1):
        if blink:
            rr(d, (cx + sx * ex - 0.15 * r, cy + ey - 0.04 * r, cx + sx * ex + 0.15 * r, cy + ey + 0.05 * r), 0.04 * r, fill=ink)
        else:
            el(d, (cx + sx * ex - 0.12 * r, cy + ey - 0.15 * r, cx + sx * ex + 0.12 * r, cy + ey + 0.15 * r), fill=ink)
    if glasses:
        for sx in (-1, 1):
            circ(d, cx + sx * ex, cy + ey, 0.3 * r, outline=(17, 17, 17), width=0.09 * r)
        line(d, [(cx - ex + 0.3 * r, cy + ey), (cx + ex - 0.3 * r, cy + ey)], (17, 17, 17), 0.08 * r, False)
    mc = (58, 31, 20)
    if mouth == 0:
        d.arc(sc((cx - 0.32 * r, cy + 0.22 * r, cx + 0.32 * r, cy + 0.66 * r)), 15, 165, fill=mc, width=int(0.11 * r * S))
    elif mouth == 1:
        d.chord(sc((cx - 0.32 * r, cy + 0.28 * r, cx + 0.32 * r, cy + 0.78 * r)), 0, 180, fill=mc)
    else:
        el(d, (cx - 0.12 * r, cy + 0.42 * r, cx + 0.12 * r, cy + 0.68 * r), fill=mc)


def bot(d, cx, cy, r, tint=0.0):
    grey = mix((154, 163, 173), RED, tint * 0.65)
    line(d, [(cx, cy - 1.0 * r), (cx, cy - 1.45 * r)], grey, 0.16 * r)
    circ(d, cx, cy - 1.5 * r, 0.2 * r, fill=RED)
    rr(d, (cx - r, cy - r, cx + r, cy + 0.9 * r), 0.32 * r, fill=grey)
    for sx in (-1, 1):
        rr(d, (cx + sx * 0.42 * r - 0.2 * r, cy - 0.32 * r, cx + sx * 0.42 * r + 0.2 * r, cy + 0.08 * r), 0.06 * r, fill=RED)
    rr(d, (cx - 0.42 * r, cy + 0.38 * r, cx + 0.42 * r, cy + 0.54 * r), 0.08 * r, fill=(91, 99, 107))


def blink_at(t, period, offset, dur=0.14):
    return ((t + offset) % period) < dur


def coin(d, cx, cy, w, thick=7, shade=0.0):
    """Side-view coin: top face ellipse at cy, rim below."""
    h = w * 0.36
    rr(d, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2 + thick), h / 2, fill=GOLD_D, outline=(150, 105, 10), width=1)
    el(d, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), fill=mix(GOLD, WHITE, shade))
    el(d, (cx - w * 0.32, cy - h * 0.3, cx + w * 0.32, cy + h * 0.3), outline=GOLD_D, width=1.2)


def mark(d, x, y, size, tiles=None, bg=True):
    """VooSquare mark at display (x, y) top-left. tiles: list of (dx, dy, alpha) offsets per tile."""
    k = size / 512
    if bg:
        rr(d, (x, y, x + size, y + size), 120 * k, fill=GREEN)
    cols = [WHITE, (191, 233, 214), (191, 233, 214), LIME]
    pos = [(112, 112), (272, 112), (112, 272), (272, 272)]
    for i, (px, py) in enumerate(pos):
        dx, dy = (tiles[i] if tiles else (0, 0))
        rr(d, (x + px * k + dx, y + py * k + dy, x + (px + 128) * k + dx, y + (py + 128) * k + dy), 36 * k, fill=cols[i])


# --- output --------------------------------------------------------------------------------
SWATCH = [GREEN, GREEN2, DEEP, LIME, NIGHT, NIGHT2, WHITE, OUTER, GOLD, GOLD_D, RED, INK, (91, 63, 232), (60, 35, 194), (124, 92, 255)]


def save_gif(frames2x, path, start_index=0, duration=FPS_MS, colors=254, extra_swatch=(), corners=True, base2x=None):
    """frames2x: list of RGBA images at 2x. Downscale, quantise with one shared palette, save looping GIF."""
    frames = []
    for f in frames2x:
        w, h = f.size
        fr = f.convert('RGB').resize((w // S, h // S), Image.LANCZOS)
        frames.append(round_top_corners(fr) if corners else fr)
    frames = frames[start_index:] + frames[:start_index]
    # shared palette from a mosaic of sampled frames + brand swatch
    step = max(1, len(frames) // 12)
    sample = frames[::step]
    w, h = frames[0].size
    mosaic = Image.new('RGB', (w, h * len(sample)))
    for i, f in enumerate(sample):
        mosaic.paste(f, (0, h * i))
    sw = list(SWATCH) + SKINS + SHIRTS + HAIRS + [(122, 74, 42), (31, 74, 53), (58, 31, 20), (20, 12, 8)] + list(extra_swatch)
    # exact brand/skin colours are reserved; the rest of the palette comes from median cut
    uniq = []
    for c in sw:
        if c not in uniq:
            uniq.append(tuple(c))
    mc = mosaic.quantize(colors=colors - len(uniq), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    mp = mc.getpalette()[:(colors - len(uniq)) * 3]
    mp += [255, 0, 255] * (((colors - len(uniq)) * 3 - len(mp)) // 3)
    flat = mp + [v for c in uniq for v in c]
    flat += [255, 0, 255] * ((256 * 3 - len(flat)) // 3)  # never matched: keeps index 255 free for transparency
    pal = Image.new('P', (1, 1))
    pal.putpalette(flat)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    if base2x is not None:
        # Static background: dither it once (no banding) and reuse those indices wherever a frame shows the background.
        import numpy as np
        bw_, bh_ = base2x.size
        b = base2x.convert('RGB').resize((bw_ // S, bh_ // S), Image.LANCZOS)
        if corners:
            b = round_top_corners(b)
        bq = np.array(b.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG))
        brgb = np.array(b).astype(np.int16)
        nq = []
        for f, qi in zip(frames, q):
            fa = np.array(f).astype(np.int16)
            same = (np.abs(fa - brgb).max(axis=2) <= 1)
            a = np.array(qi)
            a[same] = bq[same]
            im = Image.fromarray(a.astype(np.uint8), 'P')
            im.putpalette(qi.getpalette())
            nq.append(im)
        q = nq
    # Inter-frame optimisation: pixels identical to the previous frame become transparent (index 255),
    # which LZW compresses to almost nothing. Frame 0 stays complete.
    import numpy as np
    TR = 255
    arrs = [np.array(x) for x in q]
    out = []
    pal_bytes = q[0].getpalette()[:255 * 3] + [255, 0, 255]
    for i, a in enumerate(arrs):
        if i == 0:
            b = a.copy()
        else:
            b = a.copy()
            b[a == arrs[i - 1]] = TR
        im = Image.fromarray(b.astype(np.uint8), 'P')
        im.putpalette(pal_bytes)
        im.info['transparency'] = TR
        out.append(im)
    out[0].save(path, save_all=True, append_images=out[1:], duration=duration, loop=0, optimize=False,
                disposal=1, transparency=TR)
    import os
    return os.path.getsize(path), len(q)
