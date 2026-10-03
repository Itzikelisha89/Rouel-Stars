import os
os.environ["VE_SIZE"] = "1920x1080"
import arnica_project as AP
from engine import contact
ed, tm, raw, sr = AP.build()
Wd = ed.ws
checks = [("הצתה", "טבעית", Wd(2, "טבעית")["t"]), ("ניפוץ", "להקל", Wd(2, "להקל")["t"]),
          ("יוצא מהמסגרת", "יהושע", Wd(3, "יהושע")["t"]), ("כותרת שם", "מטפל", Wd(3, "מטפל")["t"]),
          ("כותרת 3D", "הארניקה", Wd(4, "הארניקה")["t"]), ("קובייה", "שיאה", Wd(5, "שיאה")["t"]),
          ("חותמות", "מכה", Wd(6, "מכה")["t"]), ("נמחקות", "מורחים", Wd(7, "מורחים")["t"]),
          ("חותם", "דרמטולוגית", Wd(8, "דרמטולוגית")["t"]), ("ביקורות", "והלקוחות", Wd(9, "והלקוחות")["t"]),
          ("ציטוט יהושע", "מריחה", Wd(10, "מריחה")["t"]), ("מחיר", "עשרים", Wd(11, "עשרים")["t"]),
          ("מתנה", "במתנה", Wd(12, "במתנה")["t"]), ("סיום", "קרם", Wd(13, "קרם")["t"])]
contact.effect_sheet("build_arnica/arnica_ad.mp4", checks[:7], "build_arnica/contact/effects_a.jpg", tw=240, th=135)
contact.effect_sheet("build_arnica/arnica_ad.mp4", checks[7:], "build_arnica/contact/effects_b.jpg", tw=240, th=135)
