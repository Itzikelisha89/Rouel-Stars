# מפיק את הקריינות בעברית (edge-tts, קול עצבי של Microsoft) + תזמון משפטים לכתוביות.
# הרצה: python3 tools/voice.py [מפתח ...]   (בלי מפתחות = הכול)
import asyncio, json, os, sys, subprocess
import certifi
if os.path.exists('/root/.ccr/ca-bundle.crt'):
    certifi.where = lambda: '/root/.ccr/ca-bundle.crt'
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
OUT = os.path.join(ROOT, 'build', 'vo')
os.makedirs(OUT, exist_ok=True)
V = CFG['voice']

def voice_for(item):
    kind = item.get('voice', 'narrator')
    if kind == 'ai':
        return V['ai'], '+6%', '+0Hz'
    if kind == 'asker':
        return V['narrator'], '+10%', '+12Hz'
    if item.get('warm'):
        return V['narrator'], '+11%', '-4Hz'
    return V['narrator'], V['rate'], V['pitch']

async def one(key, item):
    voice, rate, pitch = voice_for(item)
    text = item.get('say', item['text'])
    for attempt in range(5):
        try:
            c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary='SentenceBoundary',
                                     proxy=os.environ.get('HTTPS_PROXY'))
            audio, sent = bytearray(), []
            async for ch in c.stream():
                if ch['type'] == 'audio':
                    audio += ch['data']
                elif ch['type'] in ('SentenceBoundary', 'WordBoundary'):
                    sent.append({'text': ch['text'], 'start': ch['offset'] / 1e7, 'end': (ch['offset'] + ch['duration']) / 1e7})
            open(f'{OUT}/{key}.mp3', 'wb').write(audio)
            json.dump(sent, open(f'{OUT}/{key}.json', 'w', encoding='utf-8'), ensure_ascii=False)
            return
        except Exception as e:
            print('retry', key, e); await asyncio.sleep(2 + attempt * 2)
    raise SystemExit(f'TTS failed for {key}')

def process(key, item):
    """עיבוד קול: קריין טריילר (בס, קומפרסיה, הד עדין) / מחשב רובוטי."""
    kind = item.get('voice', 'narrator')
    src, dst = f'{OUT}/{key}.mp3', f'{OUT}/{key}.wav'
    if kind == 'ai':
        af = ('highpass=f=180,lowpass=f=7000,aecho=0.8:0.6:18|36:0.35|0.2,'
              'acompressor=threshold=-20dB:ratio=4:attack=5:release=80,volume=1.2')
    elif kind == 'asker':
        af = 'highpass=f=150,lowpass=f=4500,acompressor=threshold=-20dB:ratio=3,volume=1.1'
    elif item.get('warm'):
        af = ('highpass=f=60,bass=g=4:f=140,treble=g=1.5,acompressor=threshold=-22dB:ratio=3:attack=8:release=120,'
              'aecho=0.85:0.5:55|110:0.10|0.05,volume=1.25')
    else:
        af = ('highpass=f=55,bass=g=6:f=120,treble=g=2,acompressor=threshold=-24dB:ratio=4:attack=5:release=100,'
              'aecho=0.85:0.6:70|140:0.16|0.08,volume=1.3')
    trim = 'areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.25,'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', trim + af, '-ar', '48000', '-ac', '1', dst], check=True)

async def main():
    keys = sys.argv[1:] or list(CFG['vo'])
    await asyncio.gather(*(one(k, CFG['vo'][k]) for k in keys))
    for k in keys:
        process(k, CFG['vo'][k])
    print('voice ok:', ', '.join(keys))

asyncio.run(main())
