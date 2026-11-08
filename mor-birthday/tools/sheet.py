# contact sheet of build/stills for quick review
import sys, glob
from PIL import Image, ImageDraw
fs = sorted(glob.glob('build/stills/*.jpg'))
w = 800; h = 450; cols = 2; rows = (len(fs) + 1) // 2
S = Image.new('RGB', (w * cols, h * rows), 'gray'); d = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(f).resize((w, h)); S.paste(im, ((i % cols) * w, (i // cols) * h))
    d.text(((i % cols) * w + 8, (i // cols) * h + 8), f.split('/')[-1], fill='yellow')
S.save(sys.argv[1] if len(sys.argv) > 1 else 'build/sheet.jpg', quality=85)
