"""Sound: synthesized SFX library, cinematic music bed, mixing, loudness normalization."""
import subprocess
import numpy as np
from scipy import signal

SR = 48000
_rng = np.random.RandomState(7)


def _t(d): return np.arange(int(d * SR)) / SR
def _env(n, a=0.005, r=None, curve=4.0):
    e = np.ones(n, np.float32); na = max(1, int(a * SR)); e[:na] = np.linspace(0, 1, na)
    if r is None:
        e[na:] = np.exp(-curve * np.linspace(0, 1, n - na))
    return e
def _bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos"); return signal.sosfilt(sos, x)
def _lp(x, f, order=2):
    sos = signal.butter(order, f, "lowpass", fs=SR, output="sos"); return signal.sosfilt(sos, x)
def _hp(x, f, order=2):
    sos = signal.butter(order, f, "highpass", fs=SR, output="sos"); return signal.sosfilt(sos, x)
def _norm(x, peak=0.9): return (x / (np.abs(x).max() + 1e-9) * peak).astype(np.float32)
def _noise(d): return _rng.randn(int(d * SR)).astype(np.float32)
def _sweep(f0, f1, d, kind="exp"):
    t = _t(d)
    f = f0 * (f1 / f0) ** (t / d) if kind == "exp" else f0 + (f1 - f0) * t / d
    return np.sin(2 * np.pi * np.cumsum(f) / SR).astype(np.float32)


def whoosh(d=0.5, lo=300, hi=3000, rise=0.6):
    n = _noise(d); t = _t(d)
    # moving bandpass via crossfade of two bands
    a = _bp(n, lo, lo * 3); b = _bp(n, hi / 3, hi)
    k = np.clip(t / d, 0, 1)
    x = a * (1 - k) + b * k
    env = np.sin(np.pi * np.clip(t / d, 0, 1) ** (rise)) ** 2
    return _norm(x * env, 0.7)


def boom(d=1.6, f0=110, f1=32, sub=1.0):
    t = _t(d)
    body = _sweep(f0, f1, d) * np.exp(-t * 2.6) * sub
    click = _lp(_noise(d), 2500) * np.exp(-t * 40) * 0.6
    rumble = _lp(_noise(d), 160) * np.exp(-t * 2.0) * 0.8
    return _norm(body + click + rumble, 0.95)


def impact(d=0.9):
    t = _t(d)
    return _norm(_sweep(90, 40, d) * np.exp(-t * 6) + _bp(_noise(d), 200, 4000) * np.exp(-t * 25) * .7, 0.9)


def thud(d=0.7, f=70):
    t = _t(d)
    return _norm(np.sin(2 * np.pi * f * t * (1 - .3 * t)) * np.exp(-t * 7) + _lp(_noise(d), 300) * np.exp(-t * 12) * .8, 0.9)


def riser(d=1.0):
    t = _t(d); n = _hp(_noise(d), 1500)
    return _norm(n * (t / d) ** 2.5 + _sweep(200, 1600, d) * (t / d) ** 3 * .4, 0.6)


def zing(d=0.6):
    t = _t(d)
    return _norm((np.sin(2 * np.pi * 2400 * t) + .5 * np.sin(2 * np.pi * 3600 * t)) * np.exp(-t * 7), 0.4)


def shatter(d=1.4):
    out = np.zeros(int(d * SR), np.float32)
    out[:int(.3 * SR)] += _bp(_noise(.3), 1500, 9000) * np.exp(-_t(.3) * 12)
    for _ in range(70):
        st = int(_rng.rand() ** 1.6 * (d - .2) * SR); ln = int(_rng.uniform(.02, .12) * SR)
        f = _rng.uniform(2500, 7500); tt = np.arange(ln) / SR
        ping = np.sin(2 * np.pi * f * tt) * np.exp(-tt * _rng.uniform(25, 60))
        out[st:st + ln] += ping[:len(out) - st] * _rng.uniform(.2, .6)
    return _norm(out + impact(d) * .5, 0.9)


def glitch(d=0.6):
    t = _t(d); sq = np.sign(np.sin(2 * np.pi * (300 + 900 * (np.floor(t * 30) % 5)) * t))
    crush = np.round(_noise(d) * 3) / 3
    return _norm((sq * .5 + crush * .3) * (np.floor(t * 20) % 2), 0.45)


