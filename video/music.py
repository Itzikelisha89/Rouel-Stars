"""Synthesizes a 60s orchestral-ish 'Happy Birthday' arrangement + SFX -> music.wav"""
import numpy as np, wave, sys

SR = 44100
DUR = 60.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

BPM = 108.0
BEAT = 60.0 / BPM
T_V1 = 5.5
VLEN = 25 * BEAT          # 13.89 s per verse
T_V2 = T_V1 + VLEN        # 19.39
T_BR = T_V2 + VLEN        # 33.28
T_V3 = T_BR + 20 * BEAT   # 44.39  (bridge = 20 beats)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

def add(sig, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR)
    if i >= N: return
    sig = sig[:N - i] * gain
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * l * 1.414
    R[i:i + len(sig)] += sig * r * 1.414

def env_adsr(n, a, d, s, rel, hold):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    e = np.where(t > hold, e * np.exp(-(t - hold) / max(rel, 1e-4)), e)
    return e

def piano(m, dur, vel=1.0):
    n = int((dur + 1.6) * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.zeros(n)
    for k, a in enumerate([1, .55, .3, .18, .1, .06, .04], 1):
        fk = f * k * (1 + 0.0004 * k * k)
        s += a * np.sin(2 * np.pi * fk * t) * np.exp(-t * (1.2 + 0.9 * k))
    s *= np.minimum(1, t / 0.004)
    s *= np.where(t > dur, np.exp(-(t - dur) / 0.25), 1)
    return s * 0.28 * vel

def bell(m, vel=1.0):
    n = int(3.0 * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.zeros(n)
    for r, a, dcy in [(1, 1, 1.6), (2.76, .45, 3.5), (5.4, .25, 6), (8.93, .12, 9), (2.0, .3, 2.5)]:
        s += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * dcy)
    s *= np.minimum(1, t / 0.002)
    return s * 0.18 * vel

def pad(ms, dur, vel=1.0, att=0.6):
    n = int((dur + 1.5) * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m in ms:
        f = hz(m)
        for det in (-0.12, 0.0, 0.11):
            ff = f * 2 ** (det / 12)
            ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, 9):
                s += (1 / k) * np.sin(2 * np.pi * ff * k * t + ph * k) * (0.92 ** (k * k / 4))
    e = np.minimum(1, t / att) * np.where(t > dur, np.exp(-(t - dur) / 0.5), 1)
    vib = 1 + 0.03 * np.sin(2 * np.pi * 5 * t)
    return s * e * vib * 0.022 * vel / max(1, len(ms) ** 0.5)

def brass(m, dur, vel=1.0):
    n = int((dur + 0.6) * SR); t = np.arange(n) / SR; f = hz(m); s = np.zeros(n)
    bright = np.minimum(1, t / 0.08)
    for k in range(1, 12):
        s += (1 / k) * np.sin(2 * np.pi * f * k * t) * (bright ** (k * 0.4)) * (0.85 ** k)
    e = env_adsr(n, 0.03, 0.3, 0.75, 0.15, dur)
    return s * e * 0.10 * vel

def bass(m, dur, vel=1.0):
    n = int((dur + 0.5) * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.1 * np.sin(6 * np.pi * f * t)
    return s * env_adsr(n, 0.01, 0.5, 0.6, 0.12, dur) * 0.22 * vel

def kick(vel=1.0):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * 0.55 * vel

def snare(vel=1.0):
    n = int(0.3 * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n); nz = nz - np.convolve(nz, np.ones(6) / 6, 'same')
    return (nz * np.exp(-t * 16) * 0.35 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.25) * vel

def hat(vel=1.0):
    n = int(0.08 * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n); nz = nz - np.convolve(nz, np.ones(3) / 3, 'same')
    return nz * np.exp(-t * 60) * 0.12 * vel

def cymbal(vel=1.0):
    n = int(3.5 * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n); nz = nz - np.convolve(nz, np.ones(4) / 4, 'same')
    return nz * np.exp(-t * 1.3) * 0.16 * vel

def riser(dur, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    out = np.zeros(n); y = 0.0
    a = 0.02 + 0.5 * (t / dur) ** 2           # opening low-pass
    for i in range(n):                         # simple one-pole sweep
        y += a[i] * (nz[i] - y); out[i] = y
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / dur) ** 2) / SR) * 0.15
    return (out * 1.4 + sweep) * (t / dur) ** 2 * 0.35 * vel

