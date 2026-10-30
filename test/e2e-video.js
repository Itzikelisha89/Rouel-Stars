// וידאו וקול בין שני שחקנים (מצלמה מדומה של כרומיום)
'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3123';
const OUT = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const a = await mk(), b = await mk();
  await a.goto(BASE); await a.fill('#name-input', 'איציק'); await a.click('#btn-main');
  await a.waitForSelector('#screen-lobby.active');
  const link = await a.inputValue('#share-link');
  await b.goto(link); await b.fill('#name-input', 'דנה'); await b.click('#voice-seg button[data-v="f"]'); await b.click('#btn-main');
  await b.waitForSelector('#screen-lobby.active');
  await a.click('#btn-start');
  await a.waitForSelector('#screen-game.active'); await b.waitForSelector('#screen-game.active');
  await a.click('#btn-cam');
  await b.click('#btn-cam');
  const live = (p) => p.waitForFunction(() => {
    const v = document.querySelector('#slot-top .avatar-ring video.cam');
    return v && v.videoWidth > 0 && !v.paused;
  }, null, { timeout: 20000 });
  await Promise.all([live(a), live(b)]);
  await a.waitForTimeout(1500);
  await a.screenshot({ path: `${OUT}/15-video.png` });
  console.log('video both ways: ok');
  await b.click('#btn-mic');
  await a.waitForSelector('#slot-top .mic-off', { timeout: 5000 });
  console.log('mute indicator: ok');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
