import os, sys
os.environ["VE_SIZE"] = "1920x1080"
import cv2, numpy as np
from multiprocessing import get_context
import arnica_project as AP
ed, tm, raw, sr = AP.build()
Wd = ed.ws
T = [("title", Wd(2, "הארניקה")["t"] + .7), ("comment", Wd(8, "הפלא")["t"] + 1.6), ("gift", Wd(10, "במתנה")["t"] + .5),
     ("phone", Wd(11, "באתר")["t"] + .25), ("phone2", Wd(11, "בטלפון")["t"] + .6), ("end", ed.duration - .1),
     ("erase", Wd(6, "מורחים")["t"] + .9), ("pain", Wd(5, "נקע")["t"] + .2)]
def job(a):
    n, t = a
    im = (np.clip(ed.frame(t), 0, 1) * 255).astype(np.uint8)
    im = cv2.resize(im, (480, 270), interpolation=cv2.INTER_AREA)
    cv2.putText(im, f"{n} {t:.2f}", (6, 22), 0, .6, (255, 255, 0), 2); return im
with get_context("fork").Pool(4) as p: ims = p.map(job, T)
while len(ims) % 4: ims.append(np.zeros_like(ims[0]))
cv2.imwrite(sys.argv[1], cv2.cvtColor(np.vstack([np.hstack(ims[i:i + 4]) for i in range(0, len(ims), 4)]), cv2.COLOR_RGB2BGR))
print("duration", round(ed.duration, 1))
