import os
os.environ["VE_SIZE"] = "1920x1080"
import arnica_project as AP
from engine import contact
ed, tm, raw, sr = AP.build()
Wd = ed.ws
checks = [("הצתה", "מפרקים", Wd(0, "מפרקים")["t"]), ("ניפוץ", "להקל", Wd(1, "להקל")["t"]),
          ("כותרת 3D", "הארניקה", Wd(2, "הארניקה")["t"]), ("יוצא מהמסגרת", "מטפל", Wd(3, "מטפל")["t"]),
          ("ציטוט", "מטופלים", Wd(3, "מטופלים")["t"]), ("קובייה", "שיאה", Wd(4, "שיאה")["t"]),
          ("חותמות", "מכה", Wd(5, "מכה")["t"]), ("נמחקות", "מורחים", Wd(6, "מורחים")["t"]),
          ("חותם", "דרמטולוגית", Wd(7, "דרמטולוגית")["t"]), ("תגובה", "משחת", Wd(8, "משחת")["t"]),
          ("מחיר", "עשרים", Wd(9, "עשרים")["t"]), ("מתנה", "במתנה", Wd(10, "במתנה")["t"]),
          ("טלפון", "באתר", Wd(11, "באתר")["t"]), ("סיום", "קרם", Wd(12, "קרם")["t"])]
contact.effect_sheet("build_arnica/arnica_ad.mp4", checks[:7], "build_arnica/contact/effects_a.jpg", tw=240, th=135)
contact.effect_sheet("build_arnica/arnica_ad.mp4", checks[7:], "build_arnica/contact/effects_b.jpg", tw=240, th=135)
