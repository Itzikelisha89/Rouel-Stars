"""Effect library. Each effect is anchored to output times (from words via the time map).
Stages: 5 pre-look scene setup, 10 scene/matte work, 30 titles/layout, 50 camera,
70 UI overlays (after captions). Effects are deterministic functions of time."""
import colorsys
from functools import lru_cache
import cv2
import numpy as np
from scipy.spatial import cKDTree
from .edit import FX, W, H
from .compose import (over, over_tl, ease_out, ease_in, ease_io, back_out, prog, hexc, card,
                      glow, blur_fast, scale_about, translate, rim_light, drop_shadow, rounded_mask, solid_rgba)
from .text import text_rgba
from .look import LUM, cold
from . import audio as A

GOLD, RED, TEAL = hexc("#D4AF37"), hexc("#C1121F"), hexc("#30E5D0")
REFLECT = cv2.BORDER_REFLECT


def ex(x): return float(np.exp(x))


def blit_affine(dst, patch, M):
    """Warp an RGBA patch by 2x3 M (patch coords -> dst coords) and composite into dst."""
    h, w = patch.shape[:2]
    cs = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float32) @ M.T
    x0, y0 = int(max(0, np.floor(cs[:, 0].min()))), int(max(0, np.floor(cs[:, 1].min())))
    x1, y1 = int(min(dst.shape[1], np.ceil(cs[:, 0].max()))), int(min(dst.shape[0], np.ceil(cs[:, 1].max())))
    if x1 <= x0 or y1 <= y0:
        return
    M2 = M.copy(); M2[0, 2] -= x0; M2[1, 2] -= y0
    wp = cv2.warpAffine(patch, M2, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=0)
    a = wp[..., 3:4]
    roi = dst[y0:y1, x0:x1]
    roi *= 1 - a; roi += wp[..., :3] * a


def warp_quad(dst, img, quad, shade=1.0):
    """Perspective-map img (RGB or RGBA) onto quad (4x2: tl,tr,br,bl in dst px)."""
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, np.float32(quad))
    if img.shape[2] == 3:
        img = np.dstack([img, np.ones((h, w), np.float32)])
    wp = cv2.warpPerspective(img, M, (dst.shape[1], dst.shape[0]), flags=cv2.INTER_LINEAR, borderValue=0)
    a = wp[..., 3:4]
    dst *= 1 - a; dst += wp[..., :3] * a * shade
    return dst


def rot_quad(w, h, ax=0.0, ay=0.0, f=2400.0, s=1.0, cx=W / 2, cy=H / 2):
    p = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], np.float64)
    ca, sa, cb, sb = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]]); Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    p = p @ Rx.T @ Ry.T
    z = p[:, 2] + f
    return np.stack([cx + p[:, 0] * f / z * s, cy + p[:, 1] * f / z * s], 1)


def gold_fill(a, top="#FFF0B8", mid="#D4AF37", bot="#7A5A14"):
    h = a.shape[0]; g = np.linspace(0, 1, h)[:, None, None]
    t, m, b = hexc(top), hexc(mid), hexc(bot)
    col = np.where(g < .5, t * (1 - 2 * g) + m * 2 * g, m * (2 - 2 * g) + b * (2 * g - 1))
    out = a.copy(); out[..., :3] = col * np.ones_like(a[..., :3]); return out


@lru_cache(maxsize=8)
def _streaks():
    rs = np.random.RandomState(4)
    tex = np.zeros((H * 2, W), np.float32)
    for _ in range(14):
        x = rs.randint(-400, W + 400); th = rs.randint(6, 60)
        cv2.line(tex, (x, 0), (x + 900, H * 2), float(rs.uniform(.15, .5)), th, cv2.LINE_AA)
    tex = cv2.GaussianBlur(tex, (0, 0), 18)
    for _ in range(45):
        cv2.circle(tex, (rs.randint(0, W), rs.randint(0, 2 * H)), rs.randint(8, 40), float(rs.uniform(.2, .6)), -1, cv2.LINE_AA)
    tex = cv2.GaussianBlur(tex, (0, 0), 4)
    return tex[..., None] * np.array([1.0, .75, .35], np.float32)


# ======================================================================= E1
class Ignite(FX):
    """Gray, unedited opening -> on the word: color snap, moving bg, glow, shake, flash."""
    stage = 5
    def pre(self, c):
        if c.t < self.tw: c.raw = True; c.cap_hide = not getattr(self, "captions", False)
    def apply(self, c):
        if c.t < self.tw: return
        k = c.t - self.tw
        m = c.mask[..., None]
        if getattr(self, "move_bg", True):
            bg = scale_about(c.plate(), 1.1 + .03 * k, dx=-90 * k - 40 * float(ease_out(k / .4)), border=REFLECT) * .55
        else:
            bg = c.img * .8
        off = int((k * 520) % H)
        bg = bg + _streaks()[H - off:2 * H - off] * .55
        c.img = bg * (1 - m) + c.img * m * 1.05 + rim_light(c.mask, GOLD, 8, 1.6)
        c.img = glow(c.img, .9 * ex(-k * 3) + .3, 30, .55)
        c.shake = max(c.shake, 30 * ex(-k * 6))
        c.flash += max(0, 1 - k / .25) * .95
    def sounds(self):
        return [(self.tw - 1.0, A.riser(1.0), .55, "riser"), (self.tw, A.boom(), 1.0, "boom ignite"),
                (self.tw, A.zing(), .5, "zing")]


