# בונה את ציר הזמן של הסרט לפי אורך הקריינות בפועל, מסנתז מוזיקה מקורית ואפקטים, ומערבב הכול.
# פלט: build/timeline.json (הסרט קורא אותו) + build/soundtrack.wav
# כל הצלילים נוצרים כאן מאפס (סינתזה) – אין שימוש בחומר מוגן, מותר להקרנה באירוע.
import json, os, subprocess
import numpy as np
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
B = os.path.join(ROOT, 'build')
SR = 48000
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- קריינות וציר זמן
def wav_read(p):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()

VO = {k: wav_read(f'{B}/vo/{k}.wav') for k in CFG['vo']}
SENT = {k: json.load(open(f'{B}/vo/{k}.json', encoding='utf-8')) for k in CFG['vo']}
D = {k: len(v) / SR for k, v in VO.items()}

E = {}          # אירועים בשם -> זמן בשניות
CUES = []       # קטעי קריינות

def say(key, t):
    CUES.append({'key': key, 'start': round(t, 3), 'dur': round(D[key], 3), 'text': CFG['vo'][key]['text'],
                 'sent': [{'text': s['text'], 'start': round(t + s['start'], 3), 'end': round(t + s['end'], 3)} for s in SENT[key]]})
    E[key] = t
    E[key + '_end'] = t + D[key] - 0.25
    return E[key + '_end']

# --- חלק 1: פתיחה
t = 2.8
E['s1'] = 0
t = say('o1', t)
E['thunder'] = t + 0.35
t = say('o2', E['thunder'] + 0.7)
E['wh'] = E['o2']                       # המחסן מתחיל
t = say('o3', t + 0.9)
E['silence'] = t
t = say('o4', t + 1.3)
E['boom'] = t + 0.45
E['title'] = E['boom'] + 0.15
E['s1end'] = E['boom'] + 7.2

# --- חלק 2: האיש והאגדה
E['s2'] = E['s1end']
t = say('n1', E['s2'] + 1.0)
E['search'] = t + 0.5
t = say('n2', E['search'] + 0.5)
E['where'] = t + 0.35
E['hud'] = E['where'] + 2.3
t = say('n3', E['hud'] + 0.4)
t = say('n4', t + 0.45)
t = say('n5', t + 0.45)
t = say('n6', t + 0.4)
E['system'] = t + 0.1
E['ai'] = E['system'] + 2.9
t = say('ai1', E['ai'] + 0.5)
E['type'] = t + 0.2
t = say('ai2', E['type'] + 0.8)
E['think'] = t + 0.15
t = say('ai3', E['think'] + 1.0)
E['ring'] = t + 0.1
E['caption'] = E['ring'] + 2.2
E['s2end'] = E['caption'] + 3.3

# --- חלק 3: LEVEL UP
E['s3'] = E['s2end']
for i, n in enumerate([5, 4, 3, 2, 1]):
    E[f'cd{n}'] = E['s3'] + 0.3 + i * 0.85
E['shatter'] = E['cd1'] + 0.85
t = say('l1', E['shatter'] + 3.2)
t = say('l2', t + 0.9)
E['hb'] = t + 0.35
E['s3end'] = E['hb'] + 5.0

# --- חלק 4: הברכה
E['s4'] = E['s3end']
t = E['s4'] + 1.8
for k in ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']:
    t = say(k, t) + 0.7
E['s4end'] = E[f'b7_end'] + 2.0

# --- חלק 5: סיום
E['s5'] = E['s4end']
E['gold'] = E['s5']
t = say('f1', E['s5'] + 3.0)
E['count'] = t + 0.9
for i in range(10):
    E[f'c{10 - i}'] = E['count'] + i * 0.72
E['mazal'] = E['count'] + 7.2
t = say('f2', E['mazal'] + 1.6)
E['end'] = t + 0.6
E['logo'] = E['end'] + 4.8
TOTAL = E['logo'] + 4.4
E['total'] = TOTAL
N = int(TOTAL * SR) + SR

# ---------------------------------------------------------------- כלי סינתזה
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

