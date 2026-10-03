"""The edit: source + time map + words + effect stack -> frame(t)."""
import numpy as np
from .look import grade, raw_gray, finish, caption_groups, draw_captions
from .compose import shake_offset, translate, scale_about

from .config import W, H


class Ctx:
    def __init__(self, t, img, mask, src_t, shot, p, plate_fn, frozen):
        self.t, self.img, self.mask, self.src_t, self.shot, self.p = t, img, mask, src_t, shot, p
        self._plate_fn, self._plate = plate_fn, None
        self.frozen = frozen
        self.raw = False; self.grade = 1.0; self.cap_hide = False; self.cap_y = int(H * 0.77)
        self.cap_alpha = 1.0; self.shake = 0.0; self.flash = 0.0; self.flash_color = (1, 1, 1)
        self.zoom = 1.0; self.blackout = 0.0

    def plate(self):
        if self._plate is None:
            self._plate = self._plate_fn()
        return self._plate


class FX:
    stage = 50
    def __init__(self, t0, t1, **kw):
        self.t0, self.t1 = t0, t1
        self.__dict__.update(kw)
    def pre(self, c): pass               # runs first: layout hints (caption position etc.)
    def apply(self, c): pass
    def sounds(self): return []          # [(t_out, clip, gain, name)]
    def music_kills(self): return []     # [(t0, t1)]


class Edit:
    def __init__(self, source, timemap, words, fps=30):
        self.src, self.tm, self.fps = source, timemap, fps
        self.words = [dict(w) for w in words]
        for w in self.words:
            w["t"] = timemap.src_to_out(w["start"]); w["t_end"] = timemap.src_to_out(w["end"])
        self.groups = caption_groups(self.words)
        self.fx = []
        self.captions = True
        self.rewind = None  # (t_start, dur)
        self.duration = timemap.duration
        self.music_start = 0.0

    # word lookup in output time
    def word(self, text, n=1):
        k = 0
        for w in self.words:
            if w["word"].strip(",.?!:") == text:
                k += 1
                if k == n:
                    return w
        raise KeyError(f"word {text!r} #{n} not found")

    def ws(self, k, text, n=1):
        """word `text` (n-th occurrence) inside sentence k"""
        m = [w for w in self.words if w["sentence"] == k and w["word"] == text]
        if len(m) < n:
            raise KeyError(f"word {text!r} #{n} not in sentence {k}")
        return m[n - 1]

    def add(self, fx):
        self.fx.append(fx); return fx

    def frame(self, t):
        if self.rewind and t >= self.rewind[0]:
            from .fx import rewind_frame
            return rewind_frame(self, t)
        return self._frame(t)

    def _frame(self, t):
        samples = self.tm.sample(t)
        img = mask = None; best = None
        for src_t, w, fz in samples:
            fi, fm, shot, p, plate_fn = self.src.frame(src_t)
            img = fi * w if img is None else img + fi * w
            mask = fm * w if mask is None else mask + fm * w
            if best is None or w > best[0]:
                best = (w, src_t, shot, p, plate_fn, fz)
        _, src_t, shot, p, plate_fn, fz = best
        c = Ctx(t, img, mask, src_t, shot, p, plate_fn, fz)
        active = sorted((f for f in self.fx if f.t0 <= t < f.t1), key=lambda f: f.stage)
        stages = [f for f in active]
        for f in stages: f.pre(c)
        i = 0
        def run_until(stage):
            nonlocal i
            while i < len(stages) and stages[i].stage < stage:
                stages[i].apply(c); i += 1
        run_until(20)
        c.img = raw_gray(c.img) if c.raw else grade(c.img, c.grade)
        run_until(55)
        if c.shake > 0.5:
            dx, dy = shake_offset(t, c.shake, seed=int(t * 7))
            c.img = scale_about(c.img, 1 + c.shake / 900, dx=dx, dy=dy, border=1)
        run_until(60)
        if self.captions and not c.cap_hide and not c.raw:
            draw_captions(c.img, t, self.groups, y=c.cap_y, alpha=c.cap_alpha)
        run_until(85)
        if c.flash > 0:
            c.img = c.img + (np.array(c.flash_color, np.float32) - c.img) * min(1, c.flash)
        if c.blackout > 0:
            c.img = c.img * (1 - min(1, c.blackout))
        run_until(1000)
        return finish(c.img, int(t * self.fps), grain=0.0 if c.raw else 0.022, vignette=not c.raw)

    def sounds(self):
        out = []
        for f in self.fx: out += f.sounds()
        return out

    def music_kills(self):
        out = []
        for f in self.fx: out += f.music_kills()
        return out
