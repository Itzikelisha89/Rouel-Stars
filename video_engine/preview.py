import sys, cv2, numpy as np, project
from multiprocessing import get_context
ed, tm, raw, sr = project.build(True)
W_ = ed.word
f0 = tm.freeze_windows()[0][0]
W_ = ed.ws
T = [("ign", W_(0, "עמיר")["t"] + .2), ("pix", W_(1, "ב-AI")["t"] + .5), ("title", W_(2, "ספיר")["t"] + .7),
     ("pop", W_(3, "עמיר")["t"] + .5), ("shat", W_(4, "בעיה")["t"] + .6), ("freeze", f0 + .8),
     ("holo", W_(6, "טוב")["t"] + .3), ("giant", W_(7, "עמיר")["t"] + 1.2), ("stamp", W_(8, "עובדות", 2)["t"] + .3),
     ("cube", W_(10, "רשתות")["t"] - .05), ("cube3", W_(11, "לעבוד")["t"] + .4), ("phone", W_(13, "מפקד")["t"] + .2),
     ("dm", W_(15, "לפנות")["t"] + 1.8), ("name", W_(16, "עמיר")["t"] + .6), ("dima", W_(17, "אוהב")["t"] + .5),
     ("end", W_(20, "טוב")["t"] + .6)]
def job(a):
    n, t = a
    im = np.clip(ed.frame(t), 0, 1)
    im = cv2.resize((im * 255).astype(np.uint8), (270, 480), interpolation=cv2.INTER_AREA)
    cv2.putText(im, f"{n} {t:.2f}", (6, 22), 0, .6, (255, 255, 0), 2)
    return im
with get_context("fork").Pool(4) as p: ims = p.map(job, T)
while len(ims) % 8: ims.append(np.zeros_like(ims[0]))
rows = [np.hstack(ims[i:i + 8]) for i in range(0, len(ims), 8)]
cv2.imwrite(sys.argv[1], cv2.cvtColor(np.vstack(rows), cv2.COLOR_RGB2BGR))
