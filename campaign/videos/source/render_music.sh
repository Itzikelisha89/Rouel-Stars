#!/bin/sh
# Render compose.py MIDI files to WAV with FluidSynth + FluidR3 GM soundfont.
# Usage: sh render_music.sh <workdir>
set -e
W=$1; mkdir -p "$W"
python3 "$(dirname "$0")/compose.py" "$W"
for n in magnet myth neck first cupping; do
  fluidsynth -ni -q -g 0.7 -r 44100 \
    -o synth.reverb.active=1 -o synth.reverb.room-size=0.82 -o synth.reverb.damp=0.35 \
    -o synth.reverb.width=0.9 -o synth.reverb.level=0.75 -o synth.chorus.active=1 \
    -F "$W/$n.raw.wav" /usr/share/sounds/sf2/FluidR3_GM.sf2 "$W/$n.mid"
done
