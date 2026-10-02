"""Classical arrangements (public-domain compositions) for the campaign videos.

Writes a MIDI file per video; render.sh turns them into audio with FluidSynth
and the FluidR3 GM soundfont (MIT licensed).

Usage: python3 compose.py <outdir>
"""
import random
import sys
import mido

N = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
     'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}

def p(s):
    """'C#4' -> MIDI number."""
    name, octv = s[:-1], int(s[-1])
    return 12 * (octv + 1) + N[name]

PIANO, HARP, VIOLIN, CELLO, STRINGS, SLOW_STRINGS, FLUTE, OBOE = 0, 46, 40, 42, 48, 49, 73, 68

class Score:
    def __init__(self, sec_per_beat):
        self.spb = sec_per_beat
        self.parts = {}          # channel -> (program, [(start_sec, dur_sec, pitch, vel)])

    def part(self, ch, program):
        self.parts.setdefault(ch, (program, []))
        return self.parts[ch][1]

    def add(self, ch, program, beat, beats, pitch, vel):
        self.part(ch, program).append((beat * self.spb, beats * self.spb, p(pitch) if isinstance(pitch, str) else pitch, vel))

    def write(self, path, seed=0):
        rnd = random.Random(seed)
        mid = mido.MidiFile(ticks_per_beat=480)
        tempo = 500000          # 120 bpm => 1 sec = 960 ticks
        tps = 960
        for ch, (prog, notes) in sorted(self.parts.items()):
            tr = mido.MidiTrack(); mid.tracks.append(tr)
            tr.append(mido.MetaMessage('set_tempo', tempo=tempo, time=0))
            tr.append(mido.Message('program_change', program=prog, channel=ch, time=0))
            tr.append(mido.Message('control_change', control=91, value=70, channel=ch, time=0))  # reverb send
            tr.append(mido.Message('control_change', control=93, value=20, channel=ch, time=0))  # chorus send
            ev = []
            for st, du, pi, ve in notes:
                j = rnd.uniform(-0.006, 0.006) if prog in (PIANO, HARP) else 0
                v = max(1, min(127, int(ve + rnd.uniform(-5, 5))))
                ev.append((max(0, st + j), 1, pi, v))
                ev.append((st + j + du, 0, pi, 0))
            ev.sort(key=lambda e: (e[0], e[1]))
            last = 0
            for t, on, pi, v in ev:
                tick = int(round(t * tps))
                tr.append(mido.Message('note_on' if on else 'note_off', note=pi, velocity=v, channel=ch, time=tick - last))
                last = tick
        mid.save(path)


def canon():
    """Pachelbel, Canon in D: brand video (22.4 s)."""
    s = Score(1.0)
    bass = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2']
    chords = [['D4', 'F#4', 'A4'], ['C#4', 'E4', 'A4'], ['D4', 'F#4', 'B4'], ['C#4', 'F#4', 'A4'],
              ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['C#4', 'E4', 'A4']]
    line1 = ['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5']
    line2 = ['D5', 'C#5', 'B4', 'A4', 'G4', 'F#4', 'G4', 'E4']
    for cyc in range(2):
        for i in range(8):
            b = cyc * 8 + i
            s.add(1, CELLO, b, 1.0, bass[i], 78)
            for n in chords[i]:
                s.add(2, SLOW_STRINGS, b, 1.05, n, 46)
            # harp broken chord in triplets
            ar = [bass[i][:-1] + '3', chords[i][1][:-1] + '4', chords[i][2][:-1] + '4']
            for k, n in enumerate(ar):
                s.add(3, HARP, b + k / 3, 0.9, n, 58 if k == 0 else 48)
        mel = line1 if cyc == 0 else line2
        for i, n in enumerate(mel):
            s.add(0, VIOLIN, cyc * 8 + i, 1.0, n, 84)
        if cyc == 1:                                  # the canon: second violin echoes line 1
            for i, n in enumerate(line1):
                s.add(4, VIOLIN, 8 + i, 1.0, n[:-1] + str(int(n[-1]) - 1), 60)
    end = 16
    s.add(1, CELLO, end, 6, 'D2', 80)
    for n in ['D4', 'F#4', 'A4', 'D5']:
        s.add(2, SLOW_STRINGS, end, 6, n, 52)
    s.add(0, VIOLIN, end, 6, 'F#5', 78)
    for k, n in enumerate(['D3', 'A3', 'D4', 'F#4', 'A4', 'D5']):
        s.add(3, HARP, end + k * 0.16, 5, n, 60)
    return s


