# בונה את ציר הזמן לפי אורך הקריינות (נמתח/מתכווץ כך שהסרט יהיה בדיוק TARGET שניות),
# מסנתז מוזיקה ואפקטים מקוריים ומערבב. פלט: build/timeline.json + build/soundtrack.wav
import json, os, subprocess, sys, wave
import numpy as np
from scipy import signal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import *   # noqa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
B = os.path.join(ROOT, 'build')
TARGET = float(os.environ.get('TARGET', 90.0))

def wav_read(p):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()

VO = {k: wav_read(f'{B}/vo/{k}.wav') for k in CFG['vo']}
SENT = {k: json.load(open(f'{B}/vo/{k}.json', encoding='utf-8')) for k in CFG['vo']}
D = {k: len(v) / SR for k, v in VO.items()}

# ---------------------------------------------------------------- ציר זמן
def build(x):
    """x = מקדם מתיחה לרווחים הגמישים."""
    E, CUES = {}, []
    def say(key, t):
        CUES.append({'key': key, 'start': round(t, 3), 'dur': round(D[key], 3), 'text': CFG['vo'][key]['text'],
                     'sent': [{'text': s['text'], 'start': round(t + s['start'], 3), 'end': round(t + s['end'], 3)} for s in SENT[key]]})
        E[key] = t; E[key + '_end'] = t + D[key] - 0.2
        return E[key + '_end']
    g = lambda base: base * x
    # 1 פתיחה
    E['s1'] = 0
    t = say('o1', 1.7)
    t = say('o2', t + 0.45)
    E['boom'] = t + 0.5
    E['s2'] = E['boom'] + 4.6 + g(0.6)
    # 2 האגדה
    t = say('h1', E['s2'] + 0.5)
    E['hero'] = t + 0.35
    t = say('h2', E['hero'] + 0.7)
    E['tag1'] = E['h2'] + D['h2'] * 0.38; E['tag2'] = E['h2'] + D['h2'] * 0.55; E['tag3'] = E['h2'] + D['h2'] * 0.74
    E['legacy'] = t + 0.25
    t = say('h3', E['legacy'] + 0.3)
    E['portrait'] = E['h3'] + D['h3'] * 0.5
    E['s3'] = t + 0.6 + g(0.5)
    # 3 מאחורי הקלעים
    t = say('f1', E['s3'] + 0.65)
    E['beach'] = t + 0.4 + g(0.3)
    t = say('f2', E['beach'] + 0.3)
    E['pizza'] = t + 0.45 + g(0.3)
    E['pizza2'] = E['pizza'] + 1.4
    t = say('f3', E['pizza'] + 0.2)
    E['s4'] = t + 0.9 + g(0.4)
    # 4 עדכון משימה
    t = say('m1', E['s4'] + 0.55)
    E['family'] = t + 0.3
    t = say('m2', E['family'] + 0.25)
    E['rank'] = t + 0.35 + g(0.3)
    t = say('m3', E['rank'] + 0.3)
    E['leaf3'] = E['m3'] + D['m3'] * 0.62
    E['s5'] = t + 1.2 + g(0.8)
    # 5 ברכה
    t = say('b1', E['s5'] + 0.9 + g(0.4))
    t = say('b2', t + 0.6 + g(1.2))
    t = say('b3', t + 0.6 + g(1.2))
    E['s6'] = t + 0.9 + g(1.2)
    # 6 פינאלה
    E['upto'] = E['s6'] + 0.9
    t = say('e1', E['upto'] + 0.6)
    E['hb'] = t + 0.4
    E['credit'] = E['hb'] + 2.6 + g(0.8)
    E['total'] = E['credit'] + 3.2 + g(0.6)
    return E, CUES

lo, hi = 0.0, 8.0
for _ in range(40):
    mid = (lo + hi) / 2
    if build(mid)[0]['total'] < TARGET: lo = mid
    else: hi = mid
