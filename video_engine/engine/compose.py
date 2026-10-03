"""Small numpy/cv2 compositing helpers. Images are float32 RGB 0..1."""
import cv2
import numpy as np


def ease_out(x):  return 1 - (1 - np.clip(x, 0, 1)) ** 3
def ease_in(x):   return np.clip(x, 0, 1) ** 3
def ease_io(x):
    x = np.clip(x, 0, 1); return np.where(x < .5, 4 * x ** 3, 1 - (-2 * x + 2) ** 3 / 2) * 1.0
def back_out(x, s=1.70158):
    x = np.clip(x, 0, 1) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def clamp01(x): return float(np.clip(x, 0, 1))
def prog(t, a, b): return clamp01((t - a) / max(b - a, 1e-6))


def over(dst, rgba, x, y, alpha=1.0, scale=1.0, add=False):
    """Paste RGBA (float) onto dst centered at (x, y). Returns dst (in place)."""
    if scale != 1.0:
        h, w = rgba.shape[:2]
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        rgba = cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_LINEAR if scale < 1 else cv2.INTER_CUBIC)
    h, w = rgba.shape[:2]
    x0, y0 = int(round(x - w / 2)), int(round(y - h / 2))
    return over_tl(dst, rgba, x0, y0, alpha, add)


def over_tl(dst, rgba, x0, y0, alpha=1.0, add=False):
    H, W = dst.shape[:2]
    h, w = rgba.shape[:2]
    ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if ax1 <= ax0 or ay1 <= ay0 or alpha <= 0:
        return dst
    src = rgba[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
    a = src[..., 3:4] * alpha
    roi = dst[ay0:ay1, ax0:ax1]
    if roi.shape[2] == 4:  # RGBA destination: proper "over" with straight alpha
        da = roi[..., 3:4]
        oa = a + da * (1 - a)
        roi[..., :3] = (src[..., :3] * a + roi[..., :3] * da * (1 - a)) / np.maximum(oa, 1e-6)
        roi[..., 3:4] = oa
    elif add:
        roi += src[..., :3] * a
    else:
        roi *= (1 - a); roi += src[..., :3] * a
    return dst


def solid_rgba(h, w, color, alpha=1.0):
    a = np.zeros((h, w, 4), np.float32); a[..., :3] = color; a[..., 3] = alpha; return a


def hexc(h):
    h = h.lstrip("#"); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def rounded_mask(h, w, r):
    m = np.zeros((h, w), np.uint8)
    cv2.rectangle(m, (r, 0), (w - r - 1, h - 1), 255, -1)
    cv2.rectangle(m, (0, r), (w - 1, h - r - 1), 255, -1)
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(m, (cx, cy), r, 255, -1, cv2.LINE_AA)
    return m.astype(np.float32) / 255


def card(h, w, color, alpha=0.92, r=28, border=None, bw=3):
    c = solid_rgba(h, w, color, 0); c[..., 3] = rounded_mask(h, w, r) * alpha
    if border is not None:
        inner = np.pad(rounded_mask(h - 2 * bw, w - 2 * bw, max(1, r - bw)), bw)
        ring = np.clip(c[..., 3] / max(alpha, 1e-6) - inner, 0, 1)
        c[..., :3] = c[..., :3] * (1 - ring[..., None]) + np.array(border, np.float32) * ring[..., None]
        c[..., 3] = np.maximum(c[..., 3], ring)
    return c


def glow(img, strength=0.6, radius=25, thresh=0.6):
    b = np.clip(img - thresh, 0, 1) / (1 - thresh)
    small = cv2.resize(b, (img.shape[1] // 4, img.shape[0] // 4), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), radius / 4)
    return img + cv2.resize(small, (img.shape[1], img.shape[0])) * strength


def blur_fast(img, sigma):
    if sigma <= 0.5:
        return img
    f = 4 if sigma > 8 else 2
    small = cv2.resize(img, (img.shape[1] // f, img.shape[0] // f), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigma / f)
    return cv2.resize(small, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)


def shake_offset(t, amp, freq=28.0, seed=0):
    rs = np.random.RandomState(seed)
    ph = rs.rand(4) * 6.28
    return (amp * (np.sin(t * freq + ph[0]) + .5 * np.sin(t * freq * 2.3 + ph[1])),
            amp * (np.sin(t * freq * 1.3 + ph[2]) + .5 * np.sin(t * freq * 2.9 + ph[3])))


def translate(img, dx, dy, border=cv2.BORDER_REFLECT):
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), borderMode=border)


def scale_about(img, s, cx=None, cy=None, dx=0, dy=0, border=cv2.BORDER_CONSTANT, interp=cv2.INTER_LINEAR):
    H, W = img.shape[:2]
    cx = W / 2 if cx is None else cx; cy = H / 2 if cy is None else cy
    M = np.float32([[s, 0, cx - s * cx + dx], [0, s, cy - s * cy + dy]])
    return cv2.warpAffine(img, M, (W, H), flags=interp, borderMode=border)


def rim_light(mask, color, width=6, strength=1.0, dx=-4, dy=-4):
    """Light on the edge of a matte (mask float HxW)."""
    shifted = translate(mask, dx, dy, cv2.BORDER_CONSTANT)
    edge = np.clip(mask - shifted, 0, 1)
    edge = cv2.GaussianBlur(edge, (0, 0), width / 2) * strength
    return edge[..., None] * np.array(color, np.float32)


def drop_shadow(mask, dx=18, dy=26, blur=18, opacity=0.6):
    s = translate(mask, dx, dy, cv2.BORDER_CONSTANT)
    return np.clip(blur_fast(s, blur) * opacity, 0, 1)