def morning():
    """Grieg, Morning Mood (Peer Gynt), E major: myth video (20.6 s)."""
    s = Score(0.27)      # one eighth note per beat, 6/8
    M = {'G': 'B5', 'E': 'G#5', 'D': 'F#5', 'C': 'E5', 'A': 'C#6'}
    bars = ['GEDC', 'DEGE', 'DCDE', 'DEGE', 'GAEA', 'GEDC']
    rhythm = [2, 1, 2, 1]
    harm = [['E3', 'B3', 'G#4'], ['E3', 'B3', 'G#4'], ['E3', 'B3', 'G#4'], ['E3', 'B3', 'G#4'],
            ['C#3', 'G#3', 'E4'], ['E3', 'B3', 'G#4']]
    def phrase(start, nbars, ch, prog, vel, octave_shift=0):
        b = start
        for bi in range(nbars):
            for k, c in enumerate(bars[bi]):
                d = rhythm[k]
                last = bi == nbars - 1 and k == 3
                n = M[c]
                if octave_shift:
                    n = n[:-1] + str(int(n[-1]) + octave_shift)
                s.add(ch, prog, b, (8 if last else d) * 0.95, n, vel)
                b += d
        return b
    phrase(0, 6, 0, FLUTE, 88)
    phrase(36, 4, 1, OBOE, 80, -1)
    for bi in range(10):
        h = harm[bi if bi < 6 else bi - 6]
        for n in h:
            s.add(2, STRINGS, bi * 6, 6.2, n, 44)
        for k in range(6):                            # harp in eighths
            s.add(3, HARP, bi * 6 + k, 2, h[k % 3][:-1] + ('4' if k % 3 else '3'), 40)
    end = 60
    for n in ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4']:
        s.add(2, STRINGS, end, 17, n, 54)
    for k, n in enumerate(['E3', 'B3', 'E4', 'G#4', 'B4', 'E5']):
        s.add(3, HARP, end + k * 0.6, 15, n, 58)
    s.add(0, FLUTE, end, 14, 'G#5', 70)
    return s


def gymnopedie():
    """Satie, Gymnopedie No. 1: neck-exercise video (38 s)."""
    s = Score(0.79)      # quarter notes, 3/4
    G = ('G2', ['B3', 'D4', 'F#4']); D = ('D2', ['A3', 'C#4', 'F#4'])
    for bar in range(14):
        bass, ch = G if bar % 2 == 0 else D
        b = bar * 3
        s.add(1, PIANO, b, 1.0, bass, 62)
        for n in ch:
            s.add(1, PIANO, b + 1, 2.0, n, 46)
            s.add(2, SLOW_STRINGS, b, 3.0, n, 26)
    mel = [  # (bar, beat, beats, note)
        (4, 1, 1, 'F#5'), (4, 2, 1, 'A5'), (5, 0, 1, 'G5'), (5, 1, 1, 'F#5'), (5, 2, 1, 'C#5'),
        (6, 0, 1, 'B4'), (6, 1, 1, 'C#5'), (6, 2, 1, 'D5'), (7, 0, 3, 'A4'), (8, 0, 6, 'F#4'),
        (10, 1, 1, 'F#5'), (10, 2, 1, 'A5'), (11, 0, 1, 'G5'), (11, 1, 1, 'F#5'), (11, 2, 1, 'C#5'),
        (12, 0, 1, 'B4'), (12, 1, 1, 'C#5'), (12, 2, 1, 'D5'), (13, 0, 3, 'A4')]
    for bar, beat, beats, n in mel:
        s.add(0, PIANO, bar * 3 + beat, beats, n, 70)
    end = 14 * 3
    s.add(1, PIANO, end, 6, 'D2', 60)
    for n in ['A3', 'D4', 'F#4']:
        s.add(1, PIANO, end + 1, 5, n, 44)
        s.add(2, SLOW_STRINGS, end, 6, n, 30)
    s.add(0, PIANO, end + 1, 5, 'D5', 62)
    return s


