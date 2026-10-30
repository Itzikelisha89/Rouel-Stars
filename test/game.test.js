'use strict';
const assert = require('assert');
const { Game, boardCount, openEnds, placeOn, emptyBoard, round5, toPoints, TARGET } = require('../game');

const T = (a, b) => ({ id: `${Math.min(a, b)}${Math.max(a, b)}`, a, b });

// --- ספירת קצוות ---
{
  const b = emptyBoard();
  placeOn(b, T(5, 5), 'center');
  assert.strictEqual(boardCount(b), 10, 'כפולה בודדת נספרת כולה');
  placeOn(b, T(5, 0), 'right');
  assert.strictEqual(boardCount(b), 10, 'ספינר עם צד פתוח נספר כפול');
  assert.strictEqual(openEnds(b).length, 2, 'ספינר נפתח לארבעה צדדים רק אחרי שני הצדדים');
  placeOn(b, T(5, 3), 'left');
  assert.strictEqual(boardCount(b), 3, '3 + 0, הספינר כבר לא קצה');
  assert.strictEqual(openEnds(b).length, 4);
  placeOn(b, T(5, 2), 'up');
  assert.strictEqual(boardCount(b), 5);
  placeOn(b, T(2, 2), 'up');
  assert.strictEqual(boardCount(b), 7, 'כפולה בקצה נספרת כפול: 3+0+4');
}
{
  const b = emptyBoard();
  placeOn(b, T(6, 4), 'center');
  assert.strictEqual(boardCount(b), 10);
  placeOn(b, T(4, 4), 'right');
  assert.deepStrictEqual(b.spinner, { arm: 'right', index: 0 }, 'הכפולה הראשונה הופכת לספינר');
  assert.strictEqual(boardCount(b), 14);
  placeOn(b, T(4, 1), 'right');
  assert.strictEqual(openEnds(b).length, 4);
  assert.strictEqual(boardCount(b), 7);
}
assert.strictEqual(round5(12), 10);
assert.strictEqual(round5(13), 15);
assert.strictEqual(toPoints(15), 3, '15 על הלוח = 3 נקודות');
assert.strictEqual(toPoints(14), 0);
assert.strictEqual(TARGET, 51);
// סוף יד: נשאר ליריבים 20 → 4 נקודות, 23 → 25 → 5 נקודות
for (const [left, pts] of [[20, 4], [23, 5], [22, 4], [3, 1], [2, 0]]) {
  const game = new Game({ players: 2 });
  const winner = game.turn;
  const loser = 1 - winner;
  game.hands[winner] = [];
  game.hands[loser] = [{ id: 'x', a: Math.min(6, left), b: left - Math.min(6, left) }];
  if (left > 12) game.hands[loser] = [{ id: 'x', a: 6, b: 6 }, { id: 'y', a: left - 12, b: 0 }];
  const before = game.scores[winner];
  game.endHand(winner);
  assert.strictEqual(game.scores[winner] - before, pts, `נשאר ${left} → ${pts} נקודות`);
}

