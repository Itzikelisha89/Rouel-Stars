import json, subprocess
lines = json.load(open('lines.json'))
VO = 0.4                      # voice starts this long after its scene starts
INTRO, END = 3.4, 4.4
gaps  = [1.0, 1.0, 1.1, 1.2, 0.9, 1.3, 1.0, 1.1, 1.4, 0.9]
extra = {6: 6.0}              # scene 7 (index 6): demo beat after the voice
ids = ['kid', 'hotspot', 'ai', 'arch', 'problem', 'firewall', 'demo', 'split', 'statement', 'shower']
scenes = [{'id': 'intro', 's': 0.0, 'e': INTRO}]
voice = []
t = INTRO
for i, (ls, le, text) in enumerate(lines):
    dur = VO + (le - ls) + gaps[i] + extra.get(i, 0)
    scenes.append({'id': ids[i], 's': round(t, 3), 'e': round(t + dur, 3)})
    voice.append({'at': round(t + VO, 3), 'from': ls, 'to': le, 'text': text.strip()})
    t += dur
scenes.append({'id': 'end', 's': round(t, 3), 'e': round(t + END, 3)})
total = round(t + END, 3)
open('build/tl.js', 'w').write('window.TL=' + json.dumps({'scenes': scenes, 'voice': voice, 'total': total, 'VO': VO}, ensure_ascii=False) + ';')
print('total', total)
for s in scenes: print(f"{s['id']:10s} {s['s']:6.2f} - {s['e']:6.2f}")

# ---- audio: voice segments placed on the timeline + soft pad + click sounds
demo = next(s for s in scenes if s['id'] == 'demo')
voice_end = demo['s'] + VO + (lines[6][1] - lines[6][0])
clicks = [demo['s'] + VO + 0.45, voice_end + 0.9, voice_end + 3.9]   # נעל, חצי שעה, מצב
inputs = ['-i', 'voice.mp3']
filt = []
for k, v in enumerate(voice):
    a, b = max(0, v['from'] - 0.05), v['to'] + 0.3
    filt.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,adelay={int(v['at']*1000-50)}:all=1[v{k}]")
# pad: soft A-minor-ish chord with slow movement
pad = ("aevalsrc='0.05*sin(2*PI*110*t)+0.04*sin(2*PI*164.81*t)*(0.6+0.4*sin(2*PI*0.07*t))"
       "+0.035*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.05*t+1))+0.03*sin(2*PI*261.63*t)*(0.5+0.5*sin(2*PI*0.09*t+2))"
       f"+0.02*sin(2*PI*329.63*t)*(0.5+0.5*sin(2*PI*0.11*t))':s=44100:d={total}")
filt.append(f"{pad},lowpass=f=900,volume=0.55,afade=t=in:d=2,afade=t=out:st={total-3}:d=3[pad]")
for k, c in enumerate(clicks):
    filt.append(f"aevalsrc='0.5*sin(2*PI*1400*t)*exp(-40*t)':s=44100:d=0.15,adelay={int(c*1000)}:all=1[c{k}]")
mix = ''.join(f'[v{k}]' for k in range(len(voice))) + '[pad]' + ''.join(f'[c{k}]' for k in range(len(clicks)))
filt.append(f"{mix}amix=inputs={len(voice)+1+len(clicks)}:normalize=0:duration=longest,atrim=0:{total},loudnorm=I=-16:TP=-1.5[out]")
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filt),
                '-map', '[out]', '-ar', '44100', '-c:a', 'pcm_s16le', 'build/audio.wav'], check=True)
print('audio ok')
