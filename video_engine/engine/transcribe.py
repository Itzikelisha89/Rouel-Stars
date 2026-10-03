"""Word-level transcription with whisper.cpp + the ivrit.ai Hebrew model.

Model: ivrit-ai/whisper-large-v3-turbo-ggml (Hugging Face). Needs huggingface.co
to be reachable once for the download; after that it runs locally and offline.
"""
import json, os, subprocess, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
WHISPER = os.path.join(ROOT, "tools", "whisper.cpp", "build", "bin", "whisper-cli")
MODEL_DIR = os.path.join(ROOT, "tools", "models")
HF_REPO = "ivrit-ai/whisper-large-v3-turbo-ggml"


def ensure_model():
    os.makedirs(MODEL_DIR, exist_ok=True)
    for f in os.listdir(MODEL_DIR):
        if f.endswith(".bin"):
            return os.path.join(MODEL_DIR, f)
    files = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{HF_REPO}"))["siblings"]
    name = next(s["rfilename"] for s in files if s["rfilename"].endswith(".bin"))
    out = os.path.join(MODEL_DIR, os.path.basename(name))
    subprocess.run(["curl", "-sSfL", "-o", out, f"https://huggingface.co/{HF_REPO}/resolve/main/{name}"], check=True)
    return out


def transcribe(media, out_json, lang="he"):
    model = ensure_model()
    wav = out_json + ".16k.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", media, "-ar", "16000", "-ac", "1", wav], check=True)
    base = out_json + ".whisper"
    # full JSON with DTW token times; words are rebuilt from tokens (a leading space starts a word)
    subprocess.run([WHISPER, "-m", model, "-f", wav, "-l", lang, "-ojf", "-of", base,
                    "-dtw", "large.v3.turbo", "-nfa", "-t", str(os.cpu_count())], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    j = json.load(open(base + ".json"))
    words = []
    for seg in j["transcription"]:
        seg_end = seg["offsets"]["to"] / 1000
        for tok in seg.get("tokens", []):
            txt = tok["text"]
            if txt.startswith("[_") or not txt.strip():
                continue
            t = tok.get("t_dtw", -1)
            t = t / 100 if t is not None and t >= 0 else tok["offsets"]["from"] / 1000
            if txt.startswith(" ") or not words:
                words.append({"word": txt.strip(), "start": t, "end": seg_end})
            else:
                words[-1]["word"] += txt
        # end of a word = start of the next word in the segment
    for k in range(len(words) - 1):
        words[k]["end"] = max(words[k]["start"] + .04, min(words[k]["end"], words[k + 1]["start"]))
    json.dump(words, open(out_json, "w"), ensure_ascii=False, indent=1)
    return words
