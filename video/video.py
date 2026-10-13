"""Renders the 60s birthday commercial frames and pipes them to ffmpeg."""
import sys, os, math, glob, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = os.path.dirname(HERE)
DL = os.path.join(SCR, 'dl'); FN = os.path.join(SCR, 'fonts')
W, H, FPS, DUR = 1920, 1080, 25, 60.0

BEAT = 60 / 108
T_V1 = 5.5; T_V2 = T_V1 + 25 * BEAT; T_BR = T_V2 + 25 * BEAT; T_V3 = T_BR + 20 * BEAT

def font(name, size):
    return ImageFont.truetype(os.path.join(FN, name), size, layout_engine=ImageFont.Layout.RAQM)

F_TITLE = 'SuezOne-Regular.ttf.ttf'
F_BODY = 'SecularOne-Regular.ttf.ttf'
F_LIGHT = 'Heebo.ttf'

def img(name):
    return Image.open(os.path.join(DL, name)).convert('RGBA')

# ---------------- easing ----------------
def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_in_out(x): x = clamp(x); return 3 * x * x - 2 * x * x * x
def ease_back(x):
    x = clamp(x); c1 = 1.9; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
def window(t, t0, t1, fi=0.5, fo=0.5):
    """0..1 visibility envelope"""
    if t < t0 or t > t1: return 0.0
    return min(ease_out((t - t0) / fi) if fi > 0 else 1, ease_in_out((t1 - t) / fo) if fo > 0 else 1)

# ---------------- sprites ----------------
GOLD = [(255, 247, 200), (250, 222, 130), (226, 172, 60), (180, 120, 30), (240, 200, 100)]

def gradient(w, h, stops):
    ys = np.linspace(0, 1, h)[:, None]
    pos = np.linspace(0, 1, len(stops))
    arr = np.zeros((h, 1, 3))
    for c in range(3):
        arr[..., c] = np.interp(ys, pos, [s[c] for s in stops])
    return np.repeat(arr, w, 1)

def text_sprite(txt, fname, size, style='gold', stroke=0, glow=True, shadow=True):
    f = font(fname, size)
    kw = dict(direction='rtl', language='he') if any('֐' <= ch <= '׿' for ch in txt) else {}
    bb = f.getbbox(txt, stroke_width=stroke, **kw)
    pad = int(size * 0.5)
    w, h = bb[2] - bb[0] + 2 * pad, bb[3] - bb[1] + 2 * pad
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).text((pad - bb[0], pad - bb[1]), txt, font=f, fill=255, stroke_width=stroke, stroke_fill=255, **kw)
    if style == 'gold':
        fill = gradient(w, h, [GOLD[0], GOLD[1], GOLD[2], GOLD[3], GOLD[4]])
        # restrict gradient to text vertical extent
        y0, y1 = pad, h - pad
        g = gradient(w, max(1, y1 - y0), [GOLD[0], GOLD[1], GOLD[2], GOLD[3], GOLD[1]])
        fill[y0:y1] = g
        fill[:y0] = GOLD[0]; fill[y1:] = GOLD[4]
        col = fill
        edge_col = (90, 55, 10)
    elif style == 'white':
        col = np.ones((h, w, 3)) * 255; edge_col = (10, 40, 40)
    else:  # mint
        col = gradient(w, h, [(225, 255, 225), (150, 220, 130), (110, 190, 90)]); edge_col = (5, 50, 45)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if glow:
        gl = mask.filter(ImageFilter.GaussianBlur(size * 0.18))
        gcol = (255, 200, 90) if style == 'gold' else (160, 255, 200) if style == 'mint' else (255, 255, 255)
        gimg = Image.new('RGBA', (w, h), gcol + (0,)); gimg.putalpha(gl.point(lambda v: int(v * 0.55)))
        out = Image.alpha_composite(out, gimg)
    if shadow:
        sh = mask.filter(ImageFilter.GaussianBlur(max(2, size * 0.04)))
        sh = ImageChops.offset(sh, int(size * 0.03), int(size * 0.05))
        simg = Image.new('RGBA', (w, h), (0, 0, 0, 0)); simg.putalpha(sh.point(lambda v: int(v * 0.8)))
        out = Image.alpha_composite(out, simg)
    # thin dark edge
    edge = mask.filter(ImageFilter.MaxFilter(3))
    eimg = Image.new('RGBA', (w, h), edge_col + (0,)); eimg.putalpha(edge.point(lambda v: int(v * 0.7)))
    out = Image.alpha_composite(out, eimg)
    timg = Image.fromarray(col.astype(np.uint8), 'RGB').convert('RGBA'); timg.putalpha(mask)
    out = Image.alpha_composite(out, timg)
    out.info['mask'] = mask
    return out

