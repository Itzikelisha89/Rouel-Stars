// ROI DROR – סרטון יום הולדת (9:16, לוואטסאפ)
// כל פריים הוא פונקציה טהורה של הזמן t. קואורדינטות לוגיות 1080x1920.
'use strict';
(function () {
const W = 1080, H = 1920;
let TL, E, T, S = 1, IMG = {}, CACHE = {};

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


// ============================================================ עזרים לסרט הזה
function subtitle(ctx, t, y = 1700, o = {}) {
  for (const c of TL.vo) {
    if (SKIP_SUB.includes(c.key) || t < c.start - 0.05 || t > c.start + c.dur + 0.15) continue;
    const s = c.sent.find((q, i) => t >= q.start - 0.05 && (t < (c.sent[i + 1] ? c.sent[i + 1].start - 0.05 : c.start + c.dur + 0.15)));
    if (!s) continue;
    const next = c.sent[c.sent.indexOf(s) + 1];
    const a = Math.min(ss((t - s.start + 0.05) / 0.2), ss(((next ? next.start : c.start + c.dur + 0.15) - t) / 0.18));
    const opt = { size: o.size || 54, w: 800, fam: 'Heebo' };
    const lines = wrap(ctx, s.text, 940, opt), lh = opt.size * 1.28;
    lines.forEach((ln, i) => text(ctx, ln, W / 2, y - (lines.length - 1 - i) * lh, { ...opt, alpha: a, color: '#fff', stroke: 9, strokeColor: 'rgba(0,0,0,0.7)', glow: 14, glowColor: 'rgba(0,0,0,0.9)' }));
  }
}
const SKIP_SUB = ['o1', 'o2'];

function framed(ctx, im, cx, cy, w, h, o = {}) {
  const a = o.alpha == null ? 1 : o.alpha; if (a <= 0.003) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.rotate(o.rot || 0); const sc = o.scale || 1; ctx.scale(sc, sc);
  const b = o.border == null ? 14 : o.border;
  setShadow(ctx, 60, 'rgba(0,0,0,0.85)'); ctx.fillStyle = goldGrad(ctx, -h / 2, h / 2); ctx.fillRect(-w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b); noShadow(ctx);
  ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
  if (o.filter) ctx.filter = o.filter;
  drawPhoto(ctx, im, -w / 2, -h / 2, w, h, o.fx == null ? 0.5 : o.fx, o.fy == null ? 0.5 : o.fy, o.zoom || 1);
  ctx.filter = 'none';
  if (o.sepia > 0) { ctx.globalAlpha = a * o.sepia; ctx.globalCompositeOperation = 'color'; ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.globalCompositeOperation = 'source-over'; }
  // הברקה עוברת
  if (o.sweep != null && o.sweep > 0 && o.sweep < 1) {
    const sx = -w / 2 - 300 + (w + 600) * o.sweep, g = ctx.createLinearGradient(sx - 160, -h / 2, sx + 160, h / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,245,220,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore(); ctx.restore();
}
function cover(ctx, name, fx, fy, zoom, a = 1, filter) {
  if (a <= 0.003) return;
  ctx.save(); ctx.globalAlpha = a; if (filter) ctx.filter = filter;
  drawPhoto(ctx, photo(name), 0, 0, W, H, fx, fy, zoom); ctx.restore();
}
function blurBg(ctx, name, a = 1, dark = 0.55, zoom = 1.15) {
  ctx.save(); ctx.globalAlpha = a; drawPhoto(ctx, blurred(name), 0, 0, W, H, 0.5, 0.5, zoom); ctx.restore();
  ctx.save(); ctx.globalAlpha = a * dark; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
}
function sticker(ctx, s, x, y, o = {}) {   // תווית בסגנון סטורי
  const size = o.size || 64, a = o.alpha == null ? 1 : o.alpha; if (a <= 0.003) return;
  const opt = { fam: o.fam || 'Heebo', size, w: 900 };
  const wd = measure(ctx, s, opt) + size * 0.9, hh = size * 1.45;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(o.rot || 0); const sc = o.scale || 1; ctx.scale(sc, sc);
  setShadow(ctx, 30, 'rgba(0,0,0,0.6)'); ctx.fillStyle = o.bg || '#111'; rrect(ctx, -wd / 2, -hh / 2, wd, hh, o.r == null ? 16 : o.r); ctx.fill(); noShadow(ctx);
  text(ctx, s, 0, 2, { ...opt, color: o.color || '#fff' });
  ctx.restore();
}
function tape(ctx, s, x, y, rot, a) {   // סרט הדבקה צהוב
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot);
  setShadow(ctx, 20, 'rgba(0,0,0,0.5)'); ctx.fillStyle = '#ffd23f'; ctx.fillRect(-470, -58, 940, 116); noShadow(ctx);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = -470; i < 470; i += 36) ctx.fillRect(i, -58, 3, 116);
  text(ctx, s, 0, 4, { fam: 'Secular One', size: 76, w: 400, color: '#1a1408' });
  ctx.restore();
}
function hudGrid(ctx, t, a) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#020b16'); bg.addColorStop(0.5, '#04243a'); bg.addColorStop(1, '#01060d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = a * 0.35; ctx.strokeStyle = 'rgba(60,230,255,0.5)'; ctx.lineWidth = 1;
  const off_ = (t * 40) % 60;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -60 + off_; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  const sy = (t * 520) % (H + 300) - 150, g = ctx.createLinearGradient(0, sy - 120, 0, sy + 120);
  g.addColorStop(0, 'rgba(60,230,255,0)'); g.addColorStop(0.5, `rgba(60,230,255,${0.16 * a})`); g.addColorStop(1, 'rgba(60,230,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, sy - 120, W, 240);
  // פינות מסגרת
  ctx.save(); ctx.strokeStyle = `rgba(80,235,255,${0.8 * a})`; ctx.lineWidth = 5;
  for (const [x, y, dx, dy] of [[50, 50, 1, 1], [W - 50, 50, -1, 1], [50, H - 50, 1, -1], [W - 50, H - 50, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * 90); ctx.lineTo(x, y); ctx.lineTo(x + dx * 90, y); ctx.stroke();
  }
  ctx.restore();
}
function leaf(ctx, x, y, s, a, glow = 0) {   // עלה דרגה מוזהב
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s);
  if (glow) setShadow(ctx, glow, 'rgba(255,210,120,1)');
  const g = ctx.createLinearGradient(-40, -60, 40, 60); g.addColorStop(0, '#fff6d0'); g.addColorStop(0.4, '#f0c45c'); g.addColorStop(0.7, '#a8741e'); g.addColorStop(1, '#ffe3a0');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -62);
  ctx.bezierCurveTo(46, -40, 46, 30, 0, 62); ctx.bezierCurveTo(-46, 30, -46, -40, 0, -62); ctx.fill(); noShadow(ctx);
  ctx.strokeStyle = 'rgba(90,55,10,0.8)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 56); ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let k = -3; k <= 3; k++) { const yy = k * 13; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(24 - Math.abs(k) * 3, yy - 12); ctx.moveTo(0, yy); ctx.lineTo(-24 + Math.abs(k) * 3, yy - 12); ctx.stroke(); }
  ctx.restore();
}
function stroller(ctx, x, y, s, a, t) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s);
  setShadow(ctx, 30, 'rgba(255,200,120,0.9)');
  ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(255,217,138,0.18)';
  ctx.beginPath(); ctx.moveTo(-110, -20); ctx.arc(0, -20, 110, Math.PI, 0, true); ctx.closePath(); ctx.fill(); ctx.stroke();   // גוף
  ctx.beginPath(); ctx.moveTo(-110, -20); ctx.arc(-10, -20, 100, Math.PI, Math.PI * 1.5); ctx.lineTo(-10, -20); ctx.closePath(); ctx.fillStyle = 'rgba(255,217,138,0.45)'; ctx.fill(); ctx.stroke(); // גגון
  ctx.beginPath(); ctx.moveTo(110, -20); ctx.lineTo(150, -100); ctx.lineTo(185, -100); ctx.stroke();   // ידית
  for (const wx of [-70, 70]) { ctx.save(); ctx.translate(wx, 70); ctx.rotate(t * 3); ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.moveTo(0, -34); ctx.lineTo(0, 34); ctx.lineWidth = 4; ctx.stroke(); ctx.restore(); }
  ctx.restore();
  // לבבות עולים
  for (let i = 0; i < 6; i++) {
    const ph = ((t * 0.5 + i / 6) % 1), hx = x + Math.sin(i * 2.3 + t) * 140 * s, hy = y - 160 * s - ph * 260 * s;
    heart(ctx, hx, hy, (16 + 8 * R(i, 3)) * s, a * Math.sin(ph * Math.PI) * 0.9);
  }
}
function heart(ctx, x, y, r, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = '#ff6f91'; setShadow(ctx, 12, 'rgba(255,110,145,0.9)');
  ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.6, -r * 1.4, 0, -r * 0.45); ctx.bezierCurveTo(r * 0.6, -r * 1.4, r * 1.6, -r * 0.2, 0, r * 0.9); ctx.fill();
  ctx.restore();
}
function heroCut(ctx, cx, top, w, a, rim = 1) {   // רועי גזור, עם תאורה אחורית זהובה
  const im = IMG.cut; if (!im || a <= 0) return;
  const h = w * im.height / im.width;
  ctx.save(); ctx.globalAlpha = a;
  if (rim > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px) brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(-12deg)'; ctx.globalAlpha = a * 0.55 * rim; ctx.drawImage(im, cx - w / 2 - 10, top - 14, w + 20, h + 20); ctx.restore(); }
  ctx.drawImage(im, cx - w / 2, top, w, h);
  // דהייה למטה ולמעלה
  ctx.globalCompositeOperation = 'destination-out';
  const g = ctx.createLinearGradient(0, top + h * 0.72, 0, top + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(cx - w, top + h * 0.72, w * 2, h * 0.3);
  const g2 = ctx.createLinearGradient(0, top, 0, top + 40); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(cx - w, top - 2, w * 2, 42);
  ctx.restore();
}

// ============================================================ סצנות
const TY = 470;
function scene1(ctx, t) {   // פתיחה + כותרת
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const bm = ev('boom');
  if (t < bm) {
    smoke(ctx, t, 0.35, null, 5, 14);
    embers(ctx, t, 40, 0.5 * ss(t / 2), GOLD);
    const a1 = win(t, ev('o1') - 0.2, ev('o2') - 0.1, 0.6, 0.35), a2 = win(t, ev('o2') - 0.15, bm + 0.02, 0.5, 0.05);
    for (const [s, a, k] of [[T.open1, a1, 'o1'], [T.open2, a2, 'o2']]) {
      if (a <= 0) continue;
      const opt = { fam: 'Frank Ruhl Libre', size: 92, w: 900 }, lines = wrap(ctx, s, 900, opt);
      const sc = lerp(1.06, 1, eOut((t - ev(k)) / 2.2));
      ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.scale(sc, sc);
      lines.forEach((ln, i) => text(ctx, ln, 0, (i - (lines.length - 1) / 2) * 120, { ...opt, alpha: a, color: k === 'o2' ? '#ffe3a6' : '#fff', glow: 24, glowColor: k === 'o2' ? 'rgba(255,190,80,0.8)' : 'rgba(255,255,255,0.35)' }));
      ctx.restore();
    }
    return;
  }
  const d = t - bm;
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, 1300); bg.addColorStop(0, '#3a2408'); bg.addColorStop(0.5, '#120a03'); bg.addColorStop(1, '#000');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  rays(ctx, W / 2, TY, 0.7, t, '255,200,120', 18, 1700);
  // רועי מואר מאחור
  ctx.save(); ctx.globalAlpha = 0.55 * ss(d / 1.5); ctx.filter = 'brightness(0.55) contrast(1.2)';
  heroCut(ctx, W / 2, 860 - d * 8, 1180, 1, 1.2); ctx.restore();
  smoke(ctx, t, 0.5, null, 6, 22);
  embers(ctx, t, 70, 0.9, GOLD);
  sparksFall(ctx, t, 25, 0.5 * Math.exp(-d * 0.5));
  const sw = seg(t, bm + 0.6, bm + 2.2);
  ctx.save(); ctx.translate(W / 2, TY); const sc = lerp(1.35, 1, eOut(d / 0.7)); ctx.scale(sc, sc);
  text3D(ctx, 'ROI', 0, -150, { size: 250, depth: 20, spacing: 30, glow: 40, sweep: sw, alpha: ss(d / 0.25) });
  text3D(ctx, 'DROR', 0, 120, { size: 250, depth: 20, spacing: 30, glow: 40, sweep: sw, alpha: ss(d / 0.25) });
  ctx.restore();
  text(ctx, T.mainEnSub, W / 2, TY + 330, { fam: 'Orbitron', size: 46, w: 800, spacing: 18, color: '#ffe3a6', alpha: ss((d - 0.9) / 0.6), glow: 20 });
  ctx.save(); ctx.globalAlpha = ss((d - 1.1) / 0.6); ctx.fillStyle = goldGrad(ctx, 0, 4); ctx.fillRect(W / 2 - 260 * ss((d - 1.1) / 0.8), TY + 385, 520 * ss((d - 1.1) / 0.8), 4); ctx.restore();
  text3D(ctx, T.mainHe, W / 2, TY + 470, { fam: 'Secular One', w: 400, size: 110, depth: 8, alpha: ss((d - 1.4) / 0.6), glow: 20 });
  flare(ctx, W / 2, TY - 10, Math.exp(-d * 1.4), 1.2, '255,200,130');
  const fo = ss((t - ev('s2') + 0.35) / 0.35); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function scene2(ctx, t) {   // האגדה
  const hero = ev('hero'), leg = ev('legacy');
  if (t < hero) {   // 2006
    const d = t - ev('s2');
    blurBg(ctx, 'p01_2006.jpg', 1, 0.62);
    bokeh(ctx, t, 0.8);
    const im = photo('p01_2006.jpg'), w = 960, h = w * im.height / im.width;
    framed(ctx, im, W / 2, 930, w, h, { rot: lerp(-0.05, -0.02, eOut(d / 3)), scale: lerp(0.9, 1.02, eOut(d / 5)), alpha: ss(d / 0.5), zoom: lerp(1, 1.08, d / 6), fx: 0.45, fy: 0.4, sepia: 1 - ss((d - 1.5) / 2), sweep: seg(t, ev('s2') + 2.6, ev('s2') + 4) });
    ctx.save(); ctx.translate(W / 2, 470); const sc = lerp(1.25, 1, eOut((d - 0.2) / 0.6)); ctx.scale(sc, sc);
    text3D(ctx, T.year, 0, 0, { size: 230, depth: 16, spacing: 14, alpha: ss((d - 0.2) / 0.4), glow: 30, sweep: seg(t, ev('s2') + 1, ev('s2') + 2.4) });
    ctx.restore();
    text(ctx, T.yearSub, W / 2, 1350, { fam: 'Secular One', w: 400, size: 74, color: '#ffe3a6', alpha: ss((d - 1.0) / 0.6), glow: 18 });
    const fo = ss((t - hero + 0.25) / 0.25); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  if (t < leg) {   // הגיבור
    const d = t - hero;
    const bg = ctx.createRadialGradient(W / 2, 600, 0, W / 2, 600, 1400); bg.addColorStop(0, '#4a2c0a'); bg.addColorStop(0.45, '#160c04'); bg.addColorStop(1, '#000');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    rays(ctx, W / 2, 250, 0.55, t, '255,200,120', 14, 1800);
    smoke(ctx, t, 0.55, null, 6, 26);
    const w = lerp(1250, 1330, d / 8), top = lerp(470, 420, eOut(d / 2.5));
    heroCut(ctx, W / 2 + lerp(60, 0, eOut(d / 1.2)), top, w, ss(d / 0.5), 1.1);
    embers(ctx, t, 90, 0.9, ORANGE);
    // תגיות
    [['tag1', T.tag1, 830], ['tag2', T.tag2, 540], ['tag3', T.tag3, 250]].forEach(([k, s, x]) => {
      const dd = t - ev(k); if (dd < 0) return;
      ctx.save(); ctx.translate(x, 300); const sc = eBack(dd / 0.45); ctx.scale(sc, sc);
      text3D(ctx, s, 0, 0, { fam: 'Secular One', w: 400, size: 96, depth: 8, glow: 24, alpha: ss(dd / 0.2) });
      ctx.restore();
    });
    // כרטיס שם
    const na = ss((d - 0.4) / 0.6);
    ctx.save(); ctx.globalAlpha = na; const gw = 760 * eOut((d - 0.4) / 0.7);
    const gg = ctx.createLinearGradient(W / 2 - gw / 2, 0, W / 2 + gw / 2, 0); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.5, 'rgba(0,0,0,0.65)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(W / 2 - gw / 2, 1380, gw, 230); ctx.fillStyle = goldGrad(ctx, 0, 3); ctx.fillRect(W / 2 - gw / 2, 1380, gw, 3); ctx.fillRect(W / 2 - gw / 2, 1607, gw, 3);
    ctx.restore();
    text3D(ctx, T.heroName, W / 2, 1460, { fam: 'Secular One', w: 400, size: 116, depth: 9, alpha: na, glow: 24, sweep: seg(t, hero + 1, hero + 2.4) });
    text(ctx, T.heroRole, W / 2, 1560, { fam: 'Heebo', size: 58, w: 800, color: '#ffe3a6', spacing: 4, alpha: ss((d - 0.8) / 0.5) });
    const fo = ss((t - leg + 0.2) / 0.2); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo * 0.9; ctx.fillStyle = '#fff3d6'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    return;
  }
  // משאיר חותם: טקס ← דיוקן על הקיר
  const d = t - leg, pt = ev('portrait'), dp = t - pt;
  blurBg(ctx, dp < 0 ? 'p05_ceremony.jpg' : 'p09_portrait.jpg', 1, 0.6, 1.3);
  bokeh(ctx, t, 0.7);
  const ce = photo('p05_ceremony.jpg'), cw = 980, chh = cw * ce.height / ce.width;
  const out = ss(dp / 0.5);
  framed(ctx, ce, W / 2 - out * 900, 880, cw, chh, { rot: 0.03, alpha: ss(d / 0.35) * (1 - out), scale: lerp(0.94, 1.02, eOut(d / 3)), zoom: lerp(1.0, 1.1, d / 4), fx: 0.62, fy: 0.4 });
  if (dp > 0) {
    const pi = photo('p09_portrait.jpg'), pw = 560, ph = pw * pi.height / pi.width;
    framed(ctx, pi, W / 2 + (1 - eOut(dp / 0.6)) * 900, 980, pw, ph, { rot: -0.025, scale: lerp(1.0, 1.05, dp / 3), zoom: lerp(1, 1.08, dp / 3), fy: 0.35, sweep: seg(t, pt + 0.6, pt + 1.8) });
    ctx.save(); ctx.translate(W / 2, 250); const sc = eBack((dp - 0.3) / 0.45); ctx.scale(sc, sc);
    text3D(ctx, T.legacy, 0, 0, { fam: 'Secular One', w: 400, size: 110, depth: 9, glow: 26, alpha: ss((dp - 0.3) / 0.2) });
    ctx.restore();
  }
  const fo = ss((t - ev('s3') + 0.2) / 0.2); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function scene3(ctx, t) {   // מאחורי הקלעים
  const s3 = ev('s3'), bc = ev('beach'), pz = ev('pizza'), pz2 = ev('pizza2');
  if (t < bc) {
    const d = t - s3;
    cover(ctx, 'p02_bus.jpg', 0.5, 0.38, lerp(1.05, 1.16, d / 5));
    // סוללה
    const bx = W / 2, by = 1240, pct = 3;
    ctx.save(); ctx.globalAlpha = ss((d - 0.6) / 0.4);
    setShadow(ctx, 30, 'rgba(0,0,0,0.7)'); ctx.fillStyle = 'rgba(10,10,10,0.75)'; rrect(ctx, bx - 300, by - 95, 600, 190, 30); ctx.fill(); noShadow(ctx);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; rrect(ctx, bx - 250, by - 48, 260, 96, 16); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(bx + 14, by - 20, 14, 40);
    const blink = Math.sin(t * 10) > -0.2 ? 1 : 0.2; ctx.fillStyle = `rgba(255,60,50,${blink})`; ctx.fillRect(bx - 240, by - 38, 22, 76);
    ctx.restore();
    text(ctx, T.busPct, bx + 160, by + 4, { fam: 'Orbitron', size: 70, w: 800, color: '#ff5a4a', alpha: ss((d - 0.6) / 0.4) });
    sticker(ctx, T.bus, W / 2, 1060, { size: 60, alpha: ss((d - 0.9) / 0.4), rot: -0.03, bg: '#fff', color: '#111' });
    for (let i = 0; i < 3; i++) { const ph = (t * 0.6 + i / 3) % 1; text(ctx, 'Z', 760 + ph * 140 + i * 10, 640 - ph * 300, { fam: 'Secular One', w: 400, size: 70 + i * 20, color: '#fff', alpha: Math.sin(ph * Math.PI) * ss((d - 0.4) / 0.5), stroke: 6, strokeColor: 'rgba(0,0,0,0.5)' }); }
  } else if (t < pz) {
    const d = t - bc;
    cover(ctx, 'p03_beach.jpg', 0.55, 0.62, lerp(1.0, 1.1, d / 4));
    sticker(ctx, T.beach, W / 2, 1380, { size: 74, alpha: ss((d - 0.3) / 0.3), rot: 0.02, scale: eBack((d - 0.3) / 0.4) });
  } else {
    const d = t - pz, two = t >= pz2;
    cover(ctx, two ? 'p07_pizza2.jpg' : 'p06_pizza1.jpg', 0.6, 0.45, lerp(1.04, 1.12, (t - (two ? pz2 : pz)) / 3));
    sticker(ctx, T.pizza, W / 2, 1350, { size: 76, alpha: ss((d - 0.4) / 0.3), rot: -0.03, scale: eBack((d - 0.4) / 0.4), bg: '#ffd23f', color: '#1a1408' });
    confetti(ctx, t, pz + 0.2, 90, 0.9);
  }
  // שכבת "מאחורי הקלעים"
  const d0 = t - s3;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, 210);
  if (Math.sin(t * 6) > 0) { ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(90, 120, 18, 0, 7); ctx.fill(); }
  text(ctx, 'REC', 170, 122, { fam: 'Orbitron', size: 38, w: 800, color: '#fff', align: 'left', dir: 'ltr' });
  const secs = Math.floor(d0), fr = Math.floor((d0 % 1) * 30);
  text(ctx, `00:00:${String(secs).padStart(2, '0')}:${String(fr).padStart(2, '0')}`, W - 70, 122, { fam: 'Orbitron', size: 34, w: 500, color: '#fff', align: 'right', dir: 'ltr' });
  tape(ctx, T.bts, W / 2, 330, -0.04, ss(d0 / 0.3));
  const fo = ss((t - ev('s4') + 0.15) / 0.15); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function scene4(ctx, t) {   // עדכון משימה
  const s4 = ev('s4'), fm = ev('family'), rk = ev('rank'), l3 = ev('leaf3'), d = t - s4;
  hudGrid(ctx, t, 1);
  const gl = d < 0.4 ? (R(Math.floor(t * 30), 3) - 0.5) * 40 : 0;
  text(ctx, T.mission1, W / 2 + gl, 300, { fam: 'Orbitron', size: 74, w: 800, spacing: 8, color: '#7df0ff', glow: 30, glowColor: 'rgba(60,230,255,0.9)', alpha: ss(d / 0.2) });
  text(ctx, T.mission2, W / 2, 400, { fam: 'Heebo', size: 54, w: 700, color: '#d9fbff', alpha: ss((d - 0.4) / 0.4) });
  // שורת סטטוס
  const typed = 'TARGET: ROI DROR  ·  STATUS: LEVEL UP'.slice(0, Math.floor(clamp((d - 0.6) / 1.2) * 38));
  text(ctx, typed, 120, 500, { fam: 'Orbitron', size: 28, w: 500, color: '#7df0ff', align: 'left', dir: 'ltr', alpha: 0.85 });
  if (t >= fm && t < rk) {
    const dd = t - fm, a = ss(dd / 0.3) * (1 - ss((t - rk + 0.3) / 0.3));
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(5,30,48,0.75)'; ctx.strokeStyle = 'rgba(80,235,255,0.8)'; ctx.lineWidth = 3;
    rrect(ctx, 110, 620, W - 220, 800, 30); ctx.fill(); ctx.stroke(); ctx.restore();
    stroller(ctx, W / 2, 920, eBack(dd / 0.5) * 1.25, a, t);
    text3D(ctx, T.family, W / 2, 1180, { fam: 'Secular One', w: 400, size: 104, depth: 8, glow: 24, alpha: a * ss((dd - 0.2) / 0.3) });
    text(ctx, T.familySub, W / 2, 1310, { fam: 'Heebo', size: 62, w: 800, color: '#ff9fb5', alpha: a * ss((dd - 0.5) / 0.3), glow: 16, glowColor: 'rgba(255,110,145,0.8)' });
  }
  if (t >= rk) {
    const dd = t - rk, a = ss(dd / 0.3) * (1 - ss((t - ev('s5') + 0.4) / 0.4)), d3 = t - l3;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(5,30,48,0.75)'; ctx.strokeStyle = 'rgba(80,235,255,0.8)'; ctx.lineWidth = 3;
    rrect(ctx, 110, 620, W - 220, 860, 30); ctx.fill(); ctx.stroke(); ctx.restore();
    // כותפת
    const cx = W / 2, cy = 860, ew = 300, eh = 380;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(eBack(dd / 0.5), eBack(dd / 0.5));
    setShadow(ctx, 40, 'rgba(0,0,0,0.7)'); const og = ctx.createLinearGradient(-ew / 2, 0, ew / 2, 0); og.addColorStop(0, '#4c5228'); og.addColorStop(0.5, '#6b7238'); og.addColorStop(1, '#454a24');
    ctx.fillStyle = og; ctx.beginPath(); ctx.moveTo(-ew / 2, eh / 2); ctx.lineTo(-ew / 2, -eh / 2 + 60); ctx.quadraticCurveTo(0, -eh / 2 - 40, ew / 2, -eh / 2 + 60); ctx.lineTo(ew / 2, eh / 2); ctx.closePath(); ctx.fill(); noShadow(ctx);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
    leaf(ctx, 0, 100, 1.0, 1); leaf(ctx, 0, -20, 1.0, 1);
    if (d3 > -0.5) { const p = eOut((d3 + 0.5) / 0.5); leaf(ctx, 0, lerp(-500, -140, p), lerp(1.8, 1.0, p), ss((d3 + 0.5) / 0.2), d3 > 0 ? 40 * Math.exp(-d3 * 2) + 10 : 0); }
    ctx.restore();
    if (d3 > 0) { burst(ctx, cx, cy - 140, l3, t, 60, GOLD, 900, 1.4, 4); flare(ctx, cx, cy - 140, Math.exp(-d3 * 2), 0.8, '255,210,140'); }
    text3D(ctx, T.rank, W / 2, 1200, { fam: 'Secular One', w: 400, size: 150, depth: 12, glow: 30, alpha: a * ss(d3 / 0.3), sweep: seg(t, l3 + 0.3, l3 + 1.5) });
    text(ctx, T.rankSub, W / 2, 1330, { fam: 'Heebo', size: 56, w: 800, color: '#ffe3a6', alpha: a * ss((d3 - 0.3) / 0.3) });
    // פס התקדמות
    const pb = clamp(dd / Math.max(0.5, l3 - rk)) * 0.99;
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#7df0ff'; ctx.lineWidth = 3; rrect(ctx, 200, 1400, W - 400, 34, 17); ctx.stroke();
    ctx.fillStyle = d3 > 0 ? '#ffd56b' : '#7df0ff'; rrect(ctx, 206, 1406, (W - 412) * pb, 22, 11); ctx.fill(); ctx.restore();
    text(ctx, `${T.rankEn}  ${Math.round(pb * 100)}%`, W / 2, 1470, { fam: 'Orbitron', size: 28, w: 500, spacing: 4, color: d3 > 0 ? '#ffd56b' : '#7df0ff', alpha: a, dir: 'ltr' });
  }
}

const BLESS = [['p04_hero.jpg', 0.6, 0.45], ['p05_ceremony.jpg', 0.62, 0.4], ['p01_2006.jpg', 0.45, 0.4], ['p03_beach.jpg', 0.55, 0.62]];
function scene5(ctx, t) {   // ברכה
  const s5 = ev('s5'), s6 = ev('s6'), span = (s6 - s5) / BLESS.length;
  const i = Math.min(BLESS.length - 1, Math.floor((t - s5) / span)), dl = t - s5 - i * span;
  const [f, fx, fy] = BLESS[i];
  blurBg(ctx, f, 1, 0.55, 1.25);
  if (dl < 0.6 && i > 0) { ctx.save(); ctx.globalAlpha = 1 - ss(dl / 0.6); blurBg(ctx, BLESS[i - 1][0], 1, 0.55, 1.25); ctx.restore(); }
  bokeh(ctx, t, 1);
  embers(ctx, t, 30, 0.5, GOLD);
  text3D(ctx, 'רועי', W / 2, 260, { fam: 'Secular One', w: 400, size: 150, depth: 10, glow: 30, alpha: ss((t - s5) / 0.8), sweep: ((t - s5) * 0.25) % 1 });
  for (const k of [i - 1, i]) {
    if (k < 0) continue;
    const [ff, fxx, fyy] = BLESS[k], im = photo(ff), dk = t - s5 - k * span;
    const portrait = im.height > im.width, w = portrait ? 760 : 940, h = portrait ? 1000 : w * im.height / im.width;
    const inA = ss(dk / 0.6), outA = k < i ? 1 - ss(dl / 0.6) : 1;
    const rot = [-0.035, 0.03, -0.025, 0.035][k];
    framed(ctx, im, W / 2 + (1 - eOut(dk / 0.8)) * (k % 2 ? -200 : 200), 900, w, h, { rot, alpha: inA * outA, scale: lerp(0.92, 1.03, dk / span), zoom: lerp(1, 1.08, dk / span), fx: fxx, fy: fyy, sweep: seg(dk, 0.8, 2.0) });
  }
  const fo = ss((t - s6 + 0.3) / 0.3); if (fo > 0) { ctx.save(); ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function scene6(ctx, t) {   // פינאלה
  const s6 = ev('s6'), up = ev('upto'), hb = ev('hb'), cr = ev('credit');
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#05030e'); bg.addColorStop(1, '#1d0d16');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (t < up) { embers(ctx, t, 120, 0.9 * ss((t - s6) / 0.5), GOLD, -1); return; }
  fireworks(ctx, t, up - 0.5, ev('total'), 2.6, 11, 0.5);
  rays(ctx, W / 2, H * 0.4, 0.45, t, '255,210,140', 18, 1700);
  if (t < hb) {
    const d = t - up;
    for (let k = 0; k < 5; k++) burst(ctx, W * (0.15 + 0.17 * k), H * (0.22 + 0.08 * (k % 2)), up + k * 0.12, t, 70, FWC[k], 800, 2.0, k * 9 + 2);
    ctx.save(); ctx.translate(W / 2, H * 0.42); const sc = eBack(d / 0.55) * (1 + 0.02 * Math.sin(t * 3)); ctx.scale(sc, sc);
    text3D(ctx, T.upto, 0, 0, { fam: 'Secular One', w: 400, size: 250, depth: 18, glow: 40, sweep: (d * 0.5) % 1 });
    ctx.restore();
    confetti(ctx, t, up, 260);
    return;
  }
  const d = t - hb;
  if (t < cr) {
    ctx.save(); const sc = eBack(d / 0.6); ctx.translate(W / 2, H * 0.36); ctx.scale(sc, sc);
    text3D(ctx, T.hbEn1, 0, -110, { size: 86, depth: 10, spacing: 6, glow: 30, sweep: seg(t, hb + 0.6, hb + 2) });
    text3D(ctx, T.hbEn2, 0, 70, { size: 150, depth: 14, spacing: 8, glow: 36, sweep: seg(t, hb + 0.9, hb + 2.3) });
    ctx.restore();
    text3D(ctx, T.hbHe, W / 2, H * 0.36 + 300, { fam: 'Secular One', w: 400, size: 120, depth: 9, glow: 26, alpha: ss((d - 0.6) / 0.5) });
    confetti(ctx, t, hb - 0.5, 220);
    return;
  }
  // תמונת סיום וקרדיט
  const dc = t - cr, im = photo('p04_hero.jpg');
  framed(ctx, im, W / 2, 820, 760, 900, { alpha: ss(dc / 0.6), scale: lerp(0.95, 1.02, dc / 4), zoom: lerp(1.0, 1.08, dc / 4), fx: 0.6, fy: 0.45, sweep: seg(dc, 0.6, 1.8) });
  text3D(ctx, T.hbHe, W / 2, 1440, { fam: 'Secular One', w: 400, size: 110, depth: 9, glow: 26, alpha: ss((dc - 0.4) / 0.5) });
  text(ctx, T.credit, W / 2, 1580, { fam: 'Orbitron', size: 24, w: 500, spacing: 3, color: '#d8c79e', alpha: ss((dc - 1.0) / 0.6), dir: 'ltr' });
  confetti(ctx, t, cr - 1, 120, 0.8);
}

// ------------------------------------------------------------ מצלמה, הבזקים, פוסט
function shake(t) {
  let x = 0, y = 0;
  for (const [k, amp] of [['boom', 26], ['hero', 16], ['leaf3', 12], ['upto', 24], ['hb', 10]]) {
    const d = t - ev(k); if (d >= 0 && d < 1.2) { const a = amp * Math.exp(-d * 5); x += a * Math.sin(d * 63); y += a * Math.cos(d * 51); }
  }
  return [x, y];
}
function flashes(ctx, t) {
  for (const [k, a, c, dur] of [['boom', 1, '#fff', 1.0], ['hero', 0.7, '#fff3d0', 0.5], ['leaf3', 0.6, '#fff3d0', 0.5], ['upto', 1, '#fff6dc', 0.8], ['hb', 0.6, '#fff6dc', 0.5]]) {
    const d = t - ev(k); if (d < 0 || d > dur) continue;
    ctx.save(); ctx.globalAlpha = a * Math.pow(1 - d / dur, 2); ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}
function post(ctx, t) {
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.06; ctx.drawImage(grainTex(Math.floor(t * 30) % 6), 0, 0, W, H); ctx.restore();
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
  else if (t < ev('s6')) scene5(ctx, t);
  else scene6(ctx, t);
  ctx.restore();
  flashes(ctx, t);
  post(ctx, t);
  subtitle(ctx, t, 1720);
  const fi = 1 - ss(t / 0.6); if (fi > 0) { ctx.globalAlpha = fi; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  const fo = seg(t, TL.total - 1.6, TL.total);
  if (fo > 0) { ctx.globalAlpha = fo; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

// ------------------------------------------------------------ טעינה
const PHOTOS = ['p01_2006.jpg', 'p02_bus.jpg', 'p03_beach.jpg', 'p04_hero.jpg', 'p05_ceremony.jpg', 'p06_pizza1.jpg', 'p07_pizza2.jpg', 'p09_portrait.jpg'];
async function load(timelineUrl = 'build/timeline.json', overrides = null) {
  TL = await (await fetch(timelineUrl, { cache: 'no-store' })).json();
  E = TL.events; T = Object.assign({}, TL.titles, overrides || {});
  const li = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('missing ' + src)); im.src = src; });
  IMG.cut = await li('assets/cutouts/roi_hero.png');
  await Promise.all(PHOTOS.map(async (n) => { IMG[n] = await li('assets/photos/' + n); }));
  const fams = [['Heebo', 900], ['Heebo', 800], ['Heebo', 700], ['Frank Ruhl Libre', 900], ['Secular One', 400], ['Cinzel', 900], ['Orbitron', 800], ['Orbitron', 500]];
  await Promise.all(fams.map(([f, w]) => document.fonts.load(`${w} 40px "${f}"`, 'אבגROI0123')));
  await document.fonts.ready;
  return TL;
}
function setScale(s) { S = s; }
function setTitles(o) { T = Object.assign({}, TL.titles, o); }
window.FILM = { load, render, setScale, setTitles, get timeline() { return TL; }, W, H };
})();
