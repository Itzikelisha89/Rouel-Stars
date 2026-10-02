const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const FPS = 30;
const [mode, ...names] = process.argv.slice(2); // mode: preview | video
const OUT = process.env.OUT || path.join(__dirname, 'out');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'engine.html'));
  await page.evaluate(() => document.fonts.ready);
  for (const name of names) {
    const total = await page.evaluate(n => build(n), name);
    await page.evaluate(() => document.fonts.ready);
    if (mode === 'preview') {
      const times = (process.env.TIMES || '').split(',').filter(Boolean).map(Number);
      for (const t of times) {
        await page.evaluate(t => render(t), t);
        await page.screenshot({ path: `${OUT}/prev-${name}-${t}.png` });
      }
      console.log(name, 'total', total);
      continue;
    }
    const frames = Math.round(total * FPS);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      `${OUT}/${name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < frames; i++) {
      await page.evaluate(t => render(t), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    console.log(name, frames, 'frames done');
  }
  await browser.close();
})();
