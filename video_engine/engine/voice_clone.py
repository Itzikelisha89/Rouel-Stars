"""Narration in Ido's own voice (with his consent): Chatterbox Multilingual (Hebrew),
zero-shot from a short reference recording; word timings come from transcribing the
result with ivrit.ai (engine/transcribe.py). Models download once from huggingface.co."""
import difflib, json, os, re
import numpy as np
from scipy.signal import resample_poly
from .audio import SR, write_wav
from .narration import display_words, tts_text
from .transcribe import transcribe

_model = None


def _tts():
    global _model
    if _model is None:
        import glob, os, torch
        torch.set_num_threads(os.cpu_count())
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from chatterbox.models.tokenizers import tokenizer as tk
        from dicta_onnx import Dicta
        # Hebrew niqqud (Dicta) so names and words are pronounced correctly
        tk._dicta = Dicta(glob.glob(os.path.join(os.path.dirname(__file__), "..", "tools", "models", "dicta*.onnx"))[0])
        _model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
    return _model


def clone_text(s):
    """Spell non-Hebrew bits phonetically so the Hebrew voice says them right."""
    for a, b in (("ב-AI", "בְּאֵיי-אַיי"), ("ה-AI", "הָאֵיי-אַיי"), ("AI", "אֵיי-אַיי"), ("—", ","), ("…", ".")):
        s = s.replace(a, b)
    return s


def _trim(a, sr, thresh=0.02, pad=0.06):
    idx = np.where(np.abs(a) > thresh)[0]
    if not len(idx):
        return a
    return a[max(0, idx[0] - int(pad * sr)):idx[-1] + int(pad * sr)]


def _norm(w):
    w = re.sub(r"[\u200e\u200f\u202a-\u202e]", "", w)  # bidi marks from the transcriber
    w = w.strip(",.?!-—…\"").replace("-", "").replace(" ", "")
    for a in ("אייאיי", "איאיי"):
        w = w.replace(a, "AI")
    w = re.sub(r"A?\.?I", "AI", w)
    return SAME_SOUND.get(w, w)


# spellings the transcriber may choose for the same sound
SAME_SOUND = {"אמיר": "עמיר", "בלשת": "ברשת", "שהכל": "שהכול", "להכל": "להכול", "לאור": "לעור", "ציאה": "שיאה", "צייה": "שיאה", "כרמי": "קרמי"}


NUMBER_WORDS = {"120": ["מאה", "עשרים"], "129": ["מאה", "עשרים", "ותשע"], "100": ["מאה"], "10": ["עשר"]}


def _expand_numbers(heard):
    out = []
    for h in heard:
        parts = NUMBER_WORDS.get(re.sub(r"[^\d]", "", h["word"]) if re.fullmatch(r"\W*\d+\W*", h["word"]) else "")
        if parts:
            d = (h["end"] - h["start"]) / len(parts)
            out += [{"word": p, "start": h["start"] + i * d, "end": h["start"] + (i + 1) * d} for i, p in enumerate(parts)]
        else:
            out.append(h)
    return out


def _align(script_words, heard, offset):
    """Assign each script word the time of the matching heard word (interpolate the rest)."""
    heard = _expand_numbers(heard)
    sm = difflib.SequenceMatcher(a=[_norm(w) for w in script_words], b=[_norm(h["word"]) for h in heard], autojunk=False)
    times = [None] * len(script_words)
    for blk in sm.get_matching_blocks():
        for i in range(blk.size):
            h = heard[blk.b + i]; times[blk.a + i] = (h["start"], h["end"])
    # unmatched words: spread proportionally between known neighbours
    last = heard[-1]["end"] if heard else 0.5
    for i in range(len(times)):
        if times[i] is None:
            p = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), 0.0)
            n = next((times[j][0] for j in range(i + 1, len(times)) if times[j]), last)
            times[i] = (p, max(p + .05, p + (n - p) / 2))
    return [(offset + s, offset + e) for s, e in times], sm.ratio()


def build(sentences, ref_wav, wav_out, words_out, pauses, lead=0.8, takes=3, log=print):
    from scipy.io import wavfile
    m = _tts()
    parts, words, t = [np.zeros(int(lead * SR), np.float32)], [], lead
    for k, s in enumerate(sentences):
        disp = display_words(s)
        best = None
        tmp = words_out + f".s{k}.wav"
        if os.path.exists(tmp) and os.path.exists(tmp + ".json"):  # resume: reuse a finished take
            from scipy.io import wavfile as _wf
            a = _wf.read(tmp)[1].astype(np.float32) / 32767
            times, score = _align(disp, json.load(open(tmp + ".json")), 0.0)
            if score >= 0.85:
                best = (score, a, times); log(f"  sentence {k}: reused take (match {score:.2f})")
        for take in range(takes if best is None else 0):
            ref = ref_wav[k] if isinstance(ref_wav, (list, tuple)) else ref_wav  # per-sentence voice
            kw = {"audio_prompt_path": ref} if ref else {}  # no ref -> the model's built-in narrator voice
            wav = m.generate(clone_text(s), language_id="he", **kw)
            a = _trim(resample_poly(wav.squeeze().numpy().astype(np.float32), SR, m.sr), SR)
            tmp = words_out + f".s{k}.wav"
            wavfile.write(tmp, SR, (np.clip(a, -1, 1) * 32767).astype(np.int16))
            heard = transcribe(tmp, tmp + ".json")
            times, score = _align(disp, heard, 0.0)
            log(f"  sentence {k} take {take + 1}: match {score:.2f} | heard: {' '.join(h['word'] for h in heard)}")
            if best is None or score > best[0]:
                best = (score, a, times)
            if score >= 0.9:
                break
        score, a, times = best
        for w, (s0, s1) in zip(disp, times):
            words.append({"word": w, "start": round(t + s0, 3), "end": round(t + s1, 3), "sentence": k})
        parts.append(a); t += len(a) / SR
        parts.append(np.zeros(int(pauses[k] * SR), np.float32)); t += pauses[k]
    audio = np.concatenate(parts)
    write_wav(wav_out, audio * 0.95)
    json.dump(words, open(words_out, "w"), ensure_ascii=False, indent=1)
    return audio, words
