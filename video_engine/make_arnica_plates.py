"""Compose the 16:9 source plates for the arnica ad from the clinic's own website images."""
import cv2, numpy as np
from engine.compose import hexc, blur_fast
from engine.masks import matte
A = "assets/arnica/"
W, H = 1920, 1080
TEAL, GREEN = hexc("#0E5A5A"), hexc("#7AB83C")
NAVY_C, NAVY_E, ACCENT = hexc("#1C3F6E"), hexc("#0A1F3D"), hexc("#4FB6C9")  # trustworthy palette


def load(n):
    im = cv2.imread(A + n, cv2.IMREAD_UNCHANGED)
    if im.shape[2] == 4:
        a = im[..., 3:] / 255.; im = (im[..., :3] * a + 255 * (1 - a)).astype(np.uint8)
    return cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32) / 255


def brand_bg(light=False):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W * .62) / W) ** 2 + ((yy - H * .45) / H) ** 2)
    if light:
        c0, c1 = np.array([.97, .98, .99]), hexc("#D9E4EF")
    else:
        c0, c1 = NAVY_C, NAVY_E
    g = np.clip(r * 1.6, 0, 1)[..., None]
    return (c0 * (1 - g) + c1 * g).astype(np.float32)


def circle_photo(bg, img, cx, cy, d, ring=ACCENT):
    s = d / min(img.shape[:2]); im = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    h, w = im.shape[:2]; im = im[(h - d) // 2:(h - d) // 2 + d, (w - d) // 2:(w - d) // 2 + d]
    m = np.zeros((d, d), np.float32); cv2.circle(m, (d // 2, d // 2), d // 2 - 2, 1, -1, cv2.LINE_AA)
    x0, y0 = cx - d // 2, cy - d // 2
    roi = bg[y0:y0 + d, x0:x0 + d]; roi[:] = roi * (1 - m[..., None]) + im * m[..., None]
    cv2.circle(bg, (cx, cy), d // 2 + 10, tuple(float(v) for v in ring), 14, cv2.LINE_AA)
    return bg


def leaves_layer(bg, x, y, h, alpha=.9, flip=False):
    lv = load("img11.jpg")
    if flip: lv = lv[:, ::-1]
    s = h / lv.shape[0]; lv = cv2.resize(lv, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    m = np.clip((0.82 - lv.min(2)) / 0.22, 0, 1)  # leaves on white -> alpha
    hh_, ww_ = m.shape
    fy = np.clip(np.minimum(np.arange(hh_), hh_ - 1 - np.arange(hh_)) / 60, 0, 1)[:, None]
    fx = np.clip(np.minimum(np.arange(ww_), ww_ - 1 - np.arange(ww_)) / 60, 0, 1)[None, :]
    m = cv2.GaussianBlur(m * fy * fx, (0, 0), 1) * alpha
    hh, ww = lv.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + ww), min(H, y + hh)
    roi = bg[y0:y1, x0:x1]; mm = m[y0 - y:y1 - y, x0 - x:x1 - x, None]
    roi[:] = roi * (1 - mm) + lv[y0 - y:y1 - y, x0 - x:x1 - x] * mm
    return bg


def save(n, img):
    cv2.imwrite(A + n, cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])


# 1 pain: back-pain photo from the site in a big ring, dark teal
bg = brand_bg(); bg = circle_photo(bg, load("img8.jpg"), 1300, 540, 820); save("plate_pain_v2.jpg", bg)
# 2 product: the real jar photo, cover 16:9
p = load("img1.jpg"); s = W / p.shape[1]; p = cv2.resize(p, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
y0 = (p.shape[0] - H) // 2; pass  # product plate unchanged
# 3 Yehoshua: cut out of his site portrait, on brand background with leaves
y = load("img12.png"); bgr = cv2.cvtColor((y * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
m = matte(bgr)
s = 1000 / y.shape[0]; yy_ = cv2.resize(y, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC); mm = cv2.resize(m, None, fx=s, fy=s)
bg = brand_bg(); bg = leaves_layer(bg, 1080, 40, 1000, .3); bg = leaves_layer(bg, -150, 300, 800, .2, True)
h, w = yy_.shape[:2]; x0 = 1300 - w // 2; y0 = H - h
roi = bg[y0:H, x0:x0 + w]; roi[:] = roi * (1 - mm[..., None]) + yy_ * mm[..., None]
save("plate_yehoshua_v2.jpg", bg)
# 4 leaves / nature: light background for ingredient cards
bg = brand_bg(True); bg = leaves_layer(bg, 1100, 0, 1080, .95); bg = leaves_layer(bg, -100, 200, 900, .8, True)
save("plate_leaves_v2.jpg", bg)
print("plates ok")
