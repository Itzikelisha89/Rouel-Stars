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
    base = out_json[:-5]
    # --max-len 1 + --split-on-word => one segment per word with its own timestamps
    subprocess.run([WHISPER, "-m", model, "-f", wav, "-l", lang, "-ml", "1", "-sow",
                    "-oj", "-of", base, "-t", str(os.cpu_count())], check=True)
    j = json.load(open(base + ".json"))
    words = []
    for seg in j["transcription"]:
        w = seg["text"].strip()
        if w:
            words.append({"word": w, "start": seg["offsets"]["from"] / 1000, "end": seg["offsets"]["to"] / 1000})
    json.dump(words, open(out_json, "w"), ensure_ascii=False, indent=1)
    return words