def recolor_gold(im):
    a = im.getchannel('A')
    w, h = im.size
    g = Image.fromarray(gradient(w, h, [GOLD[0], GOLD[1], GOLD[2], GOLD[1]]).astype(np.uint8), 'RGB').convert('RGBA')
    g.putalpha(a)
    return g

def circle_frame(src, diam, ring=14, focus=None, zoom=1.0, shift=(0, 0)):
    """circular photo medallion with golden ring and soft glow. focus=(cx,cy,side) crop in src px"""
    sw, sh = src.size
    if focus is None: focus = (sw / 2, sh / 2, min(sw, sh))
    cx, cy, side = focus
    side = side / zoom
    cx += shift[0]; cy += shift[1]
    box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
    ph = src.transform((diam, diam), Image.EXTENT, box, Image.BICUBIC)
    bg = Image.new('RGBA', (diam, diam), (250, 250, 245, 255))
    ph = Image.alpha_composite(bg, ph)
    pad = ring * 3
    S = diam + 2 * pad
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # glow
    gm = Image.new('L', (S, S), 0); ImageDraw.Draw(gm).ellipse((pad - ring, pad - ring, S - pad + ring, S - pad + ring), fill=255)
    gm = gm.filter(ImageFilter.GaussianBlur(ring * 1.6))
    gl = Image.new('RGBA', (S, S), (255, 205, 100, 0)); gl.putalpha(gm.point(lambda v: int(v * 0.85)))
    out = Image.alpha_composite(out, gl)
    # ring (gold gradient)
    rm = Image.new('L', (S, S), 0); ImageDraw.Draw(rm).ellipse((pad - ring, pad - ring, S - pad + ring, S - pad + ring), fill=255)
    rg = Image.fromarray(gradient(S, S, [GOLD[0], GOLD[2], GOLD[3], GOLD[1], GOLD[0]]).astype(np.uint8), 'RGB').convert('RGBA')
    rg.putalpha(rm)
    out = Image.alpha_composite(out, rg)
    # photo
    pm = Image.new('L', (diam * 2, diam * 2), 0); ImageDraw.Draw(pm).ellipse((0, 0, diam * 2 - 1, diam * 2 - 1), fill=255)
    pm = pm.resize((diam, diam), Image.LANCZOS)
    ph.putalpha(ImageChops.multiply(ph.getchannel('A'), pm))
    out.alpha_composite(ph, (pad, pad))
    # inner thin dark line
    ImageDraw.Draw(out).ellipse((pad - 2, pad - 2, pad + diam + 1, pad + diam + 1), outline=(120, 80, 20, 200), width=3)
    return out

def star_sprite(r, col=(255, 240, 190)):
    S = r * 4; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = S / 2
    d.polygon([(c, c - 2 * r), (c + r * .18, c - r * .18), (c + 2 * r, c), (c + r * .18, c + r * .18),
               (c, c + 2 * r), (c - r * .18, c + r * .18), (c - 2 * r, c), (c - r * .18, c - r * .18)], fill=col + (255,))
    glow = im.filter(ImageFilter.GaussianBlur(r * 0.5))
    dot = Image.new('RGBA', (S, S), (0, 0, 0, 0)); ImageDraw.Draw(dot).ellipse((c - r * .5, c - r * .5, c + r * .5, c + r * .5), fill=(255, 255, 255, 255))
    out = Image.alpha_composite(glow, im); out = Image.alpha_composite(out, glow)
    return Image.alpha_composite(out, dot.filter(ImageFilter.GaussianBlur(r * 0.2)))

def bokeh_sprite(r, col, a=110):
    S = int(r * 2.6); im = Image.new('RGBA', (S, S), col + (0,)); m = Image.new('L', (S, S), 0)
    c = S / 2; ImageDraw.Draw(m).ellipse((c - r, c - r, c + r, c + r), fill=a)
    ImageDraw.Draw(m).ellipse((c - r * .85, c - r * .85, c + r * .85, c + r * .85), fill=int(a * 0.7))
    im.putalpha(m.filter(ImageFilter.GaussianBlur(r * 0.12))); return im

def dot_sprite(r, col):
    S = int(r * 6); im = Image.new('RGBA', (S, S), col + (0,)); m = Image.new('L', (S, S), 0); c = S / 2
    ImageDraw.Draw(m).ellipse((c - r * 2, c - r * 2, c + r * 2, c + r * 2), fill=90)
    m = m.filter(ImageFilter.GaussianBlur(r))
    ImageDraw.Draw(m).ellipse((c - r * .7, c - r * .7, c + r * .7, c + r * .7), fill=255)
    im.putalpha(m); return im