// --- סימולציה: אלפי משחקים אקראיים, בדיקת שמירת אבנים וחוקיות ---
for (const [n, teams] of [[2, false], [3, false], [4, false], [4, true]]) {
  for (let g = 0; g < 400; g++) {
    const game = new Game({ players: n, teams });
    if (game.handNo === 1 && n === 4) assert.ok(game.hands[game.starter].some((t) => t.id === '66') && game.required === '66', 'בארבעה תמיד 6:6 פותח');
    if (n === 4) assert.strictEqual(game.boneyard.length, 0);
    if (n < 4 && !game.hands.some((h) => h.some((t) => t.id === '66'))) assert.ok(game.required === '55' || !game.hands.some((h) => h.some((t) => t.id === '55')), 'בלי 6:6 – פותח 5:5');
    let guard = 0;
    let overEv = null;
    while (game.state !== 'gameOver') {
      if (++guard > 5000) throw new Error('לולאה אינסופית');
      if (game.state === 'handOver') {
        game.startHand();
        continue;
      }
      const placed = 1 + ['left', 'right', 'up', 'down'].reduce((s, k) => s + game.board.arms[k].length, 0);
      const total = game.hands.reduce((s, h) => s + h.length, 0) + game.boneyard.length + (game.board.center ? placed : 0);
      assert.strictEqual(total, 28, 'מספר האבנים נשמר');
      const seat = game.turn;
      const moves = game.movesFor(seat);
      if (moves.length) {
        const m = moves[Math.floor(Math.random() * moves.length)];
        const side = game.sideOf(seat);
        const before = game.scores[side];
        const lastTile = game.hands[seat].length === 1;
        game.play(seat, m.tileId, m.end);
        assert.strictEqual(game.scores[side], before, 'הנקודות לא נכנסות בלי הכרזה');
        assert.strictEqual(game.state, lastTile ? 'closing' : 'playing', 'לא עוצרים באמצע סיבוב');
        // שחקן מכריז נכון / טועה / שוכח
        const r = Math.random();
        if (r < 0.6) {
          game.callPoints(seat, m.count);
          assert.strictEqual(game.scores[side] - before, m.score);
        } else if (r < 0.7) {
          game.callPoints(seat, m.count + 5);
          assert.strictEqual(game.scores[side], before, 'הכרזה שגויה – אין נקודות');
        }
        if (game.state === 'closing') game.closeHand();
      } else if (game.boneyard.length) {
        assert.throws(() => game.pass(seat));
        game.draw(seat);
      } else {
        game.pass(seat);
      }
      for (const e of game.drainEvents()) if (e.type === 'gameOver') overEv = e;
    }
    assert.ok(game.scores[game.winnerSide] >= 51);
    assert.strictEqual(overEv.winSide, game.winnerSide, 'אירוע סוף המשחק מציין את המנצח הנכון');
    assert.ok(game.scores.every((s, i) => i === game.winnerSide || s < game.scores[game.winnerSide]), 'המנצח הוא המוביל');
  }
}

// --- חובה להכריז ---
{
  const setup = () => {
    const game = new Game({ players: 2 });
    const me = game.turn, other = 1 - me;
    game.required = null;
    game.hands[me] = [{ id: '55', a: 5, b: 5 }, { id: '01', a: 0, b: 1 }];
    game.hands[other] = [{ id: '56', a: 5, b: 6 }, { id: '33', a: 3, b: 3 }];
    game.boneyard = [];
    return { game, me, other };
  };
  { // שכחתי להגיד, היריב התחיל → הנקודות הלכו
    const { game, me, other } = setup();
    game.play(me, '55', 'center');
    game.play(other, '56', 'right');
    assert.throws(() => game.callPoints(me, 10), 'מאוחר מדי');
    assert.strictEqual(game.scores[me], 0);
    assert.ok(game.drainEvents().some((e) => e.type === 'missed' && e.seat === me && e.points === 2));
  }
  { // אמרתי בזמן → 10 = 2 נקודות
    const { game, me } = setup();
    game.play(me, '55', 'center');
    assert.strictEqual(game.callPoints(me, 10), 2);
    assert.strictEqual(game.scores[me], 2);
    assert.throws(() => game.callPoints(me, 10), 'אי אפשר להכריז פעמיים');
  }
  { // היריב לא יכול להכריז במקומי
    const { game, me, other } = setup();
    game.play(me, '55', 'center');
    assert.throws(() => game.callPoints(other, 10));
  }
  { // גם שליפה של היריב סוגרת את ההכרזה
    const { game, me, other } = setup();
    game.hands[other] = [{ id: '33', a: 3, b: 3 }];
    game.boneyard = [{ id: '44', a: 4, b: 4 }];
    game.play(me, '55', 'center');
    game.draw(other);
    assert.throws(() => game.callPoints(me, 10));
  }
}

// --- אכיפת חוקים ---
{
  const game = new Game({ players: 2 });
  const other = 1 - game.turn;
  assert.throws(() => game.play(other, game.hands[other][0].id, 'center'), /התור/);
  const wrong = game.hands[game.turn].find((t) => t.id !== game.required);
  assert.throws(() => game.play(game.turn, wrong.id, 'center'), 'חייבים לפתוח בכפולה הגבוהה');
  game.play(game.turn, game.required, 'center');
}

console.log('✓ כל בדיקות המנוע עברו');
