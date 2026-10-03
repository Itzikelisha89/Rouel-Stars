"""Narration in Ido's voice (he agreed): clone from assets/voice/ido_ref.wav, transcribe with ivrit.ai."""
import os, sys
os.environ.setdefault("TQDM_DISABLE", "1")
from engine import voice_clone as V
sents = [l.strip() for l in open("script.txt") if l.strip()]
P = [1.0, 2.1, 1.0, 1.2, 1.0, 1.0, 1.3, 1.6, 1.2, 0.8, 0.8, 1.1, 0.7, 0.7, 0.9, 2.5, 1.1, 1.1, 0.7, 0.7, 2.1]
a, w = V.build(sents, "assets/voice/ido_ref.wav", "build/raw_narration.wav", "build/words.json", P,
               log=lambda m: print(m, flush=True))
print("done", round(len(a) / 48000, 1), "s,", len(w), "words")