# ---------------- paste helper ----------------
def paste(canvas, spr, cx, cy, scale=1.0, alpha=1.0, rot=0.0):
    if alpha <= 0.003 or scale <= 0.01: return
    s = spr
    if abs(scale - 1) > 0.003:
        s = s.resize((max(1, int(s.width * scale)), max(1, int(s.height * scale))), Image.BICUBIC)
    if rot: s = s.rotate(rot, Image.BICUBIC, expand=True)
    if alpha < 0.997:
        s = s.copy(); s.putalpha(s.getchannel('A').point(lambda v, a=alpha: int(v * a)))
    x, y = int(cx - s.width / 2), int(cy - s.height / 2)
    # clip
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + s.width), min(H, y + s.height)
    if x1 <= x0 or y1 <= y0: return
    canvas.alpha_composite(s.crop((x0 - x, y0 - y, x1 - x, y1 - y)), (x0, y0))

def add_light(canvas, spr, cx, cy, scale=1.0, alpha=1.0):
    """additive blend (screen-ish) of an RGBA sprite"""
    if alpha <= 0.003: return
    s = spr if abs(scale - 1) < 0.003 else spr.resize((max(1, int(spr.width * scale)), max(1, int(spr.height * scale))), Image.BICUBIC)
    x, y = int(cx - s.width / 2), int(cy - s.height / 2)
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + s.width), min(H, y + s.height)
    if x1 <= x0 or y1 <= y0: return
    reg = canvas.crop((x0, y0, x1, y1)); sc = s.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    a = np.asarray(sc, dtype=np.float32); r = np.asarray(reg, dtype=np.float32)
    k = a[..., 3:4] / 255 * alpha
    out = r.copy(); out[..., :3] = np.minimum(255, r[..., :3] + a[..., :3] * k)
    canvas.paste(Image.fromarray(out.astype(np.uint8), 'RGBA'), (x0, y0))