MUS = np.zeros((2, N)); SFX = np.zeros((2, N)); VOX = np.zeros(N)
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

def firework(t0, buf=None, g=1.0, pan=0.0):
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

# ---------------------------------------------------------------- המוזיקה לפי החלקים
def chord(name, octave=3):
    root = note(name.rstrip('m') + str(octave)); minor = name.endswith('m')
    return [root, root + (3 if minor else 4), root + 7]

def bars(start, end, bpm, beats=4):
    b = 60 / bpm * beats; t = start; out = []
    while t < end - 0.01: out.append(t); t += b
    return out, b

# חלק 1 ------------------------------------------------------------
put(SFX, static(1.1), 0.25, 0.25, -0.3)
put(SFX, wind(E['boom']), 0, 0.12)
hb_t = 0.6
while hb_t < E['boom'] - 0.6:
    near = (hb_t - 0) / E['boom']
    put(SFX, heartbeat(), hb_t, 0.9 - 0.3 * near if hb_t < E['silence'] or hb_t > E['o4'] else 0.25)
    hb_t += 1.05 - 0.35 * near
put(MUS, strings([note('D2'), note('A2')], E['silence'] + 0.6, bright=700, a=4, r=1.2), 0.5, 0.55)
x = tt(E['boom']); put(MUS, np.sin(2 * np.pi * mf(26) * x) * np.minimum(1, x / 5) * 0.5, 0, 0.6)
put(SFX, thunder(), E['thunder'] - 0.05, 0.9, 0.2)
put(SFX, sub_boom(3, 60), E['thunder'], 0.6)
# אוסטינטו של המחסן
bt = 60 / 100 / 4; tq = E['wh']; i = 0
seq = [38, 38, 50, 38, 38, 45, 38, 41]
while tq < E['silence']:
    put(MUS, spicc(seq[i % 8], 0.14, 1600 + 1600 * (tq - E['wh']) / (E['silence'] - E['wh'])), tq, 0.45, 0.25 * np.sin(i))
    if i % 8 == 0: put(MUS, taiko(1.0, 80), tq, 0.55)
    tq += bt; i += 1
put(SFX, whoosh(1.4, 200, 2400), E['wh'] - 0.4, 0.5, -0.4)
put(SFX, rev_cymbal(1.2), E['silence'] - 1.2, 0.3)
put(MUS, strings([note('D3'), note('F3'), note('A3')], E['boom'] - E['o4'], bright=1800, a=1.5, r=0.05), E['o4'], 0.5)
put(SFX, riser(E['boom'] - E['o4'] + 0.05), E['o4'], 0.55)
put(SFX, sub_boom(4.5, 90), E['boom'], 1.25)
put(SFX, shatter(), E['boom'], 0.35, 0.3)
put(MUS, braam(4.0), E['boom'], 1.0)
put(MUS, braam(3.5, 22), E['boom'] + 3.6, 0.85)
for k, dt in enumerate([0, 0.9, 1.8, 2.25, 2.7, 3.6, 4.5, 5.4, 5.85, 6.3]):
    put(MUS, taiko(1, 90 if k % 3 else 70), E['boom'] + dt, 0.55 if dt else 0.8)
put(MUS, strings(chord('Dm', 3) + [note('D2')], 7.2, bright=1500, a=0.4, r=1.5), E['boom'], 0.5)
put(SFX, whoosh(1.0, 400, 5000), E['s1end'] - 0.8, 0.5)

# חלק 2 ------------------------------------------------------------
s2 = E['s2']; bpm = 116; beat = 60 / bpm
put(MUS, strings(chord('Dm', 3), E['search'] - s2 + 0.5, bright=1400, a=1.0, r=0.4), s2, 0.45)
put(MUS, strings([note('D2')], E['search'] - s2 + 0.5, bright=500, a=1.0, r=0.4), s2, 0.5)
tq = s2
while tq < E['search']:
    put(MUS, hat(0.03), tq, 0.35, 0.3); tq += beat
    if int((tq - s2) / beat) % 4 == 0: put(MUS, taiko(0.8, 85), tq, 0.45)