def whoosh(dur=0.9, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.standard_normal(n); y = 0.0; out = np.zeros(n)
    a = 0.05 + 0.3 * np.sin(np.pi * t / dur)
    for i in range(n):
        y += a[i] * (nz[i] - y); out[i] = y
    return out * np.sin(np.pi * t / dur) ** 2 * 0.35 * vel

def sparkle_sfx(t0, base=84, count=7, vel=0.6):
    for i in range(count):
        add(bell(base + [0, 4, 7, 12, 16, 19, 24, 28][i % 8], vel * (1 - i * 0.07)), t0 + i * 0.055, pan=-0.6 + 1.2 * i / count)

# ---------- melody (in semitones relative to key root, F=65) ----------
# (offset_beat, dur_beats, degree)
MEL = [(0, .75, -5), (.75, .25, -5),
       (1, 1, -3), (2, 1, -5), (3, 1, 0), (4, 2, -1),
       (6, .75, -5), (6.75, .25, -5),
       (7, 1, -3), (8, 1, -5), (9, 1, 2), (10, 2, 0),
       (12, .75, -5), (12.75, .25, -5),
       (13, 1, 7), (14, 1, 4), (15, 1, 0), (16, 1, -1), (17, 1, -3),
       (18, .75, 5), (18.75, .25, 5),
       (19, 1, 4), (20, 1, 0), (21, 1, 2), (22, 3, 0)]
# chords per bar (bar starts at beat 1 + 3k), roots relative to key
CH = [(1, [0, 4, 7]), (4, [-5, -1, 2]), (7, [-5, -1, 2]), (10, [0, 4, 7]),
      (13, [5, 9, 12]), (16, [-2, 2, 5]), (19, [0, 4, 7]), (19 + 1.5, [-5, -1, 2]), (22, [0, 4, 7])]

def verse(t0, key, style):
    b = BEAT
    for (ob, db, deg) in MEL:
        m = key + 12 + deg if style != 'grand' else key + 12 + deg
        if style == 'box':
            add(bell(m + 12, 0.9), t0 + ob * b, pan=0.15)
            add(piano(m, db * b, 0.55), t0 + ob * b, pan=-0.1)
        elif style == 'warm':
            add(piano(m, db * b, 1.0), t0 + ob * b, pan=0.05)
            add(pad([m], db * b, 0.9, att=0.08), t0 + ob * b, pan=-0.2)
        else:
            add(brass(m, db * b * 0.95, 1.0), t0 + ob * b, pan=-0.15)
            add(brass(m - 12, db * b * 0.95, 0.6), t0 + ob * b, pan=0.2)
            add(piano(m + 12, db * b, 0.5), t0 + ob * b, pan=0.3)
            add(bell(m + 24, 0.35), t0 + ob * b, pan=0.5)
    for i, (cb, notes) in enumerate(CH):
        nb = CH[i + 1][0] if i + 1 < len(CH) else 25.5
        d = (nb - cb) * b
        ns = [key + x for x in notes]
        root = key + notes[0] - 24
        if style == 'box':
            add(pad(ns, d, 0.7, att=0.4), t0 + cb * b, pan=0)
            add(bass(root + 12, d * 0.9, 0.35), t0 + cb * b)
        elif style == 'warm':
            add(pad(ns, d, 1.1, att=0.25), t0 + cb * b)
            add(bass(root, d * 0.9, 0.8), t0 + cb * b)
            for k in range(int(round(nb - cb))):
                for j, x in enumerate(ns):
                    add(piano(x - 12, 0.3, 0.25), t0 + (cb + k + j * 0.33) * b, pan=-0.4 + 0.4 * j)
        else:
            add(pad(ns + [n + 12 for n in ns], d, 1.5, att=0.15), t0 + cb * b)
            add(bass(root, d * 0.9, 1.1), t0 + cb * b)
    if style in ('warm', 'grand'):
        for k in range(25):
            tb = t0 + (1 + k) * b
            if 1 + k >= 25: break
            beat_in_bar = k % 3
            if style == 'grand':
                if beat_in_bar == 0: add(kick(1.0), tb)
                else: add(snare(0.55 if beat_in_bar == 1 else 0.4), tb, pan=0.1)
                add(hat(0.8), tb + b / 2, pan=0.4); add(hat(0.6), tb, pan=0.4)
            else:
                if beat_in_bar == 0: add(kick(0.55), tb)
                add(hat(0.5), tb + b / 2, pan=0.35)

F = 53  # F3 as key root reference (melody +12 -> F4)

# ---------- intro 0..5.5 ----------
add(pad([F, F + 7, F + 12, F + 16], 5.0, 1.0, att=2.5), 0.0)
add(pad([F - 12], 5.0, 0.8, att=2.0), 0.0)
for i, m in enumerate([F + 12, F + 16, F + 19, F + 24, F + 28, F + 31, F + 36, F + 31, F + 28, F + 24]):
    add(bell(m + 12, 0.55), 0.6 + i * 0.27, pan=-0.7 + 0.14 * i)
add(riser(2.2, 0.8), 3.3)
sparkle_sfx(3.2, 88, 8, 0.5)
add(cymbal(0.9), T_V1); add(kick(1.0), T_V1)

# ---------- verses ----------
verse(T_V1, F, 'box')
add(whoosh(1.0, 0.8), T_V2 - 0.8); add(cymbal(0.7), T_V2)
verse(T_V2, F, 'warm')

# ---------- bridge 20 beats: F Dm Bb C (x) with arps, build ----------
prog = [(F, [0, 4, 7]), (F - 3, [0, 3, 7]), (F - 7, [0, 4, 7]), (F - 5, [0, 4, 7]), (F - 5, [0, 4, 7])]
for i, (r, q) in enumerate(prog):
    tb = T_BR + i * 4 * BEAT
    ns = [r + x + 12 for x in q]
    add(pad(ns, 4 * BEAT, 1.2, att=0.3), tb)
    add(bass(r - 12, 4 * BEAT * 0.95, 0.9), tb)
    for k in range(8):
        n = (ns + [ns[0] + 12])[[0, 1, 2, 3, 2, 1, 2, 3][k]]
        add(piano(n + 12, 0.25, 0.45), tb + k * BEAT / 2, pan=-0.5 + 0.12 * k)
        add(bell(n + 24, 0.18), tb + k * BEAT / 2, pan=0.5)
    add(kick(0.5), tb); add(kick(0.4), tb + 2 * BEAT)
    for k in range(4): add(hat(0.45), tb + k * BEAT + BEAT / 2, pan=0.4)
add(whoosh(0.9, 0.6), T_BR + 5.6 - 0.45)
add(riser(3.4, 1.1), T_V3 - 3.4)
for k in range(8): add(snare(0.25 + 0.08 * k), T_V3 - 2 * BEAT + k * BEAT / 4)

# ---------- verse 3 grand, up a whole step ----------
add(cymbal(1.1), T_V3); add(kick(1.1), T_V3)
sparkle_sfx(T_V3, 91, 8, 0.7)
verse(T_V3, F + 2, 'grand')
T_END = T_V3 + 25 * BEAT
G = F + 2
add(pad([G, G + 4, G + 7, G + 12, G + 16], 60 - T_END, 1.6, att=0.05), T_END - 0.6)
add(cymbal(1.0), T_END - 0.6)
sparkle_sfx(T_END - 0.3, 93, 8, 0.6)

# ---------- reverb ----------
def reverb(x, secs=2.2, mix=0.25, seed=0):
    r = np.random.default_rng(seed)
    n = int(secs * SR); t = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-t * 3.2); ir[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt((ir ** 2).sum())
    m = len(x) + n; nf = 1 << (m - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[:len(x)]
    return x * (1 - mix) + y * mix * 1.6

L2 = reverb(L, seed=1); R2 = reverb(R, seed=2)
# fade out last 1.5 s, fade in first .05
t = np.arange(N) / SR
fade = np.clip((DUR - t) / 1.6, 0, 1) * np.clip(t / 0.05, 0, 1)
L2 *= fade; R2 *= fade
st = np.stack([L2, R2], 1)
st = np.tanh(st / (np.abs(st).max() * 0.55)) * 0.89   # soft limiter
st /= np.abs(st).max() / 0.89
pcm = (st * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("T_V1", T_V1, "T_V2", T_V2, "T_BR", T_BR, "T_V3", T_V3, "END", T_END)
