"""Original ambient score for the campaign videos (synthesized, royalty free).

Usage: python3 music.py <name> <seconds> <out.wav>
"""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 44100
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}

def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] - 9) / 12 + (octave - 4))

# chord = (root, list of semitone offsets from root)
MAJ, MIN, MAJ7, MIN7 = [0, 4, 7, 12], [0, 3, 7, 12], [0, 4, 7, 11], [0, 3, 7, 10]
TRACKS = {
    'magnet':  dict(bpm=72, chords=[('A', MIN), ('F', MAJ), ('C', MAJ), ('G', MAJ)], seed=1),
    'myth':    dict(bpm=80, chords=[('D', MIN), ('A#', MAJ), ('F', MAJ), ('C', MAJ)], seed=2),
    'neck':    dict(bpm=66, chords=[('C', MAJ7), ('A', MIN7), ('F', MAJ7), ('G', MAJ)], seed=3),
    'first':   dict(bpm=70, chords=[('F', MAJ7), ('C', MAJ), ('D', MIN7), ('A#', MAJ)], seed=4),
    'cupping': dict(bpm=76, chords=[('E', MIN), ('C', MAJ), ('G', MAJ), ('D', MAJ)], seed=5),
}

def env(n, a, r):
    e = np.ones(n)
    a, r = min(a, n // 2), min(r, n // 2)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[n - r:] *= np.linspace(1, 0, r) ** 2
    return e

def pad_tone(f, n, rng):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.12, 0.0, 0.12):           # gentle chorus
        ff = f * 2 ** (det / 12)
        ph = rng.uniform(0, 2 * np.pi)
        for h, amp in ((1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05)):
            out += amp * np.sin(2 * np.pi * ff * h * t + ph * h)
    return out / 3

def pluck(f, n):
    t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.001 * t)
            + 0.15 * np.sin(2 * np.pi * f * 3.002 * t) + 0.06 * np.sin(2 * np.pi * f * 4.2 * t))
    return tone * np.exp(-t * 3.2) * env(n, int(0.004 * SR), int(0.05 * SR))

def kick(n):
    t = np.arange(n) / SR
    f = 48 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def reverb(x, seconds, rng):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 6.9 / seconds)[:, None]
    ir[:, 0] = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir[:, 0])
    ir[:, 1] = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir[:, 1])
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    return np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], axis=1)

def render(name, seconds):
    cfg = TRACKS[name]
    rng = np.random.default_rng(cfg['seed'])
    beat = 60 / cfg['bpm']
    bar = 4 * beat
    total = int((seconds + 3) * SR)
    pad = np.zeros((total, 2)); keys = np.zeros((total, 2)); low = np.zeros((total, 2)); perc = np.zeros((total, 2))
    bars = int(np.ceil(seconds / bar)) + 1
    for b in range(bars):
        root, iv = cfg['chords'][b % len(cfg['chords'])]
        s = int(b * bar * SR); n = int(bar * SR * 1.15)
        if s >= total: break
        n = min(n, total - s)
        e = env(n, int(0.9 * SR), int(0.9 * SR))
        for k, off in enumerate(iv):
            f = hz(root, 3) * 2 ** (off / 12)
            pan = 0.5 + 0.3 * np.sin(k * 1.7)
            tone = pad_tone(f, n, rng) * e * 0.10
            pad[s:s + n, 0] += tone * (1 - pan); pad[s:s + n, 1] += tone * pan
        bass = np.sin(2 * np.pi * hz(root, 2) * np.arange(n) / SR) * env(n, int(.3 * SR), int(.6 * SR)) * 0.13
        low[s:s + n] += bass[:, None]
        # piano arpeggio in 8ths, joins after first bar
        if b >= 1:
            pattern = [0, 2, 1, 3, 2, 1, 3, 2]
            for i, p in enumerate(pattern):
                if rng.random() < 0.18: continue
                st = s + int(i * beat / 2 * SR)
                ln = min(int(2.2 * SR), total - st)
                if ln <= 0: continue
                f = hz(root, 5) * 2 ** (iv[p % len(iv)] / 12)
                v = 0.11 * (1.0 if i % 2 == 0 else 0.75)
                pan = 0.35 + 0.3 * rng.random()
                tone = pluck(f, ln) * v
                keys[st:st + ln, 0] += tone * (1 - pan); keys[st:st + ln, 1] += tone * pan
        # soft heartbeat pulse from bar 2 for momentum
        if b >= 2:
            for q in (0, 2):
                st = s + int(q * beat * SR); ln = min(int(0.5 * SR), total - st)
                if ln > 0: perc[st:st + ln] += (kick(ln) * 0.28)[:, None]
            for q in range(8):   # brushed shaker
                st = s + int((q + 0.5) * beat / 2 * SR); ln = min(int(0.07 * SR), total - st)
                if ln > 0:
                    nz = sosfilt(butter(2, 7000, 'high', fs=SR, output='sos'), rng.standard_normal(ln))
                    perc[st:st + ln] += (nz * np.exp(-np.arange(ln) / SR * 60) * 0.025)[:, None]
    pad = sosfilt(butter(2, 2200, 'low', fs=SR, output='sos'), pad, axis=0)
    wet = reverb(pad * 0.6 + keys, 3.2, rng)
    mix = pad * 0.85 + keys * 1.05 + wet * 0.55 + low + perc
    mix = mix[:int(seconds * SR)]
    n = len(mix)
    fade = np.ones(n); fi, fo = int(0.8 * SR), int(2.2 * SR)
    fade[:fi] = np.linspace(0, 1, fi); fade[n - fo:] = np.linspace(1, 0, fo) ** 1.5
    mix *= fade[:, None]
    mix = np.tanh(mix * 1.4) / np.tanh(1.4)       # gentle glue
    mix *= 0.89 / np.max(np.abs(mix))
    return (mix * 32767).astype(np.int16)

if __name__ == '__main__':
    name, secs, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    wavfile.write(out, SR, render(name, secs))
    print('wrote', out)
