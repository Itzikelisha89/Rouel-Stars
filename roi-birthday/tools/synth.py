# כלי סינתזה מקוריים (מועתקים מפרויקט mor-birthday). כל הצלילים נוצרים מאפס.
import numpy as np
from scipy import signal
SR = 48000
rng = np.random.default_rng(7)
def tt(d): return np.arange(int(d * SR)) / SR
def mf(m): return 440.0 * 2 ** ((m - 69) / 12)
def note(n):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    s = names[n[0]]; i = 1
    if n[1] in '#b': s += 1 if n[1] == '#' else -1; i = 2
    return 12 * (int(n[i:]) + 1) + s
def lp(x, fc, o=2): return signal.sosfilt(signal.butter(o, min(fc, SR / 2 - 100), 'low', fs=SR, output='sos'), x)
def hp(x, fc, o=2): return signal.sosfilt(signal.butter(o, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return signal.sosfilt(signal.butter(o, [lo, min(hi, SR / 2 - 100)], 'band', fs=SR, output='sos'), x)
def noise(d): return rng.standard_normal(int(d * SR))
def env_ar(n, a, r, total=None):
    e = np.ones(n); na = max(1, int(a * SR)); nr = max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)[:n]
    if nr < n: e[-nr:] *= np.linspace(1, 0, nr)
    return e
def expd(n, rate): return np.exp(-np.arange(n) / SR * rate)
def saw(f, d, ph=None):
    x = tt(d); ph = rng.random() if ph is None else ph
    return 2 * ((f * x + ph) % 1.0) - 1
def norm(x, g=1.0): return x / (np.max(np.abs(x)) + 1e-9) * g

def put(buf, sig, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= buf.shape[-1] or len(sig) == 0: return
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), buf.shape[-1] - i)
    L = np.cos((pan + 1) * np.pi / 4); R = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + n] += sig[:n] * g * L * 1.414
    buf[1, i:i + n] += sig[:n] * g * R * 1.414

# --- כלים מוזיקליים
def strings(notes, d, bright=2600, a=0.5, r=0.9):
    out = np.zeros(int(d * SR))
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * tt(d) + rng.random() * 6)
    for m in notes:
        f = mf(m)
        for det in (-9, -3, 4, 10):
            ph = np.cumsum(np.full(len(out), f * 2 ** (det / 1200)) * vib) / SR + rng.random()
            out += 2 * (ph % 1) - 1
    return lp(out, bright) * env_ar(len(out), a, r) / (len(notes) * 4)

def spicc(m, d=0.16, bright=2800):
    s = sum(saw(mf(m) * 2 ** (c / 1200), d) for c in (-7, 0, 7))
    n = len(s); e = np.minimum(1, np.arange(n) / (0.006 * SR)) * expd(n, 18)
    return lp(s * e, bright) / 3

def piano(m, d=2.4, vel=1.0):
    x = tt(d); f = mf(m); out = np.zeros(len(x)); B_ = 0.00035
    for k in range(1, 11):
        fk = f * k * np.sqrt(1 + B_ * k * k)
        if fk > 16000: break
        out += np.sin(2 * np.pi * fk * x + rng.random()) * (1 / k ** 1.25) * np.exp(-x * (0.9 + 0.55 * k) * (1 + (m - 60) / 60))
    out *= np.minimum(1, x / 0.004)
    out[:int(0.01 * SR)] += lp(noise(0.01), 3000) * 0.05
    return out * vel * 0.35

def brass(notes, d, a=0.08):
    out = np.zeros(int(d * SR)); x = tt(d)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * x) * np.minimum(1, x / 0.6)
    for m in notes:
        for det in (-6, 0, 6):
            ph = np.cumsum(np.full(len(out), mf(m) * 2 ** (det / 1200)) * vib) / SR + rng.random()
            out += 2 * (ph % 1) - 1
    dark, bri = lp(out, 600), lp(out, 3200)
    mix = np.clip(x / 0.35, 0, 1) * 0.8
    o = np.tanh((dark * (1 - mix) + bri * mix) * 1.4 / max(1, len(notes)))
    return o * env_ar(len(o), a, 0.5)

