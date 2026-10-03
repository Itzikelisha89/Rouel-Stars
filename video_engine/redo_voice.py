"""Re-generate only weak sentences (best of several takes, alternate spellings), then reassemble."""
import json, os
import numpy as np
from scipy.io import wavfile
from engine import voice_clone as V
from engine.narration import display_words
from engine.transcribe import transcribe
sents = [l.strip() for l in open("script.txt") if l.strip()]
VARIANTS = {18: ["אֲנִי, עִידּוֹ עָמִיר.", "אני — עידו עמיר!", "אֲנִי עִידּוֹ עָמִיר."],
            20: ["וּמְפַקֵּד הָרֶשֶׁת, הכי טוב.", "ומפקד הרשת — הכי טוב!", "וּמְפַקֵּד הָרֶשֶׁת הֲכִי טוֹב."],
            2: ["אני עידו עמיר, מומחה ה-AI של מערך ספיר.", "אֲנִי עִידּוֹ עָמִיר — מומחה ה-AI של מערך ספיר."]}
m = V._tts()
base = "build/words.json"
for k, s in enumerate(sents):
    f = f"{base}.s{k}.wav"
    disp = display_words(s)
    _, score = V._align(disp, json.load(open(f + ".json")), 0)
    if score >= 0.9:
        continue
    print(f"sentence {k}: {score:.2f} -> redo", flush=True)
    best = (score, None, None)
    texts = VARIANTS.get(k, [s]) * 2
    for i, t in enumerate(texts[:6]):
        wav = m.generate(V.clone_text(t), language_id="he", audio_prompt_path="assets/voice/ido_ref.wav")
        from scipy.signal import resample_poly
        a = V._trim(resample_poly(wav.squeeze().numpy().astype(np.float32), 48000, m.sr), 48000)
        tmp = f"{base}.s{k}.try{i}.wav"
        wavfile.write(tmp, 48000, (np.clip(a, -1, 1) * 32767).astype(np.int16))
        heard = transcribe(tmp, tmp + ".json")
        _, sc = V._align(disp, heard, 0)
        print(f"   try {i + 1}: {sc:.2f} | {' '.join(h['word'] for h in heard)}", flush=True)
        if sc > best[0]:
            best = (sc, tmp, heard)
        if sc >= 0.9:
            break
    if best[1]:
        os.replace(best[1], f); json.dump(best[2], open(f + ".json", "w"), ensure_ascii=False)
print("redo done", flush=True)
