"""Which effect lands on which word (this video). Words are looked up in the transcript."""
import numpy as np
from scipy.signal import resample
from engine import fx as F
from engine import audio as A

REWIND = 1.7


def _w(words, text, n=1):
    k = 0
    for w in words:
        if w["word"] == text:
            k += 1
            if k == n: return w
    raise KeyError(text)


def timing(words):
    """Changes to the time map: freeze frames + footage kept after a word for the effect to finish."""
    freezes = [(_w(words, "העולמות")["end"] + .02, .38),    # E6 blackout gap
               (_w(words, "עוצר")["end"] + .03, 1.7)]         # E7 time stop
    holds = [(_w(words, "התחיל")["end"], .45), (_w(words, "ספיר")["end"], .5),
             (_w(words, "השתנה")["end"], 1.5), (_w(words, "לקצין")["end"], .9),
             (_w(words, "התהפך")["end"], 1.85), (_w(words, "עיר")["end"], .5),
             (_w(words, "לגדול")["end"], 1.3), (_w(words, "מחדש")["end"], .9),
             (_w(words, "קטן")["end"], .7), (_w(words, "גאווה")["end"], .8),
             (_w(words, "אפס")["end"], .9), (_w(words, "ספיר", 2)["end"], 2.0),
             (_w(words, "שאני")["end"], 1.0), (_w(words, "ההתחלה")["end"], 1.8)]
    return freezes, holds


def sent_start(ed, k):
    return min(w["t"] for w in ed.words if w["sentence"] == k)


def sent_end(ed, k):
    return max(w["t_end"] for w in ed.words if w["sentence"] == k)


def add_effects(ed):
    W = ed.word
    nxt = lambda k: sent_start(ed, k + 1) - .06  # effect ends just before the next sentence
    # E1 ignite on "התחיל"
    tw = W("התחיל")["t"]; ed.music_start = tw
    ed.add(F.Ignite(0, nxt(0), tw=tw))
    # E2 3D title on "ספיר"
    title = ed.add(F.Title3D(W("ספיר")["t"], nxt(1), tw=W("ספיר")["t"], text="מערך ספיר", cx=540, cy=520))
    # E3 shatter on "השתנה"
    tw = W("השתנה")["t"]; ed.add(F.Shatter(tw, tw + 1.6, tw=tw, impact=(560, 800)))
    # E4 pop-out on "לקצין"
    ed.add(F.PopOut(sent_start(ed, 3) - .05, nxt(3), ts=sent_start(ed, 3) - .05, tw=W("לקצין")["t"], title=title))
    # E5 flip on "התהפך"
    tw = W("התהפך")["t"]; ed.add(F.Flip(tw, tw + 1.75, tw=tw))
    # E6 worlds on "מדבר ים חלל עיר"
    tws = [W(x)["t"] for x in ("מדבר", "ים", "חלל", "עיר")]
    ed.add(F.Worlds(W("העולמות")["t_end"] + .02, nxt(5), tws=tws, names=["desert", "sea", "space", "city"]))
    # E7 time freeze after "עוצר"
    f0, f1 = ed.tm.freeze_windows()[1]
    ed.add(F.TimeFreeze(f0, f1)); ed.add(F.Stopwatch(f0, f1))
    # E8 giant on "לגדול"
    tw = W("לגדול")["t"]; ed.add(F.Giant(tw, nxt(7), tw=tw))
    # E9 pixels on "מתפרקים" ... rebuild on "מחדש"
    ed.add(F.Pixelate(W("מתפרקים")["t"], nxt(8), tw=W("מתפרקים")["t"], tr=W("מחדש")["t"]))
    # E10 phone dives on "לטלפון אחד קטן"
    ed.add(F.PhoneZoom(sent_start(ed, 9), nxt(9), ts=sent_start(ed, 9), dives=[W(x)["t"] for x in ("לטלפון", "אחד", "קטן")]))
    # E11 cube on "משמעת צוות אחריות גאווה"
    tws = [W(x)["t"] for x in ("משמעת", "צוות", "אחריות", "גאווה")]
    t0 = sent_start(ed, 10) - .04
    tws[0] = max(tws[0], t0 + .5)
    ed.add(F.Cube(t0, nxt(10), tws=tws, cards=[("משמעת", "כל יום, בזמן"), ("צוות", "אף אחד לא לבד"),
                                                         ("אחריות", "על כל החלטה"), ("גאווה", "מערך ספיר")]))
    # E12 stamps on "תירוצים", erased on "מחקתי", price -> 0 on "אפס"
    ed.add(F.Stamps(W("תירוצים")["t"] - .15, nxt(11), tw=W("תירוצים")["t"], terase=W("מחקתי")["t"],
                    tprice=W("המחיר")["t"], tzero=W("אפס")["t"]))
    # E13 comment box on "בתגובות", code word typed on "ספיר" (#2), then DM
    ed.add(F.CommentDM(W("בתגובות")["t"], nxt(12), tbox=W("בתגובות")["t"], tw=W("ספיר", 2)["t"], code="ספיר"))
    # E14 hologram on "זה מי שאני"
    tw = W("זה", 3)["t"]
    tags = [("משקפיים", (870, 560), (640, 800)), ("קצין", (880, 1250), (940, 1120)),
            ("מערך ספיר", (230, 600), (420, 760)), ("גדוד להב", (220, 1300), (430, 1330))]
    times = [tw, W("מי")["t"], W("שאני")["t"], W("שאני")["t_end"] + .15]
    ed.add(F.Hologram(tw, nxt(13), tw=tw)); ed.add(F.HoloTags(tw, nxt(13), tags=tags, times=times))
    # E15 follow on "תעקבו", goal on "ההתחלה"
    ed.add(F.FollowGoal(W("תעקבו")["t"] - .1, ed.duration, tw=W("תעקבו")["t"], tgoal=W("ההתחלה")["t"],
                        goal=10000, badge="10K"))
    # ending: tape rewind back to the very first frame (loop)
    ed.rewind = (ed.duration, REWIND)


def rewind_audio(x, ed):
    T, d = ed.rewind
    i0, n = int(T * A.SR), int(d * A.SR)
    rev = np.ascontiguousarray(x[:i0][::-1])
    # non-linear speed like the picture: resample in two halves (fast middle)
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
