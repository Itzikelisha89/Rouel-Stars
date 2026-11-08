// MOR SHABAT – THE LEGEND OF LAHAV
// מנוע הסרט: כל פריים הוא פונקציה טהורה של הזמן t (דטרמיניסטי) – כך אפשר גם לנגן בזמן אמת וגם לרנדר פריים-פריים ל-MP4.
// קואורדינטות לוגיות 1920x1080, מוכפלות ל-4K בזמן רינדור.
'use strict';
(function () {
const W = 1920, H = 1080;
let TL, E, T, PH, S = 1, IMG = {}, CACHE = {};

// ------------------------------------------------------------ עזרים
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ss = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const eOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const eIn = (x) => Math.pow(clamp(x), 3);
const eBack = (x) => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const win = (t, a, b, fi = 0.4, fo = 0.4) => Math.min(ss((t - a) / fi), ss((b - t) / fo));
function hash(n) { n |= 0; n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
const R = (i, k = 0) => hash(Math.imul(i | 0, 7919) + Math.imul(k | 0, 104729) + 17);   // [0,1)
const ev = (k) => E[k];

function off(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function glowSprite(color, size = 128) {
  const key = 'glow' + color + size;
  if (CACHE[key]) return CACHE[key];
  const c = off(size, size), g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, color); gr.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.25)'));
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return (CACHE[key] = c);
}
const GOLD = 'rgba(255,196,90,1)', BLUE = 'rgba(90,170,255,1)', CYAN = 'rgba(60,230,255,1)', WHITE = 'rgba(255,255,255,1)', RED = 'rgba(255,70,60,1)', ORANGE = 'rgba(255,130,40,1)';

function smokeTex(i) {
  const key = 'smoke' + i;
  if (CACHE[key]) return CACHE[key];
  const n = 512, c = off(n, n), g = c.getContext('2d');
  for (let k = 0; k < 70; k++) {
    const x = n * (0.2 + 0.6 * R(k, i)), y = n * (0.25 + 0.5 * R(k, i + 9)), r = n * (0.08 + 0.18 * R(k, i + 3));
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return (CACHE[key] = c);
}
function grainTex(i) {
  const key = 'grain' + i;
  if (CACHE[key]) return CACHE[key];
  const w = 640, h = 360, c = off(w, h), g = c.getContext('2d'), d = g.createImageData(w, h);
  let s = i * 99991 + 1;
  for (let p = 0; p < d.data.length; p += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = 128 + ((s >> 8) % 120) - 60; d.data[p] = d.data[p + 1] = d.data[p + 2] = v; d.data[p + 3] = 255; }
  g.putImageData(d, 0, 0);
  return (CACHE[key] = c);
}

function font(fam, size, w = 900) { return `${w} ${size}px "${fam}"`; }
function setShadow(ctx, blur, color) { ctx.shadowBlur = blur * S; ctx.shadowColor = color; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
function noShadow(ctx) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }

function text(ctx, s, x, y, o = {}) {
  ctx.save();
  ctx.font = font(o.fam || 'Heebo', o.size || 60, o.w || 900);
  ctx.direction = o.dir || (/[֐-׿]/.test(s) ? 'rtl' : 'ltr');
  ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle';
  ctx.letterSpacing = (o.spacing || 0) + 'px';
  ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
  if (o.glow) setShadow(ctx, o.glow, o.glowColor || 'rgba(255,200,100,0.9)');
  if (o.stroke) { ctx.lineWidth = o.stroke; ctx.strokeStyle = o.strokeColor || '#000'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = o.color || '#fff';
  ctx.fillText(s, x, y);
  ctx.restore();
}
function measure(ctx, s, o) { ctx.save(); ctx.font = font(o.fam || 'Heebo', o.size || 60, o.w || 900); ctx.letterSpacing = (o.spacing || 0) + 'px'; const m = ctx.measureText(s).width; ctx.restore(); return m; }
function wrap(ctx, s, maxW, o) {
  const words = s.split(' '), lines = []; let cur = '';
  for (const w of words) { const tr = cur ? cur + ' ' + w : w; if (measure(ctx, tr, o) > maxW && cur) { lines.push(cur); cur = w; } else cur = tr; }
  if (cur) lines.push(cur);
  return lines;
}
function goldGrad(ctx, y0, y1, sweep = -1, x0 = 0, x1 = W) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fffbe8'); g.addColorStop(0.3, '#ffd98a'); g.addColorStop(0.52, '#b9852a'); g.addColorStop(0.62, '#e9c06a'); g.addColorStop(0.8, '#fff1bf'); g.addColorStop(1, '#8a5a14');
  return g;
}
// טקסט תלת-ממדי מזהב/כסף עם עומק והברקה נעה
function text3D(ctx, s, x, y, o = {}) {
  const size = o.size || 150, depth = o.depth || 16, fam = o.fam || 'Cinzel';
  ctx.save();
  ctx.font = font(fam, size, o.w || 900);
  ctx.direction = /[֐-׿]/.test(s) ? 'rtl' : 'ltr';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.letterSpacing = (o.spacing || 0) + 'px';
  ctx.globalAlpha *= o.alpha == null ? 1 : o.alpha;
  const dx = o.dx == null ? 0.0 : o.dx, dy = o.dy == null ? 1 : o.dy;
  const silver = o.silver;
  for (let i = depth; i > 0; i--) {
    const k = i / depth;
    ctx.fillStyle = silver ? `rgb(${40 + 30 * (1 - k)},${45 + 35 * (1 - k)},${55 + 40 * (1 - k)})` : `rgb(${70 + 60 * (1 - k)},${38 + 34 * (1 - k)},${8 + 10 * (1 - k)})`;
    ctx.fillText(s, x + dx * i, y + dy * i);
  }
  if (o.glow) setShadow(ctx, o.glow, o.glowColor || 'rgba(255,190,80,0.8)');
  const g = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
  if (silver) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#c9d3e0'); g.addColorStop(0.55, '#5d6878'); g.addColorStop(0.75, '#dfe8f5'); g.addColorStop(1, '#8796ab'); }
  else { g.addColorStop(0, '#fffbe8'); g.addColorStop(0.32, '#ffd98a'); g.addColorStop(0.52, '#a8741e'); g.addColorStop(0.64, '#efc66e'); g.addColorStop(0.85, '#fff0b8'); g.addColorStop(1, '#9b6a1c'); }
  ctx.fillStyle = g; ctx.fillText(s, x, y);
  noShadow(ctx);
  if (o.sweep != null) {   // פס אור חוצה
    const wdt = ctx.measureText(s).width, sx = x - wdt / 2 + (wdt + 400) * o.sweep - 200;
    const sg = ctx.createLinearGradient(sx - 120, y - size, sx + 120, y + size);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.85)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sg; ctx.globalAlpha *= 0.7; ctx.fillText(s, x, y);
  }
  ctx.restore();
}

function sprite(ctx, img, x, y, r, a = 1) { if (a <= 0.003) return; ctx.globalAlpha = a; ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }

// ------------------------------------------------------------ תמונות
function photo(name) { return IMG[name]; }
function blurred(name) {
  const key = 'blur' + name;
  if (CACHE[key]) return CACHE[key];
  const im = photo(name), w = 320, h = Math.round(320 * im.height / im.width), c = off(w, h), g = c.getContext('2d');
  g.filter = 'blur(9px)'; g.drawImage(im, -20, -20, w + 40, h + 40);
  return (CACHE[key] = c);
}
// מצייר תמונה כך שתכסה מלבן, עם מיקוד וזום, בלי שוליים ריקים
function drawPhoto(ctx, im, rx, ry, rw, rh, fx = 0.5, fy = 0.5, zoom = 1, px = 0.5, py = 0.5) {
  const iw = im.width, ih = im.height;
  const s = Math.max(rw / iw, rh / ih) * zoom;
  let ox = rx + rw * px - fx * iw * s, oy = ry + rh * py - fy * ih * s;
  ox = Math.min(rx, Math.max(rx + rw - iw * s, ox)); oy = Math.min(ry, Math.max(ry + rh - ih * s, oy));
  ctx.drawImage(im, ox, oy, iw * s, ih * s);
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ------------------------------------------------------------ אפקטים
function smoke(ctx, t, a, tint = null, n = 6, speed = 20) {
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < n; i++) {
    const tex = smokeTex(i % 4), sz = 1100 + 500 * R(i, 1);
    const x = ((R(i, 2) * (W + sz) + t * speed * (0.5 + R(i, 3))) % (W + sz)) - sz / 2 - sz / 2;
    const y = H * (0.2 + 0.7 * R(i, 4)) - sz / 2 + Math.sin(t * 0.2 + i) * 30;
    ctx.globalAlpha = a * 0.4 * (0.5 + 0.5 * R(i, 5));
    ctx.drawImage(tex, x, y, sz, sz);
  }
  if (tint) { ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
// ניצוצות/גחלים עולות
function embers(ctx, t, n, a, color = ORANGE, up = 1, spread = 1) {
  const g = glowSprite(color, 64);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const life = 3 + 4 * R(i, 1), ph = (t / life + R(i, 2)) % 1;
    const x = W * R(i, 3) + Math.sin(t * (0.6 + R(i, 4)) + i) * 40 * spread;
    const y = up > 0 ? H + 40 - ph * (H + 120) : -40 + ph * (H + 120);
    const fl = 0.6 + 0.4 * Math.sin(t * 9 + i * 3);
    sprite(ctx, g, x, y, 5 + 9 * R(i, 5), a * fl * Math.sin(ph * Math.PI));
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function sparksFall(ctx, t, n, a) {   // ניצוצות ריתוך נופלים עם שובל
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const life = 1.2 + R(i, 1), ph = (t / life + R(i, 2)) % 1, x0 = W * R(i, 3), vx = (R(i, 4) - 0.5) * 300;
    const tt = ph * life, x = x0 + vx * tt, y = -20 + 200 * tt + 450 * tt * tt;
    ctx.strokeStyle = `rgba(255,${170 + 60 * R(i, 5)},90,${a * (1 - ph)})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vx * 0.03, y - (200 + 900 * tt) * 0.03); ctx.stroke();
  }
  ctx.restore();
}
function rays(ctx, cx, cy, a, t, color = '255,210,130', n = 14, len = 1400) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + t * 0.05 + R(i, 1) * 0.3, wdt = 0.03 + 0.05 * R(i, 2);
    const al = a * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2)));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
    g.addColorStop(0, `rgba(${color},${al})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, len, ang - wdt, ang + wdt); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function flare(ctx, x, y, a, scale = 1, color = '120,190,255') {   // הבזק עדשה אנמורפי
  if (a <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x - 1100 * scale, 0, x + 1100 * scale, 0);
  g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.5, `rgba(${color},${0.9 * a})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - 1100 * scale, y - 5 * scale, 2200 * scale, 10 * scale);
  ctx.globalAlpha = a * 0.5; ctx.fillRect(x - 1100 * scale, y - 18 * scale, 2200 * scale, 36 * scale);
  sprite(ctx, glowSprite('rgba(255,255,255,1)', 256), x, y, 160 * scale, a);
  for (let k = 1; k <= 4; k++) {
    const fx = lerp(x, W - x, k / 4), fy = lerp(y, H - y, k / 4);
    sprite(ctx, glowSprite(`rgba(${color},1)`, 128), fx, fy, (20 + 25 * k) * scale, a * 0.18);
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function lightning(ctx, x0, y0, x1, y1, seed, a) {
  if (a <= 0) return;
  let pts = [[x0, y0], [x1, y1]];
  for (let it = 0; it < 7; it++) {
    const np = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay);
      np.push([(ax + bx) / 2 + (R(seed + it * 131 + i, 1) - 0.5) * d * 0.45, (ay + by) / 2 + (R(seed + it * 131 + i, 2) - 0.5) * d * 0.15]); np.push(pts[i]);
    }
    pts = np;
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
  for (const [w, al] of [[22, 0.08], [9, 0.25], [3, 1]]) {
    ctx.strokeStyle = `rgba(200,220,255,${al * a})`; ctx.lineWidth = w; ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  }
  ctx.restore();
}
function burst(ctx, cx, cy, t0, t, n, color, speed = 900, life = 1.6, seed = 1, grav = 220) {
  const dt = t - t0; if (dt < 0 || dt > life) return;
  const g = glowSprite(color, 64);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const k = 2.2, f = (1 - Math.exp(-k * dt)) / k;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + R(i, seed) * 0.3, v = speed * (0.55 + 0.45 * R(i, seed + 1));
    const x = cx + Math.cos(ang) * v * f, y = cy + Math.sin(ang) * v * f + grav * dt * dt;
    const a = (1 - dt / life) * (0.7 + 0.3 * Math.sin(t * 30 + i));
    sprite(ctx, g, x, y, 9, a);
    const f2 = (1 - Math.exp(-k * Math.max(0, dt - 0.08))) / k;
    ctx.globalAlpha = a * 0.5; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + Math.cos(ang) * v * f2, cy + Math.sin(ang) * v * f2 + grav * Math.max(0, dt - 0.08) ** 2); ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
const FWC = [GOLD, 'rgba(255,90,120,1)', BLUE, 'rgba(140,255,160,1)', 'rgba(255,240,200,1)', 'rgba(200,120,255,1)'];
function fireworks(ctx, t, t0, t1, rate, seedBase = 0, yMax = 0.55) {
  const n = Math.floor((t1 - t0) * rate);
  for (let i = 0; i < n; i++) {
    const tb = t0 + (i + R(i, seedBase + 1) * 0.8) / rate;
    if (t < tb - 0.8 || t > tb + 2.2) continue;
    const x = W * (0.12 + 0.76 * R(i, seedBase + 2)), y = H * (0.12 + yMax * 0.6 * R(i, seedBase + 3));
    if (t < tb) {   // שיגור
      const p = 1 - (tb - t) / 0.8; sprite(ctx, glowSprite(GOLD, 64), x, lerp(H + 20, y, eOut(p)), 6, 0.8); ctx.globalAlpha = 1; continue;
    }
    const c = FWC[(i + seedBase) % FWC.length];
    burst(ctx, x, y, tb, t, 70, c, 600 + 400 * R(i, seedBase + 4), 2.0, i * 3 + seedBase);
    if (t - tb < 0.25) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; sprite(ctx, glowSprite(c, 256), x, y, 260, (0.25 - (t - tb)) * 2.4); ctx.restore(); ctx.globalAlpha = 1; }
  }
}
function confetti(ctx, t, t0, n = 260, a = 1) {
  const dt = t - t0; if (dt < 0) return;
  const cols = ['#ffd56b', '#ff6f91', '#6fd3ff', '#9dff8a', '#ffffff', '#c58bff', '#ffb347'];
  ctx.save();
  for (let i = 0; i < n; i++) {
    const delay = R(i, 1) * 3, d = dt - delay; if (d < 0) continue;
    const y = -40 + d * (140 + 120 * R(i, 2)); if (y > H + 40) continue;
    const x = W * R(i, 3) + Math.sin(d * (1.5 + R(i, 4) * 2) + i) * 60;
    ctx.globalAlpha = a; ctx.fillStyle = cols[i % cols.length];
    ctx.save(); ctx.translate(x, y); ctx.rotate(d * (2 + 4 * R(i, 5)) + i); ctx.scale(1, Math.cos(d * (3 + 5 * R(i, 6)) + i));
    ctx.fillRect(-7, -4, 14, 8); ctx.restore();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function bokeh(ctx, t, a, warm = true) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const x = (W * R(i, 1) + t * 12 * (R(i, 2) - 0.5)) % W, y = H * R(i, 3) + Math.sin(t * 0.3 + i) * 25, r = 30 + 90 * R(i, 4);
    const c = warm ? `rgba(255,${180 + 50 * R(i, 5)},${90 + 60 * R(i, 6)},1)` : `rgba(120,180,255,1)`;
    sprite(ctx, glowSprite(c, 128), x, y, r, a * (0.06 + 0.12 * R(i, 7)) * (0.7 + 0.3 * Math.sin(t + i)));
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ המחסן (פרספקטיבה אמיתית)
const LABELS = ['CISCO RTR', 'MOR ✓', 'CISCO SW', 'TABLES ×20', 'MOR ✓', 'UNIFORMS', 'SW-48P', 'RTR-04'];
function warehouse(ctx, t, zc, mode = 'real', bright = 1, scan = -1) {
  const f = 950, cy = H / 2 + 40, camY = 1.7, camX = Math.sin(t * 0.4) * 0.15;
  const P = (x, y, z) => { const d = z - zc; return [W / 2 + f * (x - camX) / d, cy - f * (y - camY) / d, d]; };
  const holo = mode === 'holo';
  // רקע
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  if (holo) { bg.addColorStop(0, '#020a14'); bg.addColorStop(0.55, '#03202e'); bg.addColorStop(1, '#010509'); }
  else { bg.addColorStop(0, '#05070a'); bg.addColorStop(0.5, '#141a1c'); bg.addColorStop(1, '#030405'); }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = bright;
  // רצפה – קווי רשת
  ctx.lineWidth = 1.5;
  for (let x = -6; x <= 6; x += 1.5) {
    const [x1, y1] = P(x, 0, zc + 1.2), [x2, y2] = P(x, 0, zc + 70);
    ctx.strokeStyle = holo ? 'rgba(60,230,255,0.35)' : 'rgba(255,220,160,0.06)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  const zs = Math.ceil(zc / 2) * 2;
  for (let z = zs + 2; z < zc + 70; z += 2) {
    const [x1, y1, d] = P(-6, 0, z), [x2] = P(6, 0, z);
    ctx.strokeStyle = holo ? `rgba(60,230,255,${0.35 * Math.max(0, 1 - d / 60)})` : `rgba(255,220,160,${0.05 * Math.max(0, 1 - d / 60)})`;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
  }
  // מדפים וארגזים – מהרחוק לקרוב
  const unit = 1.6, z0 = Math.floor(zc / unit) * unit;
  for (let z = z0 + 45 * unit; z > zc + 0.6; z -= unit) {
    const idx = Math.round(z / unit);
    for (const side of [-1, 1]) {
      for (let lv = 0; lv < 3; lv++) {
        const id = idx * 7 + lv * 3 + (side > 0 ? 1 : 0);
        if (R(id, 1) < 0.12) continue;
        const y0 = lv * 1.25 + 0.1, hgt = 0.85 + 0.25 * R(id, 2), xin = side * 2.6, xout = side * 4.2;
        const zA = z + 0.08, zB = z + unit - 0.08;
        const a = P(xin, y0, zA), b = P(xin, y0 + hgt, zA), c = P(xin, y0 + hgt, zB), d = P(xin, y0, zB);
        const e = P(xout, y0, zA), g = P(xout, y0 + hgt, zA);
        const fog = Math.max(0, 1 - a[2] / 55);
        if (fog <= 0) continue;
        const hue = R(id, 3);
        if (holo) {
          const sc = scan > 0 && Math.abs(z - (zc + scan)) < 1.2;
          ctx.fillStyle = `rgba(40,200,255,${(sc ? 0.35 : 0.08) * fog})`;
          ctx.strokeStyle = `rgba(80,235,255,${(sc ? 1 : 0.6) * fog})`; ctx.lineWidth = sc ? 2.5 : 1.2;
          for (const q of [[a, b, c, d], [a, b, g, e]]) { ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        } else {
          const base = [[62, 70, 38], [75, 66, 44], [52, 60, 40], [88, 72, 48]][Math.floor(hue * 4)];
          const lit = fog * bright;
          ctx.fillStyle = `rgb(${base[0] * lit * 0.8},${base[1] * lit * 0.8},${base[2] * lit * 0.8})`;
          ctx.beginPath(); [a, b, c, d].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
          ctx.fillStyle = `rgb(${base[0] * lit * 1.15},${base[1] * lit * 1.15},${base[2] * lit * 1.15})`;
          ctx.beginPath(); [a, b, g, e].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = `rgba(0,0,0,${0.55 * fog})`; ctx.lineWidth = Math.max(1, 40 / a[2]); ctx.stroke();
          ctx.beginPath(); [a, b, c, d].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
          // סטנסיל על הפאה הקדמית (מקבילה למסך)
          if (a[2] < 16) {
            const fw = Math.abs(e[0] - a[0]), fh = Math.abs(a[1] - b[1]);
            if (fw > 30) {
              ctx.save(); ctx.globalAlpha = lit * 0.55; ctx.fillStyle = '#e8dcb0';
              ctx.font = `700 ${Math.min(fh * 0.22, fw * 0.16)}px "Orbitron"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(LABELS[id % LABELS.length], (a[0] + e[0]) / 2, (a[1] + b[1]) / 2);
              ctx.restore();
            }
          }
        }
      }
      // עמודי מדף
      const p1 = P(side * 2.55, 0, z), p2 = P(side * 2.55, 3.9, z);
      ctx.strokeStyle = holo ? `rgba(80,235,255,${0.5 * Math.max(0, 1 - p1[2] / 50)})` : `rgba(140,140,130,${0.5 * Math.max(0, 1 - p1[2] / 50) * bright})`;
      ctx.lineWidth = Math.max(1, 60 / p1[2]); ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
  }
  // תאורת תקרה + קרני אור נפחיות
  if (!holo) {
    ctx.globalCompositeOperation = 'lighter';
    const lu = 6, l0 = Math.floor(zc / lu) * lu;
    for (let z = l0 + lu * 9; z > zc + 1; z -= lu) {
      const [lx, ly, d] = P(0, 5.2, z), fog = Math.max(0, 1 - d / 55) * bright;
      const [fx1, fy1] = P(-2.2, 0, z), [fx2] = P(2.2, 0, z);
      const g = ctx.createLinearGradient(0, ly, 0, fy1);
      g.addColorStop(0, `rgba(255,225,170,${0.22 * fog})`); g.addColorStop(1, 'rgba(255,225,170,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx - 30 * 10 / d, ly); ctx.lineTo(lx + 30 * 10 / d, ly); ctx.lineTo(fx2, fy1); ctx.lineTo(fx1, fy1); ctx.closePath(); ctx.fill();
      sprite(ctx, glowSprite('rgba(255,220,160,1)', 128), lx, ly, 900 / d, fog);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  return P;
}

// ------------------------------------------------------------ רכיבי ממשק
function hudFrame(ctx, x, y, w, h, color = 'rgba(80,235,255,', a = 1) {
  ctx.save(); ctx.strokeStyle = color + a + ')'; ctx.lineWidth = 3; const c = 30;
  for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(px, py + c * sy); ctx.lineTo(px, py); ctx.lineTo(px + c * sx, py); ctx.stroke();
  }
  ctx.fillStyle = color + 0.06 * a + ')'; ctx.fillRect(x, y, w, h);
  ctx.restore();
}
function scanlines(ctx, a) {
  if (CACHE.scan == null) { const c = off(4, 8), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 4, 3); CACHE.scan = c; }
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = ctx.createPattern(CACHE.scan, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}
function typed(s, t, t0, cps = 22) { const n = Math.floor(clamp((t - t0) * cps, 0, s.length)); return [...s].slice(0, n).join(''); }
function ringLoader(ctx, x, y, r, t, color, a = 1) {
  ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, r, t * 5, t * 5 + 4.2); ctx.stroke(); ctx.restore();
}

// מצב קריינות: כתוביות לפי משפטים
function subtitle(ctx, t, keys, y = H - 120, o = {}) {
  for (const c of TL.vo) {
    if (!keys.includes(c.key) || t < c.start - 0.05 || t > c.start + c.dur + 0.2) continue;
    const s = c.sent.find((q, i) => t >= q.start - 0.05 && (t < (c.sent[i + 1] ? c.sent[i + 1].start - 0.05 : c.start + c.dur + 0.2)));
    if (!s) continue;
    const next = c.sent[c.sent.indexOf(s) + 1];
    const a = Math.min(ss((t - s.start + 0.05) / 0.25), ss(((next ? next.start : c.start + c.dur + 0.2) - t) / 0.2));
    const opt = { size: o.size || 46, w: o.w || 700, fam: o.fam || 'Heebo' };
    const lines = wrap(ctx, s.text, o.maxW || 1500, opt);
    const lh = opt.size * 1.3;
    lines.forEach((ln, i) => text(ctx, ln, o.x || W / 2, y - (lines.length - 1 - i) * lh, { ...opt, alpha: a, color: o.color || '#fff', stroke: 7, strokeColor: 'rgba(0,0,0,0.65)', align: o.align, glow: o.glow, glowColor: o.glowColor }));
  }
}
function cueOf(key) { return TL.vo.find((c) => c.key === key); }

// ============================================================ סצנות
// --- חלק 1: פתיחה
function scene1(ctx, t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // מחסן
  const whA = Math.max(win(t, ev('wh') - 0.3, ev('silence') + 0.4, 1.2, 0.8), win(t, ev('o4'), ev('boom'), 1.0, 0.05) * 0.55);
  if (whA > 0) {
    ctx.save(); ctx.globalAlpha = whA;
    const zc = (t - ev('wh')) * 3.2 + Math.max(0, t - ev('o4')) * 6;
    warehouse(ctx, t, zc, 'real', 1);
    ctx.restore();
    smoke(ctx, t, 0.5 * whA, null, 5, 30);
    sparksFall(ctx, t, 26, whA);
  }
  smoke(ctx, t, 0.25, null, 4, 10);
  // ברק והבזק
  const th = ev('thunder');
  if (t >= th - 0.05 && t < th + 0.6) {
    lightning(ctx, W * 0.62, -20, W * 0.48, H * 0.75, 11, clamp(1 - (t - th) / 0.45) * (Math.sin((t - th) * 60) > -0.3 ? 1 : 0.3));
    lightning(ctx, W * 0.66, -20, W * 0.85, H * 0.5, 23, clamp(1 - (t - th - 0.1) / 0.35));
  }
  // טקסטים
  const lines = [['open1', 'o1', th + 0.2], ['open2', 'o2', ev('o3') - 0.15], ['open3', 'o3', ev('o4') - 0.4]];
  for (const [k, cue, end] of lines) {
    const s0 = ev(cue) - 0.1, a = win(t, s0, end, 0.6, 0.35);
    if (a <= 0) continue;
    const p = seg(t, s0, end);
    ctx.save(); ctx.filter = `blur(${(1 - ss((t - s0) / 0.6)) * 10 * S}px)`;
    text(ctx, T[k], W / 2, H / 2, { fam: 'Frank Ruhl Libre', size: 84, w: 700, alpha: a, spacing: 2 + p * 6, glow: 18, glowColor: 'rgba(255,255,255,0.35)' });
    ctx.restore();
  }
  // "הופך את הבלתי אפשרי לאפשרי" – זהב, אור שמתעצם
  const o4 = ev('o4'), bm = ev('boom');
  if (t > o4 - 0.2 && t < bm + 0.2) {
    const p = seg(t, o4, bm);
    rays(ctx, W / 2, H / 2, p * 0.9, t, '255,215,140', 18, 1300);
    sprite(ctx, glowSprite('rgba(255,210,140,1)', 256), W / 2, H / 2, 300 + p * 900, p * 0.6); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1 + p * 0.08, 1 + p * 0.08);
    text(ctx, T.open4, 0, 0, { fam: 'Frank Ruhl Libre', size: 96, w: 900, color: goldGrad(ctx, -50, 50), alpha: ss((t - o4) / 0.5), glow: 24 });
    ctx.restore();
  }
  // פיצוץ + כותרת
  if (t >= bm) titleCard(ctx, t);
}
function titleCard(ctx, t) {
  const bm = ev('boom'), d = t - bm;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 1100);
  bg.addColorStop(0, 'rgba(70,45,15,1)'); bg.addColorStop(0.5, 'rgba(18,12,8,1)'); bg.addColorStop(1, '#000');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  rays(ctx, W / 2, H * 0.45, 0.7 * clamp(d / 1.5), t, '255,200,120', 16, 1500);
  smoke(ctx, t, 0.45, null, 6, 25);
  embers(ctx, t, 110, 0.9);
  // גל הדף וחלקיקים
  burst(ctx, W / 2, H / 2, bm, t, 160, ORANGE, 1800, 1.8, 3, 60);
  burst(ctx, W / 2, H / 2, bm, t, 90, 'rgba(255,240,200,1)', 1100, 1.4, 9, 30);
  if (d < 1.2) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,220,160,${1 - d / 1.2})`; ctx.lineWidth = 30 * (1 - d / 1.2);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, eOut(d / 1.2) * 1400, 0, 7); ctx.stroke(); ctx.restore();
  }
  flare(ctx, W / 2, H * 0.43, clamp(1 - d / 2.5) * 0.9 + 0.25 * win(t, bm, bm + 7, 1, 1), 1.2);
  // MOR SHABAT
  const sc = lerp(1.12, 1.0, eOut(d / 6.5));
  ctx.save(); ctx.translate(W / 2, H * 0.43); ctx.scale(sc, sc);
  const a = ss(d / 0.4) * win(t, bm, ev('s1end'), 0.2, 0.6);
  text3D(ctx, T.mainEn, 0, 0, { size: 190, depth: 18, dy: 1.1, spacing: 14, glow: 30, alpha: a, sweep: seg(t, bm + 1.2, bm + 3.4), silver: false });
  ctx.restore();
  const a2 = ss((d - 1.4) / 0.8) * win(t, bm, ev('s1end'), 0.2, 0.6);
  text(ctx, T.mainEnSub, W / 2, H * 0.43 + 155, { fam: 'Cinzel', size: 54, w: 700, spacing: lerp(10, 24, eOut((d - 1.4) / 4)), alpha: a2, color: '#e9eef7', glow: 14, glowColor: 'rgba(140,190,255,0.8)' });
  const a3 = ss((d - 2.6) / 0.8) * win(t, bm, ev('s1end'), 0.2, 0.6);
  text(ctx, T.mainHe, W / 2, H * 0.43 + 240, { fam: 'Heebo', size: 44, w: 300, spacing: 6, alpha: a3, color: '#ffe3a3' });
}

// --- חלק 2
function heroShot(ctx, t, t0, t1) {
  const p = seg(t, t0, t1), h = PH.hero;
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, H);
  smoke(ctx, t, 0.35, null, 4, 20);
  // התמונה בצד ימין, נעלמת לשמאל
  const rx = 640, rw = W - rx;
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, 0, rw, H); ctx.clip();
  ctx.filter = 'contrast(1.15) saturate(0.75) brightness(0.95)';
  drawPhoto(ctx, photo(h.file), rx, 0, rw, H, h.fx, h.fy, (h.zoom || 2) * lerp(1, 1.12, p), 0.55, 0.42);
  ctx.filter = 'none';
  const m = ctx.createLinearGradient(rx, 0, rx + 520, 0);
  m.addColorStop(0, 'rgba(5,8,10,1)'); m.addColorStop(1, 'rgba(5,8,10,0)');
  ctx.fillStyle = m; ctx.fillRect(rx - 2, 0, 522, H);
  // דירוג צבע טיל-כתום
  ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(20,90,110,0.55)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  rays(ctx, W * 0.82, -80, 0.35, t, '255,200,140', 10, 1300);
  sparksFall(ctx, t, 14, 0.7);
  embers(ctx, t, 40, 0.6);
  // כרטיס שם
  const a = ss((t - t0 - 1.6) / 0.8) * win(t, t0, t1, 0.3, 0.4);
  const x = 560;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = goldGrad(ctx, 470, 480); ctx.fillRect(x - 380 * eOut((t - t0 - 1.6) / 1.2), 552, 380 * eOut((t - t0 - 1.6) / 1.2), 4);
  ctx.restore();
  text(ctx, T.heroName, x, 470, { fam: 'Secular One', size: 128, w: 400, align: 'right', alpha: a, color: goldGrad(ctx, 410, 530), glow: 20 });
  text(ctx, T.heroRole, x, 610, { fam: 'Heebo', size: 46, w: 300, align: 'right', alpha: ss((t - t0 - 2.4) / 0.8) * win(t, t0, t1, 0.3, 0.4), color: '#e8eef5', spacing: 2 });
}
function searchGag(ctx, t, t0, t1) {
  const p = seg(t, t0, t1);
  warehouse(ctx, t, 30 + p * 2, 'real', 0.28);
  // פנס מחפש
  const ang = Math.sin(t * 2.2) * 0.55, ox = W * 0.5, oy = H * 0.86;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const len = 1100, g = ctx.createRadialGradient(ox, oy, 0, ox, oy, len);
  g.addColorStop(0, 'rgba(255,240,200,0.55)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, len, -Math.PI / 2 + ang - 0.22, -Math.PI / 2 + ang + 0.22); ctx.closePath(); ctx.fill();
  ctx.restore();
  // דמות מצוירת (צללית) מסתכלת לצדדים
  const look = Math.sin(t * 2.2);
  ctx.save(); ctx.translate(ox, oy + 30); ctx.fillStyle = '#020303';
  ctx.beginPath(); ctx.ellipse(0, -250, 48, 56, 0, 0, 7); ctx.fill();                               // ראש
  ctx.beginPath(); ctx.ellipse(look * 10, -298, 62, 22, 0, Math.PI, 0); ctx.fill();                 // כובע
  ctx.beginPath(); ctx.moveTo(-110, 0); ctx.quadraticCurveTo(-120, -170, -60, -190); ctx.lineTo(60, -190); ctx.quadraticCurveTo(120, -170, 110, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
  // סימני שאלה מרחפים
  for (let i = 0; i < 7; i++) {
    const tt = t - t0 - i * 0.35; if (tt < 0) continue;
    const a = clamp(tt / 0.3) * win(t, t0, t1 + 0.3, 0.2, 0.4);
    text(ctx, '?', W * (0.3 + 0.4 * R(i, 1)), H * 0.55 - tt * 40 - R(i, 2) * 200, { fam: 'Secular One', size: 70 + 60 * R(i, 3), w: 400, alpha: a * 0.85, color: '#ffd36b', glow: 12 });
  }
  hudFrame(ctx, W - 520, 70, 450, 110, 'rgba(255,210,120,', 0.8);
  ringLoader(ctx, W - 130, 125, 26, t, '#ffd36b');
  text(ctx, T.searchStatus, W - 180, 125, { fam: 'Heebo', size: 44, w: 700, align: 'right', color: '#ffe7b0' });
}
function whereSlam(ctx, t, t0, t1) {
  const d = t - t0;
  ctx.fillStyle = '#120404'; ctx.fillRect(0, 0, W, H);
  // קרני קומיקס
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(t * 0.15);
  for (let i = 0; i < 24; i++) { ctx.fillStyle = i % 2 ? 'rgba(150,20,20,0.9)' : 'rgba(60,8,8,0.9)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 1400, (i / 24) * 6.283, ((i + 1) / 24) * 6.283); ctx.fill(); }
  ctx.restore();
  const sc = d < 0.25 ? lerp(3.2, 0.92, eIn(d / 0.25)) : 1 + 0.08 * Math.exp(-(d - 0.25) * 6) * Math.sin((d - 0.25) * 30) + 0.02 * Math.sin(t * 4);
  const gl = d < 0.45 ? 14 * (1 - d / 0.45) : 0;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.rotate(-0.04);
  if (gl) { text(ctx, T.where, -gl, 0, { fam: 'Secular One', size: 260, w: 400, color: 'rgba(0,255,255,0.7)' }); text(ctx, T.where, gl, 0, { fam: 'Secular One', size: 260, w: 400, color: 'rgba(255,0,80,0.7)' }); }
  text(ctx, T.where, 0, 0, { fam: 'Secular One', size: 260, w: 400, color: '#fff', stroke: 22, strokeColor: '#000', glow: 30, glowColor: 'rgba(255,60,60,0.9)' });
  ctx.restore();
  for (let i = 0; i < 10; i++) {
    const a = clamp((d - 0.3 - i * 0.08) / 0.2);
    text(ctx, '?', W * R(i, 11), H * R(i, 12), { fam: 'Secular One', size: 80 + 80 * R(i, 13), w: 400, alpha: a * 0.6, color: '#ffcf4a' });
  }
}
const ITEMS = [['router', 'ראוטרים סיסקו', 64], ['switch', 'מתגים סיסקו', 120], ['table', 'שולחנות פלסטיק', 80], ['uniform', 'מדים', 1450], ['switch', 'כבלי רשת', 900], ['router', 'ארונות תקשורת', 12]];
// אייקונים הולוגרפיים של הציוד (ציור וקטורי)
function itemIcon(ctx, kind, x, y, a, t) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = a; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#bff8ff'; ctx.fillStyle = 'rgba(60,220,255,0.18)'; setShadow(ctx, 22, 'rgba(80,235,255,1)');
  const led = (lx, ly, on) => { ctx.save(); ctx.fillStyle = on ? '#8dff9e' : '#2a6a55'; ctx.beginPath(); ctx.arc(lx, ly, 5, 0, 7); ctx.fill(); ctx.restore(); };
  if (kind === 'router') {
    rrect(ctx, -95, -20, 190, 56, 12); ctx.fill(); ctx.stroke();
    for (const ax of [-60, 60]) { ctx.beginPath(); ctx.moveTo(ax, -20); ctx.lineTo(ax + (ax > 0 ? 18 : -18), -95); ctx.stroke(); ctx.beginPath(); ctx.arc(ax + (ax > 0 ? 18 : -18), -100, 6, 0, 7); ctx.stroke(); }
    for (let i = 0; i < 5; i++) led(-60 + i * 22, 8, Math.sin(t * 6 + i * 1.7) > -0.2);
    for (let k = 1; k <= 3; k++) { ctx.globalAlpha = a * (0.5 - k * 0.12) * (0.6 + 0.4 * Math.sin(t * 4)); ctx.beginPath(); ctx.arc(0, -40, 30 + k * 22, -2.4, -0.74); ctx.stroke(); }
  } else if (kind === 'switch') {
    rrect(ctx, -120, -30, 240, 60, 8); ctx.fill(); ctx.stroke();
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) { ctx.strokeRect(-100 + i * 22, -20 + r * 22, 16, 14); }
    for (let i = 0; i < 4; i++) led(85, -18 + i * 12 - 0, Math.sin(t * 8 + i * 2.1) > 0);
  } else if (kind === 'table') {
    ctx.beginPath(); ctx.moveTo(-120, -20); ctx.lineTo(120, -20); ctx.lineTo(95, -45); ctx.lineTo(-95, -45); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(-120, -20, 240, 12); ctx.strokeRect(-120, -20, 240, 12);
    for (const lx of [-95, 95]) { ctx.beginPath(); ctx.moveTo(lx, -8); ctx.lineTo(lx - 18, 60); ctx.moveTo(lx, -8); ctx.lineTo(lx + 18, 60); ctx.stroke(); }
  } else if (kind === 'uniform') {
    ctx.beginPath(); ctx.moveTo(-35, -70); ctx.lineTo(-95, -45); ctx.lineTo(-120, 5); ctx.lineTo(-85, 20); ctx.lineTo(-70, -10); ctx.lineTo(-70, 75); ctx.lineTo(70, 75); ctx.lineTo(70, -10); ctx.lineTo(85, 20); ctx.lineTo(120, 5); ctx.lineTo(95, -45); ctx.lineTo(35, -70); ctx.lineTo(0, -40); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, 75); ctx.stroke();
    ctx.strokeRect(-55, -15, 38, 30); ctx.strokeRect(17, -15, 38, 30);
  }
  ctx.restore();
}
function holoScene(ctx, t, t0, t1) {
  const zc = 40 + (t - t0) * 2.2, scan = ((t - t0) * 9) % 40;
  warehouse(ctx, t, zc, 'holo', 1, scan);
  scanlines(ctx, 0.25);
  // ממשק
  hudFrame(ctx, 60, 60, 520, 240);
  text(ctx, 'MOR SYSTEM v9', 90, 105, { fam: 'Orbitron', size: 30, w: 800, align: 'left', color: '#7ff0ff' });
  const cnt = Math.floor(lerp(120, 184, eOut(seg(t, t0, t0 + 6))));
  text(ctx, `ראוטרים ומתגים סיסקו: ${cnt}`, 550, 165, { size: 34, w: 700, align: 'right', color: '#d9fbff' });
  text(ctx, 'חוסרים: 0', 550, 215, { size: 34, w: 700, align: 'right', color: '#8dff9e' });
  text(ctx, 'סטטוס: מור על זה ✓', 550, 265, { size: 34, w: 700, align: 'right', color: '#ffe08a' });
  // רדאר
  ctx.save(); ctx.translate(W - 190, 190); ctx.strokeStyle = 'rgba(80,235,255,0.7)'; ctx.lineWidth = 2;
  for (const r of [50, 100, 140]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
  ctx.rotate(t * 2); const rg = ctx.createLinearGradient(0, 0, 140, 0); rg.addColorStop(0, 'rgba(80,235,255,0.6)'); rg.addColorStop(1, 'rgba(80,235,255,0)');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 140, 0, 0.6); ctx.fill(); ctx.restore();
  // שלוש קופסאות שנפתחות (אחת לכל משפט)
  const opens = [ev('n3'), ev('n4'), ev('n5'), ev('n6') + 0.9];
  opens.forEach((to, k) => {
    const bx = W / 2 + (k - 1.5) * 445, by = H * 0.70, d = t - to + 0.3;
    if (d < 0) return;
    const app = eBack(d / 0.5), lid = eOut((d - 0.4) / 0.8);
    ctx.save(); ctx.translate(bx, by); ctx.scale(app * 0.78, app * 0.78);
    // אור מתוך הקופסה
    if (lid > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, -60, 0, -520); g.addColorStop(0, `rgba(120,240,255,${0.6 * lid})`); g.addColorStop(1, 'rgba(120,240,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-130, -60); ctx.lineTo(130, -60); ctx.lineTo(220, -520); ctx.lineTo(-220, -520); ctx.closePath(); ctx.fill();
      ctx.restore();
      burst(ctx, 0, -70, to + 0.1, t, 40, CYAN, 500, 1.2, k * 5 + 1, -150);
    }
    // גוף
    ctx.fillStyle = 'rgba(10,60,80,0.85)'; ctx.strokeStyle = '#7ff0ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.rect(-140, -60, 280, 160); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(140, -60); ctx.lineTo(190, -95); ctx.lineTo(190, 65); ctx.lineTo(140, 100); ctx.closePath(); ctx.fill(); ctx.stroke();
    // מכסה מסתובב
    ctx.save(); ctx.translate(0, -60); ctx.scale(1, Math.cos(lid * 2.2)); ctx.beginPath(); ctx.moveTo(-140, 0); ctx.lineTo(140, 0); ctx.lineTo(190, -35); ctx.lineTo(-90, -35); ctx.closePath(); ctx.fillStyle = 'rgba(20,90,110,0.95)'; ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.restore();
    // הולוגרמה של הפריט
    const it = ITEMS[k], ha = ss((d - 0.8) / 0.5);
    if (ha > 0) {
      itemIcon(ctx, it[0], bx, by - 290 - 10 * Math.sin(t * 2 + k), ha, t);
      text(ctx, `${it[1]} ×${it[2].toLocaleString('en-US')}  ✓`, bx, by - 160, { size: 38, w: 900, alpha: ha, color: '#e6fdff', glow: 10, glowColor: 'rgba(80,235,255,1)' });
    }
  });
  // תגיות סריקה בצדדים
  for (let i = 0; i < 6; i++) {
    const tt = t - t0 - 0.6 - i * 0.9; if (tt < 0 || tt > 2.2) continue;
    const a = win(tt, 0, 2.2, 0.2, 0.4), x = W / 2 + (i % 2 ? -170 : 170), y = H * (0.10 + 0.05 * (i % 3));
    text(ctx, `✓ ${ITEMS[(i + 3) % 6][1]} – נמצא`, x, y, { size: 32, w: 700, alpha: a, color: '#9ff6ff', glow: 8, glowColor: 'rgba(80,235,255,1)' });
  }
}
function systemPanel(ctx, t, t0, t1) {
  holoBackground(ctx, t);
  const a = win(t, t0, t1 + 0.6, 0.35, 0.5), d = t - t0;
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(W / 2, H / 2);
  ctx.strokeStyle = 'rgba(80,235,255,0.8)'; ctx.lineWidth = 3;
  for (let k = 0; k < 3; k++) { ctx.save(); ctx.rotate(t * (k % 2 ? -0.6 : 0.4) + k); ctx.setLineDash([60 + k * 20, 30]); ctx.beginPath(); ctx.arc(0, 0, 330 + k * 45, 0, 7); ctx.stroke(); ctx.restore(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); const sc = eBack(d / 0.6); ctx.scale(sc, sc);
  text(ctx, T.systemTitle, 0, -60, { fam: 'Orbitron', size: 130, w: 800, color: '#e8fdff', glow: 35, glowColor: 'rgba(60,220,255,1)', spacing: 10 });
  text(ctx, T.systemSub, 0, 50, { fam: 'Orbitron', size: 44, w: 500, color: '#8ff3ff', spacing: 8 });
  const bw = 600, pr = eOut((d - 0.4) / 1.4);
  ctx.fillStyle = 'rgba(80,235,255,0.2)'; ctx.fillRect(-bw / 2, 115, bw, 14); ctx.fillStyle = '#8dff9e'; ctx.fillRect(-bw / 2, 115, bw * pr, 14);
  text(ctx, `${Math.round(pr * 100)}%  ${pr >= 1 ? '✓' : ''}`, 0, 165, { fam: 'Orbitron', size: 30, w: 500, color: '#8dff9e' });
  text(ctx, T.systemHe, 0, 230, { size: 42, w: 300, color: '#ffffff', alpha: ss((d - 1.3) / 0.5) });
  ctx.restore();
}
function holoBackground(ctx, t) {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 1200);
  bg.addColorStop(0, '#062a3a'); bg.addColorStop(1, '#01060b');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(60,230,255,0.08)'; ctx.lineWidth = 1;
  for (let x = (t * 20) % 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  embers(ctx, t, 40, 0.5, CYAN, 1);
  scanlines(ctx, 0.2);
}
function speaking(t, key) { const c = cueOf(key); return c && t >= c.start && t <= c.start + c.dur - 0.25; }
function morAI(ctx, t, t0, t1) {
  holoBackground(ctx, t);
  const talk = speaking(t, 'ai1') || speaking(t, 'ai3');
  const amp = talk ? 0.5 + 0.5 * Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3 + 1)) : 0.1;
  const cx = W / 2, cy = 380;
  // ליבת AI
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  sprite(ctx, glowSprite('rgba(80,200,255,1)', 256), cx, cy, 260 + amp * 90, 0.85);
  sprite(ctx, glowSprite('rgba(255,255,255,1)', 128), cx, cy, 70 + amp * 30, 0.9);
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(cx, cy); ctx.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    ctx.save(); ctx.rotate(t * (0.5 + k * 0.3) * (k % 2 ? -1 : 1)); ctx.scale(1, 0.35 + k * 0.15);
    ctx.strokeStyle = `rgba(120,230,255,${0.7 - k * 0.12})`; ctx.beginPath(); ctx.arc(0, 0, 150 + k * 35, 0, 7); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  // גל קול
  ctx.save(); ctx.strokeStyle = 'rgba(140,240,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let x = 0; x <= 900; x += 6) { const y = Math.sin(x * 0.05 + t * 12) * Math.sin(x * 0.012 + t * 3) * 40 * amp * Math.sin(Math.PI * x / 900); x ? ctx.lineTo(cx - 450 + x, 600 + y) : ctx.moveTo(cx - 450, 600 + y); }
  ctx.stroke(); ctx.restore();
  text(ctx, 'MOR.AI', cx, 140, { fam: 'Orbitron', size: 70, w: 800, color: '#e8fdff', glow: 25, glowColor: 'rgba(60,220,255,1)', spacing: 12 });
  // מסוף
  const ai1 = cueOf('ai1');
  hudFrame(ctx, 260, 680, 1400, 330);
  const l1 = typed('>> MOR.AI ONLINE', t, t0 + 0.2, 30);
  text(ctx, l1, 300, 725, { fam: 'Orbitron', size: 28, w: 500, align: 'left', color: '#7ff0ff' });
  const s1 = 'מנהלת את כל הציוד בעולם 🌍';
  text(ctx, typed(s1, t, ai1.start + 1.6, 18), 1620, 780, { size: 40, w: 700, align: 'right', color: '#e6fdff' });
  // שאלה
  const q = T.aiQuestion, qt = ev('type');
  if (t > qt) {
    const qa = ss((t - qt) / 0.3);
    ctx.save(); ctx.globalAlpha = qa; ctx.fillStyle = 'rgba(255,210,120,0.15)'; rrect(ctx, 820, 820, 800, 74, 37); ctx.fill(); ctx.restore();
    text(ctx, '🙋  ' + typed(q, t, qt, 16), 1590, 858, { size: 42, w: 700, align: 'right', color: '#ffe7b0', alpha: qa });
  }
  // חושבת…
  const th = ev('think'), a3 = cueOf('ai3');
  if (t > th && t < a3.start + 0.1) {
    const pr = Math.min(99, Math.floor(eOut(seg(t, th, a3.start)) * 99));
    text(ctx, `מעבדת… ${pr}%`, 1590, 945, { size: 38, w: 700, align: 'right', color: '#9ff6ff' });
    ringLoader(ctx, 1260, 945, 20, t, '#9ff6ff');
  }
  if (t >= a3.start) text(ctx, typed(T.aiAnswer, t, a3.start, 16), 1590, 945, { size: 42, w: 900, align: 'right', color: '#8dff9e', glow: 10, glowColor: 'rgba(120,255,160,0.8)' });
  // שיחה נכנסת
  const rg = ev('ring');
  if (t > rg - 0.1) callScreen(ctx, t, rg);
}
function callScreen(ctx, t, t0) {
  const d = t - t0, a = ss(d / 0.35), sc = eBack(d / 0.45);
  ctx.save(); ctx.globalAlpha = a * 0.75; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(15,25,35,0.95)'; rrect(ctx, -300, -400, 600, 800, 60); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3; ctx.stroke();
  for (let k = 0; k < 3; k++) {   // טבעות פעימה
    const ph = (d * 0.9 + k / 3) % 1; ctx.strokeStyle = `rgba(120,255,160,${(1 - ph) * 0.8})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, -120, 130 + ph * 110, 0, 7); ctx.stroke();
  }
  ctx.save(); ctx.beginPath(); ctx.arc(0, -120, 130, 0, 7); ctx.clip();
  drawPhoto(ctx, photo('10.jpg'), -130, -250, 260, 260, 0.6, 0.27, 2.4);
  ctx.restore();
  text(ctx, T.callingName, 0, 80, { fam: 'Secular One', size: 64, w: 400, color: '#fff' });
  text(ctx, 'מתקשרת…' + '.'.repeat(Math.floor(d * 3) % 3), 0, 150, { size: 36, w: 300, color: '#9fb3c4' });
  ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(0, 290, 55 + 4 * Math.sin(d * 12), 0, 7); ctx.fill();
  text(ctx, '📞', 0, 292, { size: 52, dir: 'ltr' });
  ctx.restore();
}
function captionCard(ctx, t, t0, t1) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.45; ctx.filter = 'brightness(0.6) saturate(0.6)';
  drawPhoto(ctx, photo('10.jpg'), 0, 0, W, H, 0.5, 0.3, lerp(1.0, 1.08, seg(t, t0, t1)));
  ctx.restore(); ctx.filter = 'none';
  const v = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 1100); v.addColorStop(0, 'rgba(0,0,0,0.2)'); v.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  embers(ctx, t, 60, 0.8);
  const d = t - t0, a = win(t, t0, t1 + 0.4, 0.5, 0.5);
  const parts = T.caption.split(' – ');
  text(ctx, parts[0], W / 2, H / 2 - 70, { fam: 'Secular One', size: 130, w: 400, color: goldGrad(ctx, H / 2 - 140, H / 2), alpha: a * ss(d / 0.5), glow: 25 });
  if (parts[1]) text(ctx, parts[1], W / 2, H / 2 + 70, { fam: 'Heebo', size: 56, w: 700, color: '#fff', alpha: a * ss((d - 0.5) / 0.5), spacing: 1 });
  flare(ctx, W / 2, H / 2 - 70, 0.5 * clamp(1 - d / 1.2), 0.8, '255,200,120');
}
function scene2(ctx, t) {
  if (t < ev('search')) heroShot(ctx, t, ev('s2'), ev('search'));
  else if (t < ev('where')) searchGag(ctx, t, ev('search'), ev('where'));
  else if (t < ev('hud')) whereSlam(ctx, t, ev('where'), ev('hud'));
  else if (t < ev('system')) holoScene(ctx, t, ev('hud'), ev('system'));
  else if (t < ev('ai')) systemPanel(ctx, t, ev('system'), ev('ai'));
  else if (t < ev('caption')) morAI(ctx, t, ev('ai'), ev('caption'));
  else captionCard(ctx, t, ev('caption'), ev('s2end'));
  if (t < ev('caption')) subtitle(ctx, t, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  // מעבר הבזק
  for (const k of ['search', 'where', 'hud', 'system', 'ai', 'caption']) {
    const d = t - ev(k); if (d > -0.15 && d < 0.3) { ctx.save(); ctx.globalAlpha = d < 0 ? (d + 0.15) / 0.15 * 0.6 : 0.6 * (1 - d / 0.3); ctx.fillStyle = k === 'where' ? '#fff' : k === 'caption' ? '#ffe0a0' : '#bff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }
}

// --- חלק 3
function countdown5(ctx, t) {
  ctx.fillStyle = '#080102'; ctx.fillRect(0, 0, W, H);
  const pulse = 0.5 + 0.5 * Math.sin(t * 7.5);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 1000); g.addColorStop(0, `rgba(120,10,10,${0.5 + 0.3 * pulse})`); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  scanlines(ctx, 0.3);
  // פסי אזהרה
  ctx.save(); ctx.globalAlpha = 0.5; for (const y of [40, H - 80]) { for (let x = -80 + (t * 120) % 80; x < W; x += 80) { ctx.fillStyle = '#ffc400'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 40, y); ctx.lineTo(x + 80, y + 40); ctx.lineTo(x + 40, y + 40); ctx.closePath(); ctx.fill(); } } ctx.restore();
  for (const n of [5, 4, 3, 2, 1]) {
    const t0 = ev('cd' + n), d = t - t0; if (d < 0 || d > 0.85) continue;
    const sc = lerp(1.4, 1, eOut(d / 0.25));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc);
    ctx.strokeStyle = 'rgba(255,80,60,0.9)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 260, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - d / 0.85)); ctx.stroke();
    text(ctx, String(n), 0, 10, { fam: 'Orbitron', size: 330, w: 800, color: '#fff', glow: 40, glowColor: 'rgba(255,60,40,1)' });
    ctx.restore();
  }
  text(ctx, 'SYSTEM OVERRIDE', W / 2, 150, { fam: 'Orbitron', size: 40, w: 800, color: '#ff6a5a', spacing: 16, alpha: 0.6 + 0.4 * pulse });
}
function shards(ctx, t, t0, drawPrev) {
  if (!CACHE.shardSrc) {
    const c = off(W, H), g = c.getContext('2d'); drawPrev(g, t0 - 0.02); CACHE.shardSrc = c;
    const pts = [], nx = 9, ny = 6;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const edge = i === 0 || j === 0 || i === nx || j === ny;
      pts.push([(i / nx) * W + (edge ? 0 : (R(i * 31 + j, 1) - 0.5) * 140), (j / ny) * H + (edge ? 0 : (R(i * 31 + j, 2) - 0.5) * 120)]);
    }
    const tris = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c2 = a + nx + 1, d = c2 + 1;
      tris.push([pts[a], pts[b], pts[d]], [pts[a], pts[d], pts[c2]]);
    }
    CACHE.tris = tris;
  }
  const d = t - t0;
  CACHE.tris.forEach((tr, i) => {
    const cx = (tr[0][0] + tr[1][0] + tr[2][0]) / 3, cy = (tr[0][1] + tr[1][1] + tr[2][1]) / 3;
    const dx = cx - W / 2, dy = cy - H / 2, dist = Math.hypot(dx, dy) + 1;
    const sp = 900 + 1200 * R(i, 4), k = eIn(clamp(d / 1.3)) * 1.3 + d * 0.3;
    const ox = (dx / dist) * sp * k, oy = (dy / dist) * sp * k + 300 * d * d, rot = (R(i, 5) - 0.5) * 5 * d, z = 1 + d * 0.8 * R(i, 6);
    ctx.save(); ctx.globalAlpha = clamp(1 - d / 1.4);
    ctx.translate(cx + ox, cy + oy); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-cx, -cy);
    ctx.beginPath(); ctx.moveTo(...tr[0]); ctx.lineTo(...tr[1]); ctx.lineTo(...tr[2]); ctx.closePath(); ctx.clip();
    ctx.drawImage(CACHE.shardSrc, 0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  });
}
function heli(ctx, x, y, s, t, a, flip = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * flip, s); ctx.globalAlpha = a; ctx.fillStyle = '#05070b';
  ctx.beginPath(); ctx.ellipse(0, 0, 90, 34, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(60, -10); ctx.lineTo(230, -6); ctx.lineTo(230, 6); ctx.lineTo(60, 14); ctx.fill();
  ctx.fillRect(220, -34, 14, 40); ctx.fillRect(-60, 34, 120, 6); ctx.fillRect(-40, 26, 6, 10); ctx.fillRect(34, 26, 6, 10);
  ctx.fillRect(-4, -46, 8, 14);
  ctx.globalAlpha = a * 0.35; ctx.beginPath(); ctx.ellipse(0, -48, 210, 8 + 3 * Math.sin(t * 50), 0, 0, 7); ctx.fill();
  ctx.globalAlpha = a; ctx.fillStyle = 'rgba(255,60,60,1)'; if (Math.sin(t * 12) > 0.6) { ctx.beginPath(); ctx.arc(232, -30, 4, 0, 7); ctx.fill(); }
  ctx.restore();
}
function missionScene(ctx, t) {
  const t0 = ev('shatter'), d = t - t0;
  // שמי דמדומים
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#060a1a'); sky.addColorStop(0.55, '#3a1d2a'); sky.addColorStop(0.8, '#a2512a'); sky.addColorStop(1, '#2a0f08');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  sprite(ctx, glowSprite('rgba(255,150,70,1)', 256), W * 0.5, H * 0.86, 900, 0.55); ctx.globalAlpha = 1;
  smoke(ctx, t, 0.3, null, 5, 40);
  // קו אופק – הרים
  ctx.fillStyle = '#07040a'; ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * 0.84 - 60 * Math.abs(Math.sin(x * 0.004 + 1)) - 30 * Math.sin(x * 0.013));
  ctx.lineTo(W, H); ctx.fill();
  // מסוקים
  for (const [ts, dur, y, s, dir] of [[t0 + 1.0, 4.5, 260, 1.0, 1], [t0 + 2.0, 5.0, 380, 0.6, 1], [t0 + 5.5, 4.0, 200, 1.3, -1]]) {
    const p = (t - ts) / dur; if (p < 0 || p > 1) continue;
    heli(ctx, dir > 0 ? lerp(-300, W + 300, p) : lerp(W + 300, -300, p), y + Math.sin(t * 2) * 8, s, t, 1, dir > 0 ? -1 : 1);
  }
  // זרמי אנרגיה מוזהבים
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const p = ((t - t0) * 0.35 + R(i, 1)) % 1, y0 = H * (0.25 + 0.5 * R(i, 2));
    const g = glowSprite(GOLD, 64);
    for (let k = 0; k < 26; k++) { const q = p - k * 0.008; if (q < 0) break; const x = q * (W + 400) - 200, y = y0 + Math.sin(q * 9 + i) * 80; sprite(ctx, g, x, y, 16 - k * 0.5, (1 - k / 26) * 0.7); }
  }
  ctx.restore(); ctx.globalAlpha = 1;
  fireworks(ctx, t, t0 + 3, ev('hb') + 5, 1.2, 4, 0.5);
  // לוח משימה
  const pa = ss((d - 0.4) / 0.5) * (1 - ss((t - ev('l1') + 0.5) / 0.5));
  if (pa > 0) {
    const x = W / 2 - 560, y = 250;
    ctx.save(); ctx.globalAlpha = pa; ctx.fillStyle = 'rgba(5,10,20,0.6)'; ctx.fillRect(x, y, 1120, 380); ctx.restore();
    hudFrame(ctx, x, y, 1120, 380, 'rgba(255,200,90,', pa);
    const lines = [[T.hud1, 0.5, '#ffd36b', 72], [T.hud2, 1.4, '#ffffff', 48], [T.hud3, 2.2, '#8dff9e', 48]];
    lines.forEach(([s, dl, c, sz], i) => {
      const glitch = (d - dl) < 0.3 && (d - dl) > 0 ? (R(Math.floor(t * 30), i) - 0.5) * 20 : 0;
      text(ctx, typed(s, t, t0 + dl, 34), W / 2 + glitch, y + 90 + i * 110, { fam: 'Orbitron', size: sz, w: 800, color: c, alpha: pa, glow: 16, glowColor: c, spacing: 4 });
    });
  }
  // שורות הקריין כטקסט קולנועי
  for (const key of ['l1', 'l2']) {
    const c = cueOf(key); if (t < c.start - 0.1 || t > c.start + c.dur + 0.35) continue;
    c.sent.forEach(() => {});
    const parts = key === 'l1' ? ['אבל היום…', 'לראשונה בהיסטוריה…', 'המשימה היא לא למצוא ציוד.'] : ['המשימה היא לחגוג', 'לאיש שדואג לכולם.'];
    const n = parts.length, spanEnd = c.start + c.dur - 0.25;
    parts.forEach((s, i) => {
      const ts = c.start + (spanEnd - c.start) * (key === 'l1' ? [0, 0.25, 0.58][i] : [0, 0.45][i]);
      const a = ss((t - ts) / 0.35) * ss((c.start + c.dur + 0.35 - t) / 0.3);
      const big = i === n - 1;
      text(ctx, s, W / 2, H * 0.5 - (n - 1) * 55 + i * 110, { fam: big ? 'Secular One' : 'Frank Ruhl Libre', size: big ? 92 : 74, w: big ? 400 : 700, alpha: a, color: big ? goldGrad(ctx, H * 0.5 - 60, H * 0.5 + 200) : '#fff', glow: 18, glowColor: 'rgba(0,0,0,0.9)', stroke: 6, strokeColor: 'rgba(0,0,0,0.5)' });
    });
  }
  // HAPPY BIRTHDAY
  const hb = ev('hb');
  if (t > hb) {
    const e = t - hb;
    rays(ctx, W / 2, H * 0.45, 0.8 * ss(e / 0.6), t, '255,210,130', 20, 1600);
    ctx.save(); ctx.translate(W / 2, H * 0.42); const sc = eBack(e / 0.6); ctx.scale(sc, sc);
    text3D(ctx, T.hbEn, 0, 0, { size: 92, depth: 12, spacing: 2, glow: 30, sweep: seg(t, hb + 0.6, hb + 2.4) });
    ctx.restore();
    text(ctx, T.hbHe, W / 2, H * 0.42 + 150, { fam: 'Secular One', size: 84, w: 400, color: '#fff', alpha: ss((e - 0.5) / 0.4), glow: 20, glowColor: 'rgba(255,190,80,0.9)' });
    confetti(ctx, t, hb, 220);
  }
}
function scene3(ctx, t) {
  const sh = ev('shatter');
  if (t < sh) return countdown5(ctx, t);
  missionScene(ctx, t);
  if (t < sh + 1.5) shards(ctx, t, sh, countdown5);
}

