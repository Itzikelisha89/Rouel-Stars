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
    (0.6, 8.2, 'שלום. אני רוצה להציג לך את "מוצא המוצרים". מערכת שמאפשרת לכל לקוח, למצוא כל מוצר בחנות, תוך שניות.'),
    (9.6, 14, 'בסניף של אלף מטר, יש אלפי מוצרים. לקוח נכנס, ומחפש סיר קטן. הוא מסתובב בין המעברים... מחפש עובד פנוי... ולפעמים, פשוט יוצא בלי לקנות.'),
    (24.4, 9.4, 'קודם, משרטטים פעם אחת את מפת הסניף. גוררים אצבע על המסך, מסמנים מעברים, ונותנים להם שם.'),
    (34.4, 14.4, 'אחר כך, עומדים מול מדף ומצלמים, או פשוט מסריטים את כל המעבר בהליכה. המערכת מזהה כל מוצר, ושומרת אותו עם המיקום המדויק שלו.'),
    (49.7, 7.6, 'בכניסה לסניף יש שלט עם קוד קיו אר. הלקוח סורק אותו, בלי להוריד שום אפליקציה.'),
    (57.6, 4.2, 'ופשוט אומר: "אני מחפש סיר קטן".'),
    (62.0, 11.4, 'המערכת מציגה לו שלושה סירים קטנים, עם תמונה, מחיר ומיקום. הוא בוחר, והמערכת אפילו אומרת לו בקול, איפה המוצר נמצא.'),
    (73.7, 15.5, 'המערכת מראה לו את הדרך על המפה. ובקצה כל מעבר, יש מדבקת "אתה כאן". סריקה אחת, והוא יודע בדיוק איפה הוא עומד, וכמה נשאר עד המוצר.'),
    (90.2, 8.6, 'הגעת. המוצר משמאלך, במדף התחתון. מהכניסה ועד המוצר, בפחות מדקה, ובלי לשאול אף אחד.'),
    (99.5, 15, 'ואם הלקוח לא מצא? הוא מסמן "המדף ריק", והעובד מקבל מיד התראה בטלפון. כך כל לקוח הופך לבודק מדפים, והמדף מתמלא תוך דקות.'),
    (115.5, 12, 'יש לו כמה מוצרים לקנות? הוא מוסיף אותם לרשימה, והמערכת מסדרת לו את המסלול הקצר ביותר בחנות.'),
    (128.5, 16, 'בדף הבית מחכים לו המבצעים, ולצד כל מוצר: מה לקוחות אחרים חיפשו גם. ואם משהו חסר, הוא מבקש שנביא, וכשזה מגיע, הוא מקבל הודעה בוואטסאפ.'),
    (145.5, 8, 'והכול גם בערבית, ברוסית ובאנגלית, לפי שפת הטלפון.'),
    (154.5, 11.3, 'וההנהלה יודעת סוף סוף, מה הלקוחות מחפשים ולא מוצאים, ובאיזו עונה. למשל: כלים לפסח, בחודש שלפני החג.'),
    (166.5, 14, 'ובמסך של הנהלת הרשת, כל הסניפים זה לצד זה. איפה מוצאים הכי מהר, ואיפה צריך לסדר מדפים. וסניף חדש מוקם תוך יום, בלי שום חומרה.'),
    (181.5, 17, 'ומה זה נותן לרשת? יותר מכירות, כי לקוח שמוצא, קונה. עובדים שמתפנים למכירה. מדפים מלאים, קנייה חכמה לפי מה שמבקשים, וערוץ שיווק ישיר לטלפון של הלקוח.'),
    (199.5, 15.2, 'והחזון לשלב הבא: רובוט, שעובר בלילה בין המעברים, וסורק את המדפים. הוא מעדכן את הקטלוג אוטומטית, מזהה מדפים ריקים ומוצרים שזזו ממקומם. ובשעות הפתיחה, הוא יכול ללוות לקוח, עד המוצר.'),
    (215.5, 13.3, 'ההצעה שלי: פיילוט של שלושים יום, בסניף אחד, עם דוח אוטומטי: זמן עד המוצר, אחוז הלקוחות שמצאו, ושעות עבודה שנחסכו.'),
    (229.4, 7.4, 'המערכת כבר קיימת, ועובדת. אשמח לאישורך לפיילוט. תודה.'),
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


MUSIC_VOLUME = float(os.environ.get('MUSIC_VOLUME', '0.38'))  # music level under and between the narration
CLIPS = os.environ.get('VOICE_CLIPS_DIR')  # pre-generated seg{i}.wav files (e.g. from f5_hebrew_tts.py) instead of the API


def main():
    if CLIPS:
        pass
    elif not KEY:
        sys.exit('ELEVENLABS_API_KEY is not set')
    elif not VOICE:
        voices = json.loads(request('/voices'))['voices']
        for v in voices:
            print(v['voice_id'], v['name'], v.get('labels', {}))
        sys.exit('Set ELEVENLABS_VOICE_ID to one of the voices above')
    video, music, out = sys.argv[1:4]
    tmp = tempfile.mkdtemp()
    inputs, filters = [], []
    for i, (start, slot, text) in enumerate(SEGMENTS):
        if CLIPS:
            clip = os.path.join(CLIPS, f'seg{i}.wav')
        else:
            clip = os.path.join(tmp, f'seg{i}.mp3')
            audio = request(f'/text-to-speech/{VOICE}?output_format=mp3_44100_128', {
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
    filters.append(f'[1:a]volume={MUSIC_VOLUME}[mus]')
    filters.append('[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]')
    filters.append('[vo][duck]amix=inputs=2:normalize=0[mix]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', music, *inputs,
                    '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[mix]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f'{duration(video):.3f}', out], check=True)
    print('wrote', out)


if __name__ == '__main__':
    main()
