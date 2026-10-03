"""Which effect lands on which word — script: "שלום, אני עידו עמיר".
Words are addressed by (sentence index, word, occurrence) because names repeat a lot."""
import numpy as np
from scipy.signal import resample
from engine import fx as F
from engine import audio as A

REWIND = 1.7


def _w(words, k, text, n=1):
    m = [w for w in words if w["sentence"] == k and w["word"] == text]
    return m[n - 1]


def timing(words):
    """Time-map changes: freeze frames, and footage kept after a word so its effect can finish."""
    freezes = [(_w(words, 5, "ולמה")["end"] + .03, 1.6)]                       # ולמה? -> time stops
    holds = [(_w(words, 0, "עמיר")["end"], .45), (_w(words, 1, "ב-AI")["end"], 1.8),
             (_w(words, 2, "ספיר")["end"], .6), (_w(words, 3, "עמיר")["end"], .9),
             (_w(words, 6, "טוב")["end"], 1.0), (_w(words, 7, "עמיר")["end"], 1.3),
             (_w(words, 8, "עובדות", 2)["end"], .9), (_w(words, 11, "לעבוד")["end"], .8),
             (_w(words, 14, "שצריך")["end"], .6), (_w(words, 15, "לפנות")["end"], 2.2),
             (_w(words, 16, "עמיר")["end"], .8), (_w(words, 17, "אחי")["end"], .8),
             (_w(words, 20, "טוב")["end"], 1.8)]
    return freezes, holds


def sent_start(ed, k): return min(w["t"] for w in ed.words if w["sentence"] == k)
def sent_end(ed, k): return max(w["t_end"] for w in ed.words if w["sentence"] == k)


def add_effects(ed):
    W = ed.ws
    nxt = lambda k: sent_start(ed, k + 1) - .06
    # 1 gray opening ignites on his name
    tw = W(0, "עמיר")["t"]; ed.music_start = tw
    ed.add(F.Ignite(0, nxt(0), tw=tw))
    # 9 "...שמתעסק ב-AI": breaks into pixels on AI, rebuilds
    tw = W(1, "ב-AI")["t"]
    ed.add(F.Pixelate(tw, nxt(1), tw=tw, tr=tw + 1.0))
    # 2 3D title "מערך ספיר"
    tw = W(2, "ספיר")["t"]
    title = ed.add(F.Title3D(tw, nxt(2), tw=tw, text="מערך ספיר", cx=540, cy=520))
    # 4 "כולם מחפשים את עידו עמיר": he breaks out of the frame over the title
    ed.add(F.PopOut(sent_start(ed, 3) - .05, nxt(3), ts=sent_start(ed, 3) - .05, tw=W(3, "עמיר")["t"], title=title))
    # 3 "כשיש בעיה ברשת": the screen shatters and heals
    tw = W(4, "בעיה")["t"]; ed.add(F.Shatter(tw, tw + 1.6, tw=tw, impact=(560, 700)))
    # 7 "ולמה?": time stops
    f0, f1 = ed.tm.freeze_windows()[0]
    ed.add(F.TimeFreeze(f0, f1)); ed.add(F.Stopwatch(f0, f1, label="ולמה?"))
    # 14 "מפקד הרשת הכי טוב": hologram + tags
    tw = W(6, "מפקד")["t"]
    tags = [("מפקד רשת", (860, 560), (640, 800)), ("מומחה AI", (230, 600), (420, 760)),
            ("מערך ספיר", (220, 1300), (430, 1330)), ("הכי טוב", (880, 1250), (940, 1120))]
    times = [tw, W(6, "הרשת")["t"], W(6, "הכי")["t"], W(6, "טוב")["t"]]
    ed.add(F.Hologram(tw, nxt(6), tw=tw)); ed.add(F.HoloTags(tw, nxt(6), tags=tags, times=times))
    # 8 "כי אני עידו עמיר…": grows into a giant over a mini city
    tw = W(7, "עמיר")["t"]; ed.add(F.Giant(tw, nxt(7), tw=tw))
    # 12 "עובדות הן עובדות": red stamps land on each "עובדות", then fall
    t1, t2 = W(8, "עובדות")["t"], W(8, "עובדות", 2)["t"]
    ed.add(F.Stamps(t1 - .15, nxt(8), tw=t1, stamps=[("עובדה", (330, 640), 12), ("מאומת", (740, 820), -9), ("100%", (420, 1010), 6)],
                    lands=[t1, t2, t2 + .2], terase=None, tfall=W(8, "עובדות", 2)["t_end"] + .45))
    # 11 cube: one card per "יודע ___"
    tws = [W(9, "AI")["t"], W(10, "רשתות")["t"], W(11, "לעבוד")["t"]]
    t0 = sent_start(ed, 9) - .04
    tws[0] = max(tws[0], t0 + .5)
    ed.add(F.Cube(t0, nxt(11), tws=tws, cards=[("AI", "בינה מלאכותית"), ("רשתות", "מפקד הרשת"), ("הכול עובד", "תמיד")]))
    # 10 infinite phone zoom: one dive per need
    ed.add(F.PhoneZoom(sent_start(ed, 12), nxt(14), ts=sent_start(ed, 12),
                       dives=[W(12, "מומחה")["t"], W(13, "מפקד")["t"], W(14, "יעבוד")["t"]]))
    # 13 "למי לפנות": the comment box types his name, then a private message
    ed.add(F.CommentDM(sent_start(ed, 15), nxt(15), tbox=sent_start(ed, 15), tw=W(15, "לפנות")["t"], code="עידו עמיר"))
    # 2b "לעידו עמיר": his name as a 3D title
    tw = W(16, "עמיר")["t"]
    ed.add(F.Title3D(tw, nxt(16), tw=tw, text="עידו עמיר", cx=540, cy=560))
    # Dima: name tag on "דימה", hearts on "אוהב"
    ed.add(F.FriendTag(sent_start(ed, 17), nxt(17), tw=W(17, "ודימה")["t"], tlove=W(17, "אוהב")["t"],
                       name="דימה", pill_xy=(300, 520), anchor=(335, 775)))
    # 15 ending: follow button, counter, #1 gold stamp on "הכי טוב"
    ed.add(F.FollowGoal(W(18, "אני")["t"] - .1, ed.duration, tw=W(18, "אני")["t"], tgoal=W(20, "טוב")["t"],
                        goal=10000, badge="#1", badge_sub="הכי טוב"))
    ed.rewind = (ed.duration, REWIND)


def rewind_audio(x, ed):
    T, d = ed.rewind
    i0, n = int(T * A.SR), int(d * A.SR)
    rev = np.ascontiguousarray(x[:i0][::-1])
    fast = resample(rev, n).astype(np.float32) * .45
    env = np.minimum(1, np.minimum(np.arange(n) / (.08 * A.SR), (n - np.arange(n)) / (.08 * A.SR)))
    out = x.copy()
    out[i0:i0 + n] = fast[:len(out) - i0] * env[:len(out) - i0]
    w = A.tape_rewind(d) * .55
    out[i0:i0 + len(w)] += w[:len(out) - i0]
    st = A.tape_stop() * .6
    j = i0 + n - len(st) // 2
    out[j:j + len(st)] += st[:max(0, len(out) - j)]
    return out