def blip(f=1200, d=0.12):
    t = _t(d); return _norm(np.sign(np.sin(2 * np.pi * f * t)) * np.exp(-t * 30), 0.35)


def click(d=0.05, f=3000):
    t = _t(d); return _norm(_bp(_noise(d), f * .6, min(f * 1.6, 20000)) * np.exp(-t * 120), 0.5)


def key_tap(): return click(0.04, 2200) * 0.8 + click(0.04, 5000) * 0.3


def ding(d=1.2):
    t = _t(d)
    x = (np.sin(2 * np.pi * 1318.5 * t) * np.exp(-t * 4) +
         np.sin(2 * np.pi * 1760 * t) * np.exp(-np.clip(t - .12, 0, None) * 4) * (t > .12))
    return _norm(x, 0.5)


def pop(d=0.15):
    t = _t(d); return _norm(_sweep(900, 200, d) * np.exp(-t * 25), 0.5)


def stamp(d=0.5):
    t = _t(d)
    return _norm(thud(d, 90) + _bp(_noise(d), 500, 3000) * np.exp(-t * 35) * 1.2, 0.95)


def scratch(d=0.35):
    t = _t(d); n = _bp(_noise(d), 1500, 6000) * (0.6 + .4 * np.sin(2 * np.pi * 18 * t))
    return _norm(n * np.sin(np.pi * t / d), 0.5)


def fall(d=0.8):
    return _norm(_sweep(1400, 250, d) * np.linspace(1, 0, int(d * SR)), 0.3)


def ticks(d=1.0, rate=18):
    out = np.zeros(int(d * SR), np.float32)
    for k in range(int(d * rate)):
        c = click(0.03, 4000); i = int(k / rate * SR); out[i:i + len(c)] += c[:len(out) - i]
    return out


def stopwatch_ticks(d=1.5, rate=2):
    out = np.zeros(int(d * SR), np.float32)
    for k in range(int(d * rate) + 1):
        c = _norm(click(0.06, 1800) + click(0.06, 6000) * .4, .5); i = int(k / rate * SR)
        out[i:i + len(c)] += c[:max(0, len(out) - i)]
    return out


def time_stop(d=1.2):
    t = _t(d)
    x = _sweep(400, 40, d) * np.exp(-t * 2.5) + _lp(_noise(d), 600) * np.exp(-t * 5) * .4
    return _norm(x, 0.8)


def hum(d=1.5):
    t = _t(d)
    x = sum(np.sin(2 * np.pi * 60 * k * t) / k for k in range(1, 8)) * (0.7 + 0.3 * np.sin(2 * np.pi * 7 * t))
    x += _hp(_noise(d), 5000) * 0.15 * (np.sin(2 * np.pi * 3 * t) > .6)
    env = np.minimum(1, np.minimum(t / .15, (d - t) / .3))
    return _norm(x * env, 0.35)


def shimmer(d=1.5):
    t = _t(d); x = sum(np.sin(2 * np.pi * f * t) for f in (1568, 2093, 2637, 3136)) * np.exp(-t * 2.2)
    return _norm(x * (1 + .3 * np.sin(2 * np.pi * 9 * t)), 0.35)


def confetti_pop(d=1.2):
    return _norm(pop(.2) * 1.0 if False else np.concatenate([pop(.15), np.zeros(int((d - .15) * SR), np.float32)]) + shimmer(d) * .7, 0.6)


def tape_rewind(d=1.6):
    t = _t(d)
    f = 300 + 2600 * np.clip(t / (d * .3), 0, 1) ** .5
    whir = np.sin(2 * np.pi * np.cumsum(f * (1 + .03 * np.sin(2 * np.pi * 11 * t))) / SR) * .25
    hiss = _bp(_noise(d), 2000, 9000) * .3
    return _norm((whir + hiss) * np.minimum(1, np.minimum(t / .05, (d - t) / .05)), 0.6)


def tape_stop(d=0.35):
    t = _t(d); return _norm(thud(d, 120) * .6 + click(d, 1500) * 1.0, 0.7)


def digital_dive(d=0.45):
    t = _t(d)
    return _norm(whoosh(d, 400, 6000, 1.5) + _sweep(300, 2400, d) * np.sin(np.pi * t / d) * .25, 0.6)