// --- חלק 4: הברכה
const HEAD = { b1: 'מור היקר שלנו', b2: 'הפעם – אנחנו דואגים לך', b3: 'בריאות', b4: 'אושר', b5: 'עושר', b6: 'אהבה', b7: 'כל הטוב שבעולם' };
function scene4(ctx, t) {
  const s4 = ev('s4');
  ctx.fillStyle = '#0d0703'; ctx.fillRect(0, 0, W, H);
  const keys = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
  // מי הפסקה הנוכחית (כולל ההפסקה שלפניה)
  let ki = 0;
  keys.forEach((k, i) => { if (t >= cueOf(k).start - 0.6) ki = i; });
  const key = keys[ki], c = cueOf(key), list = PH[key];
  const half = c.start + c.dur * 0.5;
  const pi = t < half ? 0 : 1, item = list[pi % list.length];
  const segStart = pi === 0 ? c.start - 0.6 : half, segEnd = pi === 0 ? half : c.start + c.dur + 0.6;
  const p = seg(t, segStart, segEnd);
  // רקע: התמונה מטושטשת
  ctx.save(); ctx.globalAlpha = 0.55; drawPhoto(ctx, blurred(item.file), 0, 0, W, H, 0.5, 0.5, 1.15); ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(120,70,20,0.9)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 1200); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  bokeh(ctx, t, 1);
  embers(ctx, t, 60, 0.6, GOLD, 1, 0.5);
  // כרטיס תמונה בזהב (מתחלף צד בכל פסקה)
  const side = ki % 2 === 0 ? -1 : 1;
  const cw = 760, chh = 900, cx = W / 2 + side * 440, cy = H / 2;
  const appear = Math.min(ss((t - segStart) / 0.7), ss((segEnd - t) / 0.5));
  const im = photo(item.file), ar = im.width / im.height;
  let w = cw, h = cw / ar; if (h > chh) { h = chh; w = chh * ar; }
  ctx.save(); ctx.globalAlpha = appear; ctx.translate(cx, cy + (1 - appear) * 40); ctx.rotate(side * 0.025 + (1 - appear) * side * 0.05);
  setShadow(ctx, 50, 'rgba(0,0,0,0.8)'); ctx.fillStyle = '#000'; ctx.fillRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 28); noShadow(ctx);
  ctx.fillStyle = goldGrad(ctx, -h / 2, h / 2); ctx.fillRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 28);
  ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
  drawPhoto(ctx, im, -w / 2, -h / 2, w, h, item.fx, item.fy, lerp(1.0, 1.12, p), 0.5, 0.45);
  const lg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); lg.addColorStop(0, 'rgba(255,220,150,0.18)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(255,150,60,0.15)');
  ctx.fillStyle = lg; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  ctx.restore();
  // הבזק אור בהחלפת תמונה
  const fd = t - half; if (fd > -0.2 && fd < 0.4) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; sprite(ctx, glowSprite('rgba(255,220,160,1)', 256), cx, cy, 700, (fd < 0 ? (fd + 0.2) / 0.2 : 1 - fd / 0.4) * 0.6); ctx.restore(); ctx.globalAlpha = 1; }
  // כותרת זהב + כתוביות בעמודה השנייה
  const tx = W / 2 - side * 440, colW = 780;
  const ha = Math.min(ss((t - c.start + 0.4) / 0.6), ss((c.start + c.dur + 0.5 - t) / 0.4));
  ctx.save(); ctx.translate(tx, 330); const hs = lerp(0.92, 1, eOut((t - c.start + 0.4) / 1.2)); ctx.scale(hs, hs);
  text(ctx, HEAD[key], 0, 0, { fam: 'Secular One', size: HEAD[key].length > 8 ? 76 : 120, w: 400, color: goldGrad(ctx, -60, 60), alpha: ha, glow: 25 });
  ctx.restore();
  ctx.save(); ctx.globalAlpha = ha; ctx.fillStyle = goldGrad(ctx, 0, 10); ctx.fillRect(tx - 150 * ha, 420, 300 * ha, 3); ctx.restore();
  subtitle(ctx, t, [key], 640, { x: tx, maxW: colW, size: 56, w: 400, fam: 'Heebo' });
  // מעבר פתיחה מהזיקוקים
  const inA = 1 - ss((t - s4) / 1.4);
  if (inA > 0) { ctx.save(); ctx.globalAlpha = inA; ctx.fillStyle = '#fff5d8'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// --- חלק 5: סיום
function textPoints(s, n) {
  const key = 'pts' + s + n; if (CACHE[key]) return CACHE[key];
  const c = off(1600, 400), g = c.getContext('2d');
  g.font = font('Secular One', 300, 400); g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(s, 800, 210);
  const d = g.getImageData(0, 0, 1600, 400).data, pts = [];
  for (let y = 0; y < 400; y += 4) for (let x = 0; x < 1600; x += 4) if (d[(y * 1600 + x) * 4 + 3] > 128) pts.push([x - 800, y - 200]);
  const out = []; for (let i = 0; i < n; i++) out.push(pts[Math.floor(R(i, 77) * pts.length)]);
  return (CACHE[key] = out);
}
function goldName(ctx, t, t0, t1) {
  const pts = textPoints(T.goldName, 2600), d = t - t0, form = eOut(d / 2.8);
  const ang = Math.sin((t - t0) * 0.45) * 0.55, cosA = Math.cos(ang), sinA = Math.sin(ang), fz = 1400;
  const g = glowSprite(GOLD, 64), gw = glowSprite('rgba(255,245,220,1)', 32);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const cy = H * 0.4, out = 1 - ss((t - t1 + 0.6) / 0.6);
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i], pz = (R(i, 3) - 0.5) * 60;
    const sx = (R(i, 1) - 0.5) * 3000, sy = (R(i, 2) - 0.5) * 2000, sz = (R(i, 4) - 0.5) * 2000;
    const x = lerp(sx, px, form), y = lerp(sy, py, form), z = lerp(sz, pz, form);
    const rx = x * cosA - z * sinA, rz = x * sinA + z * cosA, k = fz / (fz + rz);
    const tw = 0.6 + 0.4 * Math.sin(t * 6 + i);
    sprite(ctx, i % 3 ? g : gw, W / 2 + rx * k, cy + y * k, (i % 3 ? 7 : 5) * k, tw * out * (0.35 + 0.65 * form));
  }
  ctx.restore(); ctx.globalAlpha = 1;
  // טקסט אמיתי מאחורי החלקיקים לחדות
  ctx.save(); ctx.translate(W / 2, cy); ctx.transform(cosA, 0, sinA * 0.15, 1, 0, 0);
  text(ctx, T.goldName, 0, 10, { fam: 'Secular One', size: 300, w: 400, color: goldGrad(ctx, -150, 150), alpha: ss((d - 2.2) / 1.0) * 0.9 * out, glow: 30 });
  ctx.restore();
}
function photoWall(ctx, t, a) {
  const list = PH.wall; if (!a) return;
  ctx.save(); ctx.globalAlpha = a;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 7; i++) {
    const f = list[(i + r * 3) % list.length], w = 380, h = 270;
    const x = ((i * 410 + t * (r % 2 ? 40 : -40)) % (7 * 410) + 7 * 410) % (7 * 410) - 300, y = 90 + r * 320;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); drawPhoto(ctx, photo(f), x, y, w, h, 0.5, 0.35, 1); ctx.restore();
    ctx.strokeStyle = 'rgba(255,210,130,0.6)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}
