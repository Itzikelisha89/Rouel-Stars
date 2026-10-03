"""Contact sheets for self-checking: 6 frames per second, time printed on each."""
import subprocess
import numpy as np
from PIL import Image, ImageDraw
from .text import font


def _frames(video, fps=6, tw=180, th=320, t0=None, t1=None):
    cmd = ["ffmpeg", "-loglevel", "error"]
    if t0 is not None: cmd += ["-ss", f"{t0:.3f}"]
    cmd += ["-i", video]
    if t1 is not None: cmd += ["-t", f"{t1 - (t0 or 0):.3f}"]
    cmd += ["-vf", f"fps={fps},scale={tw}:{th}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, th, tw, 3)


def sheets(video, out_prefix, fps=6, secs_per_sheet=6, label_fn=None, tw=180, th=320):
    fr = _frames(video, fps, tw, th)
    per = fps * secs_per_sheet
    paths = []
    f = font("sans", 20, 700)
    for si in range(0, len(fr), per):
        chunk = fr[si:si + per]
        rows = int(np.ceil(len(chunk) / fps))
        sheet = Image.new("RGB", (fps * tw, rows * (th + 30)), (20, 20, 20))
        d = ImageDraw.Draw(sheet)
        for k, im in enumerate(chunk):
            t = (si + k) / fps
            x, y = (k % fps) * tw, (k // fps) * (th + 30)
            sheet.paste(Image.fromarray(im), (x, y + 30))
            lab = f"{t:05.2f}s"
            d.text((x + 4, y + 3), lab, font=f, fill=(255, 220, 90))
            if label_fn:
                w = label_fn(t)
                if w: d.text((x + tw - 4, y + 3), w, font=f, fill=(255, 255, 255), anchor="ra",
                             direction="rtl", language="he")
        p = f"{out_prefix}_{si // per:02d}.jpg"
        sheet.save(p, quality=85); paths.append(p)
    return paths


def effect_sheet(video, checks, out_path, fps=6, tw=150, th=266):
    """checks: [(name, word, t_word)] -> one row per effect: frames t_word-0.5 .. +1.5,
    the frame at the word outlined in red."""
    f = font("sans", 18, 700)
    cols = int(2.0 * fps)
    sheet = Image.new("RGB", (220 + cols * tw, len(checks) * (th + 24)), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    for r, (name, word, tw0) in enumerate(checks):
        t0 = max(0, tw0 - 0.5)
        fr = _frames(video, fps, tw, th, t0, t0 + 2.0)
        y = r * (th + 24)
        d.text((210, y + 40), name, font=f, fill=(255, 220, 90), anchor="ra", direction="rtl", language="he")
        d.text((210, y + 70), f"«{word}»", font=f, fill=(255, 255, 255), anchor="ra", direction="rtl", language="he")
        d.text((210, y + 100), f"{tw0:.2f}s", font=f, fill=(180, 180, 180), anchor="ra")
        for k, im in enumerate(fr[:cols]):
            t = t0 + k / fps
            x = 220 + k * tw
            sheet.paste(Image.fromarray(im), (x, y + 24))
            d.text((x + 3, y + 2), f"{t:.2f}", font=f, fill=(200, 200, 200))
            if abs(t - tw0) < 0.5 / fps + 1e-6:
                d.rectangle([x, y + 24, x + tw - 1, y + 24 + th - 1], outline=(255, 40, 40), width=4)
    sheet.save(out_path, quality=85)
    return out_path
