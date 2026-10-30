// בדיקת קצה-לקצה: 3 דפדפנים, יצירת שולחן, הצטרפות בקישור, צ'אט ומשחק אמיתי דרך הממשק.
// הרצה: PORT=3123 node server.js & ; node test/e2e.js [screenshots-dir]
'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3123';
const OUT = process.argv[2] || '.';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
    return page;
  };
  const host = await mk(390, 844);
  const p2 = await mk(1280, 800);
  const p3 = await mk(390, 844);

  await host.goto(BASE);
  await host.screenshot({ path: `${OUT}/01-home.png` });
  await host.fill('#name-input', 'איציק');
  await host.click('#avatar-grid button:nth-child(12)');
  await host.click('#btn-main');
  await host.waitForSelector('#screen-lobby.active');
  const link = await host.inputValue('#share-link');
  console.log('link:', link);

  for (const [p, name, av] of [[p2, 'דנה', 3], [p3, 'מושיקו', 14]]) {
    await p.goto(link);
    await p.waitForSelector('#invite-card:not([hidden])');
    await p.fill('#name-input', name);
    await p.click(`#avatar-grid button:nth-child(${av})`);
    await p.click('#btn-main');
    await p.waitForSelector('#screen-lobby.active');
  }
  await host.waitForTimeout(300);
  await host.screenshot({ path: `${OUT}/02-lobby.png` });

  // צ'אט
  await p2.fill('#chat-input', 'שלום לכולם! מי מוכן להפסיד? 😄');
  await p2.press('#chat-input', 'Enter');
  await host.waitForTimeout(400);

  await host.click('#btn-start');
  for (const p of [host, p2, p3]) await p.waitForSelector('#screen-game.active');
  await host.waitForTimeout(800);
  await host.screenshot({ path: `${OUT}/03-game-start-host.png` });

  const pages = [host, p2, p3];
  let turns = 0;
  let freishDone = false;
  let lastShot = 0;
  for (let i = 0; i < 400 && turns < 40; i++) {
    let acted = false;
    for (const p of pages) {
      const state = await p.evaluate(() => {
        const g = S.game;
        if (!g) return null;
        return { state: g.state, mine: g.state === 'playing' && g.turn === g.mySeat && !g.freish, moves: g.moves, canDraw: g.canDraw, canPass: g.canPass, ready: g.mySeat >= 0 && g.ready.includes(g.mySeat), needPick: g.state === 'picking' && g.hand.length < g.handSize, freishVote: !!g.freish && !(g.mySeat in g.freish.votes), canFreish: g.canFreish, hand: g.handNo };
      });
      if (!state) continue;
      // בוחרים אבן מהשולחן (לחיצה אמיתית על אבן הפוכה)
      if (state.needPick) {
        const tiles = await p.$$('.pool-tile.can:not(.taking)');
        if (tiles.length) {
          if (!(await p.evaluate(() => window.__shotPick))) {
            await p.evaluate(() => (window.__shotPick = 1));
            await p.screenshot({ path: `${OUT}/12-pick-from-table.png` });
          }
          await tiles[Math.floor(Math.random() * tiles.length)].click({ force: true }).catch(() => {});
          acted = true;
          await p.waitForTimeout(120);
        }
        continue;
      }
      if (state.freishVote) {
        await p.waitForSelector('#fr-yes', { timeout: 4000 }).catch(() => {});
        if (!(await p.evaluate(() => window.__shotFreish))) {
          await p.evaluate(() => (window.__shotFreish = 1));
          await p.screenshot({ path: `${OUT}/13-freish-vote.png` });
        }
        await p.click('#fr-yes').catch(() => {});
        acted = true;
        continue;
      }
      // פרייש פעם אחת: המארח מבקש ביד הראשונה
      if (p === host && state.canFreish && state.hand === 1 && !freishDone) {
        freishDone = true;
        await p.click('#btn-freish');
        acted = true;
        continue;
      }
      if (state.state === 'handOver' && !state.ready) {
        await p.waitForSelector('#btn-ready', { timeout: 5000 }).catch(() => {});
        if (turns - lastShot > 0) {
          await p.screenshot({ path: `${OUT}/05-hand-over.png` });
          lastShot = turns;
        }
        await p.click('#btn-ready').catch(() => {});
        acted = true;
        continue;
      }
      if (state.state === 'gameOver') {
        await p.waitForTimeout(1500);
        await p.screenshot({ path: `${OUT}/06-game-over.png` });
        turns = 999;
        break;
      }
      if (!state.mine) continue;
      acted = true;
      if (state.canDraw) {
        await p.waitForSelector('#pool-layer .pool-tile.can', { timeout: 4000 });
        if (!(await p.evaluate(() => window.__shotDraw))) {
          await p.evaluate(() => (window.__shotDraw = 1));
          await p.screenshot({ path: `${OUT}/14-draw-from-pile.png` });
        }
        await p.click('#pool-layer .pool-tile.can', { force: true });
      } else if (state.canPass) {
        await p.click('#btn-pass');
      } else {
        const m = state.moves.sort((a, b) => b.score - a.score)[0];
        const ends = new Set(state.moves.filter((x) => x.tileId === m.tileId).map((x) => x.end));
        const idx = await p.evaluate((id) => S.handOrder.indexOf(id), m.tileId);
        await p.click(`#hand .ht:nth-child(${idx + 1})`, { force: true });
        if (ends.size > 1) {
          await p.waitForSelector(`.ghost[data-tile="${m.tileId}"][data-end="${m.end}"]`);
          if (turns >= 6 && !(await p.evaluate(() => window.__shotGhost))) {
            await p.evaluate(() => (window.__shotGhost = 1));
            await p.screenshot({ path: `${OUT}/04-choose-end.png` });
          }
          await p.dispatchEvent(`.ghost[data-tile="${m.tileId}"][data-end="${m.end}"]`, 'click');
        }
        turns++;
        // הכרזה: בדרך כלל דרך הכפתור, לפעמים בצ'אט, ולפעמים "שוכחים"
        if (m.score) {
          await p.waitForSelector('#call-bar:not([hidden])', { timeout: 5000 });
          if (turns === 3 || !(await p.evaluate(() => window.__shotCall))) {
            await p.evaluate(() => (window.__shotCall = 1));
            await p.screenshot({ path: `${OUT}/10-call-bar.png` });
          }
          const mode = turns % 5;
          if (mode === 1) {
            await p.fill('#chat-input', `${m.count}!`);
            await p.press('#chat-input', 'Enter');
          } else if (mode !== 4) {
            await p.click(`#call-chips button[data-v="${m.count}"]`, { force: true });
          }
          await p.waitForTimeout(300);
        }
      }
      await p.waitForTimeout(250);
    }
    if (!acted) await host.waitForTimeout(200);
  }
  await host.waitForTimeout(800);
  await host.screenshot({ path: `${OUT}/07-host-mid.png` });
  await p2.screenshot({ path: `${OUT}/08-desktop.png` });
  await p3.evaluate(() => openChat(true));
  await p3.waitForTimeout(400);
  await p3.screenshot({ path: `${OUT}/09-chat-mobile.png` });

  const log = await host.evaluate(() => [...document.querySelectorAll('.msg.sys')].map((e) => e.textContent));
  console.log('freish happened:', log.some((t) => t.includes('כולם הסכימו')));
  console.log('calls ok:', log.filter((t) => t.includes('✓')).length, '| forgot:', log.filter((t) => t.includes('🤐')).length);
  await host.evaluate(() => { renderPad(); document.getElementById('pad-modal').hidden = false; });
  await host.waitForTimeout(300);
  await host.screenshot({ path: `${OUT}/11-score-pad.png` });
  const summary = await host.evaluate(() => ({ hand: S.game.handNo, scores: S.game.scores, placed: S.boardIds.size, state: S.game.state }));
  console.log('turns played via UI:', turns, summary);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