put(SFX, scratch(), E['search'] - 0.1, 0.55)
# פיציקטו "מחפש" קומי
pz = [62, 65, 69, 67, 65, 64, 62, -1, 62, 65, 69, 70, 69, 67, 69, -1]
tq = E['search'] + 0.15; i = 0
while tq < E['where'] - 0.1:
    m = pz[i % 16]
    if m > 0: put(MUS, spicc(m, 0.12, 4000) * 0.9, tq, 0.5, 0.3)
    if i % 4 == 0: put(MUS, spicc(38, 0.2, 900), tq, 0.45)
    tq += beat / 2; i += 1
put(SFX, sub_boom(2.5, 80), E['where'], 1.0)
put(MUS, braam(2.2, 26), E['where'], 0.6)
put(SFX, whoosh(0.5, 800, 6000), E['where'] - 0.35, 0.6)
# HUD – ארפג'יו סינתטי
hb_bars, bar = bars(E['hud'], E['ai'], 120)
prog = ['Dm', 'Bb', 'F', 'C']
for j, b0 in enumerate(hb_bars):
    ch = chord(prog[j % 4], 4)
    for s in range(16):
        tq = b0 + s * bar / 16
        m = ch[[0, 1, 2, 1][s % 4]] + (12 if s % 8 >= 4 else 0)
        put(MUS, lp(saw(mf(m), 0.11) * expd(int(0.11 * SR), 25), 3500), tq, 0.16, 0.5 * np.sin(s))
    put(MUS, strings(chord(prog[j % 4], 3), bar, bright=1200, a=0.2, r=0.3), b0, 0.35)
    put(MUS, spicc(chord(prog[j % 4], 2)[0], 0.4, 500) * 1.5, b0, 0.5)
    for q in range(4):
        put(MUS, kick(), b0 + q * bar / 4, 0.55)
        put(MUS, hat(), b0 + q * bar / 4 + bar / 8, 0.25)
for k in range(10):
    put(SFX, blip(900 + 120 * k, 1600 + 120 * k), E['hud'] + 0.3 + k * 0.55, 0.3, (k % 3 - 1) * 0.6)
for k0 in ['n3', 'n4', 'n5']:
    put(SFX, whoosh(0.4, 1000, 7000, 0.6), E[k0] + 0.1, 0.4)
put(SFX, whoosh(0.4, 1000, 7000, 0.6), E['n6'] + 1.0, 0.4)
put(SFX, glock(86, 2.0), E['system'], 0.4); put(SFX, glock(81, 2.0), E['system'] + 0.08, 0.35)
put(SFX, sub_boom(2.0, 70), E['system'], 0.6)
# MOR.AI
put(MUS, strings([note('D3'), note('A3'), note('E4'), note('F4')], E['ring'] - E['ai'] + 0.5, bright=900, a=1.2, r=0.5), E['ai'], 0.35)
for k in range(int((E['ring'] - E['ai']) / 0.45)):
    if rng.random() < 0.55: put(SFX, beep(1400 + 400 * rng.integers(0, 4), 0.05), E['ai'] + k * 0.45, 0.08, rng.random() - 0.5)
put(SFX, typing(1.0), E['type'] - 0.1, 0.5)
for k in range(6): put(SFX, blip(700, 1100, 0.08), E['think'] + k * 0.2, 0.25)
put(SFX, ring(), E['ring'], 0.9)
put(MUS, taiko(1, 70), E['caption'], 0.8); put(SFX, sub_boom(2.5, 70), E['caption'], 0.7)
put(MUS, strings(chord('Dm', 3) + [note('D2')], 3.6, bright=1800, a=0.05, r=1.2), E['caption'], 0.55)
put(MUS, brass([note('D3'), note('A3')], 1.6), E['caption'], 0.35)
put(SFX, rev_cymbal(1.0), E['s3'] - 1.0, 0.3)

# חלק 3 ------------------------------------------------------------
for n in [5, 4, 3, 2, 1]:
    put(SFX, beep(880 if n > 1 else 1320, 0.16), E[f'cd{n}'], 0.4)
    put(MUS, taiko(0.9, 75), E[f'cd{n}'], 0.6)
