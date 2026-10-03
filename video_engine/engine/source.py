"""The 'original footage': source time -> (frame, person matte, shot info).

SlideshowSource builds footage from photos (Ken Burns per shot).
VideoSource reads a real video + its cached per-frame mattes.
"""
import cv2
import numpy as np
from .masks import photo_mask, video_masks
from .compose import blur_fast

W, H = 1080, 1920


def _cover(img, w, h, fx=0.5, fy=0.5):
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih)
    nw, nh = int(np.ceil(iw * s)), int(np.ceil(ih * s))
    r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    x0 = int(np.clip(fx * nw - w / 2, 0, nw - w)); y0 = int(np.clip(fy * nh - h / 2, 0, nh - h))
    return r[y0:y0 + h, x0:x0 + w]


def _fit(img, w, h, y_center=0.5):
    ih, iw = img.shape[:2]
    s = min(w / iw, h / ih)
    nw, nh = int(iw * s), int(ih * s)
    r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((h, w) + img.shape[2:], img.dtype)
    y0 = int(h * y_center - nh / 2); x0 = (w - nw) // 2
    canvas[y0:y0 + nh, x0:x0 + nw] = r
    return canvas, (x0, y0, nw, nh)


class SlideshowSource:
    OVERSCAN = 1.12

    def __init__(self, shots, cache_dir):
        """shots: [{'photo', 'src0', 'src1', 'mode'('cover'|'fit'), 'zoom':(a,b), 'pan':(dx,dy), 'focus':(fx,fy)}]"""
        self.shots = shots
        self.cache_dir = cache_dir
        self._base = {}

    def _prep(self, path, mode, focus):
        key = (path, mode, focus)
        if key in self._base:
            return self._base[key]
        bw, bh = int(W * self.OVERSCAN), int(H * self.OVERSCAN)
        img = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        m = photo_mask(path, self.cache_dir)
        if mode == "fit":
            bg = blur_fast(_cover(img, bw, bh), 40) * 0.45
            fg, (x0, y0, nw, nh) = _fit(img, bw, bh, 0.5)
            mf, _ = _fit(m, bw, bh, 0.5)
            inside = np.zeros((bh, bw), np.float32); inside[y0:y0 + nh, x0:x0 + nw] = 1
            base = bg * (1 - inside[..., None]) + fg * inside[..., None]
            mm = mf
        else:
            base = _cover(img, bw, bh, *focus)
            mm = _cover(m, bw, bh, *focus)
        # clean plate (background without the person) via low-res inpainting
        f = 4
        sm = cv2.resize(base, (bw // f, bh // f), interpolation=cv2.INTER_AREA)
        md = cv2.dilate((cv2.resize(mm, (bw // f, bh // f)) > 0.15).astype(np.uint8), np.ones((9, 9), np.uint8))
        inp = cv2.inpaint((sm * 255).astype(np.uint8), md, 12, cv2.INPAINT_TELEA).astype(np.float32) / 255
        inp = cv2.GaussianBlur(inp, (0, 0), 3)
        mdl = cv2.GaussianBlur(cv2.resize(md.astype(np.float32), (bw, bh)), (0, 0), 6)[..., None]
        plate = base * (1 - mdl) + cv2.resize(inp, (bw, bh)) * mdl
        self._base[key] = (base, mm, plate)
        return self._base[key]

    def shot_at(self, t):
        for s in self.shots:
            if t < s["src1"]:
                return s
        return self.shots[-1]

    def frame(self, t):
        s = self.shot_at(t)
        base, mm, plate = self._prep(s["photo"], s.get("mode", "cover"), tuple(s.get("focus", (0.5, 0.5))))
        p = np.clip((t - s["src0"]) / max(s["src1"] - s["src0"], 1e-3), 0, 1)
        z0, z1 = s.get("zoom", (1.0, 1.07))
        z = (z0 + (z1 - z0) * p) / self.OVERSCAN
        dx, dy = s.get("pan", (0, 0))
        bh, bw = base.shape[:2]
        M = np.float32([[z, 0, W / 2 - z * bw / 2 + dx * p], [0, z, H / 2 - z * bh / 2 + dy * p]])
        img = cv2.warpAffine(base, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        mask = cv2.warpAffine(mm, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        plate_fn = lambda: cv2.warpAffine(plate, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        return img, mask, s, p, plate_fn


class VideoSource:
    def __init__(self, video_path, mask_npz):
        cap = cv2.VideoCapture(video_path)
        self.fps = cap.get(cv2.CAP_PROP_FPS) or 30
        self.frames = []
        while True:
            ok, fr = cap.read()
            if not ok: break
            self.frames.append(cv2.resize(fr, (W, H)))
        self.masks = video_masks(video_path, mask_npz)

    def frame(self, t):
        i = int(np.clip(round(t * self.fps), 0, len(self.frames) - 1))
        img = cv2.cvtColor(self.frames[i], cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        m = cv2.resize(self.masks[i], (W, H)).astype(np.float32) / 255
        return img, m, {"photo": None, "src0": 0, "src1": len(self.frames) / self.fps}, t, (lambda: img)
