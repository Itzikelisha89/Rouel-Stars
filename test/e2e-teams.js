// 4 שחקנים בזוגות: שחקן עוזב באמצע (המחשב ממשיך), שחקן מרענן (חוזר לכיסא), משחקים עד הסוף.
'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3123';
const OUT = process.argv[2] || '.';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: i === 0 ? { width: 390, height: 844 } : { width: 900, height: 700 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`p${i}: ${e.message}`));
    pages.push(p);
  }
  const names = ['איציק', 'רונית', 'אבי', 'שושנה'];
  await pages[0].goto(BASE);
  await pages[0].fill('#name-input', names[0]);
  await pages[0].click('#btn-main');
  await pages[0].waitForSelector('#screen-lobby.active');
  const link = await pages[0].inputValue('#share-link');
  for (let i = 1; i < 4; i++) {
    await pages[i].goto(link);
    await pages[i].fill('#name-input', names[i]);
    await pages[i].click('#btn-main');
    await pages[i].waitForSelector('#screen-lobby.active');
  }
  await pages[0].click('#set-teams button[data-v="1"]');
  await pages[0].click('#set-target button[data-v="100"]');
  await pages[0].waitForTimeout(300);
  await pages[0].screenshot({ path: `${OUT}/t1-lobby-teams.png` });
  await pages[0].click('#btn-start');
  await pages[0].waitForSelector('#screen-game.active');

  const act = async (p) =>
    p.evaluate(async () => {
      const g = S.game;
      if (!g) return 'none';
      if (g.state === 'gameOver') return 'over';
      if (g.state === 'handOver') {
        if (!g.ready.includes(g.mySeat)) await emit('game:ready');
        return 'ready';
      }
      if (g.turn !== g.mySeat) return 'wait';
      if (g.canDraw) await emit('game:draw');
      else if (g.canPass) await emit('game:pass');
      else {
        const m = [...g.moves].sort((a, b) => b.score - a.score)[0];
        await emit('game:play', { tileId: m.tileId, end: m.end });
      }
      return 'acted';
    });

  let steps = 0, left = false, reloaded = false, over = false;
  while (!over && steps < 3000) {
    steps++;
    if (steps === 15 && !left) {
      left = true;
      await pages[3].evaluate(() => { window.confirm = () => true; leaveRoom(); });
      console.log('player 4 left mid-game');
    }
    if (steps === 30 && !reloaded) {
      reloaded = true;
      await pages[1].reload();
      await pages[1].waitForSelector('#screen-game.active', { timeout: 10000 });
      const seat = await pages[1].evaluate(() => S.game.mySeat);
      console.log('player 2 reloaded, back in seat', seat);
    }
    let any = false;
    for (let i = 0; i < 3; i++) {
      const r = await act(pages[i]);
      if (r === 'over') over = true;
      if (r === 'acted' || r === 'ready') any = true;
    }
    if (!any) await pages[0].waitForTimeout(150);
  }
  await pages[0].waitForTimeout(2000);
  await pages[0].screenshot({ path: `${OUT}/t2-game-over-mobile.png` });
  await pages[2].screenshot({ path: `${OUT}/t3-game-over-tablet.png` });
  const res = await pages[0].evaluate(() => ({ state: S.game.state, scores: S.game.scores, winner: S.game.winnerSide, hands: S.game.handNo, p4: S.room.players[3] }));
  console.log('result', JSON.stringify(res));
  // משחק חוזר: מכיוון ששחקן עזב – חוזרים ללובי
  await pages[0].evaluate(() => emit('game:rematch'));
  await pages[0].waitForSelector('#screen-lobby.active');
  console.log('back to lobby with', await pages[0].evaluate(() => S.room.players.length), 'players');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
