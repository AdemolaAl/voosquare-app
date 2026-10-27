#!/usr/bin/env python3
"""Render the VooSquare email heroes to public/email with Chromium + Pillow.

    python3 src/emails/art/render.py                 # every hero
    python3 src/emails/art/render.py welcome tools   # only these keys
    python3 src/emails/art/render.py --sheet DIR     # also write first/middle frame PNGs to DIR for review

Frames are drawn as SVG (art.js), rasterised at 2x in Chromium, then downscaled and quantised to one
shared palette per GIF (src/emails/gif-src/gifkit.py). Needs Python Playwright with Chromium; nothing is downloaded.
"""
import base64, io, json, os, sys, pathlib
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
OUT = pathlib.Path(os.environ['EMAIL_ART_OUT']) if os.environ.get('EMAIL_ART_OUT') else ROOT / 'public' / 'email'
sys.path.insert(0, str(HERE.parent / 'gif-src'))
from gifkit import save_gif  # noqa: E402

FRAME_MS = 100
LIMIT = 250 * 1024


def white_logo():
    """logo-white.png: the email logo with the dark 'Voo' turned white, for the dark header band."""
    src = ROOT / 'public' / 'email' / 'logo.png'
    im = Image.open(src).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and max(r, g, b) < 90:
                px[x, y] = (255, 255, 255, a)
    im.save(OUT / 'logo-white.png', optimize=True)


def main():
    args = sys.argv[1:]
    sheet = None
    if '--sheet' in args:
        i = args.index('--sheet'); sheet = pathlib.Path(args[i + 1]); del args[i:i + 2]; sheet.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1300, 'height': 900})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto((HERE / 'index.html').as_uri())
        pg.wait_for_function('!!(window.EMAIL_ART && window.frame)')
        heroes = pg.evaluate('EMAIL_ART.HEROES')
        total = 0
        for h in heroes:
            if args and h['key'] not in args:
                continue
            info = pg.evaluate('k => EMAIL_ART.info(k)', h['key'])
            grab = lambda T: Image.open(io.BytesIO(base64.b64decode(pg.evaluate('([k, t]) => frame(k, t, 2)', [h['key'], T]).split(',', 1)[1]))).convert('RGBA')
            path = OUT / h['file']
            if not info['dur']:
                im = grab(0).convert('RGB').quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                im.save(path, optimize=True)
                frames = None
            else:
                n = max(2, round(info['dur'] * 1000 / FRAME_MS))
                frames = [grab(i * info['dur'] / n) for i in range(n)]
                save_gif(frames, str(path), duration=FRAME_MS, corners=False)
            size = path.stat().st_size
            total += size
            print(f"{h['file']:26s} {size / 1024:7.1f} KB {'' if size <= LIMIT else '  OVER 250 KB'}")
            if sheet:
                if frames:
                    a = frames[0].resize((600, info['h']), Image.LANCZOS); m = frames[len(frames) // 2].resize((600, info['h']), Image.LANCZOS)
                    s = Image.new('RGB', (1210, info['h']), 'white'); s.paste(a, (0, 0)); s.paste(m, (610, 0)); s.save(sheet / f"{h['key']}.png")
                else:
                    Image.open(path).convert('RGB').save(sheet / f"{h['key']}.png")
        print(f'total {total / 1024:.0f} KB')
        # Manifest for src/emails/build.js: file, size and the plate colour the email header band must match.
        man = {}
        for h in heroes:
            info = pg.evaluate('k => EMAIL_ART.info(k)', h['key'])
            man[h['key']] = {'file': h['file'], 'width': 600, 'height': info['h'], 'band': info['colors']['base'], 'alt': h['alt']}
        (HERE / 'heroes.json').write_text(json.dumps(man, indent=2) + '\n')
        white_logo()
        if errors:
            print('page errors:', errors); sys.exit(1)
        b.close()


if __name__ == '__main__':
    main()
