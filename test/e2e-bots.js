// שחקן אחד + 3 שחקני מחשב (משלימים ל-4, בזוגות) – משחק שלם עד הסוף
'use strict';
const { chromium, webkit } = require('playwright');
const BT = process.env.BROWSER === 'webkit' ? webkit : chromium; // webkit = כמו באייפון
const BASE = process.env.BASE || 'http://localhost:3123';
const OUT = process.argv[2] || '.';
(async () => {
  const browser = await BT.launch();
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE);
  await p.fill('#name-input', 'יוסי');
  await p.click('#btn-main');
  await p.waitForSelector('#screen-lobby.active');
  for (let i = 0; i < 3; i++) {
    await p.click('.seat-card .add-bot');
    await p.waitForFunction((n) => S.room.players.length === n, i + 2);
  }
  await p.click('#set-teams button[data-v="1"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/b1-lobby-bots.png` });
  await p.click('#btn-start');
  await p.waitForSelector('#screen-game.active');
  const t0 = Date.now();
  let shot = false;
  for (;;) {
    if (Date.now() - t0 > 600000) throw new Error('timeout');
    const r = await p.evaluate(async () => {
      const g = S.game;
      if (g.state === 'gameOver') return 'over';
      if (g.state === 'picking') {
        if (g.hand.length < g.handSize) {
          const f = g.pool.map((x, i) => (x.taken ? -1 : i)).filter((i) => i >= 0);
          await emit('game:pick', { slot: f[0] });
        }
        return 'pick';
      }
      if (g.state === 'handOver') {
        if (!g.ready.includes(g.mySeat)) await emit('game:ready');
        return 'ready';
      }
      if (g.state !== 'playing' || g.turn !== g.mySeat) return 'wait';
      if (g.canDraw) await emit('game:draw', {});
      else if (g.canPass) await emit('game:pass');
      else {
        const m = [...g.moves].sort((a, b) => b.score - a.score)[0];
        await emit('game:play', { tileId: m.tileId, end: m.end });
        if (m.score) await emit('game:call', { value: m.score });
      }
      return 'acted';
    });
    if (r === 'over') break;
    if (!shot && r === 'wait') {
      const onBoard = await p.evaluate(() => S.boardIds.size);
      if (onBoard >= 5) {
        shot = true;
        await p.screenshot({ path: `${OUT}/b2-vs-bots.png` });
      }
    }
    await p.waitForTimeout(r === 'wait' ? 300 : 100);
  }
  const res = await p.evaluate(() => ({ scores: S.game.scores, winner: S.game.winnerSide, hands: S.game.handNo, botCalls: [...document.querySelectorAll('.msg.sys')].filter((e) => /דוד|רחל|שלמה/.test(e.textContent) && e.textContent.includes('✓')).length }));
  console.log('game over in', ((Date.now() - t0) / 1000).toFixed(0), 's', JSON.stringify(res));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