put(SFX, riser(E['shatter'] - E['cd5'] + 0.1, 120, 1800), E['cd5'], 0.5)
put(SFX, shatter(), E['shatter'], 0.6); put(SFX, sub_boom(4, 90), E['shatter'], 1.1)
put(MUS, braam(3.0), E['shatter'], 0.9)
bpm = 130; act_end = E['l2']
ab, bar = bars(E['shatter'] + 0.2, act_end, bpm)
prog = ['Dm', 'Bb', 'Gm', 'A']
ost = [0, 0, 12, 0, 0, 7, 0, 10, 0, 0, 12, 0, 7, 5, 3, 7]
for j, b0 in enumerate(ab):
    c = prog[j % 4]; root = note(c.rstrip('m') + '2') if c != 'A' else note('A1')
    for s in range(16):
        put(MUS, spicc(root + 12 + ost[s], 0.12, 3200), b0 + s * bar / 16, 0.32, 0.4 * np.sin(s * 1.3))
    put(MUS, strings(chord(c, 3), bar, bright=2200, a=0.1, r=0.3), b0, 0.4)
    put(MUS, brass([root, root + 12], bar * 0.5), b0, 0.3)
    for q, g in [(0, 1), (0.75, .6), (1.5, .8), (2, 1), (2.5, .5), (3, .9), (3.5, .7)]:
        put(MUS, taiko(g, 88), b0 + q * bar / 4, 0.55)
    put(MUS, snare(), b0 + bar / 4, 0.35); put(MUS, snare(), b0 + 3 * bar / 4, 0.35)
put(SFX, heli(4.5), E['shatter'] + 1.0, 0.6, -0.6)
put(SFX, heli(4.0), E['shatter'] + 5.5, 0.5, 0.6)
put(MUS, strings([note('D3'), note('A3'), note('D4')], E['hb'] - E['l2'], bright=1500, a=0.3, r=0.05), E['l2'], 0.45)
put(SFX, riser(E['hb'] - E['l2'] + 0.05, 200, 1600), E['l2'], 0.45)
put(SFX, sub_boom(4, 90), E['hb'], 1.2)
D_ = [note('D3'), note('F#3'), note('A3'), note('D4')]
for k, (c, dt) in enumerate([('D', 0), ('A', 1.25), ('Bm', 2.5), ('G', 3.1)]):
    put(MUS, brass(chord(c, 3) + [chord(c, 3)[0] - 12], 1.4 if k < 3 else 2.2), E['hb'] + dt, 0.5)
    put(MUS, strings(chord(c, 4) + chord(c, 3), 1.5 if k < 3 else 2.4, bright=3200, a=0.05, r=0.6), E['hb'] + dt, 0.5)
    put(MUS, taiko(1, 80), E['hb'] + dt, 0.7)
for k in range(8): put(SFX, glock([86, 90, 93, 98][k % 4], 1.4), E['hb'] + 0.1 + k * 0.12, 0.25, (k % 2) - 0.5)
firework(E['hb'] - 0.6, g=0.8, pan=-0.5); firework(E['hb'] + 0.6, g=0.7, pan=0.5); firework(E['hb'] + 2.0, g=0.6, pan=-0.2)

