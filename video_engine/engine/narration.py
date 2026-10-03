"""Script text -> raw narration track (like raw footage, with natural pauses) + word timings."""
import json
import numpy as np
from scipy.signal import resample_poly
from .tts import synth_sentence
from .audio import SR


PUNCT = ",.?!:;…—–\"“”'()"
TTS_SUBS = [("ב-AI", "באייאיי"), ("ה-AI", "האייאיי"), ("AI", "אייאיי"), ("—", " "), ("…", ".")]


def display_words(sentence):
    return [w.strip(PUNCT) for w in sentence.split() if w.strip(PUNCT)]


def tts_text(sentence):
    for a, b in TTS_SUBS:
        sentence = sentence.replace(a, b)
    return sentence


def build(sentences, wav_out, words_out, pauses=None, lead=0.8, seed=1):
    rs = np.random.RandomState(seed)
    parts, words, t = [np.zeros(int(lead * SR), np.float32)], [], lead
    for k, s in enumerate(sentences):
        a, sr, ws = synth_sentence(tts_text(s))
        disp = display_words(s)
        if len(disp) == len(ws):  # captions show the script spelling, timing from the voice
            for w, d in zip(ws, disp): w["word"] = d
        else:
            print(f"  word count mismatch in sentence {k}: {len(ws)} vs {len(disp)}")
        a = resample_poly(a, SR, sr).astype(np.float32)
        for w in ws:
            words.append({"word": w["word"], "start": round(t + w["start"], 3),
                          "end": round(t + float(w["end"]), 3), "sentence": k})
        parts.append(a); t += len(a) / SR
        gap = pauses[k] if pauses else rs.uniform(0.7, 1.3)  # raw-take pauses, cut later
        parts.append(np.zeros(int(gap * SR), np.float32)); t += gap
    audio = np.concatenate(parts)
    from .audio import write_wav
    write_wav(wav_out, audio * 0.9)
    json.dump(words, open(words_out, "w"), ensure_ascii=False, indent=1)
    return audio, words
