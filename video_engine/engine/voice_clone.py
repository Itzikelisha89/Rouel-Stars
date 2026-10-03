"""Narration in Ido's own voice (with his consent): Chatterbox Multilingual (Hebrew),
zero-shot from a short reference recording; word timings come from transcribing the
result with ivrit.ai (engine/transcribe.py). Models download once from huggingface.co."""
import difflib, json
import numpy as np
from scipy.signal import resample_poly
from .audio import SR, write_wav
from .narration import display_words, tts_text
from .transcribe import transcribe

_model = None


def _tts():
    global _model
    if _model is None:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        _model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
    return _model


def build(sentences, ref_wav, wav_out, words_out, pauses, lead=0.8):
    m = _tts()
    parts, spans, t = [np.zeros(int(lead * SR), np.float32)], [], lead
    for k, s in enumerate(sentences):
        wav = m.generate(tts_text(s).replace("אייאיי", "AI"), language_id="he", audio_prompt_path=ref_wav)
        a = resample_poly(wav.squeeze().numpy().astype(np.float32), SR, m.sr)
        spans.append((t, t + len(a) / SR)); parts.append(a); t += len(a) / SR
        parts.append(np.zeros(int(pauses[k] * SR), np.float32)); t += pauses[k]
    audio = np.concatenate(parts)
    write_wav(wav_out, audio * 0.95)
    heard = transcribe(wav_out, words_out + ".asr.json")
    # align the transcript to the script words, so captions keep the exact script spelling
    script = [(k, w) for k, s in enumerate(sentences) for w in display_words(s)]
    norm = lambda w: w.strip(",.?!-—…\"").replace("-", "")
    sm = difflib.SequenceMatcher(a=[norm(w) for _, w in script], b=[norm(h["word"]) for h in heard], autojunk=False)
    times = [None] * len(script)
    for blk in sm.get_matching_blocks():
        for i in range(blk.size):
            times[blk.a + i] = (heard[blk.b + i]["start"], heard[blk.b + i]["end"])
    # words the ASR missed: interpolate inside their sentence span
    words = []
    for i, (k, w) in enumerate(script):
        if times[i] is None:
            prev = next((times[j][1] for j in range(i - 1, -1, -1) if times[j]), spans[k][0])
            nxt = next((times[j][0] for j in range(i + 1, len(script)) if times[j]), spans[k][1])
            times[i] = (prev, max(prev + .05, (prev + nxt) / 2))
        words.append({"word": w, "start": round(times[i][0], 3), "end": round(times[i][1], 3), "sentence": k})
    json.dump(words, open(words_out, "w"), ensure_ascii=False, indent=1)
    return audio, words