# חלק 4 – פסנתר ומיתרים ------------------------------------------
s4, e4 = E['s4'] - 0.3, E['s4end'] + 0.8
bpm = 72; bb, bar = bars(s4, e4, bpm)
prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'D', 'D']
for j, b0 in enumerate(bb):
    c = prog[j % len(prog)]; ch = chord(c, 4); root = chord(c, 2)[0]
    patt = [root + 12, ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[0]]
    for s, m in enumerate(patt):
        put(MUS, piano(m, 2.2, 0.85 if s else 1.0), b0 + s * bar / 8, 0.55, 0.3 * np.sin(s))
    put(MUS, piano(root, 3.2, 0.9), b0, 0.6)
    ph = b0 - s4
    if b0 >= E['b2'] - 1:
        put(MUS, strings(chord(c, 3), bar + 0.4, bright=1800, a=0.9, r=0.8), b0, 0.42)
    if b0 >= E['b4'] - 1:
        put(MUS, strings([root + 12], bar + 0.4, bright=900, a=0.6, r=0.6), b0, 0.4)
    if b0 >= E['b5'] - 1:
        put(MUS, strings([ch[2] + 12], bar + 0.4, bright=3000, a=1.0, r=0.8), b0, 0.22)
        put(MUS, taiko(0.6, 60), b0, 0.35); put(MUS, taiko(0.4, 60), b0 + bar / 2, 0.3)
    if b0 >= E['b6'] - 1:
        top = [ch[2] + 12, ch[1] + 12, ch[0] + 12, ch[1] + 12]
        for q, m in enumerate(top): put(MUS, piano(m, 2.0, 0.6), b0 + q * bar / 4 + bar / 16, 0.35, 0.4)
    if b0 >= E['b7'] - 1:
        put(MUS, brass(chord(c, 3), bar, a=0.6) * 0.6, b0, 0.3)
put(SFX, rev_cymbal(1.6), E['b7'] - 1.6, 0.2)
for k in range(6): put(SFX, glock([81, 86, 88, 93, 90, 98][k], 2.4), E['b1'] - 1.2 + k * 0.18, 0.18, (k % 2) - 0.5)

# חלק 5 – פינאלה --------------------------------------------------
s5 = E['s5']
put(SFX, rev_cymbal(2.5), s5 + 0.2, 0.35)
for k in range(16): put(SFX, glock([74, 78, 81, 86, 90, 93, 98, 102][k % 8], 2.0), s5 + 0.1 + k * 0.16, 0.16, np.sin(k))
put(MUS, strings(chord('D', 4) + chord('D', 3), E['f1'] - s5 + 0.5, bright=2400, a=1.5, r=0.5), s5, 0.4)
bpm = 90; fb, bar = bars(E['f1'], E['count'], bpm)
prog = ['D', 'Bm', 'G', 'A']
for j, b0 in enumerate(fb):
    c = prog[j % 4]
    put(MUS, strings(chord(c, 3) + chord(c, 4), bar, bright=2600, a=0.2, r=0.4), b0, 0.42)
    put(MUS, brass(chord(c, 3), bar * 0.9, a=0.15), b0, 0.3)
    put(MUS, taiko(1, 70), b0, 0.6); put(MUS, taiko(0.7, 70), b0 + bar * 0.625, 0.45); put(MUS, snare(), b0 + bar / 2, 0.3)
    for s in range(8): put(MUS, piano(chord(c, 5)[s % 3], 1.0, 0.5), b0 + s * bar / 8, 0.25, 0.4)
# ספירה 10..1
put(SFX, riser(E['mazal'] - E['count'] + 0.05, 100, 2200), E['count'], 0.55)
put(MUS, strings([note('A2'), note('E3'), note('A3'), note('C#4')], E['mazal'] - E['count'], bright=1200, a=2, r=0.05), E['count'], 0.45)
for n in range(10, 0, -1):
    tq = E[f'c{n}']
    put(MUS, taiko(1.0, 70 + (10 - n) * 4), tq, 0.5 + (10 - n) * 0.03)
    put(SFX, beep(660 + (10 - n) * 60, 0.12), tq, 0.25)
    if n <= 4:
        for q in (0.2, 0.4, 0.6): put(MUS, snare(), tq + q, 0.2 + (5 - n) * 0.05)
# מזל טוב!
put(SFX, sub_boom(5, 100), E['mazal'], 1.3); put(MUS, braam(4, 26), E['mazal'], 0.6)
for k, dt in enumerate([-0.5, 0.2, 0.9, 1.6, 2.6, 3.3, 4.4, 5.5, 6.8, 8.0, 9.5, 11]):
    firework(E['mazal'] + dt, g=0.75 - 0.03 * k, pan=np.sin(k * 2.1) * 0.7)