E, CUES = build((lo + hi) / 2)
TOTAL = E['total']
N = int(TOTAL * SR) + SR
print(f'stretch x={lo:.2f}')

MUS = np.zeros((2, N)); SFX = np.zeros((2, N)); VOX = np.zeros(N)
def put(buf, sig, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= buf.shape[-1] or len(sig) == 0: return
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), buf.shape[-1] - i)
    L = np.cos((pan + 1) * np.pi / 4); R_ = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + n] += sig[:n] * g * L * 1.414
    buf[1, i:i + n] += sig[:n] * g * R_ * 1.414

def chord(name, octave=3):
    root = note(name.rstrip('m') + str(octave)); minor = name.endswith('m')
    return [root, root + (3 if minor else 4), root + 7]
def bars(start, end, bpm, beats=4):
    b = 60 / bpm * beats; t = start; out = []
    while t < end - 0.01: out.append(t); t += b
    return out, b
def boing(d=0.45, f0=180, f1=520):
    x = tt(d); f = f0 + (f1 - f0) * (1 - np.exp(-x * 9)); f = f * (1 + 0.06 * np.sin(2 * np.pi * 14 * x))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 5) * 0.6
def glitch(d=0.35):
    out = noise(d) * 0; n = len(out); k = 0
    while k < n:
        m = int((0.01 + 0.03 * rng.random()) * SR); f = 200 + 3000 * rng.random()
        seg_ = (np.sign(np.sin(2 * np.pi * f * np.arange(min(m, n - k)) / SR)) * 0.3 if rng.random() < 0.6 else hp(noise(min(m, n - k) / SR), 2000) * 0.5)
        out[k:k + len(seg_)] += seg_; k += m
    return out

# ---------------------------------------------------------------- 1 פתיחה
put(SFX, wind(E['boom']), 0, 0.10)
hb_t = 0.4
while hb_t < E['boom'] - 0.5:
    put(SFX, heartbeat(), hb_t, 0.85); hb_t += 1.0 - 0.3 * hb_t / E['boom']
x = tt(E['boom']); put(MUS, np.sin(2 * np.pi * mf(26) * x) * np.minimum(1, x / 3) * 0.5, 0, 0.6)
put(MUS, strings([note('D2'), note('A2'), note('D3')], E['boom'] + 0.1, bright=900, a=3, r=0.05), 0.2, 0.5)
put(SFX, riser(E['boom'] - E['o2'] + 0.05), E['o2'], 0.55)
put(SFX, rev_cymbal(1.4), E['boom'] - 1.4, 0.3)
put(SFX, sub_boom(4.5, 90), E['boom'], 1.25)
put(MUS, braam(4.0), E['boom'], 1.0)
for k, dt in enumerate([0, 0.75, 1.5, 1.88, 2.25, 3.0, 3.75]):
    put(MUS, taiko(1, 90 if k % 3 else 70), E['boom'] + dt, 0.75 if dt == 0 else 0.5)
put(MUS, strings(chord('Dm', 3) + [note('D2')], E['s2'] - E['boom'] + 0.4, bright=1600, a=0.3, r=1.0), E['boom'], 0.5)
put(MUS, brass([note('D3'), note('A3'), note('D4')], 2.5), E['boom'] + 1.5, 0.35)
put(SFX, whoosh(1.0, 400, 5000), E['s2'] - 0.7, 0.5)

