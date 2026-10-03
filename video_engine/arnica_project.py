"""TV ad (16:9, 60s) for the arnica cream of Yehoshua Elisha's clinic.
Usage: python3 arnica_project.py   |   python3 arnica_project.py t0 t1  (a section)"""
import os, sys, json
os.environ["VE_SIZE"] = "1920x1080"
import numpy as np
from scipy.io import wavfile
from engine.config import W, H
from engine.source import SlideshowSource
from engine.timemap import TimeMap
from engine.edit import Edit
from engine.render import render
from engine import fx as F, contact
import project  # reuse mix() / word_at()

ROOT = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(ROOT, "build_arnica")
P = lambda n: os.path.join(ROOT, "assets", "arnica", n)
GEN = "isnet-general-use"
SHOTS = [
    dict(photo=P("plate_pain.jpg"), zoom=(1.0, 1.05)),                          # 0 כואב לכם...
    dict(photo=P("plate_pain.jpg"), zoom=(1.05, 1.1)),                          # 1 יש דרך טבעית להקל (ניפוץ)
    dict(photo=P("plate_product.jpg"), zoom=(1.0, 1.06), mask_model=GEN),       # 2 קרם ארניקה (כותרת)
    dict(photo=P("plate_yehoshua.jpg"), zoom=(1.0, 1.03)),                      # 3 יהושע (יוצא מהמסגרת)
    dict(photo=P("plate_leaves.jpg"), zoom=(1.0, 1.04), mask_model=GEN),        # 4 רכיבים (קובייה)
    dict(photo=P("plate_pain.jpg"), zoom=(1.1, 1.16)),                          # 5 מכה? נקע? (חותמות)
    dict(photo=P("plate_product.jpg"), zoom=(1.12, 1.2), mask_model=GEN),       # 6 מורחים (נמחקות)
    dict(photo=P("plate_product.jpg"), zoom=(1.0, 1.05), mask_model=GEN),       # 7 נבדק דרמטולוגית (חותם)
    dict(photo=P("plate_yehoshua.jpg"), zoom=(1.04, 1.08)),                     # 8 משחת הפלא (תגובה)
    dict(photo=P("plate_product.jpg"), zoom=(1.05, 1.1), mask_model=GEN),       # 9 מחיר
    dict(photo=P("plate_product.jpg"), zoom=(1.08, 1.14), mask_model=GEN),      # 10 מבצע 2+1 (חותם מתנה)
    dict(photo=P("plate_yehoshua.jpg"), zoom=(1.0, 1.04)),                      # 11 הזמינו (זום לטלפון)
    dict(photo=P("plate_product.jpg"), zoom=(1.0, 1.04), mask_model=GEN),       # 12 סיום
]
HOLDS = [(0, "מפרקים", .45), (1, "להקל", 1.5), (3, "מטופלים", .7), (4, "וקמפור", .8), (6, "הכואב", .6),
         (7, "רגיש", .8), (8, "הפלא", 2.0), (9, "בלבד", .9), (10, "במתנה", 1.1),
         (11, "בטלפון", .6), (12, "גדולה", 3.6)]


def load():
    words = json.load(open(os.path.join(B, "words.json")))
    sr, raw = wavfile.read(os.path.join(B, "raw_narration.wav")); raw = raw.astype(np.float32) / 32768
    n = max(w["sentence"] for w in words) + 1
    st = [min(w["start"] for w in words if w["sentence"] == k) for k in range(n)]
    en = [max(w["end"] for w in words if w["sentence"] == k) for k in range(n)]
    shots = []
    for k in range(n):
        s0 = 0 if k == 0 else max(en[k - 1] + .05, st[k] - .2)
        s1 = max(en[k] + .05, st[k + 1] - .2) if k + 1 < n else len(raw) / sr + 5
        shots.append(dict(SHOTS[k], src0=s0, src1=s1))
    return words, raw, sr, shots


def build():
    words, raw, sr, shots = load()
    wd = lambda k, t: next(w for w in words if w["sentence"] == k and w["word"] == t)
    holds = [(wd(k, t)["end"], s) for k, t, s in HOLDS]
    tm = TimeMap.from_silences(raw, sr, holds=holds, lead_in=.25)
    ed = Edit(SlideshowSource(shots, os.path.join(ROOT, "cache", "masks")), tm, words)
    add_effects(ed)
    return ed, tm, raw, sr


