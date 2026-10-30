// צלילים מסונתזים (בלי קבצים): נקישת אבן, שליפה, ניקוד, תור, ניצחון
'use strict';

const Sound = (() => {
  let ctx = null;
  let muted = false;
  try {
    muted = localStorage.getItem('dm_muted') === '1';
  } catch {}

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise(c, dur) {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function tone(c, freq, start, dur, type = 'sine', vol = 0.18) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  const fx = {
    // נקישה של אבן על שולחן עץ: רעש קצר בתדר גבוה + "טוק" נמוך
    clack(strength = 1) {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      const n = noise(c, 0.07);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400 + Math.random() * 600;
      bp.Q.value = 1.4;
      const g = c.createGain();
      g.gain.value = 0.9 * strength;
      n.connect(bp).connect(g).connect(c.destination);
      n.start(t);
      tone(c, 180 + Math.random() * 30, t, 0.09, 'triangle', 0.25 * strength);
      // נקישה שנייה עדינה – האבן "מתיישבת"
      const n2 = noise(c, 0.04);
      const g2 = c.createGain();
      g2.gain.value = 0.25 * strength;
      const bp2 = c.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = 3200;
      n2.connect(bp2).connect(g2).connect(c.destination);
      n2.start(t + 0.055);
    },
    draw() {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      const n = noise(c, 0.22);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(2500, t + 0.2);
      const g = c.createGain();
      g.gain.value = 0.35;
      n.connect(f).connect(g).connect(c.destination);
      n.start(t);
    },
    shuffle() {
      for (let i = 0; i < 7; i++) setTimeout(() => fx.clack(0.35 + Math.random() * 0.3), i * 70 + Math.random() * 40);
    },
    score(points = 5) {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      const notes = points >= 20 ? [784, 988, 1175, 1568] : [784, 1175];
      notes.forEach((f, i) => tone(c, f, t + i * 0.09, 0.35, 'sine', 0.14));
    },
    turn() {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      tone(c, 660, t, 0.18, 'sine', 0.12);
      tone(c, 880, t + 0.12, 0.25, 'sine', 0.12);
    },
    pop() {
      const c = ac();
      if (!c) return;
      tone(c, 520, c.currentTime, 0.08, 'sine', 0.08);
    },
    pass() {
      const c = ac();
      if (!c) return;
      tone(c, 300, c.currentTime, 0.2, 'triangle', 0.1);
    },
    win() {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.13, 0.4, 'triangle', 0.15));
    },
    lose() {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      [392, 349, 311].forEach((f, i) => tone(c, f, t + i * 0.22, 0.4, 'triangle', 0.12));
    },
    error() {
      const c = ac();
      if (!c) return;
      tone(c, 160, c.currentTime, 0.15, 'square', 0.05);
    },
  };

  function play(name, ...args) {
    if (muted || !fx[name]) return;
    try {
      fx[name](...args);
    } catch {}
  }

  return {
    play,
    unlock: () => ac(),
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem('dm_muted', muted ? '1' : '0');
      } catch {}
      return muted;
    },
  };
})();