# ======================================================================= E2
class Title3D(FX):
    """Huge extruded title flies at the camera and lands, layered depth, red stripe."""
    stage = 30
    FLY, LAND = .32, .22

    def _layers(self):
        if not hasattr(self, "_L"):
            size = 230
            a = text_rgba(self.text, size, (255, 255, 255), "display", 400)
            sc = 960 / a.shape[1]
            if sc < 1:
                a = cv2.resize(a, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
            face = gold_fill(a, *getattr(self, "fill", ("#FFF0B8", "#D4AF37", "#7A5A14")))
            hl = a.copy(); hl[..., :3] = 1; hl[..., 3] = np.clip(a[..., 3] - translate(a[..., 3], 0, 3, 0), 0, 1) * .9
            D = 22; pad = D * 2
            ext = np.zeros((a.shape[0] + pad, a.shape[1] + pad, 4), np.float32)
            for k in range(D, 0, -1):
                col = np.array(getattr(self, "ext_color", (.36, .25, .06)), np.float32) * (1 - k / D * .6)
                lay = solid_rgba(a.shape[0], a.shape[1], col, 1); lay[..., 3] = a[..., 3]
                over_tl(ext, lay, int(k * .6), int(k * 1.4)) if False else None
                y0, x0 = int(k * 1.4), int(k * .6)
                roi = ext[y0:y0 + a.shape[0], x0:x0 + a.shape[1]]
                al = a[..., 3:4]
                roi[..., :3] = roi[..., :3] * (1 - al) + col * al
                roi[..., 3:4] = np.maximum(roi[..., 3:4], al)
            sh = np.zeros_like(ext); sh[..., 3] = cv2.GaussianBlur(ext[..., 3], (0, 0), 14) * .8
            self._L = (face, hl, ext, sh)
        return self._L

    def draw(self, img, cx, cy, s, sep=0.0, tilt=0.0, alpha=1.0, stripe=1.0):
        face, hl, ext, sh = self._layers()
        if tilt > 1e-3:  # perspective tilt of the whole stack: render then warp
            canvas = np.zeros((ext.shape[0] + 60, ext.shape[1] + 60, 4), np.float32)
            over_tl(canvas, ext, 30, 30); over_tl(canvas, face, 30, 30); over_tl(canvas, hl, 30, 30)
            q = rot_quad(canvas.shape[1] * s, canvas.shape[0] * s, ax=tilt, f=1600, cx=cx, cy=cy)
            sh2 = canvas.copy(); sh2[..., :3] = 0; sh2[..., 3] = cv2.GaussianBlur(canvas[..., 3], (0, 0), 12) * .7 * alpha
            warp_quad(img, sh2, q + [30 * s, 50 * s])
            canvas[..., 3] *= alpha
            warp_quad(img, canvas, q)
            return
        over(img, sh, cx + 26 * s * (1 + 2 * sep), cy + 44 * s * (1 + 2 * sep), .75 * alpha, s * (1 - .1 * sep))
        over(img, ext, cx + 12 * s, cy + 16 * s, alpha, s * (1 - .12 * sep))
        over(img, face, cx, cy, alpha, s * (1 + .1 * sep))
        over(img, hl, cx, cy, alpha * (1 - sep), s * (1 + .1 * sep))
        if stripe > 0:
            fw = face.shape[1] * s * 1.04 * stripe; y = cy + face.shape[0] * s * .5 + 18 * s
            x1 = cx + face.shape[1] * s * .52
            sc_ = getattr(self, "stripe_color", RED)
            bar = solid_rgba(max(2, int(18 * s)), max(2, int(fw)), sc_, alpha)
            over_tl(img, bar, int(x1 - fw), int(y))
            gl = solid_rgba(int(60 * s), max(2, int(fw)), sc_, .0)
            gl[..., 3] = cv2.GaussianBlur(np.pad(np.ones((max(2, int(18 * s)), max(2, int(fw))), np.float32), ((21, 21), (0, 0)))[:gl.shape[0], :gl.shape[1]], (0, 0), 9) * .5 * alpha
            over_tl(img, gl, int(x1 - fw), int(y - 21 * s), add=True)

    def apply(self, c):
        k = c.t - self.tw
        if k < 0: return
        if k < self.FLY:
            p = k / self.FLY
            s = .06 + (1.38 - .06) * float(ease_in(p))
            self.draw(c.img, self.cx, self.cy + 260 * (1 - p), s, tilt=1.1 * (1 - p) ** 1.5, stripe=0)
        else:
            q = prog(k, self.FLY, self.FLY + self.LAND)
            s = 1.38 - .38 * float(back_out(q, 2.2))
            sep = 1 - float(ease_out(q))
            st = float(ease_out(prog(k, self.FLY + .1, self.FLY + .4)))
            self.draw(c.img, self.cx, self.cy, s, sep=sep, stripe=st)
            c.shake = max(c.shake, 34 * ex(-(k - self.FLY) * 7))
            c.flash += max(0, .35 - (k - self.FLY) * 2)
    def sounds(self):
        return [(self.tw, A.whoosh(self.FLY + .05, 200, 4000, .4), .8, "whoosh title"),
                (self.tw + self.FLY, A.boom(1.4, 90, 30), .95, "impact title")]


# ======================================================================= E3
class Shatter(FX):
    """Screen cracks, shatters into ~50 Voronoi shards, then heals back."""
    stage = 50
    N = 50

    def _geo(self):
        if hasattr(self, "_G"): return self._G
        rs = np.random.RandomState(9)
        ix, iy = self.impact
        near = np.stack([ix + rs.randn(18) * 220, iy + rs.randn(18) * 260], 1)
        far = np.stack([rs.uniform(0, W, self.N - 18), rs.uniform(0, H, self.N - 18)], 1)
        pts = np.clip(np.vstack([near, far]), 5, [W - 5, H - 5])
        f = 4
        yy, xx = np.mgrid[0:H // f, 0:W // f]
        _, lab = cKDTree(pts / f).query(np.stack([xx.ravel(), yy.ravel()], 1))
        lab = cv2.resize(lab.reshape(H // f, W // f).astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST)
        edges = ((lab != np.roll(lab, 1, 0)) | (lab != np.roll(lab, 1, 1))).astype(np.float32)
        edges = cv2.GaussianBlur(cv2.dilate(edges, np.ones((2, 2), np.uint8)), (0, 0), 1.0)
        yy, xx = np.mgrid[0:H, 0:W]
        dist = np.sqrt((xx - ix) ** 2 + (yy - iy) ** 2).astype(np.float32)
        shards = []
        for i in range(len(pts)):
            m = (lab == i)
            ys, xs = np.where(m)
            if len(xs) == 0: continue
            x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            a = cv2.GaussianBlur(m[y0:y1, x0:x1].astype(np.float32), (0, 0), .8)
            e = np.clip(a - cv2.erode(a, np.ones((5, 5), np.uint8)), 0, 1)
            cxy = np.array([xs.mean(), ys.mean()])
            d = cxy - np.array([ix, iy]); dn = d / (np.linalg.norm(d) + 1e-6)
            shards.append(dict(box=(x0, y0, x1, y1), a=a, e=e, c=cxy,
                               v=dn * rs.uniform(500, 1200) + rs.randn(2) * 120,
                               rot=rs.uniform(-150, 150), z=rs.uniform(1.05, 1.6)))
        shards.sort(key=lambda s: s["z"])
        self._G = (shards, edges, dist)
        return self._G

    def apply(self, c):
        k = c.t - self.tw
        shards, edges, dist = self._geo()
        if k < .18 or k > 1.45:
            r = 1500 * float(ease_out(k / .14)) if k < .18 else 1500
            a = 1.0 if k < .18 else 1 - prog(k, 1.45, 1.6)
            reveal = np.clip((r - dist) / 60, 0, 1) * edges * a
            c.img = c.img * (1 - reveal[..., None] * .5) + reveal[..., None] * .95
            if k < .3: c.shake = max(c.shake, 26 * ex(-k * 10)); c.flash += max(0, .4 - k * 3)
            return
        if k < .8: u = float(ease_out(prog(k, .18, .8)))
        elif k < .95: u = 1.0
        else: u = 1 - float(ease_io(prog(k, .95, 1.45)))
        src = c.img
        canvas = blur_fast(src, 30) * .08
        for s in shards:
            x0, y0, x1, y1 = s["box"]
            patch = np.dstack([src[y0:y1, x0:x1] + s["e"][..., None] * .7 * u, s["a"]])
            ang = np.deg2rad(s["rot"] * u); sc = 1 + (s["z"] - 1) * u
            ctr = s["c"] + s["v"] * u * .7 + np.array([0, 900 * u * u * .35])
            cl, sl = np.cos(ang) * sc, np.sin(ang) * sc
            lc = s["c"] - [x0, y0]
            M = np.float32([[cl, -sl, ctr[0] - (cl * lc[0] - sl * lc[1])],
                            [sl, cl, ctr[1] - (sl * lc[0] + cl * lc[1])]])
            blit_affine(canvas, patch * [1, 1, 1, 1] * np.float32([1 - .25 * u, 1 - .25 * u, 1 - .25 * u, 1]), M)
        c.img = canvas
    def sounds(self):
        rev = np.ascontiguousarray(A.shatter(1.2)[::-1])
        return [(self.tw - .02, A.shatter(), 1.0, "glass shatter"),
                (self.tw + 1.45 - len(rev) / A.SR, rev, .6, "glass heal")]


# ======================================================================= E4
class PopOut(FX):
    """Frame becomes a framed card; on the word the person breaks out, grows over the title."""
    stage = 30
    def apply(self, c):
        a = min(float(ease_io(prog(c.t, self.ts, self.ts + .35))), float(ease_io(1 - prog(c.t, self.t1 - .3, self.t1))))
        fs = 1 - .24 * a; dyc = 70 * a
        img, m = c.img, c.mask
        out = blur_fast(img, 30) * (1 - .7 * a)
        A1 = np.float32([[fs, 0, W / 2 * (1 - fs)], [0, fs, H / 2 * (1 - fs) + dyc], [0, 0, 1]])
        cardi = cv2.warpAffine(img, A1[:2], (W, H))
        x0, y0 = int(W / 2 * (1 - fs)), int(H / 2 * (1 - fs) + dyc)
        x1, y1 = W - x0, int(y0 + H * fs)
        out[y0:y1, x0:x1] = cardi[y0:y1, x0:x1]
        if a > .02:
            cv2.rectangle(out, (x0 - 4, y0 - 4), (x1 + 3, y1 + 3), tuple(float(v) for v in GOLD), 7, cv2.LINE_AA)
            self.title.draw(out, W / 2, y0 + 30, .9, alpha=a, stripe=1)
        pop = float(back_out(prog(c.t, self.tw, self.tw + .45), 1.4)) * min(1, a / .9 if a < .9 else 1)
        if pop > 0:
            g = 1 + .34 * pop
            A2 = np.float32([[g, 0, W / 2 * (1 - g)], [0, g, y1 * (1 - g)], [0, 0, 1]])
            Mf = (A2 @ A1)[:2]
            fi = cv2.warpAffine(img, Mf, (W, H)); fm = cv2.warpAffine(m, Mf, (W, H))
            # inside the card the person is already there; outside -> only after pop
            sh = drop_shadow(fm, 22, 30, 16, .65 * min(1, pop))
            out *= (1 - sh[..., None])
            fmm = fm[..., None]
            out = out * (1 - fmm) + fi * fmm + rim_light(fm, GOLD, 7, 1.8) * min(1, pop)
        c.img = out
        c.cap_y = int(H * .955) if a > .5 else c.cap_y
    def sounds(self):
        return [(self.ts, A.whoosh(.35, 300, 2500), .5, "whoosh card"), (self.tw, A.whoosh(.4, 500, 5000, 1.5), .7, "whoosh pop"),
                (self.tw + .3, A.impact(), .7, "impact pop"), (self.tw + .1, A.pop(), .5, "pop")]


# ======================================================================= E5
class Flip(FX):
    """Whole screen flips in 3D with perspective, stays upside down, flips back."""
    stage = 50
    def angle(self, k):
        if k < .55: return np.pi * float(ease_io(k / .55))
        if k < 1.2: return np.pi
        return np.pi + np.pi * float(ease_io((k - 1.2) / .55))
    def apply(self, c):
        k = c.t - self.tw
        a = self.angle(k)
        s = 1 - .28 * abs(np.sin(a))
        q = rot_quad(W, H, ax=a, f=2.6 * H, s=s)
        bg = np.zeros_like(c.img); bg[:] = np.array([.03, .025, .02], np.float32)
        warp_quad(bg, c.img, q, shade=.55 + .45 * abs(np.cos(a)))
        c.img = bg
        for tl in (.55, 1.75):
            if k > tl: c.shake = max(c.shake, 16 * ex(-(k - tl) * 9))
    def sounds(self):
        return [(self.tw, A.whoosh(.55, 200, 3000), .8, "whoosh flip"), (self.tw + .55, A.thud(), .6, "thud"),
                (self.tw + 1.2, A.whoosh(.55, 200, 3000), .8, "whoosh flip back"), (self.tw + 1.75, A.thud(), .6, "thud")]


# ======================================================================= worlds (procedural)
def _grad(top, bot, h=H, w=W, gamma=1.0):
    g = np.linspace(0, 1, h)[:, None, None] ** gamma
    return (hexc(top) * (1 - g) + hexc(bot) * g) * np.ones((h, w, 3), np.float32)


@lru_cache(maxsize=4)
def world(name):
    rs = np.random.RandomState(abs(hash(name)) % 1000)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if name == "desert":
        img = _grad("#3b1f4a", "#f4a259", gamma=.8)
        d = np.sqrt((xx - 700) ** 2 + (yy - 820) ** 2)
        img += np.clip(1 - d / 180, 0, 1)[..., None] * np.array([1, .9, .6]) * 2 + np.exp(-d / 380)[..., None] * np.array([1, .55, .2]) * .5
        for k, (yb, col) in enumerate([(1080, "#c96f3b"), (1250, "#b35a2c"), (1450, "#8f4422"), (1650, "#6b3018")]):
            dune = yb + 60 * np.sin(xx[0] / (230 + 60 * k) + k * 2) + 30 * np.sin(xx[0] / 90 + k)
            m = (yy > dune[None, :]).astype(np.float32)[..., None]
            img = img * (1 - m) + hexc(col) * m * (1 - .25 * (yy - yb) / H)[..., None]
        key = hexc("#ffb26b")
    elif name == "sea":
        img = _grad("#0b3d6e", "#9fd3ea", h=H)
        hz = 1050
        sea = (yy > hz)[..., None].astype(np.float32)
        water = _grad("#1b6f9e", "#06223a", gamma=.7)
        img = img * (1 - sea) + water * sea
        d = np.sqrt((xx - 360) ** 2 + (yy - 640) ** 2)
        img += np.exp(-d / 70)[..., None] * 1.5 + np.exp(-d / 400)[..., None] * np.array([.6, .7, .7]) * .4
        refl = np.exp(-np.abs(xx - 360) / 60) * (yy > hz) * (np.sin(yy / 7) > .3)
        img += refl[..., None] * np.array([.9, .9, .8]) * .5
        key = hexc("#9fe6ff")
    elif name == "space":
        n = cv2.resize(rs.rand(24, 14).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
        n2 = cv2.resize(rs.rand(48, 27).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
        neb = np.clip(n * .7 + n2 * .3 - .35, 0, 1)
        img = np.zeros((H, W, 3), np.float32) + np.array([.01, .0, .03])
        img += neb[..., None] * np.array([.55, .12, .65]) + (np.clip(n2 - .5, 0, 1) ** 2)[..., None] * np.array([.1, .5, .9])
        st = np.zeros((H, W), np.float32)
        for _ in range(900):
            cv2.circle(st, (rs.randint(0, W), rs.randint(0, H)), int(rs.rand() ** 6 * 3), float(rs.uniform(.4, 1)), -1, cv2.LINE_AA)
        img += st[..., None]
        d = np.sqrt((xx - 820) ** 2 + (yy - 520) ** 2)
        pl = (d < 210).astype(np.float32)[..., None]
        img = img * (1 - pl) + pl * (hexc("#e07a5f") * (1 - .6 * np.clip((xx - 700) / 300, 0, 1))[..., None] + .05)
        ring = (np.abs(np.sqrt(((xx - 820) / 1.0) ** 2 + ((yy - 520) / .28) ** 2) - 330) < 12) & ~((d < 210) & (yy < 520))
        img += ring[..., None] * np.array([.9, .8, .6]) * .8
        key = hexc("#b388ff")
    else:  # city at night
        img = _grad("#050816", "#6a1b4d", gamma=1.4)
        d = np.sqrt((xx - 260) ** 2 + (yy - 420) ** 2)
        img += np.clip(1 - d / 80, 0, 1)[..., None] * .9 + np.exp(-d / 260)[..., None] * .15
        for layer, (base, hmax, col, win) in enumerate([(1500, 600, "#140f2a", .25), (1700, 500, "#0b0818", .6)]):
            x = 0
            while x < W:
                bw = rs.randint(70, 170); bh = rs.randint(200, hmax)
                cv2.rectangle(img, (x, base - bh), (x + bw, H), tuple(float(v) for v in hexc(col)), -1)
                for wy in range(base - bh + 20, base, 34):
                    for wx in range(x + 12, x + bw - 14, 26):
                        if rs.rand() < win:
                            cv2.rectangle(img, (wx, wy), (wx + 12, wy + 16), (1.0, .82, .45), -1)
                x += bw + rs.randint(0, 12)
        key = hexc("#ff4fa3")
    img = glow(np.clip(img, 0, 2).astype(np.float32), .4, 30, .7)
    return img.astype(np.float32), key


class Worlds(FX):
    """Blackout + boom, then the background swaps world per word, person cut out inside."""
    stage = 10
    def pre(self, c):
        if c.t < self.tws[0]: c.blackout = 1.0
    def apply(self, c):
        if c.t < self.tws[0]: return
        i = max(j for j, tw in enumerate(self.tws) if c.t >= tw)
        k = c.t - self.tws[i]
        bg, key = world(self.names[i])
        bg = scale_about(bg, 1.06 + .03 * k, dx=-25 * k, border=REFLECT)
        m = c.mask[..., None]
        lum = (c.img @ LUM)[..., None]
        fig = c.img * .82 + key * lum * .25
        sh = drop_shadow(c.mask, 30, 10, 25, .5)[..., None]
        c.img = bg * (1 - sh) * (1 - m) + fig * m + rim_light(c.mask, key, 9, 2.2, dx=6, dy=-4)
        punch = 1 + .07 * ex(-k * 10)
        c.img = scale_about(c.img, punch, border=REFLECT)
        c.flash += max(0, (.9 if i == 0 else .55) - k * 4.5)
        if i == 0: c.shake = max(c.shake, 34 * ex(-k * 6))
        else: c.shake = max(c.shake, 12 * ex(-k * 10))
    def sounds(self):
        out = [(self.tws[0], A.boom(1.8, 100, 28), 1.0, "BOOM worlds")]
        for tw in self.tws[1:]:
            out += [(tw - .12, A.whoosh(.25, 600, 6000, 1.6), .6, "whoosh world"), (tw, A.impact(), .6, "hit world")]
        return out
    def music_kills(self): return [(self.t0, self.tws[0] + .05)]


# ======================================================================= E7
class TimeFreeze(FX):
    """Freeze frame: cold tint, background and person drift in opposite directions."""
    stage = 10
    def apply(self, c):
        k = prog(c.t, self.t0, self.t1)
        e = float(ease_io(k))
        bg = scale_about(c.plate(), 1 + .07 * e, dx=-60 * e, border=REFLECT)
        fi = scale_about(c.img, 1 + .05 * e, dx=55 * e, border=REFLECT)
        fm = scale_about(c.mask, 1 + .05 * e, dx=55 * e)[..., None]
        c.img = cold(bg * (1 - fm) + fi * fm, min(1, k * 8))
        c.grade = .35
        c.flash += max(0, .5 - (c.t - self.t0) * 3); c.flash_color = (.75, .9, 1)
    def sounds(self):
        return [(self.t0, A.time_stop(), .9, "time stop"), (self.t0, A.click(.06, 1800), .9, "click"),
                (self.t1 - .3, np.ascontiguousarray(A.whoosh(.35, 300, 3000)[::-1]), .6, "time resumes")]
    def music_kills(self): return [(self.t0, self.t1)]


class Stopwatch(FX):
    stage = 70
    def apply(self, c):
        k = c.t - self.t0
        sc = float(back_out(min(1, k / .25)))
        if sc <= 0: return
        R = 125; S = 2 * R + 60
        im = np.zeros((S + 40, S, 4), np.float32)
        cx, cy = S // 2, S // 2 + 30
        cv2.circle(im, (cx, cy), R, (.05, .08, .12, .75), -1, cv2.LINE_AA)
        cv2.circle(im, (cx, cy), R, (.85, .95, 1, 1), 8, cv2.LINE_AA)
        cv2.rectangle(im, (cx - 18, cy - R - 34), (cx + 18, cy - R - 8), (.85, .95, 1, 1), -1)
        for j in range(60):
            a = j / 60 * 2 * np.pi; r0 = R - (24 if j % 5 == 0 else 12)
            cv2.line(im, (int(cx + np.sin(a) * r0), int(cy - np.cos(a) * r0)),
                     (int(cx + np.sin(a) * (R - 8)), int(cy - np.cos(a) * (R - 8))), (.85, .95, 1, 1), 3 if j % 5 == 0 else 1, cv2.LINE_AA)
        a = 2 * np.pi * (.6 * float(ease_out(min(1, k / .3))))  # sweeps, then stops dead
        cv2.line(im, (cx, cy), (int(cx + np.sin(a) * (R - 22)), int(cy - np.cos(a) * (R - 22))), tuple(float(v) for v in GOLD) + (1,), 6, cv2.LINE_AA)
        cv2.circle(im, (cx, cy), 10, tuple(float(v) for v in GOLD) + (1,), -1, cv2.LINE_AA)
        over(c.img, im, W / 2, 330, 1.0, sc)
        lab = text_rgba(getattr(self, "label", "הזמן נעצר"), 54, (225, 240, 255), "sans", 700)
        over(c.img, lab, W / 2, 330 + (S // 2 + 50) * sc, min(1, k * 4))


# ======================================================================= E8
@lru_cache(maxsize=2)
def mini_city():
    rs = np.random.RandomState(21)
    img = _grad("#0d1b2a", "#e76f51", gamma=1.3)
    ground = 1700
    yy, xx = np.mgrid[0:H, 0:W]
    img += np.exp(-np.sqrt((xx - 540.) ** 2 + (yy - ground) ** 2) / 500)[..., None] * np.array([.5, .25, .1]) * .6
    for base, hmin, hmax, col in [(ground - 40, 120, 320, "#2b2d42"), (ground, 60, 230, "#1d1f30")]:
        x = -10
        while x < W:
            bw = rs.randint(28, 70); bh = rs.randint(hmin, hmax)
            cv2.rectangle(img, (x, base - bh), (x + bw, base + 10), tuple(float(v) for v in hexc(col)), -1)
            for wy in range(base - bh + 8, base - 6, 14):
                for wx in range(x + 5, x + bw - 6, 10):
                    if rs.rand() < .45: cv2.rectangle(img, (wx, wy), (wx + 4, wy + 6), (1, .85, .5), -1)
            x += bw + rs.randint(0, 6)
    img[ground:] = hexc("#14141f")
    for _ in range(40):  # street lights
        x = rs.randint(0, W); cv2.circle(img, (x, ground + rs.randint(5, 60)), 3, (1, .8, .4), -1, cv2.LINE_AA)
    fg = np.zeros((H, W, 4), np.float32); x = -20
    while x < W:  # foreground row, in front of the giant's legs
        bw = rs.randint(60, 120); bh = rs.randint(70, 190); top = H - 120 - bh
        cv2.rectangle(fg, (x, top), (x + bw, H), (.07, .07, .11, 1), -1)
        for wy in range(top + 10, H - 10, 18):
            for wx in range(x + 8, x + bw - 8, 14):
                if rs.rand() < .5: cv2.rectangle(fg, (wx, wy), (wx + 6, wy + 8), (1, .85, .5, 1), -1)
        x += bw + rs.randint(4, 30)
    return glow(img.astype(np.float32), .5, 20, .7), fg, ground


class Giant(FX):
    """Person grows in heavy jumps into a giant over a miniature city; shake per step."""
    stage = 10
    STEPS = [(0.0, .28), (.32, .5), (.64, .74), (.96, 1.02)]
    def scale(self, k):
        s = self.STEPS[0][1]; prev = s
        for j, (tk, sv) in enumerate(self.STEPS):
            if k >= tk:
                q = min(1, (k - tk) / .11)
                s = prev + (sv - prev) * float(ease_out(q)); last = (j, tk)
            prev = sv
        return s, last
    def apply(self, c):
        k = c.t - self.tw
        bg, fg, ground = mini_city()
        s, (j, tk) = self.scale(k)
        M = np.float32([[s, 0, W / 2 * (1 - s)], [0, s, H * (1 - s) - (H - ground - 40) * 1.0]])
        fi = cv2.warpAffine(c.img, M, (W, H)); fm = cv2.warpAffine(c.mask, M, (W, H))
        out = bg.copy()
        sh = np.zeros((H, W), np.float32)
        cv2.ellipse(sh, (W // 2, ground + 20), (int(260 * s), int(40 * s)), 0, 0, 360, .7, -1)
        out *= 1 - blur_fast(sh, 20)[..., None]
        fmm = fm[..., None]
        out = out * (1 - fmm) + fi * fmm + rim_light(fm, hexc("#ff9e6b"), 8, 1.6, dx=6, dy=-2)
        over_tl(out, fg, 0, 0)
        c.img = out
        c.shake = max(c.shake, (18 + 30 * j) * ex(-(k - tk) * 8))
        if k < .12: c.flash += .5 - k * 4
    def sounds(self):
        return [(self.tw + tk, A.thud(.8, 55), .55 + .15 * j, f"stomp {j + 1}") for j, (tk, _) in enumerate(self.STEPS)] + \
               [(self.tw + self.STEPS[-1][0], A.boom(1.4, 70, 28), .6, "rumble")]


# ======================================================================= E9
class Pixelate(FX):
    """Person breaks into flying, color-shifting pixel blocks, then rebuilds."""
    stage = 10
    B = 30
    def _params(self, n):
        rs = np.random.RandomState(13)
        return dict(v=rs.randn(n, 2) * [520, 380] + [0, -260], d=rs.rand(n) * .12, hue=rs.rand(n), spin=rs.randn(n))
    def apply(self, c):
        gw, gh = W // self.B, H // self.B
        small = cv2.resize(c.img, (gw, gh), interpolation=cv2.INTER_AREA)
        ms = cv2.resize(c.mask, (gw, gh), interpolation=cv2.INTER_AREA)
        ys, xs = np.where(ms > .45)
        n = len(xs)
        P = self._params(gw * gh)
        idx = ys * gw + xs
        rowd = ys / gh * .3
        if c.t < self.tr:
            u = ease_in(np.clip((c.t - self.tw - .08 - rowd - P["d"][idx]) / .5, 0, 1))
        else:
            u = 1 - ease_out(np.clip((c.t - self.tr - (0.3 - rowd) - P["d"][idx]) / .45, 0, 1))
        out = blur_fast(c.plate(), 18) * .45 + blur_fast(c.img, 40) * .1  # dark, soft backdrop
        realb = 1 - prog(c.t, self.tw, self.tw + .08) if c.t < self.tr else prog(c.t, self.tr + .82, self.tr + .97)
        hsv_cache = {}
        for j in range(n):
            col = small[ys[j], xs[j]]
            uj = float(u[j])
            if uj > .01:
                h, s_, v = colorsys.rgb_to_hsv(*np.clip(col, 0, 1))
                r, g, b = colorsys.hsv_to_rgb((h + uj * .8 + P["hue"][idx[j]] * uj) % 1, min(1, s_ + .6 * uj), min(1, v + .35 * uj))
                col = (float(r), float(g), float(b))
            else:
                col = tuple(float(x) for x in col)
            sz = self.B * (1 - .35 * uj)
            x = xs[j] * self.B + self.B / 2 + P["v"][idx[j], 0] * uj
            y = ys[j] * self.B + self.B / 2 + P["v"][idx[j], 1] * uj
            cv2.rectangle(out, (int(x - sz / 2), int(y - sz / 2)), (int(x + sz / 2) - 1, int(y + sz / 2) - 1), col, -1)
        if realb > 0:
            m = c.mask[..., None] * realb
            out = out * (1 - m) + c.img * m
        c.img = glow(out, .35, 12, .7)
    def sounds(self):
        out = [(self.tw, A.glitch(.7), .8, "glitch break")]
        for j in range(6): out.append((self.tw + .05 + j * .08, A.blip(800 + 150 * j), .5, ""))
        out.append((self.tr, np.ascontiguousarray(A.glitch(.6)[::-1]), .7, "glitch rebuild"))
        for j in range(6): out.append((self.tr + .3 + j * .08, A.blip(1700 - 150 * j), .5, ""))
        return out


# ======================================================================= E10
class PhoneZoom(FX):
    """Infinite zoom into a phone that plays this very video; one dive per word."""
    stage = 50
    S = .42
    def _bezel(self):
        if hasattr(self, "_bz"): return self._bz
        sw, sh = int(W * self.S), int(H * self.S); pad = 22
        bz = card(sh + 2 * pad, sw + 2 * pad, (.04, .04, .045), 1.0, 64, border=(.45, .42, .38), bw=3)
        hole = np.pad(rounded_mask(sh, sw, 40), pad)
        bz[..., 3] *= 1 - hole
        cv2.rectangle(bz, ((sw + 2 * pad) // 2 - 70, pad + 14), ((sw + 2 * pad) // 2 + 70, pad + 40), (0, 0, 0, 1), -1)
        self._bz = (bz, rounded_mask(sh, sw, 40), pad)
        return self._bz
    def apply(self, c):
        bz, scr, pad = self._bezel()
        app = float(ease_out(prog(c.t, self.ts, self.ts + .35)))
        outro = prog(c.t, self.t1 - .3, self.t1)
        Bimg = blur_fast(c.img, 8) * .4
        over(Bimg, bz, W / 2, H / 2 + (1 - app) * 1500)
        z, ok = 1.0, False
        for i, tw in enumerate(self.dives):
            tend = min(self.dives[i + 1] if i + 1 < len(self.dives) else tw + .55, tw + .55)
            if tw <= c.t < tend:
                e = float(ease_io((c.t - tw) / (tend - tw)))
                z = float(np.exp(np.log(1 / self.S) * e))
        sw, sh = int(W * self.S), int(H * self.S)
        if app < .999:
            Bfull = blur_fast(c.img, 8) * .4; over(Bfull, bz, W / 2, H / 2)
            screen = cv2.resize(Bfull, (sw, sh), interpolation=cv2.INTER_AREA)
            y0 = int(H / 2 - sh / 2 + (1 - app) * 1500)
            sub = Bimg[max(0, y0):max(0, y0) + sh, (W - sw) // 2:(W - sw) // 2 + sw]
            hh = sub.shape[0]
            if hh > 0:
                mm = scr[:hh, :, None] if y0 >= 0 else scr[-hh:, :, None]
                sc_ = screen[:hh] if y0 >= 0 else screen[-hh:]
                sub[:] = sub * (1 - mm) + sc_ * mm
            out = Bimg
        else:
            out = self._nest(Bimg, z, scr)
        c.img = out * (1 - outro) + c.img * outro
    def _nest(self, B, z, scr):
        k0 = 0
        while z * self.S ** (k0 + 1) >= 1: k0 += 1
        sc = z * self.S ** k0
        cw, ch = W / sc, H / sc
        x0, y0 = (W - cw) / 2, (H - ch) / 2
        out = cv2.resize(B[int(y0):int(y0 + ch), int(x0):int(x0 + cw)], (W, H), interpolation=cv2.INTER_LINEAR)
        k = k0 + 1
        while True:
            sc = z * self.S ** k
            w, h = int(W * sc), int(H * sc)
            if w < 6: break
            lvl = cv2.resize(B, (w, h), interpolation=cv2.INTER_AREA)
            m = cv2.resize(scr, (w, h))[..., None]
            xa, ya = (W - w) // 2, (H - h) // 2
            roi = out[ya:ya + h, xa:xa + w]
            roi[:] = roi * (1 - m) + lvl * m
            k += 1
        return out
    def sounds(self):
        return [(self.ts, A.whoosh(.4, 300, 2500), .5, "phone in")] + [(t, A.digital_dive(), .8, "dive") for t in self.dives]


# ======================================================================= E11
class Cube(FX):
    """The frame becomes a rotating cube; an animated card on each face, one per word."""
    stage = 50
    FW, FH = 720, 1280
    def _card(self, i, anim):
        word, sub = self.cards[i]
        key = ("bg", i)
        if not hasattr(self, "_bgc"): self._bgc = {}
        if key not in self._bgc:
            g = _grad(*getattr(self, "card_grad", ("#14160f", "#2e3320")), h=self.FH, w=self.FW, gamma=1.2)
            yy, xx = np.mgrid[0:self.FH, 0:self.FW]
            g += np.exp(-np.sqrt((xx - self.FW * .7) ** 2 + (yy - 300.) ** 2) / 420)[..., None] * GOLD * .25
            cv2.rectangle(g, (24, 24), (self.FW - 25, self.FH - 25), tuple(float(v) for v in GOLD), 4, cv2.LINE_AA)
            cv2.rectangle(g, (40, 40), (self.FW - 41, self.FH - 41), tuple(float(v) * .5 for v in GOLD), 1, cv2.LINE_AA)
            self._bgc[key] = g.astype(np.float32)
        im = self._bgc[key].copy()
        num = text_rgba(f"0{i + 1}", 90, tuple(int(v * 255) for v in GOLD), "serif", 700)
        over(im, num, self.FW - 120, self.FH * .11, 1)
        a = float(ease_out(anim))
        wd = gold_fill(text_rgba(word, 200, (255, 255, 255), "serif", 900), "#FFFFFF", "#F3E3B0", "#D4AF37")
        if wd.shape[1] > self.FW - 100: wd = cv2.resize(wd, None, fx=(self.FW - 100) / wd.shape[1], fy=(self.FW - 100) / wd.shape[1])
        over(im, wd, self.FW / 2 + (1 - a) * 160, self.FH * .45, a)
        lw = int((self.FW - 200) * float(ease_out(prog(anim, .3, 1))))
        ly = int(self.FH * .58); cv2.rectangle(im, (self.FW // 2 + (self.FW - 200) // 2 - lw, ly), (self.FW // 2 + (self.FW - 200) // 2, ly + 8), tuple(float(v) for v in RED), -1)
        st = text_rgba(sub, 58, (220, 220, 210), "sans", 500)
        over(im, st, self.FW / 2, self.FH * .68 + (1 - a) * 40, float(prog(anim, .4, 1)))
        sweep = np.clip(1 - np.abs(np.arange(self.FW)[None, :] + np.arange(self.FH)[:, None] * .4 - (anim * 1800 - 300)) / 80, 0, 1)
        return im + sweep[..., None] * .12
    def theta(self, t):
        return 90 * sum(float(ease_io(prog(t, tw - .24, tw + .2))) for tw in self.tws)
    def pre(self, c): c.cap_hide = True
    def apply(self, c):
        t = c.t
        cs = 1 - .38 * float(ease_io(prog(t, self.t0, self.t0 + .25)))
        grow = float(ease_io(prog(t, self.t1 - .45, self.t1 - .12)))
        cs = cs + (1 - cs) * grow
        th = np.deg2rad(self.theta(t))
        w, h = W * cs, H * cs
        f = 2600.0; D = f + w / 2
        bg = blur_fast(c.img, 30) * .25
        yy = np.linspace(0, 1, H)[:, None, None]
        bg += np.exp(-((yy - .5) / .35) ** 2) * GOLD * .08
        faces = []
        for j in range(5):
            phi = th - j * np.pi / 2
            n = np.array([np.sin(phi), 0, -np.cos(phi)])
            facing = -n[2]
            if facing <= 0.01: continue
            if j == 0 and th > np.pi: continue
            if j == 4 and th < np.pi: continue
            if j - 1 >= len(self.cards): continue
            u = np.array([np.cos(phi), 0, np.sin(phi)])
            ctr = np.array([0, 0, D]) + n * w / 2
            pts = []
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P = ctr + u * su * w / 2 + np.array([0, sv * h / 2, 0])
                pts.append([W / 2 + f * P[0] / P[2], H / 2 + f * P[1] / P[2]])
            faces.append((facing, j, np.array(pts)))
        for facing, j, q in sorted(faces):
            if j == 0:
                img = cv2.resize(c.img, (self.FW, self.FH), interpolation=cv2.INTER_AREA)
            else:
                ci = j - 1
                anim = prog(t, self.tws[ci] - .1, self.tws[ci] + .6)
                img = self._card(ci, anim)
            warp_quad(bg, img, q, shade=.4 + .6 * facing)
        fade = prog(t, self.t1 - .12, self.t1)
        c.img = bg * (1 - fade) + c.img * fade
    def sounds(self):
        out = []
        for tw in self.tws:
            out += [(tw - .24, A.whoosh(.44, 300, 3500), .6, "cube turn"), (tw + .2, A.thud(.5, 90), .45, "cube lock"),
                    (tw + .2, A.click(.05, 2500), .5, "")]
        return out


# ======================================================================= E12
@lru_cache(maxsize=16)
def stamp_img(text, angle, rgb=(214, 40, 40)):
    t = text_rgba(text, 110, rgb, "sans", 900)
    h, w = t.shape[0] + 60, t.shape[1] + 60
    im = np.zeros((h, w, 4), np.float32)
    red = (rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1)
    cv2.rectangle(im, (8, 8), (w - 9, h - 9), red, 9, cv2.LINE_AA)
    cv2.rectangle(im, (24, 24), (w - 25, h - 25), red, 3, cv2.LINE_AA)
    over(im, t, w / 2, h / 2)
    rs = np.random.RandomState(len(text))
    grunge = cv2.GaussianBlur(rs.rand(h, w).astype(np.float32), (0, 0), 1.5)
    im[..., 3] *= np.clip((grunge - .32) * 4, 0, 1) * .92
    side = int(np.hypot(h, w)) + 4
    canvas = np.zeros((side, side, 4), np.float32); over(canvas, im, side / 2, side / 2)
    M = cv2.getRotationMatrix2D((side / 2, side / 2), angle, 1.0)
    return cv2.warpAffine(canvas, M, (side, side))


class Stamps(FX):
    """Red stamps land, get struck out and fall; a price counter crashes to 0."""
    stage = 70
    STAMPS = [("תירוץ", (330, 640), 12), ("אין זמן", (740, 820), -9), ("לא עכשיו", (420, 1010), 6)]
    def _stamps(self): return getattr(self, "stamps", self.STAMPS)
    def _lands(self): return getattr(self, "lands", None) or [self.tw + i * .18 for i in range(len(self._stamps()))]
    def apply(self, c):
        t = c.t
        terase = getattr(self, "terase", None)
        tfall0 = terase + .4 if terase is not None else getattr(self, "tfall", 1e9)
        for i, ((txt, (x, y), ang), tl) in enumerate(zip(self._stamps(), self._lands())):
            if t < tl - .12: continue
            q = prog(t, tl - .12, tl)
            s = 2.4 - 1.4 * float(ease_in(q))
            im = stamp_img(txt, ang, getattr(self, "stamp_rgb", (214, 40, 40)))
            tf = tfall0 + i * .1
            fy, fr, fa = 0, 0, 1
            if t > tf:
                tau = t - tf; fy = .5 * 4200 * tau * tau; fr = (90 if i % 2 else -90) * tau; fa = max(0, 1 - tau * 1.2)
            if fr:
                M = cv2.getRotationMatrix2D((im.shape[1] / 2, im.shape[0] / 2), fr, 1); im = cv2.warpAffine(im, M, im.shape[1::-1])
            over(c.img, im, x, y + fy, min(1, q * 1.5) * fa, s)
            te = terase + i * .12 if terase is not None else 1e9
            if t > te:  # marker strike-through, right to left
                L = 360; p = float(ease_out(prog(t, te, te + .15)))
                ca, sa = np.cos(np.deg2rad(-ang)), np.sin(np.deg2rad(-ang))
                x1, y1 = x + L / 2 * ca, y + fy + L / 2 * sa
                x2, y2 = x1 - L * p * ca, y1 - L * p * sa
                cv2.line(c.img, (int(x1), int(y1)), (int(x2), int(y2)), (.04, .04, .04), 26, cv2.LINE_AA) if fa > .5 else None
            if abs(t - tl) < .25: c.shake = max(c.shake, 20 * ex(-(t - tl) * 12) if t >= tl else 0)
        if getattr(self, "tprice", None) is not None and t >= self.tprice - .1:
            a = float(ease_out(prog(t, self.tprice - .1, self.tprice + .15)))
            v0, v1 = getattr(self, "price_from", 999), getattr(self, "price_to", 0)
            py = getattr(self, "price_y", 1380)
            v = int(round(v0 + (v1 - v0) * float(ease_in(prog(t, self.tprice, self.tzero)))))
            zero = t >= self.tzero
            lab = text_rgba(getattr(self, "price_label", "המחיר של תירוץ"), 58, (230, 230, 230), "sans", 600)
            over(c.img, lab, W / 2, py - 150, a)
            col = getattr(self, "price_hit_color", (230, 57, 70)) if zero else (255, 255, 255)
            num = text_rgba(f"₪{v:,}", 210, col, "sans", 900, 0)
            sc = 1 + .35 * ex(-(t - self.tzero) * 8) if zero else 1
            over(c.img, card(num.shape[0] - 40, num.shape[1] + 40, (0, 0, 0), .45, 30), W / 2, py, a)
            over(c.img, num, W / 2, py, a, sc)
            if zero:
                c.shake = max(c.shake, 30 * ex(-(t - self.tzero) * 7))
    def pre(self, c):
        if c.t > self.tw - .2: c.cap_y = getattr(self, "cap_y", 1700)
        if getattr(self, "tzero", None) is not None and c.t >= self.tzero: c.flash += max(0, .45 - (c.t - self.tzero) * 2.5); c.flash_color = (.9, .15, .15)
    def sounds(self):
        out = []
        terase = getattr(self, "terase", None)
        tfall0 = terase + .4 if terase is not None else getattr(self, "tfall", None)
        for i, tl in enumerate(self._lands()):
            out.append((tl, A.stamp(), .8, "stamp"))
            if terase is not None: out.append((terase + i * .12, A.scratch(.18), .6, "strike"))
            if tfall0 is not None and tfall0 < self.t1: out.append((tfall0 + i * .1, A.fall(), .4, "fall"))
        if getattr(self, "tprice", None) is not None:
            out += [(self.tprice, A.ticks(self.tzero - self.tprice, 22), .5, "counter ticks"), (self.tzero, A.boom(1.2, 80, 30), .85, "zero hit")]
        return out


# ======================================================================= E13
class CommentDM(FX):
    """A comment box where the code word gets typed, then a private-message notification."""
    stage = 70
    def pre(self, c): c.cap_y = getattr(self, "cap_y", 1300)
    def apply(self, c):
        t = c.t
        a = float(ease_out(prog(t, self.tbox, self.tbox + .3)))
        by_ = getattr(self, "box_y", 1560)
        y = (H + 230) - ((H + 230) - by_) * a
        bw, bh = getattr(self, "box_w", 980), 136
        box = card(bh, bw, (.12, .12, .13), .96, bh // 2, border=(.3, .3, .32), bw=2)
        over(c.img, box, W / 2, y)
        # avatar (right), send (left)
        cv2.circle(c.img, (int(W / 2 + bw / 2 - 72), int(y)), 44, tuple(float(v) for v in GOLD), -1, cv2.LINE_AA)
        cv2.circle(c.img, (int(W / 2 + bw / 2 - 72), int(y - 10)), 15, (.12, .12, .13), -1, cv2.LINE_AA)
        cv2.ellipse(c.img, (int(W / 2 + bw / 2 - 72), int(y + 28)), (26, 16), 0, 180, 360, (.12, .12, .13), -1, cv2.LINE_AA)
        n = int(np.clip((t - self.tw) / .09 + 1, 0, len(self.code))) if t >= self.tw else 0
        sent = t >= self.tw + .55
        typed = self.code[:n] if not sent else ""
        xr = W / 2 + bw / 2 - 140
        if typed:
            ti = text_rgba(typed, 56, (255, 255, 255), "sans", 600)
            over_tl(c.img, ti, int(xr - ti.shape[1]), int(y - ti.shape[0] / 2))
            xl = xr - ti.shape[1] + 14
        else:
            ph = text_rgba("הוסף תגובה...", 48, (140, 140, 145), "sans", 400)
            over_tl(c.img, ph, int(xr - ph.shape[1]), int(y - ph.shape[0] / 2))
            xl = xr
        if not sent and int(t * 3) % 2 == 0:
            cv2.line(c.img, (int(xl), int(y - 30)), (int(xl), int(y + 30)), tuple(float(v) for v in GOLD), 3)
        sx, sy = int(W / 2 - bw / 2 + 74), int(y)
        pr = ex(-max(0, t - self.tw - .45) * 10) if t >= self.tw + .45 else 0
        r = int(42 * (1 + .3 * pr))
        cv2.circle(c.img, (sx, sy), r, tuple(float(v) for v in GOLD) if n else (.3, .3, .32), -1, cv2.LINE_AA)
        tri = np.array([[sx - 16, sy - 18], [sx - 16, sy + 18], [sx + 20, sy]], np.int32)  # points left in RTL
        tri[:, 0] = 2 * sx - tri[:, 0]
        cv2.fillConvexPoly(c.img, tri, (.08, .08, .08), cv2.LINE_AA)
        # DM banner from the top
        td = self.tw + .8
        if t >= td:
            q = float(back_out(prog(t, td, td + .38), 1.3))
            by = -160 + (210 + 160) * q
            ban = card(200, 980, (.1, .1, .11), .95, 40, border=(.28, .28, .3), bw=2)
            ic = card(110, 110, GOLD, 1, 26)
            over(ban, ic, 980 - 95, 100)
            env = np.zeros((110, 110, 4), np.float32)
            cv2.rectangle(env, (25, 33), (85, 77), (.1, .1, .1, 1), 4, cv2.LINE_AA)
            cv2.polylines(env, [np.array([[25, 33], [55, 58], [85, 33]], np.int32)], False, (.1, .1, .1, 1), 4, cv2.LINE_AA)
            over(ban, env, 980 - 95, 100)
            t1i = text_rgba(getattr(self, "dm_title", "הודעה פרטית חדשה"), 46, (255, 255, 255), "sans", 800)
            t2i = text_rgba(getattr(self, "dm_body", f"היי! הנה כל מה שרצית לדעת על {self.code}"), 38, (190, 190, 195), "sans", 400)
            nw = text_rgba("עכשיו", 32, (150, 150, 155), "sans", 400)
            over_tl(ban, t1i, int(980 - 175 - t1i.shape[1]), 30)
            over_tl(ban, t2i, int(980 - 175 - t2i.shape[1]), 102)
            over_tl(ban, nw, 40, 34)
            over(c.img, ban, getattr(self, "dm_x", W / 2), by)
    def sounds(self):
        out = [(self.tbox, A.whoosh(.3, 400, 3000), .4, "box in")]
        for i in range(len(self.code)): out.append((self.tw + i * .09, A.key_tap(), .7, "key"))
        out += [(self.tw + .45, A.pop(), .7, "send"), (self.tw + .8, A.ding(), .8, "DM ding")]
        return out


# ======================================================================= E14
@lru_cache(maxsize=2)
def holo_floor():
    im = np.zeros((H, W), np.float32); hz = 1450
    for k in range(1, 18):
        y = int(hz + (H - hz) * (k / 17) ** 2)
        cv2.line(im, (0, y), (W, y), .5, 2, cv2.LINE_AA)
    for k in range(-12, 13):
        cv2.line(im, (W // 2 + k * 30, hz), (W // 2 + k * 260, H), .5, 2, cv2.LINE_AA)
    fade = np.clip((np.arange(H) - hz) / 300, 0, 1)[:, None]
    return (cv2.GaussianBlur(im, (0, 0), 1) * fade)[..., None] * TEAL


class Hologram(FX):
    """Person turns into a turquoise hologram with scan lines; tags pop around."""
    stage = 10
    def apply(self, c):
        t = c.t; k = t - self.tw
        lum = (c.img @ LUM)[..., None]
        m = c.mask
        yy = np.arange(H, dtype=np.float32)[:, None]
        scan = .72 + .28 * (np.sin((yy + t * 140) * np.pi / 3.5) > 0)
        rs = np.random.RandomState(int(t * 15))
        flick = .82 + .18 * rs.rand()
        holo = TEAL * (.25 + 1.25 * lum) * scan[..., None] * flick
        mm = m.copy()
        if rs.rand() < .35:  # glitch slice
            y0 = rs.randint(300, 1700); hh = rs.randint(20, 80); dx = rs.randint(-40, 40)
            holo[y0:y0 + hh] = np.roll(holo[y0:y0 + hh], dx, 1); mm[y0:y0 + hh] = np.roll(mm[y0:y0 + hh], dx, 1)
        edge = rim_light(mm, TEAL, 10, 2.5, 0, 0) + rim_light(mm, TEAL, 4, 2.0, 0, 0)
        hb = np.dstack([np.roll(holo[..., 0], 5, 1), holo[..., 1], np.roll(holo[..., 2], -5, 1)])
        dark = c.img * .1 + holo_floor()
        hol = dark * (1 - mm[..., None] * .85) + hb * mm[..., None] * .95 + edge
        line = -100 + 2300 * float(ease_io(prog(k, 0, .45)))
        sel = (yy < line).astype(np.float32)[..., None]
        bar = np.exp(-((yy - line) / 6) ** 2)[..., None] * TEAL * 1.5
        c.img = c.img * (1 - sel) + hol * sel + bar
        c.grade = .25
    def sounds(self):
        return [(self.tw, A.glitch(.4), .6, "holo glitch"), (self.tw, A.hum(self.t1 - self.tw), .55, "holo hum")]


class HoloTags(FX):
    stage = 70
    def apply(self, c):
        for (txt, (px, py), (ax, ay)), tt in zip(self.tags, self.times):
            if c.t < tt: continue
            q = prog(c.t, tt, tt + .22)
            s = float(back_out(q, 2.0))
            col = tuple(float(v) for v in TEAL)
            lp = float(ease_out(prog(c.t, tt + .05, tt + .3)))
            ex_, ey_ = px + (ax - px) * lp, py + (ay - py) * lp
            cv2.line(c.img, (int(px), int(py)), (int(ex_), int(ey_)), col, 3, cv2.LINE_AA)
            if lp > .95: cv2.circle(c.img, (int(ax), int(ay)), 9, col, -1, cv2.LINE_AA)
            ti = text_rgba(txt, 50, (210, 255, 250), "sans", 700)
            pill = card(ti.shape[0] + 6, ti.shape[1] + 30, TEAL * .25, .75, (ti.shape[0] + 6) // 2, border=TEAL, bw=3)
            over(pill, ti, pill.shape[1] / 2, pill.shape[0] / 2)
            over(c.img, pill, px, py, min(1, q * 2), s)
    def sounds(self): return [(tt, A.blip(1500 + 200 * i, .1), .6, "tag") for i, tt in enumerate(self.times)]


# ======================================================================= E15
class FollowGoal(FX):
    """Follower counter climbs to the goal; confetti, gold stamp, follow button gets pressed."""
    stage = 70
    def _confetti(self):
        if hasattr(self, "_cf"): return self._cf
        rs = np.random.RandomState(5); n = 260
        cols = [GOLD, np.array([1, 1, 1.]), RED, TEAL, hexc("#F3E3B0")]
        ang = rs.uniform(-np.pi * .95, -np.pi * .05, n); sp = rs.uniform(700, 2100, n)
        self._cf = dict(v=np.stack([np.cos(ang) * sp, np.sin(ang) * sp], 1), col=[cols[i % 5] for i in range(n)],
                        w=rs.uniform(10, 22, n), h=rs.uniform(6, 12, n), spin=rs.uniform(-12, 12, n), ph=rs.rand(n) * 6)
        return self._cf
    def pre(self, c): c.cap_y = 1700
    def apply(self, c):
        t = c.t
        goal_t = self.tgoal
        a = float(ease_out(prog(t, self.tw - .1, self.tw + .2)))
        v = int(round(self.goal * float(ease_out(prog(t, self.tw, goal_t)) ** 1.0)))
        hit = t >= goal_t
        lab = text_rgba(getattr(self, "label", "עוקבים"), 60, (220, 220, 220), "sans", 600)
        over(c.img, lab, W / 2, 560, a)
        num = text_rgba(f"{v:,}", 200, tuple(int(x * 255) for x in GOLD) if hit else (255, 255, 255), "sans", 900)
        sc = 1 + .3 * ex(-(t - goal_t) * 8) if hit else 1
        over(c.img, card(num.shape[0] - 30, num.shape[1] + 50, (0, 0, 0), .45, 36), W / 2, 740, a)
        over(c.img, num, W / 2, 740, a, sc)
        # follow button (pressed shortly after the word)
        tp = self.tw + .25
        pressed = t >= tp
        bs = 1 - .1 * float(np.sin(np.pi * prog(t, tp - .06, tp + .1)))
        btn = card(124, 420, (.2, .2, .22) if pressed else GOLD, .97, 62)
        bt = text_rgba("במעקב" if pressed else "עקוב", 60, (235, 235, 235) if pressed else (20, 18, 10), "sans", 800)
        over(btn, bt, 230 if pressed else 210, 62)
        if pressed:
            cv2.polylines(btn, [np.array([[70, 62], [92, 84], [130, 40]], np.int32)], False, tuple(float(x) for x in GOLD) + (1,), 8, cv2.LINE_AA)
        over(c.img, btn, W / 2, 1180, a, bs)
        if tp - .3 < t < tp + .35:  # finger tap ripple
            q = prog(t, tp - .3, tp)
            r = int(70 - 40 * q) if t < tp else int(30 + 160 * prog(t, tp, tp + .35))
            al = .8 if t < tp else .8 * (1 - prog(t, tp, tp + .35))
            ov = c.img.copy(); cv2.circle(ov, (W // 2 + 120, 1190), r, (1, 1, 1), 5, cv2.LINE_AA)
            c.img = c.img * (1 - al) + ov * al
        if hit:
            k = t - goal_t
            cf = self._confetti()
            pos = np.array([W / 2, 740]) + cf["v"] * k * ex(-k * .9) + np.array([0, 900 * k * k])
            for i in range(len(pos)):
                ang = cf["ph"][i] + cf["spin"][i] * k
                w2 = cf["w"][i] * abs(np.cos(ang)); h2 = cf["h"][i]
                ca, sa = np.cos(ang * .7), np.sin(ang * .7)
                pts = np.array([[-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]]) @ np.array([[ca, sa], [-sa, ca]]) + pos[i]
                cv2.fillConvexPoly(c.img, pts.astype(np.int32), tuple(float(x) for x in cf["col"][i]), cv2.LINE_AA)
            ts = goal_t + .25
            if t >= ts - .1:
                q = prog(t, ts - .1, ts)
                badge = np.zeros((360, 360, 4), np.float32)
                cv2.circle(badge, (180, 180), 165, tuple(float(x) for x in GOLD) + (1,), -1, cv2.LINE_AA)
                cv2.circle(badge, (180, 180), 140, (.45, .33, .08, 1), 5, cv2.LINE_AA)
                badge = gold_fill(badge) * np.float32([1, 1, 1, 1]); badge[..., 3] = (badge[..., 3] > 0) * 1.0
                cv2.circle(badge, (180, 180), 140, (.45, .33, .08, 1), 5, cv2.LINE_AA)
                kt = text_rgba(self.badge, 120, (60, 42, 8), "sans", 900); over(badge, kt, 180, 160)
                st = text_rgba(getattr(self, "badge_sub", "יעד הושג"), 42, (60, 42, 8), "sans", 800); over(badge, st, 180, 255)
                M = cv2.getRotationMatrix2D((180, 180), 14, 1); badge = cv2.warpAffine(badge, M, (360, 360))
                over(c.img, badge, 830, 330, min(1, q * 2), 2.3 - 1.3 * float(ease_in(q)))
                if t >= ts: c.shake = max(c.shake, 20 * ex(-(t - ts) * 9))
    def sounds(self):
        return [(self.tw + .25, A.click(.06, 2500), .8, "follow tap"), (self.tw + .27, A.pop(), .5, ""),
                (self.tw, A.ticks(self.tgoal - self.tw, 16), .35, "counter"),
                (self.tgoal, A.confetti_pop(), .8, "confetti"), (self.tgoal + .25, A.stamp(), .9, "gold stamp"),
                (self.tgoal + .25, A.shimmer(1.6), .5, "shimmer")]


# ======================================================================= ending
def rewind_frame(ed, t):
    t0, dur = ed.rewind
    n_last = dur - 1 / ed.fps
    p = min(1, (t - t0) / n_last)
    tb = t0 * (1 - float(ease_io(p)))
    img = ed._frame(tb)
    s = float(np.sin(np.pi * p)) ** .6  # VHS intensity: 0 at both ends -> clean loop point
    if s < 1e-3:
        return img
    rs = np.random.RandomState(int(t * 1000))
    img = np.dstack([np.roll(img[..., 0], int(8 * s), 1), img[..., 1], np.roll(img[..., 2], -int(8 * s), 1)])
    l = (img @ LUM)[..., None]; img = img * (1 - .35 * s) + l * .35 * s
    img[::3] *= 1 - .25 * s
    by = int((t * 1900) % (H + 300)) - 150
    for y0 in range(max(0, by), min(H, by + 140), 4):
        img[y0:y0 + 4] = np.roll(img[y0:y0 + 4], rs.randint(-60, 60), 1) * .8 + rs.rand() * .3 * s
    img += (rs.rand(H // 4, W // 4).astype(np.float32).repeat(4, 0).repeat(4, 1)[..., None] - .5) * .12 * s
    for k in range(2):  # ◀◀ icon
        x = 70 + k * 46
        cv2.fillConvexPoly(img, np.array([[x + 44, 90], [x + 44, 150], [x, 120]], np.int32), (1, 1, 1), cv2.LINE_AA)
    return img


# ======================================================================= friend tag
def heart_pts(cx, cy, r):
    t = np.linspace(0, 2 * np.pi, 40)
    x = 16 * np.sin(t) ** 3
    y = -(13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t))
    return np.stack([cx + x * r / 16, cy + y * r / 16], 1).astype(np.int32)


class FriendTag(FX):
    """Name tag pops on a person in the frame (on the name), hearts float up (on the love word)."""
    stage = 70
    def apply(self, c):
        t = c.t
        q = prog(t, self.tw, self.tw + .25)
        if q > 0:
            px, py = self.pill_xy; ax, ay = self.anchor
            lp = float(ease_out(prog(t, self.tw + .05, self.tw + .35)))
            col = tuple(float(v) for v in GOLD)
            cv2.line(c.img, (int(px), int(py + 50)), (int(px + (ax - px) * lp), int(py + 50 + (ay - py - 50) * lp)), col, 4, cv2.LINE_AA)
            if lp > .95: cv2.circle(c.img, (int(ax), int(ay)), 10, col, -1, cv2.LINE_AA)
            ti = text_rgba(self.name, 70, (25, 20, 8), "sans", 900)
            pill = card(ti.shape[0] + 10, ti.shape[1] + 60, GOLD, .97, (ti.shape[0] + 10) // 2)
            over(pill, ti, pill.shape[1] / 2, pill.shape[0] / 2)
            over(c.img, pill, px, py, min(1, q * 2), float(back_out(q, 2.0)))
        if t >= self.tlove:
            rs = np.random.RandomState(3)
            for i in range(16):
                t0 = self.tlove + i * .07
                k = t - t0
                if k < 0: continue
                x0 = self.anchor[0] + rs.uniform(-60, 420); sp = rs.uniform(250, 480)
                x = x0 + 40 * np.sin(k * 4 + i); y = self.anchor[1] + 250 - sp * k
                r = rs.uniform(18, 38) * float(back_out(min(1, k / .25)))
                a = max(0, 1 - k / 1.8)
                if a <= 0 or r <= 1: continue
                ov = c.img.copy()
                cv2.fillPoly(ov, [heart_pts(x, y, r)], (.9, .12, .2) if i % 3 else tuple(float(v) for v in GOLD), cv2.LINE_AA)
                c.img = c.img * (1 - a) + ov * a
    def sounds(self):
        return [(self.tw, A.pop(), .7, "name tag"), (self.tw, A.blip(1400, .1), .5, ""),
                (self.tlove, A.shimmer(1.4), .5, "hearts")]


# ======================================================================= ad pieces
class Badge(FX):
    """A seal lands on the word (stamp + shimmer), stays until t1."""
    stage = 70
    def _img(self):
        if not hasattr(self, "_b"):
            R = 190; S = 2 * R + 40
            b = np.zeros((S, S, 4), np.float32)
            col = tuple(float(v) for v in getattr(self, "color", GOLD)) + (1,)
            for k in range(36):  # scalloped edge
                a = k / 36 * 2 * np.pi
                cv2.circle(b, (int(S / 2 + np.cos(a) * (R - 6)), int(S / 2 + np.sin(a) * (R - 6))), 22, col, -1, cv2.LINE_AA)
            cv2.circle(b, (S // 2, S // 2), R - 8, col, -1, cv2.LINE_AA)
            b = gold_fill(b) if getattr(self, "gold", True) else b
            b[..., 3] = (b[..., 3] > 0) * 1.0
            cv2.circle(b, (S // 2, S // 2), R - 34, (1, 1, 1, 1), 4, cv2.LINE_AA)
            ink = getattr(self, "ink", (40, 30, 8))
            for txt, sz, dy in zip(self.lines, (64, 44, 40), (-60, 10, 70)):
                ti = text_rgba(txt, sz, ink, "sans", 900)
                if ti.shape[1] > 2 * R - 90: ti = cv2.resize(ti, None, fx=(2 * R - 90) / ti.shape[1], fy=(2 * R - 90) / ti.shape[1])
                over(b, ti, S / 2, S / 2 + dy)
            M = cv2.getRotationMatrix2D((S / 2, S / 2), getattr(self, "angle", -10), 1)
            self._b = cv2.warpAffine(b, M, (S, S))
        return self._b
    def apply(self, c):
        k = c.t - self.tw
        if k < -.1: return
        q = prog(c.t, self.tw - .1, self.tw + .02)
        out = 1 - prog(c.t, self.t1 - .25, self.t1)
        x, y = self.xy
        over(c.img, self._img(), x, y, min(1, q * 2) * out, (2.3 - 1.3 * float(ease_in(q))) * getattr(self, "scale", 1.0))
        if k >= 0:
            c.shake = max(c.shake, 18 * ex(-k * 9))
            sw = np.clip(1 - np.abs(np.arange(c.img.shape[1])[None, :] - (x - 300 + k * 900)) / 60, 0, 1)
            if k < .8: c.img += (sw[..., None] * .12) * np.ones_like(c.img[..., :1])
    def sounds(self): return [(self.tw, A.stamp(), .85, "seal"), (self.tw + .05, A.shimmer(1.4), .5, "shimmer")]


class LowerThird(FX):
    """TV name super: slides in on the word, optional quote card later."""
    stage = 70
    def apply(self, c):
        t = c.t
        a = float(ease_out(prog(t, self.tw, self.tw + .4))) * (1 - prog(t, self.t1 - .3, self.t1))
        if a > 0:
            n1 = text_rgba(self.name, 64, (255, 255, 255), "sans", 900)
            n2 = text_rgba(self.role, 40, (220, 240, 225), "sans", 500)
            w = max(n1.shape[1], n2.shape[1]) + 80
            bar = card(150, w, hexc(getattr(self, "bar_color", "#0E5A5A")), .92, 18)
            cv2.rectangle(bar, (w - 14, 0), (w, 150), tuple(float(v) for v in hexc(getattr(self, "accent", "#7AB83C"))) + (1,), -1)
            over_tl(bar, n1, w - 40 - n1.shape[1], 8); over_tl(bar, n2, w - 40 - n2.shape[1], 84)
            x, y = self.xy
            over(c.img, bar, x + (1 - a) * 600, y, a)
        if getattr(self, "quote", None) and t >= self.tq:
            q = float(back_out(prog(t, self.tq, self.tq + .35), 1.3)) * (1 - prog(t, self.t1 - .3, self.t1))
            qi = text_rgba(self.quote, 74, (255, 255, 255), "serif", 800)
            qa = text_rgba("— " + self.name, 40, (190, 230, 170), "sans", 600)
            w = qi.shape[1] + 90
            qc = card(qi.shape[0] + 110, w, (0, 0, 0), .5, 26, border=hexc(getattr(self, "accent", "#7AB83C")), bw=3)
            over(qc, qi, w / 2, qi.shape[0] / 2 + 18); over_tl(qc, qa, w - 45 - qa.shape[1], qi.shape[0] + 36)
            over(c.img, qc, self.qxy[0], self.qxy[1], min(1, q * 1.5), max(.01, q))
    def sounds(self):
        out = [(self.tw, A.whoosh(.35, 400, 3500), .45, "super in")]
        if getattr(self, "quote", None): out.append((self.tq, A.pop(), .5, "quote"))
        return out


class EndCard(FX):
    """Brand end card: product, logo, slogan, phone, site, disclaimer."""
    stage = 75
    def pre(self, c):
        if c.t >= self.tw + .3: c.cap_hide = True
    def _static(self):
        if hasattr(self, "_s"): return self._s
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((xx - W * .3) / W) ** 2 + ((yy - H * .5) / H) ** 2)
        g = np.clip(r * 1.5, 0, 1)[..., None]
        c0, c1 = getattr(self, "bg_colors", ("#1F7A72", "#06302F"))
        bg = hexc(c0) * (1 - g) + hexc(c1) * g
        prod = cv2.cvtColor(cv2.imread(self.product), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        pm = cv2.imread(self.product_mask, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
        logo = cv2.cvtColor(cv2.imread(self.logo, cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255
        self._s = (bg.astype(np.float32), prod, pm, logo)
        return self._s
    def apply(self, c):
        t = c.t; k = t - self.tw
        a = float(ease_io(prog(t, self.tw, self.tw + .6)))
        bg, prod, pm, logo = self._static()
        out = c.img * (1 - a) + bg * a
        # product (cut out with its matte) slides in from the left with a soft shadow
        s = .62; ph, pw = int(prod.shape[0] * s), int(prod.shape[1] * s)
        pr = cv2.resize(prod, (pw, ph), interpolation=cv2.INTER_AREA); m = cv2.resize(pm, (pw, ph))
        rgba = np.dstack([pr, m])
        px = int(W * .27 - (1 - float(ease_out(prog(t, self.tw + .1, self.tw + .8)))) * 500)
        sh = rgba.copy(); sh[..., :3] = 0; sh[..., 3] = cv2.GaussianBlur(m, (0, 0), 18) * .55
        over(out, sh, px + 25, H * .53 + 30, a); over(out, rgba, px, H * .52, a)
        # logo (white background knocked out) and texts on the right, staggered
        lg = logo.copy()
        if lg.shape[2] == 4 and lg[..., 3].min() > .99:
            lg[..., 3] = np.clip((.92 - lg[..., :3].min(2)) / .25, 0, 1)
        lg[..., :3] = np.where(lg[..., :3].mean(2, keepdims=True) < .5, 1.0, lg[..., :3])  # dark teal text -> white on teal
        sc = 520 / lg.shape[1]
        def item(img, x, y, t0):
            q = float(ease_out(prog(t, t0, t0 + .45)))
            over(out, img, x, y + (1 - q) * 40, q * a)
        item(cv2.resize(lg, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA), W * .72, H * .22, self.tw + .3)
        item(gold_fill(text_rgba(self.title, 96, (255, 255, 255), "serif", 900), "#FFFFFF", "#F3E3B0", "#D4AF37"), W * .72, H * .44, self.tw + .5)
        item(text_rgba(self.slogan, 56, (200, 235, 180), "sans", 700), W * .72, H * .56, self.tw + .7)
        item(text_rgba(self.phone, 70, (255, 255, 255), "sans", 900), W * .72, H * .69, self.tw + .9)
        item(text_rgba(self.site, 44, (220, 230, 230), "sans", 500), W * .72, H * .78, self.tw + 1.0)
        item(text_rgba(self.disclaimer, 28, (170, 195, 190), "sans", 400), W * .5, H * .95, self.tw + 1.1)
        c.img = out
    def sounds(self): return [(self.tw, A.whoosh(.6, 200, 2500), .5, "end card"), (self.tw + .5, A.shimmer(2.0), .45, "logo shimmer")]



class LightSweep(FX):
    """Specular light band that glides across the product (only on its matte) — the classic pack-shot shine."""
    stage = 10
    def apply(self, c):
        k = prog(c.t, self.tw, self.tw + getattr(self, "dur", .9))
        if k <= 0 or k >= 1: return
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        pos = -400 + (W + 800) * float(ease_io(k))
        band = np.exp(-((xx + yy * .45 - pos) / 70) ** 2)
        band = cv2.resize(band, (W, H))
        m = c.mask if getattr(self, "on_mask", True) else 1.0
        c.img = c.img + (band * m)[..., None] * getattr(self, "strength", .55)
    def sounds(self): return [(self.tw, A.zing(.7) * .6, .35, "shine")]


def stars(img, x, y, r, n=5, color=(1.0, .78, .2), gap=None):
    gap = gap or r * 2.4
    for i in range(n):
        cx = x - i * gap
        pts = []
        for j in range(10):
            a = -np.pi / 2 + j * np.pi / 5; rr = r if j % 2 == 0 else r * .45
            pts.append([cx + np.cos(a) * rr, y + np.sin(a) * rr])
        cv2.fillPoly(img, [np.array(pts, np.int32)], tuple(float(v) for v in color) + ((1.0,) if img.shape[2] == 4 else ()), cv2.LINE_AA)


class Testimonials(FX):
    """Real customer quotes as clean review cards that cascade in, 5 drawn stars each."""
    stage = 70
    def apply(self, c):
        for i, (txt, who) in enumerate(self.quotes):
            t0 = self.tw + i * getattr(self, "stagger", .45)
            q = float(back_out(prog(c.t, t0, t0 + .4), 1.2)) * (1 - prog(c.t, self.t1 - .3, self.t1))
            if q <= 0: continue
            ti = text_rgba(txt, 50, (25, 35, 55), "sans", 700)
            wi = text_rgba(who, 34, (90, 105, 125), "sans", 500)
            w = max(ti.shape[1], 520) + 80; h = ti.shape[0] + 150
            cd = card(h, w, (1, 1, 1), .97, 24)
            stars(cd, w - 50, 42, 17, color=hexc("#F2B705"))
            over_tl(cd, ti, w - 40 - ti.shape[1], 66); over_tl(cd, wi, w - 40 - wi.shape[1], h - 50)
            sh = cd.copy(); sh[..., :3] = 0; sh[..., 3] = cv2.GaussianBlur(cd[..., 3], (0, 0), 14) * .35
            x, y = self.slots[i]
            over(c.img, sh, x + 10, y + 16, min(1, q * 1.5), max(.01, q))
            over(c.img, cd, x, y + (1 - min(1, q)) * 60, min(1, q * 1.5), max(.01, q))
    def sounds(self): return [(self.tw + i * getattr(self, "stagger", .45), A.pop(), .45, "review") for i in range(len(self.quotes))]