def add_effects(ed):
    Wd = ed.ws
    ss = lambda k: min(w["t"] for w in ed.words if w["sentence"] == k)
    nxt = lambda k: ss(k + 1) - .06
    # 1 gray, unedited opening that ignites into color on "מפרקים"
    tw = Wd(0, "מפרקים")["t"]; ed.music_start = tw
    ed.add(F.Ignite(0, nxt(0), tw=tw, move_bg=False))
    # 3 the pain shatters on "להקל" and heals
    tw = Wd(1, "להקל")["t"]; ed.add(F.Shatter(tw, tw + 1.6, tw=tw, impact=(1300, 540)))
    # 2 huge 3D title flies in on "הארניקה"
    tw = Wd(2, "הארניקה")["t"]
    ed.add(F.Title3D(tw, nxt(2), tw=tw, text="קרם ארניקה", cx=W * .42, cy=H * .36))
    # 4 Yehoshua breaks out of the frame over his name; his own slogan as a quote
    name = F.Title3D(0, 0, tw=0, text="יהושע אלישע")
    ed.add(F.PopOut(ss(3) - .05, nxt(3), ts=ss(3) - .05, tw=Wd(3, "מטפל")["t"], title=name))
    ed.add(F.LowerThird(Wd(3, "מטפל")["t"], nxt(3), tw=Wd(3, "שנים")["t"], name="יהושע אלישע", role="מטפל ברפואה טבעית",
                        xy=(W * .2, H * .8), quote="״מריחה קטנה – הקלה גדולה״", tq=Wd(3, "מטופלים")["t"], qxy=(W * .24, H * .42)))
    # 11 ingredient cube: one card per ingredient
    tws = [Wd(4, x)["t"] for x in ("הארניקה", "שיאה", "מנטה", "וקמפור")]
    t0 = ss(4) - .04; tws[0] = max(tws[0], t0 + .5)
    ed.add(F.Cube(t0, nxt(4), tws=tws, FW=1280, FH=720,
                  cards=[("ארניקה", "צמח המרפא המוכר"), ("חמאת שיאה", "מזינה ומגינה על העור"),
                         ("מנטה", "תחושת רעננות"), ("קמפור", "תחושת חימום")]))
    # 12 red stamps land on each pain word, the cream strikes them out and they fall
    lands = [Wd(5, "מכה")["t"], Wd(5, "נקע")["t"], Wd(5, "כאבי")["t"]]
    ed.add(F.Stamps(lands[0] - .15, nxt(6), tw=lands[0], lands=lands, terase=Wd(6, "מורחים")["t"],
                    stamps=[("מכה", (560, 330), 10), ("נקע", (1360, 420), -8), ("כאבי שרירים", (860, 660), 5)], cap_y=int(H * .9)))
    # seal on "דרמטולוגית"
    tw = Wd(7, "דרמטולוגית")["t"]
    ed.add(F.Badge(tw - .1, nxt(7), tw=tw, xy=(W * .2, H * .38), lines=["נבדק", "דרמטולוגית", "לעור רגיש"]))
    # 13 a customer types "משחת הפלא", then a real customer quote pops in
    ed.add(F.CommentDM(ss(8), nxt(8), tbox=ss(8), tw=Wd(8, "משחת")["t"], code="משחת הפלא", box_w=1100, box_y=int(H * .84),
                       cap_y=int(H * .64), dm_title="ביקורת חדשה – 5 כוכבים", dm_body="״המשחה שלך פלאים!!! מומלצת בחום״"))
    # price drops 129 -> 120 on "עשרים"
    ed.add(F.Stamps(Wd(9, "במבצע")["t"] - .15, nxt(9), tw=Wd(9, "במבצע")["t"], stamps=[], lands=[1e9], terase=None,
                    tprice=Wd(9, "במבצע")["t"], tzero=Wd(9, "עשרים")["t"], price_from=129, price_to=120,
                    price_label="מחיר מבצע", price_y=int(H * .5), price_hit_color=(212, 175, 55), flash_color=(.95, .9, .6),
                    cap_y=int(H * .85)))
    # the real 2+1 offer: gift seal on "במתנה"
    tw = Wd(10, "במתנה")["t"]
    ed.add(F.Badge(tw - .1, nxt(10), tw=tw, xy=(W * .8, H * .38), lines=["2+1", "קרם ארניקה", "במתנה"], angle=8))
    # 10 infinite zoom into a phone that plays this very ad: one dive per channel
    ed.add(F.PhoneZoom(ss(11), nxt(11), ts=ss(11), dives=[Wd(11, "באתר")["t"], Wd(11, "בטלפון")["t"]]))
    # end card with the real logo, phone and site
    tw = Wd(12, "קרם")["t"]
    ed.add(F.EndCard(tw, ed.duration + 1, tw=tw, product=P("plate_product.jpg"),
                     product_mask=os.path.join(ROOT, "cache", "masks", f"plate_product_{GEN}_mask.png"), logo=P("img14.png"),
                     title="קרם ארניקה טיפולי", slogan="מריחה קטנה – הקלה גדולה", phone="052-252-7090",
                     site="yehoshuatherapy.co.il", disclaimer="לשימוש חיצוני בלבד. אין באמור תחליף לייעוץ רפואי."))


if __name__ == "__main__":
    ed, tm, raw, sr = build()
    print(tm.table())
    t0 = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    t1 = float(sys.argv[2]) if len(sys.argv) > 2 else ed.duration
    wav = os.path.join(B, "mix.wav")
    project.mix(ed, tm, raw, sr, wav, True)
    out = os.path.join(B, "arnica_ad.mp4" if len(sys.argv) <= 1 else f"arnica_{t0:.0f}_{t1:.0f}.mp4")
    render(ed.frame, t1, out, audio=wav, t0=t0, workers=os.cpu_count())
    if len(sys.argv) <= 1:
        os.makedirs(os.path.join(B, "contact"), exist_ok=True)
        contact.sheets(out, os.path.join(B, "contact", "ad"), label_fn=project.word_at(ed), tw=240, th=135)
