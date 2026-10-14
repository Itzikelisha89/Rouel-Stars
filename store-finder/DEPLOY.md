# העלאה לאוויר ב-Railway (כ-15 דקות)

## 1. פתיחת הפרויקט
1. נכנסים ל-[railway.com](https://railway.com) ומתחברים עם GitHub.
2. **New Project** ← **Deploy from GitHub repo** ← בוחרים את `Rouel-Stars`.
3. בהגדרות השירות (**Settings**):
   - **Source → Root Directory**: `store-finder`
   - **Source → Branch**: `store-finder-mvp` (או `main` אחרי המיזוג)
   - Railway מזהה לבד את `Dockerfile` ואת `railway.json`.

## 2. דיסק קבוע לנתונים (חובה!)
בלי זה, כל עדכון גרסה מוחק את המוצרים והתמונות.
- לוחצים על השירות ← **Volumes** (או קליק ימני ← **Attach Volume**) ← **Mount path**: `/data`

## 3. משתני סביבה (**Variables**)
| משתנה | ערך | למה |
|---|---|---|
| `REGISTRATION_CODE` | קוד שתבחר, למשל `hastock-pilot` | רק מי שיודע את הקוד יכול לפתוח חנות |
| `PUBLIC_URL` | הכתובת שתקבל בשלב 4, למשל `https://xxx.up.railway.app` | הכתובת שמודפסת בשלטי ה-QR |
| `SEED_DEMO` | `1` | יוצר את סניפי ההדגמה של הסטוק (פעם אחת): `demo`, `demo-north`, `demo-south` |
| `HQ_PASSWORD` | סיסמה חזקה להנהלת הרשת | מסך הנהלת רשת בכתובת `/hq.html`: כל הסניפים זה לצד זה |
| `DEMO_PASSWORD` | סיסמה חזקה משלך | הסיסמה של חנות ההדגמה (במקום demo1234) |
| `ELEVENLABS_API_KEY` | המפתח מ-elevenlabs.io (Profile → API Keys) | לא חובה: קול אמיתי וברור של נציג (עומר) במקום קול הטלפון |
| `GEMINI_API_KEY` | המפתח מ-[aistudio.google.com](https://aistudio.google.com) | לא חובה: זיהוי מוצרים מתמונה ומסרטון, בחינם |

## 4. כתובת
**Settings → Networking → Generate Domain**. מקבלים כתובת כמו `https://store-finder-production.up.railway.app`.
מעדכנים אותה ב-`PUBLIC_URL` (שלב 3).

אפשר גם דומיין משלך (למשל `find.hastock.co.il`): **Custom Domain**, ומוסיפים רשומת CNAME אצל מי שמנהל את הדומיין.

## 5. בדיקה
- `https://<הכתובת>/healthz` ← צריך להחזיר `{"ok":true}`
- `https://<הכתובת>/s/demo` ← מסך הלקוח של חנות ההדגמה
- `https://<הכתובת>/hq.html` ← מסך הנהלת הרשת (עם `HQ_PASSWORD`)
- `https://<הכתובת>/staff.html` ← מסך עובדים (קוד העובדים נקבע בלשונית ⚙️ הגדרות של כל סניף)
- `https://<הכתובת>/` ← כניסה למנהל (`demo` + הסיסמה מ-`DEMO_PASSWORD`), או פתיחת סניף אמיתי עם קוד ההרשמה

## עלות
תוכנית Hobby: כ-5 דולר לחודש, וזה מספיק לפיילוט של סניף אחד ויותר.

## גיבוי
בלשונית **⚙️ הגדרות** ← **הורדת הקטלוג**: כל המוצרים בקובץ אקסל. מומלץ להוריד פעם בשבוע.