def braam(d=3.5, root=26):
    x = tt(d); out = np.zeros(len(x))
    for m in (root, root + 12, root + 19, root + 24):
        for det in (-12, 0, 12):
            out += saw(mf(m) * 2 ** (det / 1200), d)
    out = np.tanh(out * 0.6)
    dark, bri = lp(out, 180), lp(out, 1600)
    sw = np.clip(x / 0.25, 0, 1) * np.exp(-x * 0.9)
    o = dark * (1 - sw) + bri * sw
    o += np.sin(2 * np.pi * mf(root - 12) * x) * 1.2
    return norm(o * np.minimum(1, x / 0.02) * np.exp(-x * 0.75), 1)

def taiko(g=1.0, f0=95):
    d = 1.0; x = tt(d)
    f = f0 * 0.55 + f0 * 0.45 * np.exp(-x * 25)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 5.5)
    s += lp(noise(d), 900) * np.exp(-x * 30) * 0.6
    return s * g

def kick():
    x = tt(0.45); f = 48 + 110 * np.exp(-x * 35)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 9) + hp(noise(0.45), 3000) * np.exp(-x * 120) * 0.3)

def snare():
    x = tt(0.3)
    return bp(noise(0.3), 1200, 7000) * np.exp(-x * 18) * 0.9 + np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30) * 0.5

def hat(d=0.05): return hp(noise(d), 7000) * expd(int(d * SR), 70) * 0.5

def glock(m, d=1.6):
    x = tt(d); f = mf(m)
    return sum(np.sin(2 * np.pi * f * r * x) * a * np.exp(-x * dk) for r, a, dk in [(1, 1, 2.5), (2.76, .4, 6), (5.4, .2, 10)]) * 0.4

def sub_boom(d=3.5, f0=70):
    x = tt(d); f = 28 + f0 * np.exp(-x * 6)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 1.3)
    s += lp(noise(d), 500) * np.exp(-x * 2.2) * 0.8 + hp(noise(d), 2000) * np.exp(-x * 25) * 0.4
    return norm(s)

def riser(d, f1=150, f2=1400):
    x = tt(d); out = np.zeros(len(x)); blk = int(0.05 * SR)
    nz = noise(d)
    for i in range(0, len(x), blk):
        p = i / len(x); c = 400 + p ** 2 * 9000
        out[i:i + blk] = bp(nz[max(0, i - blk):i + blk], c * 0.6, c * 1.4)[-len(out[i:i + blk]):]
    gl = np.sin(2 * np.pi * np.cumsum(f1 * (f2 / f1) ** (x / d)) / SR) * 0.35
    return (out * 0.8 + gl) * (x / d) ** 2.2

def rev_cymbal(d=2.0):
    x = tt(d); return hp(noise(d), 5000) * (x / d) ** 3

def whoosh(d=0.8, lo=300, hi=3000, g=1):
    x = tt(d); return bp(noise(d), lo, hi) * np.sin(np.pi * x / d) ** 2 * g

def heartbeat():
    x = tt(0.16); th = np.sin(2 * np.pi * 52 * x) * np.exp(-x * 22) + lp(noise(0.16), 200) * np.exp(-x * 40) * 0.5
    out = np.zeros(int(0.5 * SR)); out[:len(th)] += th; out[int(0.24 * SR):int(0.24 * SR) + len(th)] += th * 0.75
    return out

def thunder():
    d = 6; x = tt(d); br = np.cumsum(noise(d)); br = hp(br - np.convolve(br, np.ones(4800) / 4800, 'same'), 25)
    crack = hp(noise(d), 1500) * np.exp(-x * 9)
    mod = lp(np.abs(noise(d)), 6) * 4
    return norm(lp(br, 400) * np.exp(-x * 0.7) * (0.6 + mod) + crack * 0.7)