# ---------------- global assets (built once per worker) ----------------
A = {}
def build_assets():
    if A: return
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    def radial(c_in, c_out, cx=W / 2, cy=H / 2, rr=1150):
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rr; d = np.clip(d, 0, 1)[..., None] ** 1.3
        return (np.array(c_in) * (1 - d) + np.array(c_out) * d)
    A['bg_dark'] = Image.fromarray(radial((14, 70, 66), (2, 12, 14)).astype(np.uint8)).convert('RGBA')
    A['bg_emerald'] = Image.fromarray(radial((20, 105, 95), (3, 28, 30)).astype(np.uint8)).convert('RGBA')
    A['bg_warm'] = Image.fromarray(radial((60, 45, 20), (8, 10, 12), rr=1250).astype(np.uint8)).convert('RGBA')
    # light rays (half res, rotated per frame)
    RS = 1400; rays = Image.new('L', (RS, RS), 0); d = ImageDraw.Draw(rays); c = RS / 2
    rs = np.random.default_rng(3)
    for i in range(24):
        a0 = i * 15 + rs.uniform(-3, 3); wdt = rs.uniform(2.5, 6)
        p = [(c, c)] + [(c + RS * math.cos(math.radians(a)), c + RS * math.sin(math.radians(a))) for a in (a0 - wdt / 2, a0 + wdt / 2)]
        d.polygon(p, fill=int(rs.uniform(25, 60)))
    rays = rays.filter(ImageFilter.GaussianBlur(10))
    fall = Image.fromarray((255 * np.clip(1 - np.sqrt(((np.mgrid[0:RS, 0:RS] - c) ** 2).sum(0)) / (RS / 2), 0, 1) ** 1.5).astype(np.uint8))
    A['rays'] = ImageChops.multiply(rays, fall)
    A['star'] = [star_sprite(r) for r in (6, 9, 13, 18)]
    A['bokeh'] = [bokeh_sprite(r, c) for r in (30, 50, 75) for c in ((255, 215, 120), (150, 230, 190), (255, 245, 220))]
    A['dot'] = [dot_sprite(r, c) for r in (2, 3, 4) for c in ((255, 220, 140), (255, 250, 230))]
    A['fw_dot'] = {c: dot_sprite(4, c) for c in [(255, 210, 90), (255, 120, 140), (140, 230, 255), (180, 255, 160), (255, 255, 255), (220, 160, 255)]}
    fr = 160; g = np.mgrid[-fr:fr, -fr:fr].astype(np.float32); d2 = (g ** 2).sum(0) / (fr * 0.45) ** 2
    fa = (np.exp(-d2) * 255).astype(np.uint8)
    fl = Image.new('RGBA', (2 * fr, 2 * fr), (255, 230, 170, 0)); fl.putalpha(Image.fromarray(fa)); A['flare'] = fl

    # photos
    A['portrait'] = img('2020_11_Untitled-1_06.png')
    A['logo_je'] = recolor_gold(img('2026_06_logo02.png'))
    A['logo_main'] = img('2020_11_לוגו-סופי-02-1024x691.png').crop((89, 110, 962, 547))
    lf = np.asarray(img('2020_11_תמונה-עלים-דף-אודות-מעודכנת.jpg'), dtype=np.float32)
    mx, mn = lf[..., :3].max(-1), lf[..., :3].min(-1)
    la = np.clip((mx - mn) * 3.0 + (255 - mx) * 2.0 - 20, 0, 255)
    hh = la.shape[0]; ramp = np.clip((hh - np.arange(hh)) / (hh * 0.25), 0, 1)[:, None]
    lf[..., 3] = la * ramp
    A['leaf'] = Image.fromarray(lf.astype(np.uint8), 'RGBA').filter(ImageFilter.SMOOTH)
    def circ_src(name, inset):
        im = img(name); w, h = im.size
        return circle_frame(im, 420, ring=10, focus=(w / 2, h / 2, min(w, h) - inset))
    A['c_massage'] = circ_src('2021_01_דף-פנימי-פירוט-השירותים_18.png', 22)
    A['c_healing'] = circ_src('2021_01_דף-פנימי-פירוט-השירותים_19.png', 22)
    A['c_back'] = circ_src('2023_03_ציוד-למטפלים.jpg', 0)
    A['c_roses'] = circ_src('2020_12_עיצוב-אתר-דף-בית_48.png', 0)
    A['c_tea'] = circ_src('2020_12_עיצוב-אתר-דף-בית_50.png', 0)
    A['c_ortho'] = circ_src('2021_08_דף-פנימי-אודות_39.jpg', 40)
    A['c_preg'] = circ_src('2021_08_דף-פנימי-אודות_42.jpg', 40)
    A['c_anx'] = circ_src('2021_08_דף-פנימי-אודות_45.jpg', 40)
    A['c_prod'] = circ_src('2022_09_מוצרים.jpg', 40)

    T = {}
    def tx(key, s, fname, size, style='gold', **kw): T[key] = text_sprite(s, fname, size, style, **kw)
    tx('intro1', 'יום מיוחד', F_TITLE, 120)
    tx('intro2', 'לאדם מיוחד מאוד', F_BODY, 80, 'white')
    tx('mazal', 'מזל טוב!', F_TITLE, 190)
    tx('hb', 'יום הולדת שמח', F_BODY, 104, 'white')
    tx('name', 'שוקי אלישע', F_TITLE, 150)
    tx('who1', 'יהושע (שוקי) אלישע', F_TITLE, 100)
    tx('who2', 'מטפל ברפואה טבעית ומשלימה', F_BODY, 66, 'white')
    tx('who3', 'איש של ריפוי, אהבה ונתינה', F_BODY, 66, 'mint')
    tx('world', 'עולם שלם של ריפוי', F_TITLE, 104)
    methods = ['קינסיולוגיה', 'דיקור סיני', 'רפלקסולוגיה', 'ארומתרפיה', 'פרחי באך',
               'כוסות רוח', 'קרניו-סקראל', 'עיסוי רפואי', 'קינזיו טייפ', 'הילינג קבלי']
    T['methods'] = [text_sprite(m, F_BODY, 58, 'white', glow=False) for m in methods]
    tx('clinic', 'הקליניקה לרפואה טבעית', F_TITLE, 96)
    tx('cap_ortho', 'בעיות אורתופדיות', F_BODY, 50, 'white')
    tx('cap_preg', 'פריון והריון', F_BODY, 50, 'white')
    tx('cap_anx', 'חרדה ומתח', F_BODY, 50, 'white')
    tx('je1', 'ליין JE – רוקחות אישית', F_TITLE, 84)
    tx('je2', 'מוצרים טבעיים · קורסים · סדנאות', F_BODY, 58, 'white')
    tx('grow', 'שהקליניקה תמשיך לפרוח ולצמוח!', F_TITLE, 96, 'mint')
    tx('w0', 'שוקי היקר,', F_TITLE, 92)
    tx('w1', 'מאחלים לך בריאות, אושר ושפע', F_BODY, 72, 'white')
    tx('w2', 'הצלחה גדולה בכל מה שאתה עושה', F_BODY, 72, 'white')
    tx('w3', 'שתמשיך לרפא ולהאיר', F_BODY, 72, 'mint')
    tx('w4', 'לכל כך הרבה אנשים', F_BODY, 72, 'mint')
    tx('fin1', 'מזל טוב שוקי!', F_TITLE, 170)
    tx('fin2', 'עד 120!', F_TITLE, 130)
    tx('fin3', 'יהושע אלישע · הקליניקה לרפואה טבעית', F_BODY, 50, 'white')
    A['T'] = T
    # pill backgrounds for methods
    pills = []
    for s in T['methods']:
        pw, ph = s.width - 30, 96
        p = Image.new('RGBA', (pw + 20, ph + 20), (0, 0, 0, 0)); d = ImageDraw.Draw(p)
        d.rounded_rectangle((10, 10, pw + 10, ph + 10), radius=48, fill=(8, 60, 58, 200), outline=(236, 190, 90, 255), width=4)
        pills.append(p)
    A['pills'] = pills

