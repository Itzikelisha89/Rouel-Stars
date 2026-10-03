"""Hebrew text -> RGBA numpy, via Pillow + RAQM (correct RTL shaping).
Never use cv2.putText for Hebrew."""
import os
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

assert features.check("raqm"), "Pillow must have RAQM for Hebrew"
FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "fonts")
FONTS = {"sans": "Heebo.ttf", "serif": "FrankRuhlLibre.ttf", "display": "SuezOne-Regular.ttf"}


@lru_cache(maxsize=64)
def font(name="sans", size=80, weight=800):
    f = ImageFont.truetype(os.path.join(FONT_DIR, FONTS.get(name, name)), size,
                           layout_engine=ImageFont.Layout.RAQM)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


@lru_cache(maxsize=1024)
def text_rgba(text, size=80, color=(255, 255, 255), fname="sans", weight=800,
              stroke=0, stroke_color=(0, 0, 0), pad=None):
    """Return float32 HxWx4 (0..1) image of the text, tightly padded."""
    f = font(fname, size, weight)
    pad = int(size * 0.25) + stroke if pad is None else pad
    l, t, r, b = f.getbbox(text, direction="rtl", language="he", stroke_width=stroke)
    w, h = r - l + 2 * pad, b - t + 2 * pad
    im = Image.new("RGBA", (max(w, 1), max(h, 1)), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=f, fill=tuple(color) + (255,),
                            direction="rtl", language="he", stroke_width=stroke,
                            stroke_fill=tuple(stroke_color) + (255,))
    a = np.asarray(im).astype(np.float32) / 255.0
    a.setflags(write=False)
    return a


def text_size(text, size=80, fname="sans", weight=800):
    a = text_rgba(text, size, fname=fname, weight=weight)
    return a.shape[1], a.shape[0]
