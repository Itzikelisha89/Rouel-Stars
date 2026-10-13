"""Hebrew voiceover for the pitch video via ElevenLabs, timed to the scenes and mixed over the music.

Usage:
  export ELEVENLABS_API_KEY=...            # required
  export ELEVENLABS_VOICE_ID=...           # optional; without it the script lists your voices and exits
  python3 tools/voiceover.py video-only.mp4 music.wav pitch-video.mp4

Each segment is generated separately and placed at its scene's start time; the music is
ducked automatically under the voice (sidechain compression).
"""
import json, os, subprocess, sys, tempfile, urllib.request

API = 'https://api.elevenlabs.io/v1'
KEY = os.environ.get('ELEVENLABS_API_KEY')
VOICE = os.environ.get('ELEVENLABS_VOICE_ID')
MODEL = os.environ.get('ELEVENLABS_MODEL', 'eleven_v3')

# (start seconds, slot length, text). Text is written for the ear: short sentences, commas where a
# speaker would breathe, and a few phonetic spellings (QR -> "קיו אר") so the voice doesn't stumble.
SEGMENTS = [
    (0.8, 10, 'שלום. אני רוצה להציג לך את "מוצא המוצרים". מערכת שמאפשרת לכל לקוח, למצוא כל מוצר בחנות, תוך שניות.'),
    (12.0, 19, 'בסניף של אלף מטר, יש אלפי מוצרים. לקוח נכנס, ומחפש סיר קטן. הוא מסתובב בין המעברים... מחפש עובד פנוי... ולפעמים, פשוט יוצא בלי לקנות.'),
    (31.8, 14, 'הפתרון בנוי משלושה צעדים פשוטים, בלי חומרה ובלי התקנות. הצוות מצלם את המדפים. המערכת מזהה כל מוצר. והלקוח, מוצא אותו בטלפון.'),
    (47.0, 18, 'קודם, משרטטים פעם אחת את מפת הסניף. גוררים אצבע על המסך, מסמנים מעברים, ונותנים להם שם.'),
    (67.0, 26, 'אחר כך, עומדים מול מדף ומצלמים. המערכת מזהה כל מוצר בתמונה: שם, גודל, והמילים שלקוחות באמת משתמשים בהן. וכל מוצר נשמר עם המיקום המדויק שלו. ובהמשך, אפשר יהיה פשוט להסריט מעבר שלם בהליכה.'),
    (94.8, 8.5, 'בכניסה לסניף יש שלט עם קוד קיו אר. הלקוח סורק אותו, בלי להוריד שום אפליקציה.'),
    (103.6, 4.5, 'ופשוט אומר: "אני מחפש סיר קטן".'),
    (108.6, 12.5, 'המערכת מציגה לו שלושה סירים קטנים, עם תמונה, מחיר ומיקום. הוא בוחר את מה שמתאים לו, ולוחץ: קח אותי לשם.'),
    (121.6, 17, 'המערכת מראה לו את הדרך על המפה. ובקצה כל מעבר, יש מדבקת "אתה כאן". סריקה אחת, והוא יודע בדיוק איפה הוא עומד, וכמה נשאר עד המוצר.'),
    (140.0, 9.5, 'הגעת. המוצר משמאלך, מדף שני מלמטה. מהכניסה ועד המוצר, בפחות מדקה, ובלי לשאול אף אחד.'),
    (151.0, 18, 'ויש כאן משהו, שלא היה לנו עד היום. כל חיפוש נשמר. לראשונה, נדע מה הלקוחות מחפשים, ולא מוצאים. זה מידע זהב, להחלטות על מלאי, סידור מדפים, ומבצעים.'),
    (171.0, 17, 'המערכת בנויה לרשת. לכל סניף מפה וקטלוג משלו. סניף חדש מוקם בתוך יום. אין צורך בשום חומרה. וכל הנתונים, מכל הסניפים, מגיעים למקום אחד.'),
    (190.0, 22, 'והחזון לשלב הבא: רובוט, שעובר בלילה בין המעברים, וסורק את המדפים. הוא מעדכן את הקטלוג אוטומטית, מזהה מדפים ריקים ומוצרים שזזו ממקומם. ובשעות הפתיחה, הוא יכול ללוות לקוח, עד המוצר.'),
    (214.0, 16, 'ההצעה שלי: פיילוט של שלושים יום, בסניף אחד. שבוע הקמה, שלושה שבועות של שימוש אמיתי, ובסוף, דוח מדדים מסודר.'),
    (230.6, 7, 'המערכת כבר קיימת, ועובדת. אשמח לאישורך לפיילוט. תודה.'),
]


def request(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


def main():
    if not KEY:
        sys.exit('ELEVENLABS_API_KEY is not set')
    if not VOICE:
        voices = json.loads(request('/voices'))['voices']
        for v in voices:
            print(v['voice_id'], v['name'], v.get('labels', {}))
        sys.exit('Set ELEVENLABS_VOICE_ID to one of the voices above')
    video, music, out = sys.argv[1:4]
    tmp = tempfile.mkdtemp()
    inputs, filters = [], []
    for i, (start, slot, text) in enumerate(SEGMENTS):
        clip = os.path.join(tmp, f'seg{i}.mp3')
        audio = request(f'/text-to-speech/{VOICE}?output_format=mp3_44100_192', {
            'text': text, 'model_id': MODEL, 'language_code': 'he',
            'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.25, 'use_speaker_boost': True},
        })
        open(clip, 'wb').write(audio)
        d = duration(clip)
        tempo = min(1.12, d / slot) if d > slot else 1.0  # gently speed up only if it overruns its scene
        print(f'segment {i}: {d:.1f}s in a {slot}s slot' + (f' -> tempo {tempo:.2f}' if tempo > 1 else ''))
        inputs += ['-i', clip]
        filters.append(f'[{i + 2}:a]atempo={tempo:.3f},adelay={int(start * 1000)}|{int(start * 1000)}[v{i}]')
    n = len(SEGMENTS)
    filters.append(''.join(f'[v{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[voice]')
    filters.append('[voice]asplit=2[vo][sc]')
    filters.append('[1:a]volume=0.55[mus]')
    filters.append('[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]')
    filters.append('[vo][duck]amix=inputs=2:normalize=0[mix]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', music, *inputs,
                    '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[mix]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f'{duration(video):.3f}', out], check=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