# ---------------- particle systems (deterministic in t) ----------------
RNG = np.random.default_rng(11)
NB = 26
BOK = [(RNG.uniform(0, W), RNG.uniform(0, H), RNG.uniform(8, 30), RNG.uniform(0, 6.28), int(RNG.integers(0, 9)), RNG.uniform(0.25, 0.9)) for _ in range(NB)]
DUST = [(RNG.uniform(0, W), RNG.uniform(0, H), RNG.uniform(10, 45), RNG.uniform(0, 6.28), int(RNG.integers(0, 6))) for _ in range(90)]
STARS = [(RNG.uniform(60, W - 60), RNG.uniform(60, H - 60), RNG.uniform(0, 10), RNG.uniform(0.6, 1.6), int(RNG.integers(0, 4))) for _ in range(40)]
CONF_COLS = [(250, 210, 90), (255, 240, 200), (120, 200, 120), (40, 160, 150), (240, 120, 120), (255, 255, 255)]
CONF = [(RNG.uniform(-100, W + 100), RNG.uniform(-1.2, 0), RNG.uniform(90, 200), RNG.uniform(0, 6.28), RNG.uniform(2, 6),
         RNG.uniform(10, 22), CONF_COLS[int(RNG.integers(0, 6))], RNG.uniform(30, 90)) for _ in range(170)]

def draw_bokeh(c, t, amt=1.0):
    for (x, y, sp, ph, k, a) in BOK:
        xx = (x + math.sin(t * 0.3 + ph) * 60) % W; yy = (y - t * sp) % (H + 200) - 100
        paste(c, A['bokeh'][k], xx, yy, 1.0, a * amt * (0.6 + 0.4 * math.sin(t * 0.8 + ph)))

def draw_dust(c, t, amt=1.0):
    for (x, y, sp, ph, k) in DUST:
        xx = (x + math.sin(t * 0.5 + ph) * 40 + t * 8) % W; yy = (y - t * sp) % H
        tw = 0.5 + 0.5 * math.sin(t * 3 + ph * 3)
        paste(c, A['dot'][k], xx, yy, 1.0, amt * (0.3 + 0.7 * tw))

def draw_stars(c, t, amt=1.0):
    for (x, y, ph, sp, k) in STARS:
        v = math.sin(t * sp * 2 + ph) ** 8
        if v > 0.05: add_light(c, A['star'][k], x, y, 0.6 + 0.6 * v, amt * v)

def draw_rays(c, t, amt, cx=W / 2, cy=H / 2, col=(255, 210, 120)):
    if amt <= 0: return
    r = A['rays'].rotate(t * 6, Image.BILINEAR).resize((2600, 2600), Image.BILINEAR)
    lay = Image.new('RGBA', r.size, col + (0,)); lay.putalpha(r)
    add_light(c, lay, cx, cy, 1.0, amt)

def draw_confetti(c, t, t0, amt=1.0, dur=8.0):
    if t < t0 or t > t0 + dur + 4: return
    d = ImageDraw.Draw(c)
    for (x, y0, vy, ph, spin, sz, col, sway) in CONF:
        tt = t - t0 - (y0 * -1.0)
        if tt < 0: continue
        y = -40 + tt * vy * 2.2; x2 = x + math.sin(tt * 1.7 + ph) * sway
        if y > H + 40: continue
        ang = tt * spin + ph; fl = abs(math.cos(tt * spin * 1.3 + ph))
        w2, h2 = sz, sz * 0.5 * (0.2 + fl)
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [(x2 + px * ca - py * sa, y + px * sa + py * ca) for px, py in ((-w2, -h2), (w2, -h2), (w2, h2), (-w2, h2))]
        shade = 0.65 + 0.35 * fl
        fade = clamp((t0 + dur + 3 - t) / 2)
        d.polygon(pts, fill=tuple(int(v * shade) for v in col) + (int(235 * amt * fade),))

FW = []
_r = np.random.default_rng(5)
for (tb, x, y, col) in [(44.45, 520, 300, (255, 210, 90)), (45.2, 1450, 250, (140, 230, 255)), (46.3, 900, 200, (255, 120, 140)),
                        (47.6, 300, 420, (180, 255, 160)), (48.7, 1650, 380, (255, 210, 90)), (50.3, 1100, 230, (220, 160, 255)),
                        (52.0, 420, 260, (255, 255, 255)), (53.6, 1500, 230, (255, 210, 90)),
                        (54.05, 960, 260, (255, 210, 90)), (54.4, 420, 330, (255, 120, 140)), (54.7, 1500, 300, (140, 230, 255)),
                        (55.9, 700, 220, (180, 255, 160)), (56.6, 1250, 200, (255, 255, 255)), (57.4, 250, 300, (220, 160, 255)),
                        (57.9, 1700, 260, (255, 210, 90))]:
    n = 90; ang = _r.uniform(0, 2 * math.pi, n); spd = _r.uniform(180, 420, n)
    FW.append((tb, x, y, col, ang, spd))

