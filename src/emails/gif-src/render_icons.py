import os, glob
from playwright.sync_api import sync_playwright
from PIL import Image
root='/home/claude/voosquare-app/public'
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':96,'height':96}, device_scale_factor=1)
    for f in sorted(glob.glob(root+'/assets/icons/*.svg')):
        k=os.path.basename(f)[:-4]
        svg=open(f).read()
        pg.set_content(f'<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,{__import__("base64").b64encode(svg.encode()).decode()}" width="96" height="96" style="display:block"></body></html>')
        pg.wait_for_timeout(50)
        pg.screenshot(path=f'{root}/email/icons/{k}.png', omit_background=True, clip={'x':0,'y':0,'width':96,'height':96})
        # also 2x master for GIF use
    pg2=b.new_page(viewport={'width':192,'height':192})
    for f in sorted(glob.glob(root+'/assets/icons/*.svg')):
        k=os.path.basename(f)[:-4]; svg=open(f).read()
        pg2.set_content(f'<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,{__import__("base64").b64encode(svg.encode()).decode()}" width="192" height="192" style="display:block"></body></html>')
        pg2.wait_for_timeout(50)
        pg2.screenshot(path=f'' + __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'icon2x', f'{k}.png') + '', omit_background=True, clip={'x':0,'y':0,'width':192,'height':192})
    b.close()
# logos
im=Image.open(root+'/assets/logo-light.png').convert('RGB')
from PIL import ImageChops
bg=Image.new('RGB',im.size,(255,255,255))
bbox=ImageChops.difference(im,bg).point(lambda v:255 if v>8 else 0).getbbox()
im=im.crop(bbox); print('logo bbox',bbox,im.size)
w=400; h=round(im.size[1]*w/im.size[0])
im.resize((w,h),Image.LANCZOS).save(root+'/email/logo.png',optimize=True); print('logo',w,h)
ic=Image.open(root+'/assets/logo-icon.png').convert('RGBA').resize((96,96),Image.LANCZOS); ic.save(root+'/email/logo-icon.png',optimize=True)
