# מפיק את הקריינות: ElevenLabs (הקול המשובט שלך) ואם אין מפתח/גישה – גיבוי ב-edge-tts.
# הרצה:  python3 tools/voice.py [--engine elevenlabs|edge] [מפתח ...]
# מפתח ElevenLabs: נשמר בסביבת הענן (Network secret ל-api.elevenlabs.io) או במשתנה ELEVENLABS_API_KEY.
# בחירת הקול: config.json -> voice.elevenlabs_voice_id / elevenlabs_voice_name. אם ריקים – נבחר הקול המשובט היחיד בחשבון.
import asyncio, json, os, re, sys, subprocess, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(ROOT, 'config.json')
CFG = json.load(open(CFG_PATH, encoding='utf-8'))
OUT = os.path.join(ROOT, 'build', 'vo')
os.makedirs(OUT, exist_ok=True)
V = CFG['voice']
args = sys.argv[1:]
engine = V.get('engine', 'elevenlabs')
if '--engine' in args:
    i = args.index('--engine'); engine = args[i + 1]; del args[i:i + 2]
keys = args or list(CFG['vo'])

# ---------------------------------------------------------------- ElevenLabs
API = 'https://api.elevenlabs.io/v1'
XI_KEY = os.environ.get('ELEVENLABS_API_KEY', 'proxy-injected')   # בענן: הפרוקסי מחליף את הערך במפתח השמור

def xi(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'xi-api-key': XI_KEY, 'Content-Type': 'application/json', 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def pick_voice():
    if V.get('elevenlabs_voice_id'):
        return V['elevenlabs_voice_id']
    voices = json.loads(xi('/voices'))['voices']
    name = V.get('elevenlabs_voice_name', '').strip()
    if name:
        m = [v for v in voices if v['name'].strip() == name]
        if not m: raise SystemExit(f'voice "{name}" not found. voices: ' + ', '.join(v['name'] for v in voices))
        return m[0]['voice_id']
    mine = [v for v in voices if v.get('category') in ('cloned', 'professional', 'generated')]
    print('voices in account:', ', '.join(f"{v['name']} ({v.get('category')})" for v in voices))
    if len(mine) != 1:
        raise SystemExit('set voice.elevenlabs_voice_name in config.json to one of: ' + ', '.join(v['name'] for v in mine or voices))
    print('using voice:', mine[0]['name'])
    return mine[0]['voice_id']

def eleven_all():
    vid = pick_voice()
    model = V.get('elevenlabs_model', 'eleven_v3')
    for k in keys:
        item = CFG['vo'][k]
        body = {'text': item.get('say', item['text']), 'model_id': model,
                'voice_settings': {'stability': 0.5, 'similarity_boost': 0.85, 'style': 0.35, 'use_speaker_boost': True}}
        if model != 'eleven_v3': body['language_code'] = 'he'
        try:
            audio = xi(f'/text-to-speech/{vid}?output_format=mp3_44100_192', body)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')
            if model == 'eleven_v3' and e.code in (400, 422):
                print('eleven_v3 refused, trying eleven_multilingual_v2:', msg[:200])
                body['model_id'] = 'eleven_multilingual_v2'; body['language_code'] = 'he'
                audio = xi(f'/text-to-speech/{vid}?output_format=mp3_44100_192', body)
            else:
                raise SystemExit(f'ElevenLabs {e.code}: {msg[:300]}')
        open(f'{OUT}/{k}.mp3', 'wb').write(audio)
        print('  ', k, len(audio) // 1024, 'KB')

def eleven_ok():
    try:
        xi('/voices'); return True
    except Exception as e:
        print('ElevenLabs not available:', e); return False

# ---------------------------------------------------------------- edge-tts (גיבוי)
async def edge_one(key, item):
    import certifi
    if os.path.exists('/root/.ccr/ca-bundle.crt'):
        certifi.where = lambda: '/root/.ccr/ca-bundle.crt'
    import edge_tts
    text = item.get('say', item['text'])
    for attempt in range(5):
        try:
            c = edge_tts.Communicate(text, V['fallback_edge_voice'], rate=V['fallback_rate'], pitch=V['fallback_pitch'],
                                     proxy=os.environ.get('HTTPS_PROXY'))
            audio = bytearray()
            async for ch in c.stream():
                if ch['type'] == 'audio': audio += ch['data']
            open(f'{OUT}/{key}.mp3', 'wb').write(audio); return
        except Exception as e:
            print('retry', key, e); await asyncio.sleep(2 + attempt * 2)
    raise SystemExit(f'TTS failed for {key}')

# ---------------------------------------------------------------- עיבוד + כתוביות
def process(key, item):
    src, dst = f'{OUT}/{key}.mp3', f'{OUT}/{key}.wav'
    af = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'highpass=f=70,bass=g=3:f=130,treble=g=1.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=110,'
          'aecho=0.85:0.5:60|120:0.10|0.05,apad=pad_dur=0.2,volume=1.2')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', af, '-ar', '48000', '-ac', '1', dst], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst],
                               capture_output=True, text=True).stdout)
    # כתוביות: חלוקה למשפטים לפי סימני פיסוק, תזמון יחסי לאורך הטקסט
    parts = [p.strip() for p in re.split(r'(?<=[.?!])\s+', item['text']) if p.strip()]
    tot = sum(len(p) for p in parts); t = 0.0; sent = []; speak = max(0.5, dur - 0.25)
    for p in parts:
        d = speak * len(p) / tot; sent.append({'text': p, 'start': round(t, 3), 'end': round(t + d, 3)}); t += d
    json.dump(sent, open(f'{OUT}/{key}.json', 'w', encoding='utf-8'), ensure_ascii=False)

if engine == 'elevenlabs' and eleven_ok():
    used = 'elevenlabs'; eleven_all()
else:
    used = 'edge'
    async def _m(): await asyncio.gather(*(edge_one(k, CFG['vo'][k]) for k in keys))
    asyncio.run(_m())
for k in keys: process(k, CFG['vo'][k])
open(f'{OUT}/ENGINE.txt', 'w').write(used + '\n')
print(f'voice ok ({used}):', ', '.join(keys))