def static(d=1.0):
    x = tt(d); gate = (lp(noise(d), 30) > -0.02).astype(float)
    return bp(noise(d), 900, 4500) * (0.4 + 0.6 * gate) * env_ar(len(x), 0.02, 0.2) + np.sin(2 * np.pi * 1450 * x) * (x < 0.12) * 0.3

def beep(f=1000, d=0.14): x = tt(d); return np.sin(2 * np.pi * f * x) * env_ar(len(x), 0.004, 0.04)

def blip(f1=1200, f2=2000, d=0.07):
    x = tt(d); return np.sin(2 * np.pi * np.cumsum(np.linspace(f1, f2, len(x))) / SR) * env_ar(len(x), 0.003, 0.03) * 0.5

def shatter():
    d = 2.5; out = np.zeros(int(d * SR))
    for _ in range(60):
        st = int(rng.random() ** 2 * 1.4 * SR); m = int(0.08 * SR)
        f = 2500 + rng.random() * 6000
        ping = np.sin(2 * np.pi * f * tt(0.08)) * expd(m, 40)
        out[st:st + m] += (ping + hp(noise(0.08), 4000) * expd(m, 60)) * (0.3 + rng.random() * 0.7)
    out[:int(0.4 * SR)] += hp(noise(0.4), 2500) * expd(int(0.4 * SR), 9) * 2
    return norm(out)

def heli(d=4.0):
    x = tt(d); rot = (0.5 + 0.5 * np.sin(2 * np.pi * 12 * x)) ** 4
    return lp(noise(d), 380) * rot * np.sin(np.pi * x / d) ** 1.5 * 2.5 + lp(noise(d), 1500) * np.sin(np.pi * x / d) ** 2 * 0.15

def firework(SFX, t0, g=1.0, pan=0.0):
    x = tt(0.9); wh = np.sin(2 * np.pi * np.cumsum(900 + 1300 * x / 0.9) / SR) * 0.15 * (x / 0.9)
    put(SFX, wh, t0, g * 0.6, pan)
    put(SFX, sub_boom(2.0, 50) * 0.7, t0 + 0.9, g, pan)
    cr = np.zeros(int(1.8 * SR))
    for _ in range(140):
        st = int(rng.random() * 1.6 * SR); m = 300
        cr[st:st + m] += hp(noise(m / SR), 3000) * expd(m, 300) * rng.random()
    put(SFX, cr * np.linspace(1, 0.2, len(cr)), t0 + 1.0, g * 0.5, -pan)

def typing(d=1.0):
    out = np.zeros(int(d * SR)); t = 0.0
    while t < d - 0.05:
        i = int(t * SR); m = 400
        out[i:i + m] += bp(noise(m / SR), 1500, 6000) * expd(m, 250); t += 0.07 + rng.random() * 0.09
    return out * 0.7

def ring():
    x = tt(0.9); tr = (np.sin(2 * np.pi * 20 * x) > 0).astype(float)
    tone = (np.sin(2 * np.pi * 1300 * x) + np.sin(2 * np.pi * 1600 * x)) * tr * env_ar(len(x), 0.01, 0.05)
    out = np.zeros(int(2.6 * SR)); out[:len(tone)] += tone; out[int(1.3 * SR):int(1.3 * SR) + len(tone)] += tone
    return bp(out, 600, 4000) * 0.35

def scratch():
    d = 0.5; x = tt(d); f = 500 + 900 * np.sin(2 * np.pi * 3.2 * x) ** 2
    return bp(noise(d) * np.sin(2 * np.pi * np.cumsum(f) / SR), 300, 4000) * env_ar(len(x), 0.01, 0.1) * 1.4

def wind(d):
    x = tt(d); m = 0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * x) * np.sin(2 * np.pi * 0.07 * x + 1)
    return bp(noise(d), 200, 900) * m * 0.5

