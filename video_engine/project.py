"""This video's edit. Usage:  python3 project.py v1   |   python3 project.py full [t0 t1]"""
import json, os, sys
import numpy as np
from engine.source import SlideshowSource
from engine.timemap import TimeMap
from engine.edit import Edit
from engine import audio as A
from engine.render import render
from engine import contact

ROOT = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(ROOT, "build")
P = lambda n: os.path.join(ROOT, "assets", "photos", n)

# one shot per sentence: photo, framing, Ken Burns
SHOTS = [
    dict(photo=P("p1_civil.jpg"), zoom=(1.0, 1.06), focus=(.5, .45)),             # 0 שלום, אני עידו עמיר (הצתה)
    dict(photo=P("p4_event.jpg"), zoom=(1.15, 1.22), focus=(.5, .4)),             # 1 ...ב-AI (פיקסלים)
    dict(photo=P("p2_office.jpg"), zoom=(1.0, 1.08), focus=(.5, .5)),             # 2 מערך ספיר (כותרת)
    dict(photo=P("p2_office.jpg"), zoom=(1.0, 1.03), focus=(.5, .5)),             # 3 מחפשים את עידו (יציאה מהמסגרת)
    dict(photo=P("p1_civil.jpg"), zoom=(1.1, 1.18), focus=(.5, .35)),             # 4 בעיה ברשת (ניפוץ)
    dict(photo=P("p4_event.jpg"), zoom=(1.0, 1.05), focus=(.5, .5)),              # 5 ולמה? (עצירת זמן)
    dict(photo=P("p2_office.jpg"), zoom=(1.0, 1.05), focus=(.5, .5)),             # 6 מפקד הרשת (הולוגרמה)
    dict(photo=P("p1_civil.jpg"), zoom=(1.0, 1.04), focus=(.5, .5)),              # 7 כי אני עידו עמיר (ענק)
    dict(photo=P("p3_selfie.jpg"), zoom=(1.0, 1.08), focus=(.5, .5)),             # 8 עובדות (חותמות)
    dict(photo=P("p2_office.jpg"), zoom=(1.08, 1.12), focus=(.5, .45)),           # 9 יודע AI (קובייה)
    dict(photo=P("p2_office.jpg"), zoom=(1.12, 1.16), focus=(.5, .45)),           # 10 יודע רשתות
    dict(photo=P("p2_office.jpg"), zoom=(1.16, 1.2), focus=(.5, .45)),            # 11 לעבוד
    dict(photo=P("p4_event.jpg"), zoom=(1.0, 1.04), focus=(.5, .45)),             # 12 צריכים מומחה (טלפון)
    dict(photo=P("p4_event.jpg"), zoom=(1.04, 1.08), focus=(.5, .45)),            # 13 מפקד רשת
    dict(photo=P("p4_event.jpg"), zoom=(1.08, 1.12), focus=(.5, .45)),            # 14 שהכול יעבוד
    dict(photo=P("p4_event.jpg"), zoom=(1.0, 1.06), focus=(.5, .5)),              # 15 למי לפנות (תגובה)
    dict(photo=P("p2_office.jpg"), zoom=(1.0, 1.06), focus=(.5, .5)),             # 16 לעידו עמיר (כותרת)
    dict(photo=P("p5_dinner.jpg"), mode="fit", zoom=(1.12, 1.2), focus=(.5, .5)), # 17 דימה
    dict(photo=P("p4_event.jpg"), zoom=(1.05, 1.08), focus=(.5, .45)),            # 18 אני עידו עמיר (עקוב)
    dict(photo=P("p4_event.jpg"), zoom=(1.08, 1.1), focus=(.5, .45)),             # 19
    dict(photo=P("p4_event.jpg"), zoom=(1.1, 1.12), focus=(.5, .45)),             # 20
]


def load():
    words = json.load(open(os.path.join(B, "words.json")))
    from scipy.io import wavfile
    sr, raw = wavfile.read(os.path.join(B, "raw_narration.wav"))
    raw = raw.astype(np.float32) / 32768
    # shots switch in the middle of the pause before each sentence
    nsent = max(w["sentence"] for w in words) + 1
    starts = [min(w["start"] for w in words if w["sentence"] == k) for k in range(nsent)]
    ends = [max(w["end"] for w in words if w["sentence"] == k) for k in range(nsent)]
    shots = []
    for k in range(nsent):
        # switch just before the next sentence's speech, so kept footage after a word
        # (room for an effect to finish) stays on the same shot
        s0 = 0 if k == 0 else max(ends[k - 1] + .05, starts[k] - .2)
        s1 = max(ends[k] + .05, starts[k + 1] - .2) if k + 1 < nsent else len(raw) / sr + 5
        shots.append(dict(SHOTS[k], src0=s0, src1=s1))
    return words, raw, sr, shots


def wsrc(words, text, n=1):
    k = 0
    for w in words:
        if w["word"] == text:
            k += 1
            if k == n: return w
    raise KeyError(text)


def build(with_fx):
    words, raw, sr, shots = load()
    freezes, holds = [], []
    if with_fx:
        import effects_plan
        freezes, holds = effects_plan.timing(words)
    tm = TimeMap.from_silences(raw, sr, freezes=freezes, holds=holds)
    src = SlideshowSource(shots, os.path.join(ROOT, "cache", "masks"))
    ed = Edit(src, tm, words)
    if with_fx:
        effects_plan.add_effects(ed)
    return ed, tm, raw, sr


def mix(ed, tm, raw, sr, out_wav, with_fx):
    total = ed.duration + (ed.rewind[1] if ed.rewind else 0)
    m = A.Mixer(total)
    m.add(tm.apply_audio(raw, sr), 0, 1.0, "voice")
    for t, clip, g, name in ed.sounds():
        m.add(clip, t, g, "sfx", name)
    m.add(A.music_bed(total + 1), 0, 1.0, "music")
    start = ed.music_start if with_fx else 0.0
    m.music_env(ed.music_kills() + ([(ed.duration, total + 1)] if ed.rewind else []), start=start)
    x = m.mixdown()
    if ed.rewind:
        from effects_plan import rewind_audio
        x = rewind_audio(x, ed)
    tmp = out_wav + ".pre.wav"
    A.write_wav(tmp, x)
    A.loudnorm(tmp, out_wav)
    return m.log


def word_at(ed):
    def f(t):
        cur = ""
        for w in ed.words:
            if w["t"] <= t: cur = w["word"]
        return cur
    return f


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "v1"
    with_fx = mode == "full"
    ed, tm, raw, sr = build(with_fx)
    print(tm.table())
    total = ed.duration + (ed.rewind[1] if ed.rewind else 0)
    t0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    t1 = float(sys.argv[3]) if len(sys.argv) > 3 else total
    name = f"{mode}" if len(sys.argv) <= 2 else f"{mode}_{t0:.0f}_{t1:.0f}"
    wav = os.path.join(B, f"{mode}_mix.wav")
    log = mix(ed, tm, raw, sr, wav, with_fx)
    json.dump([(round(t, 3), n) for t, n in log], open(os.path.join(B, f"{mode}_sfx_log.json"), "w"), ensure_ascii=False)
    out = os.path.join(B, f"{name}.mp4")
    render(ed.frame, t1, out, audio=wav, t0=t0, workers=os.cpu_count())
    if len(sys.argv) <= 2:
        os.makedirs(os.path.join(B, "contact"), exist_ok=True)
        ps = contact.sheets(out, os.path.join(B, "contact", mode), label_fn=word_at(ed))
        print("contact sheets:", len(ps))
