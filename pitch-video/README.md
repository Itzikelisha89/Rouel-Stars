# סרטון הצגה — מוצא המוצרים

- `video.html`: הסרטון עצמו, כאנימציה מבוססת זמן (1920×1080, 3:57). פתיחה בדפדפן מנגנת אותו בלופ.
- `narration.md`: תסריט קריינות מתוזמן, להקלטה בקול שלך.
- `pitch-video-final.mp4`: הסרטון הסופי (‏Full HD, ‏30fps), עם קריינות פרמיום בעברית (ElevenLabs, קול "Omer") ומוזיקת רקע "Funshine" מ-FreePD (רישיון CC0, חופשי לשימוש מסחרי).

## עריכה

כל הטקסטים נמצאים ב-`video.html`. תזמון הסצנות מוגדר במערך `SCENES` והכתוביות במערך `CAPTIONS`.
אחרי שינוי מרנדרים מחדש בעזרת Playwright: עוברים על כל פריים, מריצים `render(t)`, מצלמים מסך ומעבירים ל-ffmpeg.

```bash
node tools/render.js "$PWD/video.html" video-only.mp4 30
python3 tools/music.py music.wav 238
ffmpeg -i video-only.mp4 -i music.wav -c:v copy -c:a aac -b:a 192k -shortest pitch-video.mp4
```
