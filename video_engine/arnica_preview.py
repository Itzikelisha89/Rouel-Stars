import os, sys
os.environ["VE_SIZE"] = "1920x1080"
import cv2, numpy as np
from multiprocessing import get_context
import arnica_project as AP
ed, tm, raw, sr = AP.build()
Wd = ed.ws
T = [("gray", 1.0), ("ignite", Wd(2, "טבעית")["t"] + .2), ("shatter", Wd(2, "להקל")["t"] + .6), ("pop", Wd(3, "אלישע")["t"]),
     ("super", Wd(3, "טבעית")["t"]), ("title", Wd(4, "הארניקה")["t"] + .8), ("cube", Wd(5, "שיאה")["t"] + .15),
     ("stamps", Wd(6, "כאבי")["t"] + .3), ("erase", Wd(7, "פעם")["t"] + .4), ("seal", Wd(8, "רגיש")["t"]),
     ("reviews", Wd(9, "הפלא")["t"] + .5), ("quote", Wd(10, "גדולה")["t"]), ("price", Wd(11, "עשרים")["t"] + .3),
     ("gift", Wd(12, "במתנה")["t"] + .5), ("end1", Wd(13, "יהושע")["t"]), ("end2", ed.duration - .1)]
def job(a):
    n, t = a
    im = (np.clip(ed.frame(t), 0, 1) * 255).astype(np.uint8)
    im = cv2.resize(im, (480, 270), interpolation=cv2.INTER_AREA)
    cv2.putText(im, f"{n} {t:.2f}", (6, 22), 0, .6, (255, 255, 0), 2); return im
with get_context("fork").Pool(4) as p: ims = p.map(job, T)
while len(ims) % 4: ims.append(np.zeros_like(ims[0]))
cv2.imwrite(sys.argv[1], cv2.cvtColor(np.vstack([np.hstack(ims[i:i + 4]) for i in range(0, len(ims), 4)]), cv2.COLOR_RGB2BGR))
print("duration", round(ed.duration, 1))