# ------------------------------------------------------------------ music
def music_bed(duration, bpm=84, seed=3):
    """Quiet cinematic pad: Am-F-C-G with detuned saws, sub pulse, soft hats."""
    rs = np.random.RandomState(seed)
    n = int(duration * SR); t = np.arange(n) / SR
    beat = 60 / bpm; bar = beat * 4
    chords = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]]  # Am F C G (midi)
    out = np.zeros(n, np.float32)
    mf = lambda m: 440 * 2 ** ((m - 69) / 12)
    for bi in range(int(duration / bar) + 1):
        ch = chords[bi % 4]; s0 = int(bi * bar * SR); s1 = min(n, int((bi + 1) * bar * SR + .5 * SR))
        if s0 >= n: break
        tt = np.arange(s1 - s0) / SR
        env = np.minimum(1, tt / .8) * np.minimum(1, np.clip((s1 - s0) / SR - tt, 0, None) / .8)
        for m in ch + [ch[0] - 12]:
            for det in (-0.07, 0.07):
                f = mf(m + det)
                out[s0:s1] += (signal.sawtooth(2 * np.pi * f * tt + rs.rand() * 6) * env * .05).astype(np.float32)
    out = _lp(out, 1400).astype(np.float32)
    # sub pulse on beats
    for k in range(int(duration / beat)):
        i = int(k * beat * SR); tt = np.arange(int(.5 * SR)) / SR
        kick = np.sin(2 * np.pi * 52 * tt * (1 - .4 * tt)) * np.exp(-tt * 9) * (.35 if k % 2 == 0 else .18)
        out[i:i + len(kick)] += kick[:max(0, n - i)]
        if k % 2 == 1:
            hh = _hp(_noise(.08), 7000) * np.exp(-np.arange(int(.08 * SR)) / SR * 50) * .05
            j = i; out[j:j + len(hh)] += hh[:max(0, n - j)]
    return _norm(out, 0.8)


# ------------------------------------------------------------------ mixing
class Mixer:
    def __init__(self, duration):
        self.n = int(duration * SR) + SR
        self.bus = {"voice": np.zeros(self.n, np.float32), "sfx": np.zeros(self.n, np.float32),
                    "music": np.zeros(self.n, np.float32)}
        self.log = []

    def add(self, clip, t, gain=1.0, bus="sfx", name=""):
        i = int(round(t * SR))
        if i < 0: clip = clip[-i:]; i = 0
        if i >= self.n: return
        m = min(len(clip), self.n - i)
        self.bus[bus][i:i + m] += clip[:m] * gain
        if name: self.log.append((t, name))

    def music_env(self, kills, base_db=-21, duck_db=-5, fade=0.12, start=0.0):
        """kills: [(t0, t1)] windows where the music disappears."""
        e = np.full(self.n, 10 ** (base_db / 20), np.float32)
        e[:int(start * SR)] = 0
        ramp_in = int(.6 * SR); si = int(start * SR)
        e[si:si + ramp_in] *= np.linspace(0, 1, ramp_in)[:len(e[si:si + ramp_in])]
        for a, b in kills:
            ia, ib, f = int(a * SR), int(b * SR), int(fade * SR)
            e[max(0, ia - f):ia] *= np.linspace(1, 0, ia - max(0, ia - f))
            e[ia:ib] = 0
            e[ib:ib + 4 * f] *= np.linspace(0, 1, len(e[ib:ib + 4 * f]))
        # duck under voice (sidechain from voice envelope)
        v = np.abs(self.bus["voice"]); w = int(.05 * SR)
        venv = np.convolve(v, np.ones(w) / w, "same")
        duck = 1 - (1 - 10 ** (duck_db / 20)) * np.clip(venv / (venv.max() * .25 + 1e-9), 0, 1)
        self.bus["music"] *= e * duck

    def mixdown(self):
        x = self.bus["voice"] * 1.0 + self.bus["sfx"] * 0.55 + self.bus["music"]
        return np.tanh(x * 0.9) / np.tanh(0.9)  # soft limiter


def write_wav(path, x, sr=SR):
    from scipy.io import wavfile
    wavfile.write(path, sr, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def loudnorm(inp, out, I=-14.0, TP=-1.0, LRA=11.0):
    """Two-pass EBU R128 normalization to social-media loudness (-14 LUFS)."""
    import json
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", inp, "-af",
                        f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    j = json.loads(r[r.rfind("{"):r.rfind("}") + 1])
    af = (f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
          f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", inp, "-af", af, "-ar", str(SR), out], check=True)
    return j
