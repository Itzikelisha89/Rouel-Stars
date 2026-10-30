// סרטון הסבר: מריץ את המשחק האמיתי בשלושה "טלפונים", מביים משחק, מצלם, ומרכיב עם קריינות וצלילים.
// הרצה: python3 video/make-audio.py OUT && node video/make-video.js OUT
'use strict';
process.env.PORT = process.env.PORT || '3199';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const srv = require('../server.js');
const { chromium } = require('playwright');

const OUT = path.resolve(process.argv[2] || '/tmp/vid');
const ROOT = path.join(__dirname, '..');
const DUR = JSON.parse(fs.readFileSync(path.join(OUT, 'vo/durations.json'), 'utf8'));
const SCRIPT = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'));
const PORT = process.env.PORT;
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://127.0.0.2:${PORT}`];
const NAMES = ['יוסי', 'דנה', 'אבי'];
const VOICES = ['m', 'f', 'm'];
const AVATAR_IDX = [12, 3, 14];
const FRAMES = path.join(OUT, 'frames');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => ({ id, a: +id[0], b: +id[1] });

let t0 = 0;
const now = () => (Date.now() - t0) / 1000;
const cues = [];
const cue = (file, vol = 1, at = now()) => cues.push({ file, vol, t: at });
const voiceFile = (v, key) => path.join(ROOT, 'public/audio', v, `${key}.mp3`);
const sfx = (name) => path.join(OUT, 'sfx', `${name}.wav`);

// ---- צלילי המשחק לפי מה שקורה בשרת ----
srv.hooks.freeze = true;
srv.hooks.banter = false;
srv.hooks.onFx = (room, events) => {
  const t = now();
  for (const ev of events) {
    const v = VOICES[ev.seat] || 'm';
    if (ev.type === 'play') {
      cue(sfx('clack'), 0.9, t);
      if (ev.last) cue(voiceFile(v, 'domino'), 0.9, t + 0.3);
    } else if (ev.type === 'pick') cue(sfx('pick'), 0.35, t);
    else if (ev.type === 'draw') cue(sfx('slide'), 0.7, t);
    else if (ev.type === 'call') {
      if (ev.value >= 1 && ev.value <= 9) cue(voiceFile(v, `p${ev.value}`), 0.95, t + 0.05);
      if (ev.ok) cue(sfx('chime'), 0.35, t + 0.55);
    } else if (ev.type === 'missed') cue(voiceFile(VOICES[(ev.seat + 1) % 3], 'missed'), 0.9, t + 0.25);
    else if (ev.type === 'pass') {
      cue(sfx('knock'), 0.9, t);
      cue(voiceFile(v, 'pass'), 0.8, t + 0.35);
    } else if (ev.type === 'freishAsk') cue(voiceFile(v, 'freish'), 0.95, t + 0.05);
    else if (ev.type === 'freishVote' && ev.yes) cue(voiceFile(v, 'freish_yes'), 0.9, t + 0.05);
    else if (ev.type === 'newHand') cue(sfx('shuffle'), 0.6, t);
    else if (ev.type === 'banter') cue(path.join(ROOT, 'public/audio/fun', `${ev.id}.mp3`), 0.95, t + 0.9);
    else if (ev.type === 'gameOver') {
      cue(sfx('chime'), 0.5, t + 0.4);
      cue(voiceFile(VOICES[ev.winSide], 'win'), 0.95, t + 1.6);
    }
  }
};

