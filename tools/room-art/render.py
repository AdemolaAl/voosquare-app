#!/usr/bin/env python3
"""Render the VooSquare room artwork to WebP with Chromium.

    python3 tools/room-art/render.py            # writes public/assets/rooms/<slug>.webp and <slug>-cover.webp
    python3 tools/room-art/render.py --sheet out.png   # also saves a contact sheet to look at

Needs Python Playwright with Chromium (PLAYWRIGHT_BROWSERS_PATH). Nothing is downloaded.
"""
import base64, os, sys, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'public' / 'assets' / 'rooms'
SQUARE_Q, COVER_Q = 0.84, 0.8

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 900})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto((HERE / 'index.html').as_uri())
        pg.wait_for_function('!!(window.ROOM_ART && window.renderArt)')
        slugs = pg.evaluate('ROOM_ART.ROOMS.map(r => r.slug)')
        total = 0
        for slug in slugs:
            for kind, name, q in (('square', f'{slug}.webp', SQUARE_Q), ('cover', f'{slug}-cover.webp', COVER_Q)):
                data = pg.evaluate('([s, k, q]) => renderArt(s, k, q)', [slug, kind, q])
                raw = base64.b64decode(data.split(',', 1)[1])
                (OUT / name).write_bytes(raw)
                total += len(raw)
                print(f'{name:32s} {len(raw)/1024:6.1f} KB')
        print(f'total {total/1024:.0f} KB')
        if sheet:
            pg.evaluate('sheet()')
            pg.wait_for_timeout(1500)
            pg.screenshot(path=sheet, full_page=True)
        if errors:
            print('page errors:', errors); sys.exit(1)
        b.close()

if __name__ == '__main__':
    main()
