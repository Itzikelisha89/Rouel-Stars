"""Builds demo "shelf photos" from the catalog product images: each aisle gets one or more
shelf sections (3 boards, up to 3 products per board). Writes shelves/<aisle>-<n>.jpg and
shelves.json with each product's box inside its shelf photo (0-1000 coordinates), so the demo
store works exactly like a store whose shelves were photographed.
    python3 demo/build-shelves.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFilter

D = os.path.join(os.path.dirname(__file__), 'hastock')
CELL_W, ROW_H, PER_ROW, ROWS = 500, 330, 3, 3
LEVELS = {1: ['מדף אמצעי'], 2: ['מדף עליון', 'מדף תחתון'], 3: ['מדף עליון', 'מדף אמצעי', 'מדף תחתון']}
# products that must sit on a specific board, so the photo matches the story told elsewhere
PIN_BOTTOM = {'orient', 'orient-28'}

catalog = json.load(open(os.path.join(D, 'catalog.json'), encoding='utf-8'))
by_aisle = {}
for p in catalog:
    if 'photo' not in p:  # products on a real photo of the store keep their place in it
        by_aisle.setdefault(p['aisle'], []).append(p)

out = {}
os.makedirs(os.path.join(D, 'shelves'), exist_ok=True)
for aisle, items in sorted(by_aisle.items()):
    items = sorted(items, key=lambda p: p['id'] in PIN_BOTTOM)  # pinned products go last = bottom board
    per_photo = PER_ROW * ROWS
    for n, start in enumerate(range(0, len(items), per_photo)):
        group = items[start:start + per_photo]
        k = -(-len(group) // PER_ROW)  # boards needed; spread products evenly (4 -> 2+2, not 3+1)
        sizes = [len(group) // k + (1 if i < len(group) % k else 0) for i in range(k)]
        rows, i = [], 0
        for sz in sizes:
            rows.append(group[i:i + sz]); i += sz
        W = CELL_W * max(len(r) for r in rows)
        H = 60 + len(rows) * ROW_H
        img = Image.new('RGB', (W, H), (238, 236, 232))
        d = ImageDraw.Draw(img)
        name = f'{aisle}-{n + 1}.jpg'
        for r, row in enumerate(rows):
            y_board = 40 + (r + 1) * ROW_H - 30
            cell = W // len(row)
            for c, p in enumerate(row):
                im = Image.open(os.path.join(D, p['image'])).convert('RGB')
                im.thumbnail((cell - 80, ROW_H - 70), Image.LANCZOS)
                x = c * cell + (cell - im.width) // 2
                y = y_board - im.height
                shadow = Image.new('RGBA', (im.width + 40, im.height + 40), (0, 0, 0, 0))
                ImageDraw.Draw(shadow).rounded_rectangle((20, 26, im.width + 20, im.height + 26), 16, fill=(0, 0, 0, 80))
                shadow = shadow.filter(ImageFilter.GaussianBlur(9))
                img.paste(shadow, (x - 20, y - 20), shadow)
                mask = Image.new('L', im.size, 0)
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), 14, fill=255)
                img.paste(im, (x, y), mask)
                out[p['id']] = dict(shelfPhoto=name, level=LEVELS[len(rows)][r],
                                    box=dict(x0=round(x / W * 1000), y0=round(y / H * 1000),
                                             x1=round((x + im.width) / W * 1000), y1=round((y + im.height) / H * 1000)))
            # the store's own shelf: a white board with the orange price rail and its white dots
            d.rectangle((0, y_board, W, y_board + 8), fill=(236, 238, 240))
            d.rectangle((0, y_board + 8, W, y_board + 30), fill=(242, 112, 24))
            for xd in range(60, W, 240):
                d.ellipse((xd, y_board + 11, xd + 16, y_board + 27), fill=(255, 255, 255))
                d.ellipse((xd + 13, y_board + 11, xd + 29, y_board + 27), fill=(255, 255, 255))
        img.save(os.path.join(D, 'shelves', name), quality=86)
for p in catalog:
    if 'photo' in p:
        Image.open(os.path.join(D, p['photo'])).convert('RGB').save(os.path.join(D, 'shelves', p['photo']), quality=86)
        out[p['id']] = dict(shelfPhoto=p['photo'], level=p['level'], box=p['box'])
json.dump(out, open(os.path.join(D, 'shelves.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), 'products on', len(os.listdir(os.path.join(D, 'shelves'))), 'shelf photos')
