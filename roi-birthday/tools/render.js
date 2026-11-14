// מרנדר את הסרט פריים-פריים בכרום (Playwright) ומקודד ל-MP4 עם ffmpeg.
// שימוש:
//   node tools/render.js                 -> build/ROI_DROR_4K.mp4 + build/ROI_DROR_FullHD.mp4
//   node tools/render.js --hd            -> רק Full HD (מהיר יותר)
//   node tools/render.js --stills 5,30.5 -> תמונות בדיקה ל-build/stills
//   --workers N   --from S --to S (קטע בלבד, לבדיקות)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const B = path.join(ROOT, 'build');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const HD = args.includes('--hd');
const FPS = 30;
const [WIDTH, HEIGHT] = HD ? [1080, 1920] : [2160, 3840];
const WORKERS = +opt('--workers', 4);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav' };
function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

async function openPage(browser, port, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?render=1&w=${w}&h=${h}`);
  const total = await page.waitForFunction(() => window.FILM_READY, null, { timeout: 60000 }).then((h_) => h_.jsonValue());
  return { page, total };
}
const shot = (page, w, h, type = 'jpeg') => page.screenshot({ type, quality: type === 'jpeg' ? 93 : undefined, clip: { x: 0, y: 0, width: w, height: h } });

async function main() {
  const server = await serve(); const port = server.address().port;
  const browser = await chromium.launch({ args: ['--disable-web-security', '--font-render-hinting=none'] });
  try {
    if (args.includes('--stills')) {
      const times = opt('--stills').split(',').map(Number);
      const w = +opt('--w', 1080), h = Math.round(w * 16 / 9);
      const { page } = await openPage(browser, port, w, h);
      fs.mkdirSync(path.join(B, 'stills'), { recursive: true });
      for (const t of times) {
        await page.evaluate((tt) => { try { return window.frameAt(tt); } catch (e) { throw new Error(e.stack); } }, t);
        fs.writeFileSync(path.join(B, 'stills', `t${String(t).padStart(6, '0')}.jpg`), await shot(page, w, h));
      }
      console.log('stills ->', path.join(B, 'stills'));
      return;
    }
    const probe = await openPage(browser, port, 180, 320); const total = probe.total; await probe.page.close();
    const from = +opt('--from', 0), to = Math.min(total, +opt('--to', total));
    const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS), nF = f1 - f0;
    const tag = HD ? 'FullHD' : '4K';
    const segDir = path.join(B, 'seg'); fs.rmSync(segDir, { recursive: true, force: true }); fs.mkdirSync(segDir, { recursive: true });
    const per = Math.ceil(nF / WORKERS);
    console.log(`rendering ${nF} frames (${(nF / FPS).toFixed(1)}s) at ${WIDTH}x${HEIGHT} with ${WORKERS} workers`);
    let done = 0; const tStart = Date.now();
    const tick = setInterval(() => {
      const el = (Date.now() - tStart) / 1000, r = done / el;
      process.stdout.write(`  ${done}/${nF} frames  ${r.toFixed(1)} fps  ETA ${r ? Math.round((nF - done) / r) : '?'}s\n`);
    }, 15000);
    await Promise.all(Array.from({ length: WORKERS }, async (_, k) => {
      const a = f0 + k * per, b = Math.min(f1, a + per); if (a >= b) return;
      const { page } = await openPage(browser, port, WIDTH, HEIGHT);
      const out = path.join(segDir, `s${k}.mp4`);
      const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', HD ? 'medium' : 'fast', '-crf', HD ? '17' : '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
      const closed = new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error('ffmpeg ' + c)) : r())));
      for (let f = a; f < b; f++) {
        await page.evaluate((tt) => window.frameAt(tt), f / FPS);
        const buf = await shot(page, WIDTH, HEIGHT);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        done++;
      }
      ff.stdin.end(); await closed; await page.close();
    }));
    clearInterval(tick);
    console.log(`frames done in ${Math.round((Date.now() - tStart) / 1000)}s – muxing`);
    const list = path.join(segDir, 'list.txt');
    fs.writeFileSync(list, Array.from({ length: WORKERS }, (_, k) => `file 's${k}.mp4'`).filter((_, k) => fs.existsSync(path.join(segDir, `s${k}.mp4`))).join('\n'));
    const suffix = from || to < total ? `_${from}-${to}` : '';
    const final = path.join(B, `ROI_DROR_${tag}${suffix}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ss', String(from), '-t', String(to - from), '-i', path.join(B, 'soundtrack.wav'),
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-shortest', final]);
    console.log('->', final);
    if (!HD && !suffix) {
      const hd = path.join(B, 'ROI_DROR_FullHD.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', final, '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', hd]);
      console.log('->', hd);
    }
  } finally { await browser.close(); server.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
