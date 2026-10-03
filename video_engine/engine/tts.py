"""Hebrew narration (TTS) with exact word timings.

Backend now: espeak-ng via ctypes (local, offline). The WORD events of the
library give the audio position of each word, so timings are exact.
When huggingface.co is reachable, a better Hebrew voice can be plugged in
here with the same output format: (audio float32 mono, sr, [words]).
"""
import ctypes, re
import numpy as np

_EV_WORD, _EV_END = 1, 5


class _Event(ctypes.Structure):
    _fields_ = [("type", ctypes.c_int), ("unique_identifier", ctypes.c_uint),
                ("text_position", ctypes.c_int), ("length", ctypes.c_int),
                ("audio_position", ctypes.c_int), ("sample", ctypes.c_int),
                ("user_data", ctypes.c_void_p), ("id", ctypes.c_char * 8)]


_CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int,
                       ctypes.POINTER(_Event))


def synth_sentence(text, rate=150, pitch=42, voice=b"he"):
    lib = ctypes.CDLL("libespeak-ng.so.1")
    sr = lib.espeak_Initialize(2, 0, None, 0)  # AUDIO_OUTPUT_SYNCHRONOUS
    lib.espeak_SetVoiceByName(voice)
    lib.espeak_SetParameter(1, rate, 0)   # espeakRATE
    lib.espeak_SetParameter(3, pitch, 0)  # espeakPITCH
    chunks, events = [], []

    def cb(wav, n, ev):
        if n > 0:
            chunks.append(np.ctypeslib.as_array(wav, shape=(n,)).copy())
        i = 0
        while ev[i].type != 0:
            if ev[i].type == _EV_WORD:
                events.append((ev[i].text_position, ev[i].length, ev[i].sample))
            i += 1
        return 0

    cbf = _CB(cb)
    lib.espeak_SetSynthCallback(cbf)
    b = text.encode("utf-8")
    lib.espeak_Synth(b, len(b) + 1, 0, 1, 0, 1, None, None)
    lib.espeak_Synchronize()
    audio = (np.concatenate(chunks).astype(np.float32) / 32768.0) if chunks else np.zeros(1, np.float32)
    # map word events -> word strings, start sample; end = next start or energy end
    words = []
    for k, (pos, ln, samp) in enumerate(events):
        w = text[pos - 1:pos - 1 + ln]
        w = re.sub(r"[^\w\"'״׳-]", "", w)
        if w:
            words.append([w, samp])
    out = []
    for k, (w, s) in enumerate(words):
        e = words[k + 1][1] if k + 1 < len(words) else len(audio)
        seg = audio[s:e]
        # trim trailing silence of the word
        env = np.abs(seg)
        idx = np.where(env > 0.02)[0]
        e2 = s + (idx[-1] + 1 if len(idx) else len(seg))
        out.append({"word": w, "start": s / sr, "end": e2 / sr})
    return audio, sr, out
