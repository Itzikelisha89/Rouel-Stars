'use strict';
const assert = require('assert');
const { Game, boardCount, openEnds, placeOn, emptyBoard, round5 } = require('../game');

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

// --- סימולציה: אלפי משחקים אקראיים, בדיקת שמירת אבנים וחוקיות ---
for (const [n, teams] of [[2, false], [3, false], [4, false], [4, true]]) {
  for (let g = 0; g < 400; g++) {
    const game = new Game({ players: n, target: 150, teams });
    let guard = 0;
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
        const before = game.scores[game.sideOf(seat)];
        game.play(seat, m.tileId, m.end);
        assert.strictEqual(game.scores[game.sideOf(seat)] - before >= m.score, true);
      } else if (game.boneyard.length) {
        assert.throws(() => game.pass(seat));
        game.draw(seat);
      } else {
        game.pass(seat);
      }
      game.drainEvents();
    }
    assert.ok(game.scores[game.winnerSide] >= 150);
    assert.ok(game.scores.every((s) => s % 5 === 0), 'כל הניקוד בכפולות של 5');
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
