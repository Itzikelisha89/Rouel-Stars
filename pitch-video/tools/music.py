import numpy as np, wave, sys
SR = 44100; DUR = float(sys.argv[2]); out = sys.argv[1]
t = np.arange(int(SR * DUR)) / SR
def hz(n): return 440 * 2 ** ((n - 69) / 12)
# progression: Am - F - C - G (midi), 8s per chord
CH = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]]
BASS = [45, 41, 48, 43]
SEG = 8.0
mix = np.zeros_like(t)
rng = np.random.default_rng(1)
for i in range(int(DUR / SEG) + 1):
    t0 = i * SEG; c = CH[i % 4]
    idx = (t >= t0 - 1.5) & (t < t0 + SEG + 2.5)
    tt = t[idx] - t0
    env = np.clip((tt + 1.5) / 2.5, 0, 1) * np.clip((SEG + 2.5 - tt) / 3.0, 0, 1)
    pad = np.zeros_like(tt)
    for n in c:
        for det in (-0.12, 0, 0.12):
            f = hz(n + det)
            pad += np.sin(2 * np.pi * f * tt + rng.random() * 6) + 0.3 * np.sin(4 * np.pi * f * tt) + 0.12 * np.sin(6 * np.pi * f * tt)
    mix[idx] += 0.05 * pad * env
    b = np.sin(2 * np.pi * hz(BASS[i % 4]) * tt) * env
    mix[idx] += 0.10 * b
# gentle arpeggio plucks after intro
BPM = 96; step = 60 / BPM / 2
k = 0
for start in np.arange(10.0, DUR - 6, step):
    ci = int(start // SEG) % 4; c = CH[ci]
    n = c[k % 3] + 12 * (1 + (k // 3) % 2); k += 1
    i0 = int(start * SR); L = int(1.2 * SR)
    if i0 + L > len(t): break
    tt = np.arange(L) / SR
    pl = np.sin(2 * np.pi * hz(n) * tt) * np.exp(-tt * 5) * (0.6 + 0.4 * np.sin(2 * np.pi * hz(n) * 2 * tt))
    mix[i0:i0 + L] += 0.035 * pl
# soft lowpass
y = np.zeros_like(mix); a = 0.12
for i in range(1, len(mix)): y[i] = y[i - 1] + a * (mix[i] - y[i - 1])
# simple stereo widening via short delay
d = int(0.012 * SR)
L = y; R = np.concatenate([np.zeros(d), y[:-d]])
fade = np.clip(t / 3, 0, 1) * np.clip((DUR - t) / 5, 0, 1)
st = np.stack([L * fade, R * fade], 1)
st /= np.max(np.abs(st)) / 0.7
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