function logo(ctx, t, t0) {
  const d = t - t0, a = ss(d / 0.6), sc = lerp(0.85, 1, eOut(d / 2.5));
  ctx.save(); ctx.translate(W / 2, H * 0.42); ctx.scale(sc, sc); ctx.globalAlpha = a;
  // טבעת
  ctx.lineWidth = 10; ctx.strokeStyle = goldGrad(ctx, -230, 230); ctx.beginPath(); ctx.arc(0, 0, 220, 0, 7); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 196, 0, 7); ctx.stroke();
  for (let i = 0; i < 36; i++) { const an = i / 36 * 6.283; ctx.fillStyle = goldGrad(ctx, -230, 230); ctx.beginPath(); ctx.arc(Math.cos(an) * 208, Math.sin(an) * 208, 3, 0, 7); ctx.fill(); }
  // להב + להבה (עיצוב מקורי)
  ctx.fillStyle = goldGrad(ctx, -170, 170);
  ctx.beginPath(); ctx.moveTo(0, -170); ctx.quadraticCurveTo(34, -60, 26, 70); ctx.lineTo(-26, 70); ctx.quadraticCurveTo(-34, -60, 0, -170); ctx.fill();
  ctx.fillRect(-80, 70, 160, 16); ctx.fillRect(-12, 86, 24, 60); ctx.beginPath(); ctx.arc(0, 156, 16, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,140,40,${0.5 + 0.2 * Math.sin(t * 8)})`;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 30, 60); ctx.quadraticCurveTo(s * 120, -20, s * 60, -130 - 10 * Math.sin(t * 5 + s)); ctx.quadraticCurveTo(s * 80, -30, s * 30, 0); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  text3D(ctx, T.logo, W / 2, H * 0.42 + 320, { size: 96, depth: 8, spacing: 30, alpha: ss((d - 0.6) / 0.6), sweep: seg(t, t0 + 1, t0 + 2.6) });
  text(ctx, T.logoSub, W / 2, H * 0.42 + 420, { fam: 'Heebo', size: 40, w: 300, spacing: 8, color: '#ffe3a3', alpha: ss((d - 1.2) / 0.6) });
  flare(ctx, W / 2 + 40, H * 0.42 - 150, clamp(1 - Math.abs(d - 1.6) / 0.8) * 0.8, 0.9, '255,210,140');
}
function scene5(ctx, t) {
  const s5 = ev('s5'), cnt = ev('count'), mz = ev('mazal'), en = ev('end'), lg = ev('logo');
  ctx.fillStyle = '#050302'; ctx.fillRect(0, 0, W, H);
  if (t < mz) {
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 1100); bg.addColorStop(0, '#2a1a08'); bg.addColorStop(1, '#030201');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    photoWall(ctx, t, 0.22 * ss((t - cnt + 1) / 1) );
    rays(ctx, W / 2, H * 0.4, 0.4, t, '255,200,120', 14, 1400);
    embers(ctx, t, 90, 0.8, GOLD);
    if (t < cnt + 0.5) goldName(ctx, t, s5, cnt + 0.5);
    // שורות f1
    const c = cueOf('f1');
    if (t > c.start - 0.1 && t < cnt + 0.3) {
      const s = c.sent.find((q, i) => t >= q.start - 0.05 && t < (c.sent[i + 1] ? c.sent[i + 1].start : cnt + 0.3));
      if (s) {
        const a = ss((t - s.start) / 0.3) * ss((cnt + 0.3 - t) / 0.3);
        const lines = wrap(ctx, s.text, 1500, { size: 66, w: 900 });
        lines.forEach((ln, i) => text(ctx, ln, W / 2, H * 0.74 + i * 84, { fam: 'Heebo', size: 66, w: 900, alpha: a, color: '#fff', glow: 18, glowColor: 'rgba(255,170,60,0.9)' }));
      }
    }
    // ספירה 10..1
    if (t > cnt - 0.4) {
      text(ctx, T.countdownHint, W / 2, 130, { fam: 'Heebo', size: 54, w: 900, color: '#ffe3a3', alpha: ss((t - cnt + 0.4) / 0.4), glow: 15 });
      for (let n = 10; n >= 1; n--) {
        const t0 = ev('c' + n), d = t - t0; if (d < 0 || d > 0.72) continue;
        const sc = lerp(1.6, 1, eOut(d / 0.2)) * (1 + d * 0.15);
        burst(ctx, W / 2, H * 0.53, t0, t, 40, GOLD, 900, 0.7, n * 7);
        ctx.save(); ctx.translate(W / 2, H * 0.53); ctx.scale(sc, sc);
        text3D(ctx, String(n), 0, 0, { size: 420, depth: 16, alpha: clamp(1 - (d - 0.5) / 0.22), glow: 40 });
        ctx.restore();
      }
    }
    return;
  }
  // מזל טוב!
  if (t < en) {
    const d = t - mz;
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#04030c'); bg.addColorStop(1, '#1c0d18');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    fireworks(ctx, t, mz - 0.5, en + 1, 3.2, 11, 0.7);
    for (let k = 0; k < 6; k++) burst(ctx, W * (0.15 + 0.14 * k), H * (0.25 + 0.1 * (k % 2)), mz + k * 0.12, t, 80, FWC[k], 900, 2.2, k * 9 + 2);
    rays(ctx, W / 2, H * 0.45, 0.5, t, '255,210,140', 18, 1500);
    ctx.save(); ctx.translate(W / 2, H * 0.43); const sc = eBack(d / 0.55) * (1 + 0.02 * Math.sin(t * 3)); ctx.scale(sc, sc);
    text3D(ctx, T.mazal, 0, 0, { fam: 'Secular One', w: 400, size: 190, depth: 14, glow: 40, sweep: (d * 0.5) % 1 });
    ctx.restore();
    confetti(ctx, t, mz, 320);
    subtitle(ctx, t, ['f2'], H * 0.8, { size: 54, w: 900 });
    return;
  }
  // כותרת סיום עם תמונת המשפחה
  if (t < lg) {
    const d = t - en, ph = PH.finale;
    ctx.save(); ctx.globalAlpha = 0.5; drawPhoto(ctx, blurred(ph.file), 0, 0, W, H, 0.5, 0.5, 1.1); ctx.restore();
    ctx.fillStyle = 'rgba(10,5,0,0.55)'; ctx.fillRect(0, 0, W, H);
    bokeh(ctx, t, 1); fireworks(ctx, t, en - 2, lg, 1.5, 21, 0.35);
    const im = photo(ph.file), cw = 820, chh = cw * im.height / im.width, a = ss(d / 0.6);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 80 + chh / 2); const sc = lerp(0.94, 1, eOut(d / 2)); ctx.scale(sc, sc);
    setShadow(ctx, 50, 'rgba(0,0,0,0.8)'); ctx.fillStyle = goldGrad(ctx, -chh / 2, chh / 2); ctx.fillRect(-cw / 2 - 12, -chh / 2 - 12, cw + 24, chh + 24); noShadow(ctx);
    ctx.save(); ctx.beginPath(); ctx.rect(-cw / 2, -chh / 2, cw, chh); ctx.clip(); drawPhoto(ctx, im, -cw / 2, -chh / 2, cw, chh, ph.fx, ph.fy, lerp(1, 1.06, d / 5)); ctx.restore();
    ctx.restore();
    const ty = 80 + chh + 95;
    text3D(ctx, T.endEn1, W / 2, ty, { size: 84, depth: 9, spacing: 16, alpha: ss((d - 0.4) / 0.5), sweep: seg(t, en + 0.8, en + 2.2) });
    text3D(ctx, T.endEn2, W / 2, ty + 110, { size: 110, depth: 12, spacing: 18, alpha: ss((d - 0.8) / 0.5), sweep: seg(t, en + 1.2, en + 2.6), glow: 30 });
    text(ctx, T.endHe, W / 2, ty + 215, { fam: 'Heebo', size: 50, w: 700, color: '#fff', alpha: ss((d - 1.6) / 0.6), glow: 16, glowColor: 'rgba(255,180,80,0.9)' });
    confetti(ctx, t, en - 1, 140, 0.8);
    const fo = ss((t - lg + 0.6) / 0.6); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  // לוגו סופי
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 900); bg.addColorStop(0, 'rgba(60,35,10,1)'); bg.addColorStop(1, '#000');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  rays(ctx, W / 2, H * 0.42, 0.6 * ss((t - lg) / 1), t, '255,200,120', 16, 1400);
  embers(ctx, t, 80, 0.8, GOLD);
  logo(ctx, t, lg);
  burst(ctx, W / 2, H * 0.42, lg, t, 120, GOLD, 1400, 1.8, 5, 80);
}

// ------------------------------------------------------------ מצלמה, הבזקים, פוסט
function shake(t) {
  let x = 0, y = 0;
  const hits = [['thunder', 6], ['boom', 26], ['where', 22], ['system', 6], ['caption', 8], ['shatter', 22], ['hb', 16], ['mazal', 24], ['logo', 12]];
  for (const [k, amp] of hits) { const d = t - ev(k); if (d >= 0 && d < 1.2) { const a = amp * Math.exp(-d * 5); x += a * Math.sin(d * 63); y += a * Math.cos(d * 51); } }
  for (let n = 10; n >= 1; n--) { const d = t - ev('c' + n); if (d >= 0 && d < 0.4) { const a = 6 * Math.exp(-d * 10); x += a * Math.sin(d * 70); } }
  return [x, y];
}
function flashes(ctx, t) {
  const fl = [['thunder', 0.9, '#dfe9ff', 0.35], ['boom', 1, '#fff', 1.0], ['shatter', 0.9, '#fff', 0.5], ['hb', 0.8, '#fff3d0', 0.6], ['mazal', 1, '#fff6dc', 0.8], ['logo', 0.7, '#ffe8b0', 0.8]];
  for (const [k, a, c, dur] of fl) {
    const d = t - ev(k); if (d < 0 || d > dur) continue;
    ctx.save(); ctx.globalAlpha = a * Math.pow(1 - d / dur, 2); ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}
function post(ctx, t, letterbox) {
  // ויניט
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  // גרעין פילם
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07; ctx.drawImage(grainTex(Math.floor(t * 30) % 6), 0, 0, W, H); ctx.restore();
  // פסי קולנוע
  if (letterbox > 0) { ctx.fillStyle = '#000'; const b = 66 * letterbox; ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); }
}

function render(ctx, t) {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; noShadow(ctx); ctx.filter = 'none';
  const [sx, sy] = shake(t);
  ctx.save(); ctx.translate(sx, sy); if (sx || sy) { ctx.translate(W / 2, H / 2); ctx.scale(1.03, 1.03); ctx.translate(-W / 2, -H / 2); }
  if (t < ev('s2')) scene1(ctx, t);
  else if (t < ev('s3')) scene2(ctx, t);
  else if (t < ev('s4')) scene3(ctx, t);
  else if (t < ev('s5')) scene4(ctx, t);
  else scene5(ctx, t);
  ctx.restore();
  flashes(ctx, t);
  const lb = t < ev('s4') ? 1 : t < ev('s4') + 1.5 ? 1 - seg(t, ev('s4'), ev('s4') + 1.5) : 0;
  post(ctx, t, lb);
  // פייד שחור בסוף
  const fo = seg(t, TL.total - 2.0, TL.total);
  if (fo > 0) { ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

// ------------------------------------------------------------ טעינה
async function load(timelineUrl = 'build/timeline.json', overrides = null) {
  TL = await (await fetch(timelineUrl, { cache: 'no-store' })).json();
  E = TL.events; T = Object.assign({}, TL.titles, overrides || {}); PH = TL.photos;
  const names = new Set();
  for (const v of Object.values(PH)) { if (Array.isArray(v)) v.forEach((x) => names.add(typeof x === 'string' ? x : x.file)); else names.add(v.file); }
  names.add('10.jpg');
  await Promise.all([...names].map((n) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = () => rej(new Error('missing photo ' + n)); im.src = 'assets/photos/' + n; })));
  const fams = [['Heebo', 900], ['Heebo', 700], ['Heebo', 300], ['Heebo', 400], ['Frank Ruhl Libre', 700], ['Frank Ruhl Libre', 900], ['Secular One', 400], ['Cinzel', 900], ['Cinzel', 700], ['Orbitron', 800], ['Orbitron', 500]];
  await Promise.all(fams.map(([f, w]) => document.fonts.load(`${w} 40px "${f}"`, 'אבגMOR0123')));
  await document.fonts.ready;
  return TL;
}
function setScale(s) { S = s; }
function setTitles(o) { T = Object.assign({}, TL.titles, o); for (const k in CACHE) if (k.startsWith('pts')) delete CACHE[k]; }
window.FILM = { load, render, setScale, setTitles, get timeline() { return TL; }, W, H };
})();