// ---- האולפן: שלושה טלפונים + פאנל הסבר ----
function studioHTML() {
  const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const defs = index.slice(index.indexOf('<svg class="defs"'), index.indexOf('</svg>', index.indexOf('<svg class="defs"')) + 6);
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const tileCss = css.split('\n').filter((l) => /^\.(tile|back-)/.test(l)).join('\n');
  const phones = NAMES.map(
    (n, i) => `<div class="phone" id="ph${i}"><iframe id="fr${i}" src="${ORIGINS[i]}/" allow="camera; microphone; autoplay"></iframe><div class="label">${n}</div></div>`
  ).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
${tileCss}
.defs{position:absolute;width:0;height:0;overflow:hidden}
*{box-sizing:border-box}
body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:Rubik,sans-serif;color:#f7f2e6;
  background:radial-gradient(ellipse at 75% 15%,rgba(232,184,74,.10),transparent 40%),radial-gradient(ellipse at 30% 30%,#1b5538,#0b2a1d 62%,#06170f)}
body::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.018) 0 2px,transparent 2px 6px);pointer-events:none}
.header{position:absolute;top:26px;right:44px;left:44px;display:flex;align-items:center;justify-content:space-between;z-index:5}
.brand{display:flex;align-items:center;gap:20px}
.brand .lt{display:flex;gap:6px;height:64px}.brand .lt>div{width:32px;height:64px}
.brand h1{margin:0;font-size:56px;font-weight:900;color:#e8b84a;text-shadow:0 3px 0 #5b3f08,0 8px 20px rgba(0,0,0,.4);line-height:1}
.brand .ded{font-size:24px;color:#ffe2a0;font-weight:500;margin-top:4px}
.chapter{font-size:24px;padding:10px 22px;border:1px solid rgba(232,184,74,.55);border-radius:999px;color:#ffe2a0;background:rgba(0,0,0,.25)}
.panel{position:absolute;right:44px;top:150px;width:520px;bottom:60px;display:flex;flex-direction:column;justify-content:center;gap:26px;z-index:5}
.panel .num{font-size:28px;color:#a9c2b4;font-weight:500}
.panel .title{font-size:60px;font-weight:900;color:#e8b84a;line-height:1.08;text-shadow:0 3px 0 #5b3f08}
.panel .say{font-size:33px;line-height:1.5;font-weight:500;background:rgba(0,0,0,.30);border-right:7px solid #e8b84a;padding:24px 28px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.panel .anim{animation:pin .7s cubic-bezier(.2,.9,.3,1.2) both}
@keyframes pin{from{opacity:0;transform:translateX(40px)}}
.phones{position:absolute;left:40px;top:140px;width:1300px;height:900px;display:flex;justify-content:center;align-items:flex-start;gap:26px;direction:ltr}
.phone{position:relative;width:410px;height:864px;border-radius:50px;padding:10px;background:linear-gradient(145deg,#2b2b2b,#0d0d0d);
  box-shadow:0 30px 60px rgba(0,0,0,.6),0 0 0 2px #3a3a3a inset;transition:opacity .6s,box-shadow .6s,filter .6s}
.phone iframe{width:390px;height:844px;border:0;border-radius:40px;display:block;background:#0b2a1d}
.phone .label{position:absolute;bottom:-46px;left:0;right:0;text-align:center;font-size:26px;font-weight:700;color:#ffe2a0}
.phone.focus{box-shadow:0 0 0 4px #e8b84a,0 0 50px rgba(232,184,74,.45),0 30px 70px rgba(0,0,0,.7)}
.phone.dim{opacity:.32;filter:saturate(.6)}
.phone.gone{display:none}
.tap{position:fixed;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,255,255,.35);border:3px solid #fff;pointer-events:none;z-index:60;animation:tap .65s ease-out forwards;box-shadow:0 0 20px rgba(255,255,255,.6)}
@keyframes tap{0%{transform:scale(.35);opacity:1}100%{transform:scale(1.7);opacity:0}}
.card{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;transition:opacity .9s;
  background:radial-gradient(ellipse at center,#1d5a3c 0%,#0b2a1d 60%,#051109 100%)}
.card.hidden{opacity:0;pointer-events:none}
.card .tiles{display:flex;gap:18px;height:200px;margin-bottom:10px}
.card .tiles>div{width:100px;height:200px;animation:drop .8s cubic-bezier(.2,.9,.3,1.3) both}
.card .tiles>div:nth-child(1){transform:rotate(-12deg);animation-delay:.1s}.card .tiles>div:nth-child(2){animation-delay:.3s}.card .tiles>div:nth-child(3){transform:rotate(12deg);animation-delay:.5s}
@keyframes drop{from{opacity:0;translate:0 -120px;scale:1.3}}
.card h1{margin:0;font-size:170px;font-weight:900;color:#e8b84a;text-shadow:0 6px 0 #5b3f08,0 20px 40px rgba(0,0,0,.5);line-height:1;animation:rise 1s .6s both}
.card .ded{font-size:58px;font-weight:700;color:#ffe9b5;padding:8px 40px;border:2px solid rgba(232,184,74,.6);border-radius:999px;background:rgba(232,184,74,.12);animation:rise 1s .9s both}
.card .credit{position:absolute;bottom:28px;font-size:18px;color:rgba(255,255,255,.45);direction:ltr}
.card .sub{font-size:34px;color:#a9c2b4;animation:rise 1s 1.2s both}
@keyframes rise{from{opacity:0;transform:translateY(30px)}}
</style></head><body>${defs}
<div class="header"><div class="brand"><div class="lt" id="brand-tiles"></div><div><h1>חמישיות</h1><div class="ded">הדומינו של יוסי פרג</div></div></div><div class="chapter" id="chapter">סרטון הסבר</div></div>
<div class="panel"><div class="num" id="num"></div><div class="title" id="title"></div><div class="say" id="say"></div></div>
<div class="phones">${phones}</div>
<div class="card" id="card"><div class="tiles" id="card-tiles"></div><h1>חמישיות</h1><div class="ded">הדומינו של יוסי פרג</div><div class="sub" id="card-sub">סרטון הסבר · איך משחקים</div><div class="credit" id="card-credit"></div></div>
<script src="${ORIGINS[0]}/js/tiles.js"></script>
<script>
document.getElementById('brand-tiles').innerHTML = [[5,5],[6,6]].map(([a,b]) => '<div>' + Tiles.handTileSVG(a,b) + '</div>').join('');
document.getElementById('card-tiles').innerHTML = [[5,0],[5,5],[6,4]].map(([a,b]) => '<div>' + Tiles.handTileSVG(a,b) + '</div>').join('');
window.setScene = (o) => {
  for (const id of ['num','title','say']) { const el = document.getElementById(id); el.textContent = o[id] || ''; el.classList.remove('anim'); void el.offsetWidth; el.classList.add('anim'); }
  document.getElementById('chapter').textContent = o.chapter || '';
  [0,1,2].forEach((i) => { const p = document.getElementById('ph' + i); p.className = 'phone' + (o.focus == null ? '' : o.focus.includes(i) ? ' focus' : o.gone ? ' gone' : ' dim'); });
};
window.tapAt = (x, y) => { const t = document.createElement('div'); t.className = 'tap'; t.style.left = x + 'px'; t.style.top = y + 'px'; document.body.appendChild(t); setTimeout(() => t.remove(), 700); };
window.card = (show, sub, credit) => { const c = document.getElementById('card'); c.classList.toggle('hidden', !show); if (sub) document.getElementById('card-sub').textContent = sub; if (credit) document.getElementById('card-credit').textContent = credit;
  if (show) c.querySelectorAll('.tiles>div,h1,.ded,.sub').forEach((e) => { e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; }); };
</script></body></html>`;
}

// מצלמה "מדומה" לכל שחקן: הדמות שלו, עם תנועה קלה – כדי להראות איך נראה וידאו ליד השולחן
const FAKE_CAM = fs.readFileSync(path.join(__dirname, 'fake-cam.js'), 'utf8');

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(FAKE_CAM);
  const page = await ctx.newPage();
  globalThis.__page = page;
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.setContent(studioHTML(), { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const fr = (i) => page.frames().find((f) => f.url().startsWith(ORIGINS[i]));
  const ev = (i, fn, arg) => fr(i).evaluate(fn, arg);
  async function tap(i, selector, opts = {}) {
    const loc = fr(i).locator(selector).first();
    await loc.waitFor({ state: 'attached', timeout: 10000 });
    const b = await loc.boundingBox();
    if (b) await page.evaluate(([x, y]) => window.tapAt(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
    await sleep(opts.fast ? 90 : 230);
    await loc.click({ force: true, timeout: 5000 });
    await sleep(opts.after ?? 250);
  }
  async function typeIn(i, selector, text) {
    await tap(i, selector);
    await fr(i).locator(selector).pressSequentially(text, { delay: 85 });
  }
  const handIdx = (i, id) => ev(i, (x) => S.handOrder.indexOf(x), id);
  async function playTile(i, id, end) {
    const k = await handIdx(i, id);
    await tap(i, `#hand .ht:nth-child(${k + 1})`);
    if (end) {
      const sel = `.ghost[data-tile="${id}"][data-end="${end}"] .gbox`;
      if (await fr(i).locator(sel).count()) await tap(i, sel);
    }
    await sleep(500);
  }
  const room = () => [...srv.rooms.values()][0];

  // ---- צילום מסך רציף (CDP screencast) באיכות גבוהה ----
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let fi = 0;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const f = path.join(FRAMES, `${String(fi++).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push({ f, t: metadata.timestamp * 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  let chapterNo = 0;
  const TOTAL = 14;
  async function scene(key, o, action) {
    if (o.title) chapterNo++;
    await page.evaluate((x) => window.setScene(x), { ...o, say: SCRIPT[key], num: o.title ? `פרק ${chapterNo} מתוך ${TOTAL}` : '', chapter: o.chapter || (o.title ? `${chapterNo}/${TOTAL}` : '') });
    const start = now() + 0.35;
    cue(path.join(OUT, 'vo', `${key}.mp3`), 1, start);
    await sleep(350);
    if (action) await action();
    const wait = start + DUR[key] + 0.7 - now();
    if (wait > 0) await sleep(wait * 1000);
  }

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  t0 = Date.now();

  // 0. פתיחה
  await page.evaluate(() => window.card(true));
  await scene('intro', { focus: null, chapter: 'סרטון הסבר' });
  await page.evaluate(() => window.card(false));
  await sleep(700);

  // 1. נרשמים ופותחים שולחן
  await scene('create', { title: 'נרשמים ופותחים שולחן', focus: [0], gone: true }, async () => {
    await typeIn(0, '#name-input', NAMES[0]);
    await tap(0, `#avatar-grid button:nth-child(${AVATAR_IDX[0]})`);
    await tap(0, '#voice-seg button[data-v="m"]');
    await sleep(1200);
    await tap(0, '#btn-main');
  });

  // 2. החברים מצטרפים בקישור
  await scene('lobby', { title: 'מזמינים חברים', focus: [0, 1, 2] }, async () => {
    const link = await ev(0, () => document.querySelector('#share-link').value);
    await Promise.all([1, 2].map((i) => fr(i).goto(link.replace(ORIGINS[0], ORIGINS[i]))));
    // מקלדת אחת לכל הדף – כל אחד בתורו מקליד את השם שלו
    for (const i of [1, 2]) {
      await sleep(500);
      await typeIn(i, '#name-input', NAMES[i]);
      await tap(i, `#avatar-grid button:nth-child(${AVATAR_IDX[i]})`);
      await tap(i, `#voice-seg button[data-v="${VOICES[i]}"]`);
      await tap(i, '#btn-main');
    }
    await fr(2).waitForSelector('#screen-lobby.active', { timeout: 8000 });
    await sleep(1800);
    await tap(0, '#btn-start');
  });

  // ---- מכינים את המשחק: אילו אבנים יש בכל מקום על השולחן ----
  const r = room();
  const g = r.game;
  const plan = [
    ['66', '33', '24', '55', '13', '25', '15'],
    ['36', '56', '44', '34', '14', '35', '23'],
    ['46', '11', '12', '22', '02', '00', '01'],
  ];
  const DRAW_TILE = '06';
  const used = new Set([...plan.flat(), DRAW_TILE]);
  const rest = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) if (!used.has(`${a}${b}`)) rest.push(`${a}${b}`);
  const slots = [...Array(28).keys()].sort(() => Math.random() - 0.5);
  const slotOf = [slots.slice(0, 7), slots.slice(7, 14), slots.slice(14, 21)];
  const drawSlot = slots[21];
  slotOf.forEach((ss, p) => ss.forEach((s, k) => (g.pool[s].tile = T(plan[p][k]))));
  g.pool[drawSlot].tile = T(DRAW_TILE);
  slots.slice(22).forEach((s, k) => (g.pool[s].tile = T(rest[k])));

  // 3. בוחרים אבנים מהשולחן
  await scene('pick', { title: 'בוחרים אבנים מהשולחן', focus: [0, 1, 2] }, async () => {
    await sleep(1200);
    await Promise.all([0, 1, 2].map(async (i) => {
      await sleep(i * 120);
      for (const s of slotOf[i]) {
        try {
          await tap(i, `.pool-tile[data-slot="${s}"]`, { fast: true, after: 160 });
        } catch {
          await ev(i, (x) => emit('game:pick', { slot: x }), s);
        }
      }
    }));
  });

  // 4. פתיחה ב-6:6
  await scene('open', { title: 'מי פותח?', focus: [0] }, async () => {
    await sleep(2500);
    await playTile(0, '66');
  });

  // 5. ניקוד
  await scene('score', { title: 'ספירת נקודות', focus: [1] }, async () => {
    await sleep(1500);
    await playTile(1, '36', 'right');
  });

  // 6. חייבים להגיד!
  await scene('call', { title: 'חייבים להגיד!', focus: [1, 0] }, async () => {
    await sleep(2600);
    await tap(1, '#call-chips button[data-v="3"]');
    await sleep(1600);
    await playTile(2, '46', 'left');
    await sleep(600);
    await playTile(0, '33');
    await tap(0, '#btn-chat');
    await typeIn(0, '#chat-input', '2');
    await fr(0).locator('#chat-input').press('Enter');
    await sleep(1200);
    await tap(0, '#chat-close');
  });

  // 7. הספינר
  await scene('spinner', { title: 'הספינר', focus: [1] }, async () => {
    await sleep(1500);
    await playTile(1, '56', 'up');
    await sleep(900);
    await tap(1, '#call-chips button[data-v="3"]');
  });

  // 8. מושכים מהקופה
  await scene('draw', { title: 'אין מה לשים?', focus: [2] }, async () => {
    await sleep(1800);
    await tap(2, `#pool-layer .pool-tile[data-slot="${drawSlot}"]`);
    await sleep(1500);
    await playTile(2, DRAW_TILE);
  });

  // 9. שכחו להגיד
  await scene('missed', { title: 'שכחת? הלך!', focus: [2, 0] }, async () => {
    await sleep(3200);
    srv.hooks.banter = true;
    r.lastBanter = 0;
    await playTile(0, '24');
    await sleep(400);
    srv.hooks.banter = false;
  });

  // 10. סוף הסיבוב
  await scene('end', { title: 'סוף הסיבוב', focus: [0, 1, 2] }, async () => {
    g.hands = [[T('02')], [T('11'), T('45')], [T('00'), T('12'), T('01')]];
    g.turn = 0;
    g.call = null;
    g.draws = 0;
    g.passes = 0;
    srv.broadcast(r);
    await sleep(2600);
    await playTile(0, '02', 'down');
    await sleep(700);
    await tap(0, '#call-chips button[data-v="3"]');
  });

  // 11. דף הניקוד
  await scene('pad', { title: 'דף הניקוד', focus: [0] }, async () => {
    await sleep(800);
    await ev(0, () => {
      renderPad();
      document.getElementById('pad-modal').hidden = false;
    });
  });
  await ev(0, () => (document.getElementById('pad-modal').hidden = true));
  for (const i of [0, 1, 2]) await tap(i, '#btn-ready', { fast: true });
  await sleep(1500);

  // 12. פרייש
  await scene('freish', { title: 'פרייש', focus: [1] }, async () => {
    await Promise.all([0, 1, 2].map(async (i) => {
      const free = () => ev(i, () => S.game.pool?.map((x, k) => (x.taken ? -1 : k)).filter((k) => k >= 0) || []);
      for (let n = 0; n < 7; n++) {
        const f = await free();
        if (!f.length) break;
        await tap(i, `.pool-tile[data-slot="${f[(i * 3 + n * 5) % f.length]}"]`, { fast: true, after: 60 });
      }
    }));
    await sleep(900);
    await tap(1, '#btn-freish');
    await sleep(1400);
    await tap(0, '#fr-yes');
    await sleep(700);
    await tap(2, '#fr-yes');
    await sleep(2200);
    for (const s of [0, 1, 2]) g.autoPick(s);
    srv.afterAction(r);
  });

  // 13. צ'אט, בדרן, וידאו
  await scene('social', { title: 'כמו ליד השולחן', focus: [0, 1, 2] }, async () => {
    for (const i of [0, 1, 2]) await tap(i, '#btn-cam', { fast: true, after: 300 });
    await sleep(1800);
    await ev(1, () => emit('chat:send', { text: 'מי מזמין קפה אחרי המשחק? ☕' }));
    await sleep(1500);
    await tap(2, '#reactions button:nth-child(7)');
    await sleep(1800);
    srv.hooks.banter = true;
    r.lastBanter = 0;
    const b = srv.banter(r, 'think', 1);
    srv.hooks.banter = false;
    if (b) {
      srv.io.to(r.code).emit('fx', [b]);
      srv.hooks.onFx(r, [b]);
    }
  });

  // 14. ניצחון ב-51
  await scene('win', { title: 'עד 51', focus: [0, 1, 2] }, async () => {
    g.scores = [41, 33, 24];
    g.hands = [[T('55')], [T('66'), T('46')], [T('36'), T('16'), T('05')]];
    g.turn = 0;
    g.required = null;
    g.call = null;
    srv.broadcast(r);
    await sleep(1500);
    await playTile(0, '55');
    await sleep(500);
    await tap(0, '#call-chips button[data-v="2"]');
  });
  await sleep(2500);

  // 15. סיום
  await page.evaluate(() => window.card(true, 'שולחים קישור לחברים · מתחילים לשחק', 'Music: "Life of Riley" by Kevin MacLeod (incompetech.com) · Licensed under CC BY 4.0'));
  await scene('outro', { focus: null, chapter: 'בהצלחה!' });
  await sleep(1200);
  const total = now();
  await cdp.send('Page.stopScreencast');
  await sleep(500);
  await browser.close();

  // ---- הרכבה ----
  console.log(`recorded ${total.toFixed(1)}s, ${frames.length} frames, ${cues.length} audio cues`);
  const list = ['ffconcat version 1.0'];
  const pts = frames.map((f) => Math.max(0, (f.t - t0) / 1000));
  for (let i = 0; i < frames.length; i++) {
    const start = i === 0 ? 0 : pts[i];
    const end = i + 1 < frames.length ? pts[i + 1] : total;
    list.push(`file '${frames[i].f}'`, `duration ${Math.max(0.001, end - start).toFixed(4)}`);
  }
  list.push(`file '${frames[frames.length - 1].f}'`);
  fs.writeFileSync(path.join(OUT, 'frames.txt'), list.join('\n'));
  const silent = path.join(OUT, 'video-only.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', silent], { stdio: 'inherit' });

  // אודיו: קריינות + צלילי משחק + אווירת בית קפה
  const valid = cues.filter((c) => fs.existsSync(c.file) && c.t >= 0 && c.t < total);
  const args = ['-y', '-loglevel', 'error'];
  valid.forEach((c) => args.push('-i', c.file));
  // מוזיקת רקע: "Life of Riley" – Kevin MacLeod (incompetech.com), רישיון CC BY 4.0
  const MUSIC = path.join(OUT, 'music.mp3');
  args.push('-i', MUSIC);
  const fl = valid.map((c, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${c.vol},adelay=${Math.round(c.t * 1000)}|${Math.round(c.t * 1000)}[a${i}]`);
  // שלושה ערוצים: קריינות, צלילי משחק, מוזיקה. המוזיקה "מתכופפת" אוטומטית כשהקריין מדבר.
  const isVO = (c) => c.file.includes(`${path.sep}vo${path.sep}`);
  const vo = valid.map((c, i) => (isVO(c) ? `[a${i}]` : '')).join('');
  const fx = valid.map((c, i) => (isVO(c) ? '' : `[a${i}]`)).join('');
  const nVO = valid.filter(isVO).length;
  const mus = valid.length;
  fl.push(`${vo}amix=inputs=${nVO}:normalize=0:dropout_transition=0,asplit=2[vo][vokey]`);
  fl.push(`${fx}amix=inputs=${valid.length - nVO}:normalize=0:dropout_transition=0[fx]`);
  fl.push(`[${mus}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.42,afade=t=in:d=1.2,afade=t=out:st=${(total - 4).toFixed(2)}:d=4[m0]`);
  fl.push(`[m0][vokey]sidechaincompress=threshold=0.015:ratio=9:attack=25:release=700:makeup=1[music]`);
  fl.push(`[vo][fx][music]amix=inputs=3:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[mix]`);
  fs.writeFileSync(path.join(OUT, 'filter.txt'), fl.join(';\n'));
  const audio = path.join(OUT, 'audio.m4a');
  args.push('-filter_complex_script', path.join(OUT, 'filter.txt'), '-map', '[mix]', '-t', total.toFixed(2), '-c:a', 'aac', '-b:a', '192k', audio);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  const final = path.join(OUT, 'domino-yossi-explainer.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', audio, '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' });
  console.log('DONE', final);
  process.exit(0);
})().catch(async (e) => {
  console.error(e.message);
  try {
    const page = globalThis.__page;
    await page.screenshot({ path: '/tmp/claude-0/vid/fail.png' });
    for (const f of page.frames().slice(1)) console.log(f.url(), JSON.stringify(await f.evaluate(() => ({ screen: document.querySelector('.screen.active')?.id, st: S.game?.state, mySeat: S.game?.mySeat, hand: S.game?.hand?.length, poolTiles: document.querySelectorAll('.pool-tile').length, role: S.room?.role }))));
  } catch (x) { console.error('diag failed', x.message); }
  process.exit(1);
});
