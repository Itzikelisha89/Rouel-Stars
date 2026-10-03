# מנוע עריכת וידאו (Python · OpenCV · numpy · ffmpeg)

כל פריים מורכב בקוד: `Edit.frame(t)` מקבלת זמן ומחזירה תמונה, והרינדור רץ במקביל על כל הליבות.

| קובץ | תפקיד |
|---|---|
| `engine/text.py` | עברית עם Pillow + RAQM (ימין לשמאל). אין שימוש ב-cv2.putText לעברית |
| `engine/tts.py`, `engine/narration.py` | קריינות מטקסט עם זמן מדויק לכל מילה (כרגע espeak-ng, זמני) |
| `engine/transcribe.py` | תמלול מילה-מילה: whisper.cpp + ivrit-ai/whisper-large-v3-turbo-ggml (דורש גישה ל-huggingface.co להורדה ראשונה) |
| `engine/timemap.py` | מפת זמן מקור↔סופי: חיתוך שתיקות עם מעבר רך, פריים קפוא, השארת זמן לאפקט. גם הסאונד נחתך לפיה |
| `engine/masks.py` | מסכת דמות עם rembg / u2net_human_seg, מחושבת פעם אחת ונשמרת ל-`cache/masks` |
| `engine/source.py` | החומר המקורי: מצגת תמונות (Ken Burns) או סרטון אמיתי, כולל מסכה ורקע נקי |
| `engine/look.py` | גריידינג קולנועי, גרעין, ויניט, כתוביות מונפשות |
| `engine/fx.py` | ספריית האפקטים (15 + הרצה לאחור) |
| `engine/audio.py` | צלילי אפקטים מסונתזים, מוזיקה, מיקס, נרמול ל-‎-14 LUFS |
| `engine/render.py`, `engine/contact.py` | רינדור מקבילי + גיליונות קונטקט (6 פריימים לשנייה) |
| `project.py`, `effects_plan.py` | הסרטון הזה: שוטים, ואיזה אפקט יושב על איזו מילה |

הרצה: `python3 project.py v1` (חיתוך + כתוביות) · `python3 project.py full` (כל האפקטים) · `python3 project.py full 20 30` (קטע בלבד).
