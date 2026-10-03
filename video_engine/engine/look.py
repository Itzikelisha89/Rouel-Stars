"""Global look (cinematic grade, grain, vignette) and animated Hebrew captions."""
import cv2
import numpy as np
from .compose import over, ease_out, back_out, hexc, blur_fast
from .text import text_rgba

from .config import W, H
_cache = {}


def _vignette():
    if "vig" not in _cache:
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((x - W / 2) / (W * .75)) ** 2 + ((y - H / 2) / (H * .7)) ** 2)
        _cache["vig"] = (1 - 0.42 * np.clip(r - 0.35, 0, 1) ** 1.6)[..., None].astype(np.float32)
    return _cache["vig"]


def _grain(k):
    if "grain" not in _cache:
        rs = np.random.RandomState(11)
        _cache["grain"] = [cv2.resize(rs.randn(H // 2, W // 2).astype(np.float32), (W, H))[..., None] for _ in range(8)]
    return _cache["grain"][k % 8]


LUM = np.array([.299, .587, .114], np.float32)


def grade(img, strength=1.0):
    """Teal shadows / warm highlights, gentle S-curve, slightly reduced saturation."""
    x = np.clip(img, 0, 1)
    l = (x @ LUM)[..., None]
    curve = x + 0.18 * strength * (x - 0.5) * (1 - np.abs(2 * x - 1))  # S-curve
    sh = np.array([-.035, .012, .045], np.float32); hi = np.array([.05, .018, -.04], np.float32)
    curve = curve + strength * ((1 - l) ** 2 * sh + l ** 2 * hi)
    l2 = (curve @ LUM)[..., None]
    return l2 + (curve - l2) * (1 - .1 * strength)


def raw_gray(img, amount=0.88):
    l = (img @ LUM)[..., None]
    g = img * (1 - amount) + l * amount
    return g * 0.92 + 0.04  # flat, lifted, "unedited"


def finish(img, frame_idx, grain=0.022, vignette=True):
    if vignette:
        img = img * _vignette()
    return img + _grain(frame_idx) * grain


def cold(img, amount=1.0):
    l = (img @ LUM)[..., None]
    c = l * np.array([0.78, 0.95, 1.18], np.float32) * 0.95
    return img * (1 - amount) + (c * 0.85 + img * 0.15) * amount


# ------------------------------------------------------------------ captions
GOLD = tuple(int(v * 255) for v in hexc("#D4AF37"))
CAPTION_ACTIVE = None  # project can set an (r,g,b) for the spoken word


def caption_groups(words, max_words=3, max_chars=15):
    """Group consecutive words of a sentence into caption lines."""
    groups, cur = [], []
    for w in words:
        if cur and (w["sentence"] != cur[-1]["sentence"] or len(cur) >= max_words or
                    sum(len(x["word"]) for x in cur) + len(w["word"]) > max_chars):
            groups.append(cur); cur = []
        cur.append(w)
    if cur: groups.append(cur)
    for i, g in enumerate(groups):
        nxt = groups[i + 1][0]["t"] if i + 1 < len(groups) else g[-1]["t_end"] + 0.6
        g_end = min(nxt, g[-1]["t_end"] + 0.9)
        for w in g: w["g_end"] = g_end
    return groups


def _word_img(word, color, size=86):
    key = ("cw", word, color, size)
    if key not in _cache:
        a = text_rgba(word, size, color, "sans", 800)
        sh = a.copy(); sh[..., :3] = 0
        sh[..., 3] = cv2.GaussianBlur(a[..., 3], (0, 0), 7) * 0.85
        _cache[key] = (a, sh)
    return _cache[key]


def draw_captions(img, t, groups, y=None, size=None, alpha=1.0):
    y = int(H * 0.77) if y is None else y
    size = size or int(86 * min(W, H) / 1080)
    g = None
    for gr in groups:
        if gr[0]["t"] - 0.06 <= t < gr[0]["g_end"]:
            g = gr
    if g is None or alpha <= 0:
        return img
    gap = int(size * 0.28)
    imgs = [_word_img(w["word"], (255, 255, 255), size)[0] for w in g]
    widths = [a.shape[1] - 2 * int(size * .25) for a in imgs]
    total = sum(widths) + gap * (len(g) - 1)
    x_right = W / 2 + total / 2
    fade_out = np.clip((g[0]["g_end"] - t) / 0.12, 0, 1)
    for w, wd in zip(g, widths):  # RTL: first word on the right
        cx = x_right - wd / 2
        x_right -= wd + gap
        p = (t - w["t"]) / 0.2
        if p < 0:
            continue
        s = 0.72 + 0.28 * float(back_out(min(p, 1)))
        a = min(1, p * 2.5) * fade_out * alpha
        active = w["t"] <= t < w["t_end"] + 0.05
        col = (CAPTION_ACTIVE or GOLD) if active else (255, 255, 255)
        im, sh = _word_img(w["word"], col, size)
        dy = (1 - float(ease_out(min(p, 1)))) * 26
        over(img, sh, cx + 4, y + dy + 6, a, s)
        over(img, im, cx, y + dy, a, s * (1.06 if active else 1.0))
    return img
