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
# trustworthy palette: deep navy, white, calm teal-blue accent; the clinic's green; gold only on seals
NAVY, NAVY2, ACCENT, GREEN = "#0B2545", "#13315C", "#4FB6C9", "#7AB83C"
PAIN, PROD, YEH, LEAF = P("plate_pain_v2.jpg"), P("plate_product.jpg"), P("plate_yehoshua_v2.jpg"), P("plate_leaves_v2.jpg")
SHOTS = [
    dict(photo=PAIN, zoom=(1.0, 1.04)),                       # 0 כאב בגב... גוזל את היום
    dict(photo=PAIN, zoom=(1.04, 1.08)),                      # 1 קשה לקום, קשה להירדם
    dict(photo=PAIN, zoom=(1.08, 1.12)),                      # 2 אבל יש דרך טבעית להקל (הצתה + ניפוץ)
    dict(photo=YEH, zoom=(1.0, 1.03)),                        # 3 שלום, אני יהושע אלישע (יוצא מהמסגרת + כותרת שם)
    dict(photo=PROD, zoom=(1.0, 1.06), mask_model=GEN),       # 4 פיתחתי את קרם הארניקה (כותרת 3D + ברק)
    dict(photo=LEAF, zoom=(1.0, 1.04), mask_model=GEN),       # 5 רכיבים (קובייה)
    dict(photo=PAIN, zoom=(1.1, 1.16)),                       # 6 מכה? נקע? (חותמות)
    dict(photo=PROD, zoom=(1.12, 1.2), mask_model=GEN),       # 7 מורחים (החותמות נמחקות)
    dict(photo=PROD, zoom=(1.0, 1.05), mask_model=GEN),       # 8 נבדק דרמטולוגית (חותם)
    dict(photo=LEAF, zoom=(1.04, 1.08), mask_model=GEN),      # 9 הלקוחות (כרטיסי ביקורות)
    dict(photo=YEH, zoom=(1.04, 1.08)),                       # 10 מריחה קטנה, הקלה גדולה (ציטוט של יהושע)
    dict(photo=PROD, zoom=(1.05, 1.1), mask_model=GEN),       # 11 מחיר
    dict(photo=PROD, zoom=(1.08, 1.14), mask_model=GEN),      # 12 מבצע 2+1
    dict(photo=PROD, zoom=(1.0, 1.04), mask_model=GEN),       # 13 סיום
]
HOLDS = [(2, "להקל", 1.35), (3, "טבעית", .4), (4, "הטיפולי", .5), (5, "וקמפור", .6), (7, "הכואב", .5),
         (8, "רגיש", .6), (9, "הפלא", 1.15), (10, "גדולה", .5), (11, "בלבד", .7), (12, "במתנה", .8), (13, "בטלפון", 2.3)]
SPEED = 1.1  # commercial pace; time-stretched without changing pitch, word times scaled to match


def load():
    words = json.load(open(os.path.join(B, "words.json")))
    src, fast = os.path.join(B, "raw_narration.wav"), os.path.join(B, f"raw_narration_x{SPEED}.wav")
    if not os.path.exists(fast) or os.path.getmtime(fast) < os.path.getmtime(src):
        import subprocess
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", f"atempo={SPEED}", "-ar", "48000", fast], check=True)
    for w in words:
        w["start"] = round(w["start"] / SPEED, 3); w["end"] = round(w["end"] / SPEED, 3)
    sr, raw = wavfile.read(fast); raw = raw.astype(np.float32) / 32768
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


def style(ed):
    from engine import audio as A, look
    F.GOLD, F.RED = F.hexc(ACCENT), F.hexc(GREEN)        # UI accents: borders, rim light, underlines
    look.CAPTION_ACTIVE = (79, 182, 201)                 # spoken word in the calm accent
    ed.grade_strength = .45                              # clean, honest grade (not moody)
    ed.music_fn = lambda d: A.music_bed(d, bpm=76, chords=A.MAJOR_WARM, cutoff=2200, piano=True)
    return dict(fill=("#FFFFFF", "#E6EEF6", "#9FB3C8"), ext_color=(.04, .1, .22), stripe_color=F.hexc(ACCENT))


