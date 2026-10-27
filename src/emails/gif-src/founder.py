from playwright.sync_api import sync_playwright
from PIL import Image
svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="192" height="192"><defs><clipPath id="c"><circle cx="100" cy="100" r="100"/></clipPath></defs><g clip-path="url(#c)"><rect width="200" height="200" fill="#1F4A35"/>
<path d="M20 206C26 160 60 150 100 150C140 150 174 160 180 206Z" fill="#0A0F0C"/>
<path d="M78 150L100 182L122 150" fill="#C9F65B"/><path d="M88 150L100 168L112 150" fill="#0A0F0C"/>
<rect x="86" y="118" width="28" height="30" rx="10" fill="#6B4226"/><ellipse cx="100" cy="92" rx="40" ry="46" fill="#7A4A2A"/>
<path d="M60 86C58 44 142 44 140 86C134 66 118 58 100 58C82 58 66 66 60 86Z" fill="#120B07"/>
<path d="M66 110C70 140 130 140 134 110C128 128 72 128 66 110Z" fill="#120B07"/>
<g><ellipse cx="84" cy="92" rx="4.5" ry="5.2" fill="#120B07"/><ellipse cx="116" cy="92" rx="4.5" ry="5.2" fill="#120B07"/></g>
<g fill="none" stroke="#C9F65B" stroke-width="3"><rect x="70" y="82" width="26" height="20" rx="7"/><rect x="104" y="82" width="26" height="20" rx="7"/><path d="M96 90h8"/></g>
<path d="M88 116Q100 124 112 116" stroke="#2A140A" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<g transform="translate(100 34)"><path d="M-22 6L-16 -12L-6 0L0 -16L6 0L16 -12L22 6Z" fill="#C9F65B"/><rect x="-22" y="6" width="44" height="7" rx="3" fill="#C9F65B"/></g></g></svg>'''
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':192,'height':192})
    pg.set_content('<body style="margin:0;background:transparent">'+svg+'</body>')
    pg.screenshot(path='/tmp/claude-0/founder192.png', omit_background=True, clip={'x':0,'y':0,'width':192,'height':192}); b.close()
Image.open('/tmp/claude-0/founder192.png').resize((96,96),Image.LANCZOS).save('/home/claude/voosquare-app/public/email/founder.png',optimize=True)
