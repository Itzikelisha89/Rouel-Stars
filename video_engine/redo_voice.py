"""Re-generate only weak sentences (best of several takes, alternate spellings), keep the best take on disk.
Usage: python3 redo_voice.py [ido|arnica]"""
import json, os, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from engine import voice_clone as V
from engine.narration import display_words
from engine.transcribe import transcribe

PROJECTS = {
    "ido": dict(script="script.txt", base="build/words.json", ref="assets/voice/ido_ref.wav", variants={
        18: ["אֲנִי, עִידּוֹ עָמִיר.", "אני — עידו עמיר!", "אֲנִי עִידּוֹ עָמִיר."],
        20: ["וּמְפַקֵּד הָרֶשֶׁת, הכי טוב.", "ומפקד הרשת — הכי טוב!", "וּמְפַקֵּד הָרֶשֶׁת הֲכִי טוֹב."],
        2: ["אני עידו עמיר, מומחה ה-AI של מערך ספיר.", "אֲנִי עִידּוֹ עָמִיר — מומחה ה-AI של מערך ספיר."]}),
    "arnica": dict(script="arnica_script.txt", base="build_arnica/words.json",
                   ref=__import__("make_arnica_voice").VOICES, variants={
        0: ["כְּאֵב בַּגַּב, בַּבִּרְכַּיִם אוֹ בַּמִּפְרָקִים, יָכוֹל לִגְנוֹב לָכֶם אֶת הַיּוֹם.", "כאב בגב, בברכיים, או במפרקים — יכול לגנוב לכם את היום."],
        5: ["הוּא מְשַׁלֵּב צִמְחֵי מַרְפֵּא וּשְׁמָנִים אֲרוֹמָטִיִּים: אַרְנִיקָה, חֶמְאַת שֵׁיאָה, מֶנְטָה וְקַמְפוֹר.",
            "הוא משלב צמחי מרפא ושמנים ארומתיים. ארניקה. חמאת שיאה. מנטה. וקמפור."],
        8: ["נִבְדַּק דֶּרְמָטוֹלוֹגִית, וּמַתְאִים גַּם לְעוֹר רָגִישׁ.", "נבדק דרמטולוגית. ומתאים גם לעור רגיש."]}),
}


def redo(script, base, ref, variants, tries=6):
    sents = [l.strip() for l in open(script) if l.strip()]
    m = V._tts()
    for k, s in enumerate(sents):
        f = f"{base}.s{k}.wav"
        disp = display_words(s)
        _, score = V._align(disp, json.load(open(f + ".json")), 0)
        if score >= 0.9:
            continue
        print(f"sentence {k}: {score:.2f} -> redo", flush=True)
        best = (score, None, None)
        texts = (variants.get(k, [s]) * tries)[:tries]
        for i, t in enumerate(texts):
            rr = ref[k] if isinstance(ref, (list, tuple)) else ref
            kw = {"audio_prompt_path": rr} if rr else {}
            wav = m.generate(V.clone_text(t), language_id="he", **kw)
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


if __name__ == "__main__":
    os.environ.setdefault("TQDM_DISABLE", "1")
    redo(**PROJECTS[sys.argv[1] if len(sys.argv) > 1 else "ido"])