bpm = 120; ab, bar = bars(E['mazal'], E['logo'], bpm)
prog = ['D', 'A', 'Bm', 'G']
for j, b0 in enumerate(ab):
    c = prog[j % 4]; root = chord(c, 2)[0]
    put(MUS, brass(chord(c, 3) + [root + 12], bar, a=0.05), b0, 0.42)
    put(MUS, strings(chord(c, 4) + chord(c, 3), bar, bright=3400, a=0.05, r=0.3), b0, 0.42)
    for q in range(4):
        put(MUS, kick(), b0 + q * bar / 4, 0.5); put(MUS, taiko(0.7, 85), b0 + q * bar / 4, 0.35)
        if q % 2: put(MUS, snare(), b0 + q * bar / 4, 0.4)
        for h in range(2): put(MUS, hat(), b0 + q * bar / 4 + h * bar / 8, 0.15)
    for s in range(8):
        put(MUS, spicc(chord(c, 4)[[0, 1, 2, 1][s % 4]] + 12, 0.14, 4000), b0 + s * bar / 8, 0.22, 0.4 * np.sin(s))
put(SFX, sub_boom(4, 80), E['end'], 0.8)
for k in range(10): put(SFX, glock([86, 90, 93, 98, 102][k % 5], 2.0), E['end'] + k * 0.1, 0.2, np.sin(k))
put(SFX, rev_cymbal(1.5), E['logo'] - 1.5, 0.35)
put(SFX, sub_boom(5, 90), E['logo'], 1.2); put(MUS, braam(4.5, 26), E['logo'], 0.9)
put(MUS, brass(chord('D', 3) + [note('D2')], 4.4, a=0.03), E['logo'], 0.5)
put(MUS, strings(chord('D', 4) + chord('D', 3) + [note('D2')], 4.5, bright=3000, a=0.03, r=3.0), E['logo'], 0.55)
for k in range(8): put(SFX, glock([86, 90, 93, 98][k % 4], 3.0), E['logo'] + 0.05 + k * 0.09, 0.25, np.sin(k))

# ---------------------------------------------------------------- קריינות + מיקס
for c in CUES:
    i0 = int(c['start'] * SR); v = VO[c['key']]; VOX[i0:i0 + len(v)] += v[:N - i0]

def reverb(x, secs=2.2, wet=0.22):
    n = int(secs * SR); tt_ = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = lp(rng.standard_normal(n), 5000) * np.exp(-tt_ * 3.2); ir[:int(0.012 * SR)] = 0; ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = signal.fftconvolve(x[ch], ir)[:x.shape[1]]
    return x * (1 - wet) + out * wet * 1.2

MUS = reverb(MUS, 2.4, 0.25)
SFX = reverb(SFX, 1.6, 0.12)
# דאקינג של המוזיקה מתחת לקריינות
envv = np.abs(VOX); k = int(0.25 * SR)
envv = np.convolve(envv, np.ones(k) / k, 'same'); envv = np.clip(envv / (np.percentile(envv[envv > 1e-4], 70) + 1e-9), 0, 1)
duck = 1 - 0.5 * lp(envv, 3)
mus_peak = np.percentile(np.abs(MUS), 99.5) + 1e-9
mix = MUS / mus_peak * 0.32 * duck + SFX / (np.percentile(np.abs(SFX), 99.7) + 1e-9) * 0.38
vox = VOX / (np.max(np.abs(VOX)) + 1e-9) * 0.82
mix = mix + vox[None, :]
# הפייד בסוף
fe = int(TOTAL * SR); mix[:, fe - int(2.5 * SR):fe] *= np.linspace(1, 0, int(2.5 * SR)) ** 1.5; mix[:, fe:] = 0
mix = mix[:, :fe]
mix = np.tanh(mix * 1.15) * 0.93   # לימיטר רך
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
import wave
with wave.open(f'{B}/soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

json.dump({'events': {k: round(v, 3) for k, v in E.items()}, 'vo': CUES, 'total': round(TOTAL, 3),
           'titles': CFG['titles'], 'photos': CFG['photos']},
          open(f'{B}/timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'timeline ok – total {TOTAL:.1f}s ({int(TOTAL // 60)}:{TOTAL % 60:04.1f})')
for k in ['s1end', 's2end', 's3end', 's4end', 'mazal', 'logo']: print(f'  {k:7s} {E[k]:6.1f}')