def draw_fireworks(c, t, amt=1.0):
    for (tb, x, y, col, ang, spd) in FW:
        dt = t - tb
        if dt < -0.6 or dt > 2.4: continue
        if dt < 0:  # rising rocket
            p = (dt + 0.6) / 0.6
            paste(c, A['fw_dot'][(255, 255, 255)], x, H + 20 - (H + 20 - y) * ease_out(p), 1.0, amt)
            continue
        if dt < 0.25: add_light(c, A['flare'], x, y, 1.0 + dt * 4, amt * (1 - dt / 0.25) * 0.9)
        fade = clamp(1 - dt / 2.4) ** 1.3
        for k in range(len(ang)):
            for tr in (0.0, 0.06, 0.12):
                tt = max(0, dt - tr)
                r = spd[k] * (1 - math.exp(-tt * 2.2)) / 2.2 * 1.6
                px = x + math.cos(ang[k]) * r; py = y + math.sin(ang[k]) * r + 40 * tt * tt
                paste(c, A['fw_dot'][col], px, py, 1.0 - tr * 3, amt * fade * (1 - tr * 5) * (0.6 + 0.4 * math.sin(tt * 30 + k)))

def shine(spr, p):
    """sweep a light band across a text sprite (p 0..1)"""
    if p <= 0 or p >= 1: return spr
    w, h = spr.size
    xs = np.arange(w)[None, :] + np.arange(h)[:, None] * 0.4
    band = np.exp(-((xs - (-0.2 + 1.4 * p) * (w + h * .4)) / (w * 0.06)) ** 2)
    m = np.asarray(spr.info.get('mask') or spr.getchannel('A'), dtype=np.float32) / 255
    a = np.asarray(spr, dtype=np.float32).copy()
    a[..., :3] = np.minimum(255, a[..., :3] + (band * m * 200)[..., None])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')

# ---------------- portrait medallion with ken-burns ----------------
PORTRAIT_FOCUS = (250, 250, 470)   # (cx, cy, side) in portrait px - face & shoulders
def portrait(t, diam, z0=1.0, z1=1.15, t0=0, t1=10):
    p = ease_in_out((t - t0) / (t1 - t0))
    return circle_frame(A['portrait'], diam, ring=14, focus=PORTRAIT_FOCUS, zoom=z0 + (z1 - z0) * p, shift=(0, -20 * p))

