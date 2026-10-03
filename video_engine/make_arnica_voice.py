"""Narrator for the arnica ad: Chatterbox built-in voice (no cloning), checked with ivrit.ai."""
import os
os.environ.setdefault("TQDM_DISABLE", "1")
from engine import voice_clone as V
sents = [l.strip() for l in open("arnica_script.txt") if l.strip()]
P = [0.8, 1.8, 0.8, 1.0, 1.1, 0.7, 1.0, 1.1, 2.4, 1.2, 1.4, 1.0, 3.8]
a, w = V.build(sents, None, "build_arnica/raw_narration.wav", "build_arnica/words.json", P,
               log=lambda m: print(m, flush=True))
print("done", round(len(a) / 48000, 1), "s,", len(w), "words")
