"""Arnica TV ad narration: narrator (Chatterbox built-in voice) + Yehoshua's own voice (he agreed),
every sentence checked against the script with ivrit.ai."""
import os
os.environ.setdefault("TQDM_DISABLE", "1")
from engine import voice_clone as V
sents = [l.strip() for l in open("arnica_script.txt") if l.strip()]
Y = "assets/voice/yehoshua_ref.wav"
VOICES = [None, None, None, Y, Y, Y, None, None, None, None, Y, None, None, None]  # None = narrator
P = [0.6, 0.7, 1.8, 0.8, 1.0, 1.1, 0.7, 0.9, 1.1, 1.9, 0.9, 1.2, 1.4, 3.8]
if __name__ == "__main__":
    a, w = V.build(sents, VOICES, "build_arnica/raw_narration.wav", "build_arnica/words.json", P,
                   log=lambda m: print(m, flush=True))
    print("done", round(len(a) / 48000, 1), "s,", len(w), "words")