# ---------------- the scenes ----------------
def frame(fi):
    build_assets()
    t = fi / FPS
    T = A['T']
    # background choice with crossfades
    if t < T_V1:
        c = A['bg_dark'].copy()
    elif t < T_V3:
        c = A['bg_emerald'].copy()
        if t < T_V1 + 0.6:
            c = Image.blend(A['bg_dark'], c, ease_out((t - T_V1) / 0.6))
    else:
        c = A['bg_warm'].copy()
    # ambient layers
    draw_rays(c, t, 0.9 * window(t, 0.3, T_V1 + 3, 2.5, 2.0), W / 2, H / 2)
    draw_rays(c, t, 0.6 * window(t, T_V3 - 0.2, 60, 0.6, 1.5), W / 2, 380)
    draw_bokeh(c, t, 0.35 if t < T_V1 else 0.75)
    draw_dust(c, t, 0.9)

    # ===== Scene 1: intro =====
    if t < T_V1 + 0.4:
        a1 = window(t, 0.4, 3.3, 1.0, 0.6)
        paste(c, T['intro1'], W / 2, H / 2 - 70 - 30 * (1 - ease_out((t - 0.4) / 1.5)), 0.92 + 0.08 * ease_out((t - 0.4) / 2), a1)
        a2 = window(t, 1.1, 3.3, 1.0, 0.6)
        paste(c, T['intro2'], W / 2, H / 2 + 70 + 30 * (1 - ease_out((t - 1.1) / 1.5)), 1.0, a2)
        a3 = window(t, 3.2, T_V1 + 0.3, 0.9, 0.3)
        paste(c, A['logo_je'], W / 2, H / 2, 0.55 + 0.1 * ease_out((t - 3.2) / 2.3), a3)
        if 3.2 < t < T_V1: add_light(c, A['flare'], W / 2, H / 2, 3 + 3 * ((t - 3.2) / 2.3) ** 2, 0.5 * ((t - 3.2) / 2.3) ** 2)

    # ===== Scene 2: Mazal Tov + portrait (verse 1) =====
    s2a, s2b = T_V1, T_V2 + 0.4
    if s2a <= t < s2b:
        pa = window(t, s2a + 0.1, T_V2 + 0.35, 0.8, 0.5)
        pin = ease_back((t - s2a - 0.1) / 1.0)
        pr = portrait(t, 560, 1.0, 1.18, s2a, T_V2)
        paste(c, pr, 1430 + (1 - pin) * 300, 540, 0.8 + 0.2 * pin, pa)
        split = T_V1 + 8.0
        cx = 650
        # first text block
        a = window(t, s2a + 0.5, split, 0.6, 0.5)
        paste(c, T['mazal'], cx, 300, 0.7 + 0.3 * ease_back((t - s2a - 0.5) / 0.7), a)
        a = window(t, s2a + 1.6, split, 0.6, 0.5)
        paste(c, T['hb'], cx, 520 + 40 * (1 - ease_out((t - s2a - 1.6) / 0.8)), 1, a)
        a = window(t, s2a + 2.8, split, 0.7, 0.5)
        nm = shine(T['name'], (t - s2a - 4.0) / 1.4)
        paste(c, nm, cx, 720, 0.75 + 0.25 * ease_back((t - s2a - 2.8) / 0.8), a)
        # second text block
        a = window(t, split + 0.3, T_V2 + 0.3, 0.7, 0.5)
        paste(c, T['who1'], cx, 380 - 30 * (1 - ease_out((t - split - 0.3) / 0.8)), 1, a)
        a = window(t, split + 1.2, T_V2 + 0.3, 0.7, 0.5)
        paste(c, T['who2'], cx, 540, 1, a)
        a = window(t, split + 2.2, T_V2 + 0.3, 0.7, 0.5)
        paste(c, T['who3'], cx, 680, 0.9 + 0.1 * ease_out((t - split - 2.2) / 0.8), a)
        draw_confetti(c, t, s2a, 0.85, 4.0)

    # ===== Scene 3: world of healing (verse 2) =====
    s3a, s3b = T_V2, T_BR + 0.4
    if s3a - 0.2 <= t < s3b:
        a = window(t, s3a + 0.1, T_BR + 0.3, 0.7, 0.5)
        paste(c, T['world'], W / 2 + 330, 150 + 20 * (1 - ease_out((t - s3a) / 0.8)), 1, a)
        # carousel of circles on the left
        imgs = ['c_massage', 'c_healing', 'c_back', 'c_roses', 'c_tea']
        seg = (T_BR - s3a) / len(imgs)
        for i, k in enumerate(imgs):
            ta = s3a + i * seg
            av = window(t, ta - 0.2, ta + seg + 0.25, 0.6, 0.6)
            if av > 0:
                p = (t - ta) / seg
                paste(c, A[k], 470, 560, (1.08 + 0.12 * p) * (0.9 + 0.1 * ease_out((t - ta + 0.2) / 0.6)), av, rot=(1 - ease_out((t - ta + 0.2) / 0.8)) * 8)
        # methods pills in 2 columns on right
        for i, (spr, pill) in enumerate(zip(T['methods'], A['pills'])):
            col = i % 2; row = i // 2
            x = 1480 - col * 520; y = 330 + row * 135
            ti = s3a + 1.0 + i * 0.95
            pa_ = window(t, ti, T_BR + 0.3, 0.45, 0.5)
            if pa_ > 0:
                sc = ease_back((t - ti) / 0.5)
                paste(c, pill, x, y, sc, pa_)
                paste(c, spr, x, y + 2, sc, pa_)
                if t - ti < 0.5: add_light(c, A['star'][3], x + pill.width * 0.45 * sc, y - 30, 1.0, (1 - (t - ti) / 0.5))

    # ===== Scene 4: clinic / JE / grow (bridge) =====
    s4a, s4b = T_BR, T_V3 + 0.3
    if s4a - 0.2 <= t < s4b:
        mid = T_BR + 5.6
        a = window(t, s4a + 0.1, mid, 0.6, 0.5)
        paste(c, T['clinic'], W / 2, 170, 0.8 + 0.2 * ease_back((t - s4a) / 0.7), a)
        for i, (k, cap) in enumerate([('c_ortho', 'cap_ortho'), ('c_preg', 'cap_preg'), ('c_anx', 'cap_anx')]):
            ti = s4a + 0.5 + i * 0.5
            av = window(t, ti, mid, 0.6, 0.5)
            x = 1450 - i * 490
            yy = 560 + 80 * (1 - ease_out((t - ti) / 0.8))
            paste(c, A[k], x, yy, 0.8, av)
            paste(c, T[cap], x, yy + 245, 1, av)
        # JE line
        a = window(t, mid + 0.2, T_BR + 8.6, 0.6, 0.5)
        paste(c, A['c_prod'], 560, 560, 0.95 + 0.08 * ease_out((t - mid) / 3), a)
        a = window(t, mid + 0.6, T_BR + 8.6, 0.6, 0.5)
        paste(c, T['je1'], 1300, 470, 1, a)
        a = window(t, mid + 1.2, T_BR + 8.6, 0.6, 0.5)
        paste(c, T['je2'], 1300, 620, 1, a)
        # grow wish with leaves
        g0 = T_BR + 8.4
        a = window(t, g0, T_V3 + 0.2, 0.7, 0.25)
        if a > 0:
            p = ease_out((t - g0) / 2.5)
            paste(c, A['leaf'], 200, 640 - 60 * p, 0.9, a, rot=8 - 6 * p)
            lf = A['leaf'].transpose(Image.FLIP_LEFT_RIGHT)
            paste(c, lf, W - 200, 640 - 60 * p, 0.9, a, rot=-8 + 6 * p)
            paste(c, T['grow'], W / 2, 540, 0.85 + 0.15 * ease_back((t - g0) / 0.8), a)

    # ===== Scene 5: wishes + finale (verse 3, grand) =====
    if t >= T_V3 - 0.1:
        draw_fireworks(c, t, 1.0)
        fin = 53.9
        pa = window(t, T_V3, 60, 0.6, 0.01)
        pin = ease_back((t - T_V3) / 1.0)
        pr = portrait(t, 520, 1.12, 0.95, T_V3, 59)
        px = 1440 if t < fin else 1440 + (1460 - 1440) * ease_in_out((t - fin) / 1)
        paste(c, pr, px, 520, (0.7 + 0.3 * pin), pa)
        # rotating sparkle ring around portrait
        for k in range(12):
            ang = t * 0.9 + k * math.pi / 6
            rr = 330
            v = 0.5 + 0.5 * math.sin(t * 4 + k)
            add_light(c, A['star'][1 + k % 2], px + math.cos(ang) * rr, 520 + math.sin(ang) * rr, 0.8 + 0.5 * v, pa * v * 0.9)
        cx = 650
        lines = [('w0', T_V3 + 0.6, 230), ('w1', T_V3 + 1.8, 400), ('w2', T_V3 + 3.6, 540), ('w3', T_V3 + 5.5, 690), ('w4', T_V3 + 6.4, 810)]
        for k, ti, y in lines:
            a = window(t, ti, fin, 0.7, 0.5)
            paste(c, T[k], cx + 50 * (1 - ease_out((t - ti) / 0.8)), y, 1, a)
        # finale
        a = window(t, fin + 0.2, 60, 0.6, 0.01)
        paste(c, shine(T['fin1'], (t - fin - 1.4) / 1.3), cx, 330, 0.6 + 0.4 * ease_back((t - fin - 0.2) / 0.8), a)
        a = window(t, fin + 1.0, 60, 0.6, 0.01)
        paste(c, shine(T['fin2'], (t - fin - 2.4) / 1.2), cx, 560, 0.5 + 0.5 * ease_back((t - fin - 1.0) / 0.8), a)
        a = window(t, fin + 1.8, 60, 0.6, 0.01)
        paste(c, A['logo_main'], cx, 800, 0.38, a * 0.95 if False else 0)  # (kept for alt layout)
        paste(c, T['fin3'], cx, 790, 1, a)
        paste(c, A['logo_je'], cx, 930, 0.16, a)
        draw_confetti(c, t, T_V3, 1.0, 13.0)

    draw_stars(c, t, 0.9)

    # flashes on musical hits
    for th, s in ((T_V1, 0.75), (T_V2, 0.35), (T_BR + 5.6, 0.2), (T_V3, 0.85), (53.9, 0.4)):
        if th - 0.05 <= t < th + 0.5:
            k = clamp(1 - (t - th) / 0.5) * s
            c = Image.blend(c, Image.new('RGBA', (W, H), (255, 245, 220, 255)), k)

    # vignette + global fades
    out = np.asarray(c.convert('RGB'), dtype=np.float32)
    out *= VIG[..., None]
    g = clamp(t / 0.8) * clamp((60 - t) / 1.4)
    out *= g
    return out.clip(0, 255).astype(np.uint8).tobytes()

yy_, xx_ = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.45 * np.clip(np.sqrt(((xx_ - W / 2) / (W * 0.62)) ** 2 + ((yy_ - H / 2) / (H * 0.75)) ** 2) - 0.35, 0, 1) ** 1.5).astype(np.float32)

if __name__ == '__main__':
    out = sys.argv[1]; audio = sys.argv[2]
    frames = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else None
    if frames:   # preview stills
        build_assets()
        for f in frames:
            Image.frombytes('RGB', (W, H), frame(f)).save(f'{out}_{f:04d}.jpg', quality=85)
        sys.exit()
    n = int(DUR * FPS)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-i', audio, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                           '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', out], stdin=subprocess.PIPE)
    with Pool(4) as pool:
        for i, b in enumerate(pool.imap(frame, range(n), chunksize=4)):
            ff.stdin.write(b)
            if i % 100 == 0: print('frame', i, flush=True)
    ff.stdin.close(); ff.wait()
    print('done', out)
