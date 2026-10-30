# מייצר את קול הקריינות של הסרטון ואפקטים (נקישות, דפיקה, שליפה)
import asyncio, os, sys, json, subprocess, certifi, numpy as np, wave
certifi.where = lambda: '/root/.ccr/ca-bundle.crt'
import edge_tts
OUT = sys.argv[1]
os.makedirs(f'{OUT}/vo', exist_ok=True); os.makedirs(f'{OUT}/sfx', exist_ok=True)
script = json.load(open(os.path.join(os.path.dirname(__file__), 'script.json'), encoding='utf-8'))
async def one(k, t):
    for _ in range(4):
        try:
            await edge_tts.Communicate(t, 'he-IL-HilaNeural', rate='-3%', pitch='-2Hz', proxy=os.environ.get('HTTPS_PROXY')).save(f'{OUT}/vo/{k}.mp3'); return
        except Exception: await asyncio.sleep(1.5)
    print('FAILED', k)
async def main(): await asyncio.gather(*(one(k, t) for k, t in script.items()))
asyncio.run(main())
dur = {}
for k in script:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{OUT}/vo/{k}.mp3'], capture_output=True, text=True)
    dur[k] = float(r.stdout.strip())
json.dump(dur, open(f'{OUT}/vo/durations.json', 'w'))
print('total VO', round(sum(dur.values()), 1), 's')

SR = 44100
def save(name, x):
    x = np.clip(x / (np.abs(x).max() + 1e-9) * 0.9, -1, 1)
    with wave.open(f'{OUT}/sfx/{name}.wav', 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype(np.int16).tobytes())
def env(n, p=3): return (1 - np.linspace(0, 1, n)) ** p
def bandnoise(n, lo, hi):
    f = np.fft.rfft(np.random.randn(n)); fr = np.fft.rfftfreq(n, 1 / SR); f[(fr < lo) | (fr > hi)] = 0; return np.fft.irfft(f, n)
t = lambda s: np.arange(int(SR * s)) / SR
# נקישת אבן על שולחן עץ: "טיק" גבוה + "טוק" נמוך + התיישבות
n = int(SR * .12)
clack = bandnoise(n, 1800, 4200) * env(n, 6) * 1.0 + np.sin(2 * np.pi * 190 * t(.12)) * env(n, 4) * .5
second = np.zeros(n); k = int(SR * .045); second[k:] = (bandnoise(n - k, 2500, 4500) * env(n - k, 8)) * .3
save('clack', clack + second)
n2 = int(SR * .06); save('pick', bandnoise(n2, 2000, 5000) * env(n2, 6) + np.sin(2 * np.pi * 260 * t(.06)) * env(n2, 4) * .2)
n3 = int(SR * .25); save('slide', bandnoise(n3, 900, 3000) * np.sin(np.linspace(0, np.pi, n3)) ** 2)
k1 = np.concatenate([bandnoise(int(SR * .1), 60, 600) * env(int(SR * .1), 3) + np.sin(2 * np.pi * 95 * t(.1)) * env(int(SR * .1), 2), np.zeros(int(SR * .07))])
save('knock', np.concatenate([k1, k1 * .9]))
ch = sum(np.sin(2 * np.pi * f * t(.9)) * env(int(SR * .9), 2) * a for f, a in [(784, 1), (1175, .7), (1568, .4)])
ch[int(SR * .09):] += (np.sin(2 * np.pi * 1175 * t(.9)) * env(int(SR * .9), 2))[: len(ch) - int(SR * .09)] * .8
save('chime', ch)
sh = np.zeros(int(SR * 1.0))
for i in range(9):
    st = int(SR * (i * .09 + np.random.rand() * .03)); m = int(SR * .05); sh[st:st + m] += bandnoise(m, 2000, 4500) * env(m, 6) * (.5 + np.random.rand() * .5)
save('shuffle', sh)
print('sfx ok')