# ---------------------------------------------------------------- 2 האגדה (אפי, 100bpm)
s2, e2 = E['s2'], E['s3']
ab, bar = bars(s2, e2, 100)
prog = ['Dm', 'Bb', 'F', 'C']
ost = [0, 0, 12, 0, 7, 0, 10, 0, 0, 0, 12, 0, 7, 5, 3, 7]
for j, b0 in enumerate(ab):
    c = prog[j % 4]; root = chord(c, 2)[0]
    inten = 0.6 if b0 < E['hero'] else 1.0
    for s in range(16):
        put(MUS, spicc(root + 12 + ost[s], 0.13, 2200 + 1200 * inten), b0 + s * bar / 16, 0.26 * inten, 0.4 * np.sin(s * 1.3))
    put(MUS, strings(chord(c, 3), bar, bright=1500 + 900 * inten, a=0.2, r=0.3), b0, 0.42)
    put(MUS, strings([root], bar, bright=500, a=0.2, r=0.3), b0, 0.45)
    if b0 >= E['hero'] - 0.1:
        put(MUS, brass([root + 12, root + 19], bar * 0.6), b0, 0.3)
        for q, gg in [(0, 1), (0.75, .6), (1.5, .8), (2, 1), (2.5, .5), (3, .9), (3.5, .7)]:
            put(MUS, taiko(gg, 88), b0 + q * bar / 4, 0.5)
    else:
        put(MUS, taiko(0.8, 80), b0, 0.45); put(MUS, taiko(0.6, 80), b0 + bar / 2, 0.35)
put(SFX, sub_boom(3, 80), E['hero'], 1.0); put(MUS, braam(2.6, 26), E['hero'], 0.6)
put(SFX, whoosh(0.6, 600, 6000), E['hero'] - 0.45, 0.6)
for k in ['tag1', 'tag2', 'tag3']:
    put(MUS, taiko(1, 70), E[k], 0.7); put(SFX, whoosh(0.35, 1500, 8000, 0.7), E[k] - 0.15, 0.35)
put(SFX, glock(86, 2.0), E['legacy'], 0.3); put(SFX, glock(93, 2.0), E['legacy'] + 0.1, 0.25)
put(SFX, whoosh(0.5, 800, 6000), E['portrait'] - 0.3, 0.45)
put(SFX, glock(98, 2.4), E['portrait'] + 0.2, 0.3)

