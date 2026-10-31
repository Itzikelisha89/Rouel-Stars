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
      // אייפון: בלי זה, כשהמתג בצד על "שקט" – דפי אינטרנט לא משמיעים כלום (iOS 17 ומעלה)
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch {}
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  // אייפון "פותח" את הצליל רק בתוך נגיעה של המשתמש, ולפעמים סוגר אותו שוב (מעבר אפליקציה / שיחה).
  // בכל נגיעה: מעירים את הצליל ומשמיעים רגע של שקט – זה "הטריק" שמשחרר את הרמקול בספארי.
  let unlocked = false;
  function unlockOnGesture() {
    const c = ac();
    if (!c) return;
    if (!unlocked || c.state !== 'running') {
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
        unlocked = true;
      } catch {}
    }
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach((e) => document.addEventListener(e, unlockOnGesture, { capture: true, passive: true }));

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
    // דפיקה על השולחן – כמו שעושים בפאס
    knock() {
      const c = ac();
      if (!c) return;
      const t = c.currentTime;
      [0, 0.16].forEach((d) => {
        const n = noise(c, 0.09);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        const g = c.createGain();
        g.gain.value = 1.4;
        n.connect(lp).connect(g).connect(c.destination);
        n.start(t + d);
        tone(c, 95, t + d, 0.12, 'sine', 0.45);
      });
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

  // ---- קול בעברית: הקלטות של קריין (גבר/אישה) ----
  const buffers = new Map();
  async function loadVoice(voice, key) {
    const id = `${voice}/${key}`;
    if (!buffers.has(id)) {
      buffers.set(
        id,
        fetch(`/audio/${id}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then((b) => new Promise((res, rej) => ac().decodeAudioData(b, res, rej)))
          .catch(() => null)
      );
    }
    return buffers.get(id);
  }
  let lastVoiceAt = 0;
  async function voice(v, key, delay = 0) {
    if (muted || !ac()) return;
    const buf = await loadVoice(['nar', 'fun', 'f'].includes(v) ? v : 'm', key);
    if (!buf) return;
    const c = ac();
    // שני אנשים לא מדברים בדיוק באותה שנייה
    const at = Math.max(c.currentTime + delay, lastVoiceAt);
    lastVoiceAt = at + buf.duration * 0.6;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = 1.15;
    src.connect(g).connect(c.destination);
    src.start(at);
  }
  function preload(keys) {
    for (const k of keys) {
      if (k.startsWith('nar/')) loadVoice('nar', k.slice(4));
      else for (const v of ['m', 'f']) loadVoice(v, k);
    }
  }

  // ---- אווירה: רעש חדר של בית קפה + צלצולי כוסות ונקישות רחוקות ----
  let amb = null;
  let ambOn = true;
  try {
    ambOn = localStorage.getItem('dm_amb') !== '0';
  } catch {}
  function startAmbience() {
    const c = ac();
    if (!c || amb || muted || !ambOn) return;
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // רעש חום – המיית חדר
        d[i] = last * 3.2;
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.16, c.currentTime + 2);
    src.connect(lp).connect(g).connect(c.destination);
    src.start();
    const tick = () => {
      if (!amb) return;
      const t = c.currentTime;
      const r = Math.random();
      if (r < 0.45) {
        // כפית בכוס / כוס על צלוחית
        const f = 2200 + Math.random() * 2600;
        tone(c, f, t, 0.5, 'sine', 0.012 + Math.random() * 0.01);
        tone(c, f * 1.5, t + 0.01, 0.35, 'sine', 0.006);
      } else if (r < 0.8) {
        // דומינו בשולחן אחר
        const n = noise(c, 0.05);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2000;
        const gg = c.createGain();
        gg.gain.value = 0.06;
        n.connect(bp).connect(gg).connect(c.destination);
        n.start(t);
      } else {
        // כיסא זז
        const n = noise(c, 0.35);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 300;
        const gg = c.createGain();
        gg.gain.value = 0.05;
        n.connect(bp).connect(gg).connect(c.destination);
        n.start(t);
      }
      amb.timer = setTimeout(tick, 2500 + Math.random() * 6000);
    };
    amb = { src, g, timer: setTimeout(tick, 3000) };
  }
  function stopAmbience() {
    if (!amb) return;
    clearTimeout(amb.timer);
    try {
      amb.g.gain.linearRampToValueAtTime(0, ac().currentTime + 0.5);
      const s = amb.src;
      setTimeout(() => s.stop(), 600);
    } catch {}
    amb = null;
  }

  function play(name, ...args) {
    if (muted || !fx[name]) return;
    try {
      fx[name](...args);
    } catch {}
  }

  return {
    play,
    voice,
    preload,
    startAmbience,
    stopAmbience,
    get ambience() {
      return ambOn;
    },
    toggleAmbience() {
      ambOn = !ambOn;
      try {
        localStorage.setItem('dm_amb', ambOn ? '1' : '0');
      } catch {}
      ambOn ? startAmbience() : stopAmbience();
      return ambOn;
    },
    unlock: () => ac(),
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      if (muted) stopAmbience();
      try {
        localStorage.setItem('dm_muted', muted ? '1' : '0');
      } catch {}
      return muted;
    },
  };
})();
