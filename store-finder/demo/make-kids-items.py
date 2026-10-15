"""Pilot demo items for the toy aisle (squishies and craft kits) drawn in the chain's post style:
a pastel scene, the product as a big illustration, the name and an orange price circle.
    python3 demo/make-kids-items.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

D = os.path.join(os.path.dirname(__file__), 'hastock')
EMOJI = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 109)
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
heb = lambda s: s  # Pillow lays out right-to-left text itself

ITEMS = [
    # id, name, title on the image, emojis, background, price, keywords
    ('sq-cat', 'סקוויז חתול רך', 'סקוויז חתול', '🐱', ('#ffd6e8', '#ffe9f3'), '12.90', 'סקוויז, squishy, סקווישי, מעיכה, חתול'),
    ('sq-avocado', 'סקוויז אבוקדו', 'סקוויז אבוקדו', '🥑', ('#d9f7c9', '#effbe8'), '12.90', 'סקוויז, squishy, סקווישי, מעיכה, אבוקדו'),
    ('sq-donut', 'סקוויז דונאט בריח תות', 'סקוויז דונאט', '🍩', ('#ffe1c4', '#fff1e2'), '9.90', 'סקוויז, squishy, סקווישי, מעיכה, דונאט, ריחני'),
    ('sq-unicorn', 'סקוויז חד קרן נוצץ', 'סקוויז חד קרן', '🦄', ('#e6dcff', '#f3eeff'), '14.90', 'סקוויז, squishy, סקווישי, מעיכה, יוניקורן, חד קרן'),
    ('sq-pack', 'מארז 3 סקוויזים חיות', 'מארז סקוויזים', '🐸🐼🐷', ('#c9f0ff', '#e6f8ff'), '29.90', 'סקוויז, squishy, סקווישי, מעיכה, מארז, חיות'),
    ('sq-pop', 'פופ איט קשת ענק', 'פופ איט קשת', '🌈🫧', ('#fff3b0', '#fffbe0'), '19.90', 'פופ איט, pop it, פידג׳ט, fidget, קשת, צעצוע לחץ'),
    ('cr-slime', 'ערכת סליים זוהר', 'ערכת סליים', '🧪✨', ('#d4ffe6', '#ecfff4'), '34.90', 'סליים, slime, ערכת יצירה, יצירה, זוהר בחושך'),
    ('cr-bracelets', 'ערכת יצירת צמידים וחרוזים', 'צמידים וחרוזים', '📿💖', ('#ffe0f0', '#fff0f7'), '29.90', 'יצירה, ערכת יצירה, צמידים, חרוזים, תכשיטים'),
    ('cr-sand', 'ערכת ציור בחול צבעוני', 'ציור בחול', '🎨🏖️', ('#ffe9c7', '#fff5e6'), '24.90', 'יצירה, ערכת יצירה, חול צבעוני, ציור'),
    ('cr-diamond', 'ערכת ציור יהלומים', 'ציור יהלומים', '💎🖼️', ('#dde4ff', '#eef1ff'), '39.90', 'יצירה, ערכת יצירה, ציור יהלומים, יהלומים'),
    ('cr-clay', 'פלסטלינה 12 צבעים', 'פלסטלינה', '🧸🟥🟨', ('#ffe4d6', '#fff2ea'), '19.90', 'פלסטלינה, בצק משחק, יצירה, צבעים'),
    ('cr-paint', 'סט צבעי גואש לילדים', 'צבעי גואש', '🖌️🎨', ('#e0f4ff', '#f0faff'), '22.90', 'צבעים, גואש, ציור, יצירה, מכחול'),
]

def emoji_img(chars, size):
    parts = []
    for ch in chars_split(chars):
        im = Image.new('RGBA', (140, 140), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((8, 8), ch, font=EMOJI, embedded_color=True)
        im = im.crop(im.getbbox())
        parts.append(im)
    w = sum(p.width for p in parts) + 10 * (len(parts) - 1); h = max(p.height for p in parts)
    row = Image.new('RGBA', (w, h), (0, 0, 0, 0)); x = 0
    for p in parts: row.paste(p, (x, (h - p.height) // 2), p); x += p.width + 10
    k = min(size[0] / row.width, size[1] / row.height)
    return row.resize((int(row.width * k), int(row.height * k)), Image.LANCZOS)

def chars_split(s):
    out, cur = [], ''
    for c in s:
        if c in '️‍' or (cur and ord(c) in range(0x1F3FB, 0x1F400)): cur += c
        else:
            if cur: out.append(cur)
            cur = c
    if cur: out.append(cur)
    return out

def make(it):
    pid, name, title, emo, (c1, c2), price, kw = it
    W, H = 1000, 1000
    img = Image.new('RGB', (W, H), c2)
    d = ImageDraw.Draw(img)
    for y in range(H):  # soft gradient, a "room" behind the product
        t = y / H
        a = tuple(int(int(c1[i:i + 2], 16) * (1 - t) + int(c2[i:i + 2], 16) * t) for i in (1, 3, 5))
        d.line([(0, y), (W, y)], fill=a)
    d.rectangle((0, 700, W, H), fill=(236, 220, 200))  # a wooden table
    for x in range(0, W, 140): d.line([(x, 700), (x - 60, H)], fill=(222, 204, 182), width=3)
    pic = emoji_img(emo, (620, 480))
    sh = Image.new('RGBA', (pic.width + 120, 80), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((0, 0, pic.width + 120, 80), fill=(0, 0, 0, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    img.paste(sh, ((W - sh.width) // 2, 760), sh)
    img.paste(pic, ((W - pic.width) // 2, 790 - pic.height), pic)
    f = ImageFont.truetype(BOLD, 72)
    d.text((W - 60, 70), heb(title), font=f, fill=(25, 25, 35), anchor='ra')
    d.ellipse((700, 700, 940, 940), fill=(242, 112, 24))
    whole, cents = price.split('.')
    d.text((830, 825), whole, font=ImageFont.truetype(BOLD, 96), fill='white', anchor='rm')
    d.text((836, 790), cents, font=ImageFont.truetype(BOLD, 44), fill='white', anchor='lm')
    d.text((60, 920), heb('הסטוק'), font=ImageFont.truetype(BOLD, 54), fill=(242, 112, 24))
    img.save(os.path.join(D, f'{pid}.jpg'), quality=88)

cat = json.load(open(os.path.join(D, 'catalog.json'), encoding='utf-8'))
ids = {i[0] for i in ITEMS}
cat = [p for p in cat if p['id'] not in ids]
for it in ITEMS:
    make(it)
    pid, name, _, _, _, price, kw = it
    cat.append(dict(id=pid, name=name, brand='הסטוק', category='יצירה וסקוויזים', price=price,
                    keywords=f'{kw}, צעצוע, צעצועים, משחק, מתנה לילד, מתנה לילדה', aisle='a9',
                    level='מדף אמצעי' if pid.startswith('sq') else 'מדף עליון', image=f'{pid}.jpg', real=True, pilot=True))
json.dump(cat, open(os.path.join(D, 'catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(ITEMS), 'items;', len(cat), 'in catalog')
