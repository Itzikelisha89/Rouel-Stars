"""Parallel renderer: one pure function frame(t) -> image, many cores, ffmpeg encode."""
import multiprocessing as mp
import subprocess
import time
import numpy as np

_FN = None


def _job(args):
    t, = args
    img = _FN(t)
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()


def render(frame_fn, duration, out_path, fps=30, size=(1080, 1920), audio=None,
           workers=4, t0=0.0, crf=16, preset="slow"):
    global _FN
    _FN = frame_fn
    n = int(round((duration - t0) * fps))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{size[0]}x{size[1]}", "-r", str(fps), "-i", "-"]
    if audio:
        cmd += ["-ss", str(t0), "-i", audio]
    cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-colorspace", "bt709", "-movflags", "+faststart"]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest"]
    cmd += [out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    st = time.time()
    with mp.get_context("fork").Pool(workers) as pool:
        for k, buf in enumerate(pool.imap(_job, [(t0 + i / fps,) for i in range(n)], chunksize=2)):
            proc.stdin.write(buf)
            if k % 150 == 0:
                print(f"  frame {k}/{n}  {time.time() - st:.0f}s", flush=True)
    proc.stdin.close(); proc.wait()
    print(f"  done {n} frames in {time.time() - st:.0f}s -> {out_path}")