# ---------------------------------------------------------------- 3 מאחורי הקלעים (קומי)
s3, e3 = E['s3'], E['s4']
put(SFX, scratch(), s3 - 0.05, 0.7)
bt = 60 / 124
pz = [65, -1, 69, 72, 70, -1, 69, 65, 67, -1, 70, 69, 67, 65, 64, -1]
bass = [41, 48, 46, 41]
tq = s3 + 0.4; i = 0
while tq < e3 - 0.3:
    m = pz[i % 16]
    if m > 0: put(MUS, spicc(m, 0.12, 4200), tq, 0.42, 0.3)
    if i % 4 == 0: put(MUS, spicc(bass[(i // 8) % 4], 0.22, 900) * 1.4, tq, 0.42)
    if i % 2 == 0: put(MUS, hat(0.03), tq, 0.2, -0.3)
    tq += bt / 2; i += 1
put(SFX, boing(), E['f2'] + D['f2'] * 0.35, 0.5)
put(SFX, whoosh(0.4, 800, 6000), E['beach'] - 0.3, 0.5)
put(SFX, whoosh(0.4, 800, 6000), E['pizza'] - 0.3, 0.5)
put(SFX, boing(0.6, 400, 140), E['pizza2'] - 0.05, 0.45)
for k in range(5): put(SFX, beep(1200 if k % 2 else 900, 0.05), E['f1'] + 0.2 + k * 0.35, 0.08)

# ---------------------------------------------------------------- 4 עדכון משימה (HUD, 120bpm)
s4, e4 = E['s4'], E['s5']
put(SFX, glitch(0.5), s4 - 0.1, 0.5); put(SFX, sub_boom(2.0, 70), s4, 0.6)
hb_bars, bar = bars(s4, e4, 120)
prog = ['Dm', 'Bb', 'F', 'C']
for j, b0 in enumerate(hb_bars):
    ch = chord(prog[j % 4], 4)
    for s in range(16):
        m = ch[[0, 1, 2, 1][s % 4]] + (12 if s % 8 >= 4 else 0)
        put(MUS, lp(saw(mf(m), 0.11) * expd(int(0.11 * SR), 25), 3500), b0 + s * bar / 16, 0.16, 0.5 * np.sin(s))
    put(MUS, strings(chord(prog[j % 4], 3), bar, bright=1300, a=0.2, r=0.3), b0, 0.35)
    put(MUS, spicc(chord(prog[j % 4], 2)[0], 0.4, 500) * 1.5, b0, 0.5)
    for q in range(4):
        put(MUS, kick(), b0 + q * bar / 4, 0.5); put(MUS, hat(), b0 + q * bar / 4 + bar / 8, 0.22)
for k in range(8): put(SFX, blip(900 + 120 * k, 1600 + 120 * k), s4 + 0.2 + k * 0.3, 0.25, (k % 3 - 1) * 0.6)
put(SFX, whoosh(0.5, 1000, 7000), E['family'] - 0.3, 0.5); put(SFX, glock(88, 2.0), E['family'] + 0.1, 0.35)
put(SFX, whoosh(0.5, 1000, 7000), E['rank'] - 0.3, 0.5)
put(SFX, riser(E['leaf3'] - E['rank'], 150, 1800), E['rank'], 0.4)
put(SFX, sub_boom(3, 90), E['leaf3'], 1.1); put(MUS, braam(2.5, 26), E['leaf3'], 0.5)
for k in range(8): put(SFX, glock([86, 90, 93, 98][k % 4], 1.6), E['leaf3'] + 0.05 + k * 0.1, 0.25, (k % 2) - 0.5)
put(SFX, rev_cymbal(1.2), e4 - 1.2, 0.25)

# ---------------------------------------------------------------- 5 ברכה (פסנתר ומיתרים)
s5, e5 = E['s5'] - 0.2, E['s6'] + 0.6
bb, bar = bars(s5, e5, 72)
prog = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A']
for j, b0 in enumerate(bb):
    c = prog[j % len(prog)]; ch = chord(c, 4); root = chord(c, 2)[0]
    patt = [root + 12, ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[0]]
    for s, m in enumerate(patt): put(MUS, piano(m, 2.2, 0.85 if s else 1.0), b0 + s * bar / 8, 0.55, 0.3 * np.sin(s))
    put(MUS, piano(root, 3.2, 0.9), b0, 0.6)
    put(MUS, strings(chord(c, 3), bar + 0.4, bright=1800, a=0.9, r=0.8), b0, 0.4)
    if b0 >= E['b2'] - 1:
        put(MUS, strings([root + 12], bar + 0.4, bright=900, a=0.6, r=0.6), b0, 0.38)
        put(MUS, taiko(0.5, 60), b0, 0.3)
    if b0 >= E['b3'] - 1:
        for q, m in enumerate([ch[2] + 12, ch[1] + 12, ch[0] + 12, ch[1] + 12]): put(MUS, piano(m, 2.0, 0.6), b0 + q * bar / 4 + bar / 16, 0.33, 0.4)
        put(MUS, brass(chord(c, 3), bar, a=0.6) * 0.6, b0, 0.25)
for k in range(6): put(SFX, glock([81, 86, 88, 93, 90, 98][k], 2.4), E['s5'] + k * 0.16, 0.18, (k % 2) - 0.5)

# ---------------------------------------------------------------- 6 פינאלה
s6 = E['s6']
put(SFX, riser(E['upto'] - s6 + 0.6, 120, 2000), s6 - 0.6, 0.5)
put(SFX, sub_boom(5, 100), E['upto'], 1.3); put(MUS, braam(4, 26), E['upto'], 0.65)
for k, dt in enumerate([-0.4, 0.3, 1.0, 1.8, 2.7, 3.5, 4.6, 5.6, 6.8, 8.0, 9.4, 10.8, 12.2]):
    if E['upto'] + dt < TOTAL - 1.5: firework(SFX, E['upto'] + dt, g=0.7 - 0.025 * k, pan=np.sin(k * 2.1) * 0.7)
ab, bar = bars(E['upto'], TOTAL, 120)
prog = ['D', 'A', 'Bm', 'G']
for j, b0 in enumerate(ab):
    c = prog[j % 4]; root = chord(c, 2)[0]
    put(MUS, brass(chord(c, 3) + [root + 12], bar, a=0.05), b0, 0.42)
    put(MUS, strings(chord(c, 4) + chord(c, 3), bar, bright=3400, a=0.05, r=0.3), b0, 0.42)
    for q in range(4):
        put(MUS, kick(), b0 + q * bar / 4, 0.5); put(MUS, taiko(0.7, 85), b0 + q * bar / 4, 0.35)
        if q % 2: put(MUS, snare(), b0 + q * bar / 4, 0.4)
        for h in range(2): put(MUS, hat(), b0 + q * bar / 4 + h * bar / 8, 0.15)
    for s in range(8): put(MUS, spicc(chord(c, 4)[[0, 1, 2, 1][s % 4]] + 12, 0.14, 4000), b0 + s * bar / 8, 0.22, 0.4 * np.sin(s))
put(SFX, sub_boom(4, 80), E['hb'], 0.9)
for k in range(10): put(SFX, glock([86, 90, 93, 98, 102][k % 5], 2.0), E['hb'] + k * 0.1, 0.2, np.sin(k))
put(SFX, sub_boom(4, 90), E['credit'], 0.8)
put(MUS, strings(chord('D', 4) + chord('D', 3) + [note('D2')], TOTAL - E['credit'] + 0.5, bright=3000, a=0.05, r=2.5), E['credit'], 0.5)

# ---------------------------------------------------------------- מיקס
for c in CUES:
    i0 = int(c['start'] * SR); v = VO[c['key']]; VOX[i0:i0 + len(v)] += v[:N - i0]

def reverb(x, secs=2.2, wet=0.22):
    n = int(secs * SR); tt_ = np.arange(n) / SR; out = np.zeros_like(x)
    for ch in range(2):
        ir = lp(rng.standard_normal(n), 5000) * np.exp(-tt_ * 3.2); ir[:int(0.012 * SR)] = 0; ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = signal.fftconvolve(x[ch], ir)[:x.shape[1]]
    return x * (1 - wet) + out * wet * 1.2

MUS = reverb(MUS, 2.4, 0.25); SFX = reverb(SFX, 1.6, 0.12)
envv = np.abs(VOX); k = int(0.25 * SR)
envv = np.convolve(envv, np.ones(k) / k, 'same'); envv = np.clip(envv / (np.percentile(envv[envv > 1e-4], 70) + 1e-9), 0, 1)
duck = 1 - 0.55 * lp(envv, 3)
mix = MUS / (np.percentile(np.abs(MUS), 99.5) + 1e-9) * 0.32 * duck + SFX / (np.percentile(np.abs(SFX), 99.7) + 1e-9) * 0.36 * (1 - 0.3 * lp(envv, 3))
vox = VOX / (np.max(np.abs(VOX)) + 1e-9) * 0.85
mix = mix + vox[None, :]
fe = int(TOTAL * SR); mix[:, fe - int(2.0 * SR):fe] *= np.linspace(1, 0, int(2.0 * SR)) ** 1.5; mix = mix[:, :fe]
mix = np.tanh(mix * 1.15) * 0.93
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
with wave.open(f'{B}/soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
json.dump({'events': {k: round(v, 3) for k, v in E.items()}, 'vo': CUES, 'total': round(TOTAL, 3), 'titles': CFG['titles']},
          open(f'{B}/timeline.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'timeline ok – total {TOTAL:.1f}s')
for k in ['s2', 's3', 's4', 's5', 's6', 'hb', 'total']: print(f'  {k:6s} {E[k]:6.1f}')
