"""Time map: original (source) time <-> final (output) time.

Segments are played back to back. Cuts between non-contiguous source ranges get
a soft crossfade (video dissolve + audio equal-power fade, same length).
Freeze segments hold one source frame for `dur` seconds (silent).
Every effect is anchored to a source word time and mapped through src_to_out,
and the audio is cut with the very same segments, so everything stays in sync.
"""
import numpy as np


class TimeMap:
    def __init__(self, segments, xfade=0.12):
        self.xf = xfade
        self.segs, out = [], 0.0
        for s in segments:
            s = dict(s)
            d = s["dur"] if s.get("freeze") is not None else s["src1"] - s["src0"]
            s["out0"], s["out1"] = out, out + d
            out += d
            self.segs.append(s)
        self.duration = out
        # a boundary is soft if the source jumps (a cut), hard for freezes / contiguous
        for a, b in zip(self.segs, self.segs[1:]):
            jump = a.get("freeze") is None and b.get("freeze") is None and abs(a["src1"] - b["src0"]) > 1e-3
            a["soft_out"] = b["soft_in"] = jump

    # ---- construction -------------------------------------------------
    @classmethod
    def from_silences(cls, audio, sr, min_sil=0.30, pad=0.10, thresh_db=-40, lead_in=0.35,
                      tail=0.6, freezes=(), holds=(), xfade=0.12):
        hop = int(sr * 0.01)
        n = len(audio) // hop
        rms = np.sqrt(np.mean(audio[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
        db = 20 * np.log10(rms / (rms.max() + 1e-9))
        speech = db > thresh_db
        regions, i = [], 0
        while i < n:
            if speech[i]:
                j = i
                while j < n and speech[j]: j += 1
                regions.append([i * 0.01, j * 0.01]); i = j
            else:
                i += 1
        merged = []
        for r in regions:
            if merged and r[0] - merged[-1][1] < min_sil:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        total = len(audio) / sr
        keep = [[max(0, a - pad), min(total, b + pad)] for a, b in merged]
        keep[0][0] = max(0, keep[0][0] - lead_in)
        keep[-1][1] = min(total, keep[-1][1] + tail)
        # holds: keep `sec` of footage after src time (room for an effect to finish)
        for ht, sec in holds:
            for r in keep:
                if r[0] <= ht <= r[1] + 1e-3:
                    r[1] = min(total, max(r[1], ht + sec))
        keep.sort(); m2 = []
        for r in keep:
            if m2 and r[0] <= m2[-1][1]:
                m2[-1][1] = max(m2[-1][1], r[1])
            else:
                m2.append(r)
        keep = m2
        segs = []
        for a, b in keep:
            cuts = sorted(f for f in freezes if a < f[0] < b)
            cur = a
            for ft, fd in cuts:
                segs.append({"src0": cur, "src1": ft})
                segs.append({"freeze": ft, "dur": fd})
                cur = ft
            segs.append({"src0": cur, "src1": b})
        return cls(segs, xfade)

    # ---- queries --------------------------------------------------------
    def _seg_at(self, t):
        for i, s in enumerate(self.segs):
            if t < s["out1"]:
                return i, s
        return len(self.segs) - 1, self.segs[-1]

    @staticmethod
    def _src(s, t):
        if s.get("freeze") is not None:
            return s["freeze"]
        return s["src0"] + (t - s["out0"])

    def sample(self, t):
        """[(src_time, weight, is_frozen)] — 2 entries inside a crossfade."""
        t = float(np.clip(t, 0, self.duration - 1e-6))
        i, s = self._seg_at(t)
        h = self.xf / 2
        fz = s.get("freeze") is not None
        if s.get("soft_in") and t - s["out0"] < h:
            p = self.segs[i - 1]
            w = 0.5 + (t - s["out0"]) / self.xf
            return [(self._src(p, t), 1 - w, False), (self._src(s, t), w, fz)]
        if s.get("soft_out") and s["out1"] - t < h:
            nx = self.segs[i + 1]
            w = 0.5 + (s["out1"] - t) / self.xf
            return [(self._src(s, t), w, fz), (self._src(nx, t), 1 - w, False)]
        return [(self._src(s, t), 1.0, fz)]

    def src_to_out(self, ts):
        best, bd = 0.0, 1e9
        for s in self.segs:
            if s.get("freeze") is not None:
                continue
            if s["src0"] <= ts <= s["src1"]:
                return s["out0"] + ts - s["src0"]
            for edge, o in ((s["src0"], s["out0"]), (s["src1"], s["out1"])):
                if abs(edge - ts) < bd: best, bd = o, abs(edge - ts)
        return best

    def freeze_windows(self):
        return [(s["out0"], s["out1"]) for s in self.segs if s.get("freeze") is not None]

    # ---- audio ------------------------------------------------------------
    def apply_audio(self, audio, sr):
        out = np.zeros(int(self.duration * sr) + sr, np.float32)
        h = self.xf / 2
        for s in self.segs:
            if s.get("freeze") is not None:
                continue
            a0 = s["src0"] - (h if s.get("soft_in") else 0)
            a1 = s["src1"] + (h if s.get("soft_out") else 0)
            o0 = s["out0"] - (h if s.get("soft_in") else 0)
            i0, i1 = int(round(a0 * sr)), int(round(a1 * sr))
            chunk = np.zeros(i1 - i0, np.float32)
            lo, hi = max(i0, 0), min(i1, len(audio))
            chunk[lo - i0:hi - i0] = audio[lo:hi]
            n = int(self.xf * sr)
            ramp = np.sin(np.linspace(0, np.pi / 2, n)) ** 2  # equal-power-ish
            if s.get("soft_in"): chunk[:n] *= ramp
            if s.get("soft_out"): chunk[-n:] *= ramp[::-1]
            oi = int(round(o0 * sr))
            out[oi:oi + len(chunk)] += chunk[:len(out) - oi]
        return out[:int(self.duration * sr)]

    def table(self):
        rows = []
        for s in self.segs:
            if s.get("freeze") is not None:
                rows.append(f"FREEZE src {s['freeze']:.2f}s for {s['dur']:.2f}s -> out {s['out0']:.2f}-{s['out1']:.2f}")
            else:
                rows.append(f"PLAY   src {s['src0']:.2f}-{s['src1']:.2f} -> out {s['out0']:.2f}-{s['out1']:.2f}")
        return "\n".join(rows)