def add_effects(ed):
    T = style(ed)
    Wd = ed.ws
    ss = lambda k: min(w["t"] for w in ed.words if w["sentence"] == k)
    nxt = lambda k: ss(k + 1) - .06
    # PROBLEM: gray, unedited opening; HOPE ignites into color on "טבעית"
    tw = Wd(2, "טבעית")["t"]; ed.music_start = tw
    ed.add(F.Ignite(0, nxt(2), tw=tw, move_bg=False, captions=True))
    # the pain shatters on "להקל" and heals
    tw = Wd(2, "להקל")["t"]; ed.add(F.Shatter(tw, tw + 1.6, tw=tw, impact=(1300, 540)))
    # AUTHORITY: Yehoshua breaks out of the frame over his name; TV name super
    name = F.Title3D(0, 0, tw=0, text="יהושע אלישע", **T)
    ed.add(F.PopOut(ss(3) - .05, nxt(3), ts=ss(3) - .05, tw=Wd(3, "יהושע")["t"], title=name))
    ed.add(F.LowerThird(ss(3), nxt(3), tw=Wd(3, "מטפל")["t"], name="יהושע אלישע", role="מטפל ברפואה טבעית",
                        xy=(W * .2, H * .8), bar_color=NAVY2, accent=ACCENT))
    # PRODUCT: 3D title + pack-shot shine
    tw = Wd(4, "הארניקה")["t"]
    ed.add(F.Title3D(tw, nxt(4), tw=tw, text="קרם ארניקה", cx=W * .42, cy=H * .36, **T))
    ed.add(F.LightSweep(tw + .45, tw + 1.5, tw=tw + .45, dur=1.0))
    # HOW IT WORKS: ingredient cube, one card per ingredient
    tws = [Wd(5, x)["t"] for x in ("ארניקה", "שיאה", "מנטה", "וקמפור")]
    t0 = ss(5) - .04; tws[0] = max(tws[0], t0 + .5)
    ed.add(F.Cube(t0, nxt(5), tws=tws, FW=1280, FH=720, card_grad=(NAVY2, NAVY),
                  cards=[("ארניקה", "צמח המרפא המוכר"), ("חמאת שיאה", "מזינה ומגינה על העור"),
                         ("מנטה", "תחושת רעננות"), ("קמפור", "תחושת חימום")]))
    # PAIN WORDS land as red stamps; the cream strikes them out and they fall
    lands = [Wd(6, "מכה")["t"], Wd(6, "נקע")["t"], Wd(6, "כאבי")["t"]]
    ed.add(F.Stamps(lands[0] - .15, nxt(7), tw=lands[0], lands=lands, terase=Wd(7, "מורחים")["t"],
                    stamps=[("מכה", (560, 330), 10), ("נקע", (1360, 420), -8), ("כאבי שרירים", (860, 660), 5)], cap_y=int(H * .9)))
    ed.add(F.LightSweep(Wd(7, "פעם")["t"], Wd(7, "פעם")["t"] + 1.2, tw=Wd(7, "פעם")["t"], dur=1.1, strength=.4))
    # SAFETY: gold seal on "דרמטולוגית"
    tw = Wd(8, "דרמטולוגית")["t"]
    ed.add(F.Badge(tw - .1, nxt(8), tw=tw, xy=(W * .2, H * .38), lines=["נבדק", "דרמטולוגית", "לעור רגיש"]))
    # SOCIAL PROOF: real customer quotes from the site
    tw = Wd(9, "והלקוחות")["t"]
    ed.add(F.Testimonials(tw, nxt(9), tw=tw, stagger=.55, slots=[(W * .66, H * .2), (W * .4, H * .45), (W * .62, H * .68)],
                          quotes=[("״משחת הארניקה הצילה אותי הלילה״", "לקוחה ממליצה"),
                                  ("״המשחה שלך פלאים!!! מומלצת בחום״", "מטפלת ממליצה"),
                                  ("״מרגישים שהכל איכותי״", "לקוחה ממליצה")]))
    # Yehoshua's own tagline, in his voice
    ed.add(F.LowerThird(ss(10), nxt(10), tw=1e9, name="יהושע אלישע", role="", xy=(0, 0), bar_color=NAVY2, accent=ACCENT,
                        quote="״מריחה קטנה – הקלה גדולה״", tq=ss(10), qxy=(W * .3, H * .45)))
    # OFFER: price 129 -> 120 on "עשרים", then the real 2+1 gift
    ed.add(F.Stamps(Wd(11, "במבצע")["t"] - .15, nxt(11), tw=Wd(11, "במבצע")["t"], stamps=[], lands=[1e9], terase=None,
                    tprice=Wd(11, "במבצע")["t"], tzero=Wd(11, "עשרים")["t"], price_from=129, price_to=120,
                    price_label="מחיר מבצע", price_y=int(H * .5), price_hit_color=(79, 182, 201), flash_color=(.85, .95, 1),
                    cap_y=int(H * .85)))
    ed.add(F.LightSweep(Wd(11, "עשרים")["t"], Wd(11, "עשרים")["t"] + 1, tw=Wd(11, "עשרים")["t"], dur=.9, strength=.35))
    tw = Wd(12, "במתנה")["t"]
    ed.add(F.Badge(tw - .1, nxt(12), tw=tw, xy=(W * .8, H * .38), lines=["2+1", "קרם ארניקה", "במתנה"], angle=8))
    # CALL TO ACTION: brand end card with the real logo, phone and site
    tw = Wd(13, "קרם")["t"]
    ed.add(F.EndCard(tw, ed.duration + 1, tw=tw, product=PROD, bg_colors=("#1C3F6E", "#0A1F3D"),
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