def prelude():
    """Bach, Prelude in C major BWV 846: first-treatment video (26.4 s)."""
    s = Score(0.206)     # sixteenth notes
    bars = [['C4', 'E4', 'G4', 'C5', 'E5'], ['C4', 'D4', 'A4', 'D5', 'F5'], ['B3', 'D4', 'G4', 'D5', 'F5'],
            ['C4', 'E4', 'G4', 'C5', 'E5'], ['C4', 'E4', 'A4', 'E5', 'A5'], ['C4', 'D4', 'F#4', 'A4', 'D5'],
            ['B3', 'D4', 'G4', 'D5', 'G5']]
    for bi, (n1, n2, n3, n4, n5) in enumerate(bars):
        for half in range(2):
            b = bi * 16 + half * 8
            s.add(0, PIANO, b, 8, n1, 60)
            s.add(0, PIANO, b + 1, 7, n2, 54)
            for k, n in enumerate([n3, n4, n5, n3, n4, n5]):
                s.add(0, PIANO, b + 2 + k, 1.1, n, 62 if k % 3 == 0 else 52)
        for n in (n1, n2, n3):
            s.add(1, SLOW_STRINGS, bi * 16, 16, n[:-1] + str(int(n[-1]) - 1), 30)
    end = 7 * 16
    for k, n in enumerate(['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5']):
        s.add(0, PIANO, end + k * 0.5, 14, n, 62)
    for n in ['C3', 'G3', 'E4']:
        s.add(1, SLOW_STRINGS, end, 16, n, 38)
    return s


def fur_elise():
    """Beethoven, Fur Elise (A section, twice): cupping video (23.8 s)."""
    s = Score(0.2)       # sixteenth notes, 3/8
    A, E = ['A2', 'E3', 'A3'], ['E2', 'E3', 'G#3']
    sec = [  # each bar: (rh notes for 6 sixteenths or None, lh arpeggio or None)
        (['E5', 'D#5', 'E5', 'B4', 'D5', 'C5'], None),
        ([('A4', 2), 'C4', 'E4', 'A4'], A),
        ([('B4', 2), 'E4', 'G#4', 'B4'], E),
        ([('C5', 2), 'E4', 'E5', 'D#5'], A),
        (['E5', 'D#5', 'E5', 'B4', 'D5', 'C5'], None),
        ([('A4', 2), 'C4', 'E4', 'A4'], A),
        ([('B4', 2), 'E4', 'C5', 'B4'], E),
        ([('A4', 4)], A),
    ]
    b = 0
    s.add(0, PIANO, b, 1, 'E5', 64); s.add(0, PIANO, b + 1, 1, 'D#5', 58); b = 2
    for rep in range(2):
        for bi, (rh, lh) in enumerate(sec):
            pos = b
            for item in rh:
                n, d = (item if isinstance(item, tuple) else (item, 1))
                s.add(0, PIANO, pos, d * 1.05, n, 66 if pos == b else 56)
                pos += d
            if lh:
                for k, n in enumerate(lh):
                    s.add(1, PIANO, b + k, 3 - k + 0.5, n, 50)
                for n in (lh if lh is E else ['A3', 'C4', 'E4']):
                    s.add(2, SLOW_STRINGS, b, 6, n, 24)
            if bi == 7 and rep == 0:              # pickup into the repeat
                s.add(0, PIANO, b + 4, 1, 'E5', 62); s.add(0, PIANO, b + 5, 1, 'D#5', 56)
            b += 6
    end = b
    for k, n in enumerate(['A2', 'E3', 'A3', 'C4', 'E4', 'A4']):
        s.add(1, PIANO, end + k * 0.8, 18, n, 56)
    for n in ['A3', 'C4', 'E4']:
        s.add(2, SLOW_STRINGS, end, 20, n, 34)
    return s


PIECES = {'magnet': canon, 'myth': morning, 'neck': gymnopedie, 'first': prelude, 'cupping': fur_elise}

if __name__ == '__main__':
    out = sys.argv[1]
    for i, (name, fn) in enumerate(PIECES.items()):
        fn().write(f'{out}/{name}.mid', seed=i)
        print('wrote', name)
