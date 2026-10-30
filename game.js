'use strict';
// מנוע המשחק: דומינו "חמישיות" (All Fives / Muggins)
// השרת הוא הסמכות היחידה – הלקוח רק מציג ושולח בקשות.

const crypto = require('crypto');

// כל שחקן מקבל 7. בארבעה מחלקים את כל 28 האבנים, ולכן 6:6 תמיד אצל מישהו.
const HAND_SIZE = { 2: 7, 3: 7, 4: 7 };
const TARGET = 51;
// כל 5 בסכום הקצוות = נקודה אחת (15 על הלוח = 3 נקודות)
const toPoints = (sum) => (sum > 0 && sum % 5 === 0 ? sum / 5 : 0);
const ENDS = ['left', 'right', 'up', 'down'];

function fullSet() {
  const set = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push({ id: `${a}${b}`, a, b });
  return set;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const round5 = (n) => Math.round(n / 5) * 5;
const isDouble = (t) => t.a === t.b;
const pipsOf = (hand) => hand.reduce((s, t) => s + t.a + t.b, 0);

function emptyBoard() {
  return { center: null, arms: { left: [], right: [], up: [], down: [] }, spinner: null };
}

// ספינר = הכפולה הראשונה שהונחה. אפשר לשחק על ארבעת צדדיו רק אחרי ששני הצדדים הרגילים שלו תפוסים.
function spinnerOpen(board) {
  const s = board.spinner;
  if (!s) return false;
  if (s.arm === 'center') return board.arms.left.length > 0 && board.arms.right.length > 0;
  return board.arms[s.arm].length > s.index + 1;
}

function openEnds(board) {
  if (!board.center) return null;
  const tip = (arm, fallback) => {
    const list = board.arms[arm];
    return list.length ? list[list.length - 1].b : fallback;
  };
  const ends = [
    { end: 'left', value: tip('left', board.center.l) },
    { end: 'right', value: tip('right', board.center.r) },
  ];
  if (spinnerOpen(board)) {
    const s = board.spinner;
    const v = s.arm === 'center' ? board.center.l : board.arms[s.arm][s.index].b;
    ends.push({ end: 'up', value: tip('up', v) }, { end: 'down', value: tip('down', v) });
  }
  return ends;
}

// סכום הקצוות הפתוחים. כפולה בקצה נספרת פעמיים.
function boardCount(board) {
  const c = board.center;
  if (!c) return 0;
  const A = board.arms;
  if (!A.left.length && !A.right.length) return c.l + c.r;
  const tipVal = (t) => (t.a === t.b ? t.a * 2 : t.b);
  let sum = 0;
  for (const side of ['left', 'right']) {
    const arm = A[side];
    if (arm.length) sum += tipVal(arm[arm.length - 1]);
    else sum += c.l === c.r ? c.l * 2 : side === 'left' ? c.l : c.r;
  }
  for (const side of ['up', 'down']) if (A[side].length) sum += tipVal(A[side][A[side].length - 1]);
  return sum;
}

function placeOn(board, tile, end) {
  if (end === 'center') {
    board.center = { id: tile.id, l: tile.a, r: tile.b };
    if (isDouble(tile)) board.spinner = { arm: 'center', index: 0 };
    return;
  }
  const e = openEnds(board).find((x) => x.end === end);
  const a = e.value;
  const b = tile.a === a ? tile.b : tile.a;
  board.arms[end].push({ id: tile.id, a, b });
  if (isDouble(tile) && !board.spinner) board.spinner = { arm: end, index: board.arms[end].length - 1 };
}

class Game {
  constructor({ players, target = TARGET, teams = false }) {
    this.n = players;
    this.target = target;
    this.teams = !!teams && players === 4;
    this.scores = new Array(this.sides).fill(0);
    this.handNo = 0;
    this.nextStarter = null;
    this.events = [];
    this.winnerSide = null;
    this.startHand();
  }

  get sides() {
    return this.teams ? 2 : this.n;
  }

  sideOf(seat) {
    return this.teams ? seat % 2 : seat;
  }

  startHand() {
    this.handNo++;
    const size = HAND_SIZE[this.n];
    let hands, boneyard, starter, required = null;
    for (;;) {
      const set = shuffle(fullSet());
      hands = [];
      for (let i = 0; i < this.n; i++) hands.push(set.splice(0, size));
      boneyard = set;
      if (this.nextStarter != null) {
        starter = this.nextStarter;
        break;
      }
      // יד ראשונה: 6:6 פותח. אם היא בקופה (פחות מ-4 שחקנים) – 5:5, וכן הלאה
      let best = -1;
      hands.forEach((h, seat) =>
        h.forEach((t) => {
          if (isDouble(t) && t.a > best) {
            best = t.a;
            starter = seat;
            required = t.id;
          }
        })
      );
      if (best >= 0) break;
    }
    this.hands = hands;
    this.boneyard = boneyard;
    this.starter = starter;
    this.turn = starter;
    this.required = required;
    this.board = emptyBoard();
    this.passes = 0;
    this.state = 'playing';
    this.lastMove = null;
    this.handResult = null;
    this.ready = new Set();
    this.handOverAt = null;
    this.events.push({ type: 'newHand', handNo: this.handNo, starter, required });
  }

  movesFor(seat) {
    if (this.state !== 'playing') return [];
    const hand = this.hands[seat];
    const ends = openEnds(this.board);
    const moves = [];
    for (const t of hand) {
      if (!ends) {
        if (this.required && t.id !== this.required) continue;
        moves.push({ tileId: t.id, end: 'center', a: t.a, b: t.b });
        continue;
      }
      for (const e of ends) {
        if (t.a === e.value || t.b === e.value) {
          moves.push({ tileId: t.id, end: e.end, a: e.value, b: t.a === e.value ? t.b : t.a });
        }
      }
    }
    for (const m of moves) {
      const copy = JSON.parse(JSON.stringify(this.board));
      placeOn(copy, hand.find((t) => t.id === m.tileId), m.end);
      const c = boardCount(copy);
      m.count = c;
      m.score = toPoints(c);
    }
    return moves;
  }

  assertTurn(seat) {
    if (this.state !== 'playing') throw new Error('היד לא פעילה כרגע');
    if (seat !== this.turn) throw new Error('זה לא התור שלך');
  }

  play(seat, tileId, end) {
    this.assertTurn(seat);
    if (!ENDS.includes(end) && end !== 'center') throw new Error('קצה לא חוקי');
    const move = this.movesFor(seat).find((m) => m.tileId === tileId && m.end === end);
    if (!move) throw new Error('אי אפשר להניח את האבן הזו כאן');
    const hand = this.hands[seat];
    const tile = hand.splice(hand.findIndex((t) => t.id === tileId), 1)[0];
    placeOn(this.board, tile, end);
    this.required = null;
    this.passes = 0;
    const count = boardCount(this.board);
    const scored = toPoints(count);
    const side = this.sideOf(seat);
    if (scored) this.scores[side] += scored;
    this.lastMove = { seat, tileId, end, scored, count };
    this.events.push({ type: 'play', seat, tile: { a: tile.a, b: tile.b }, tileId, end, scored, count });

    if (this.scores[side] >= this.target) {
      this.finish(side, { reason: 'target', winnerSeat: seat, winSide: side, points: 0 });
    } else if (hand.length === 0) {
      this.endHand(seat);
    } else {
      this.turn = (this.turn + 1) % this.n;
    }
  }

  draw(seat) {
    this.assertTurn(seat);
    if (this.movesFor(seat).length) throw new Error('יש לך אבן לשחק – אין צורך לשלוף');
    if (!this.boneyard.length) throw new Error('הקופה ריקה');
    const tile = this.boneyard.pop();
    this.hands[seat].push(tile);
    this.events.push({ type: 'draw', seat, tileId: tile.id, left: this.boneyard.length });
    return tile;
  }

  pass(seat) {
    this.assertTurn(seat);
    if (this.movesFor(seat).length) throw new Error('יש לך מהלך חוקי');
    if (this.boneyard.length) throw new Error('צריך לשלוף מהקופה קודם');
    this.passes++;
    this.events.push({ type: 'pass', seat });
    if (this.passes >= this.n) this.endHand(null);
    else this.turn = (this.turn + 1) % this.n;
  }

  // מהלך אוטומטי (שחקן שעזב / נגמר הזמן): שולף עד שאפשר, ומניח את האבן שמביאה הכי הרבה נקודות
  autoMove(seat) {
    for (;;) {
      if (this.state !== 'playing' || this.turn !== seat) return;
      const moves = this.movesFor(seat);
      if (moves.length) {
        moves.sort((x, y) => y.score - x.score || y.a + y.b - (x.a + x.b));
        this.play(seat, moves[0].tileId, moves[0].end);
        return;
      }
      if (this.boneyard.length) this.draw(seat);
      else return this.pass(seat);
    }
  }

  endHand(winnerSeat) {
    const handPips = this.hands.map(pipsOf);
    const sidePips = new Array(this.sides).fill(0);
    handPips.forEach((p, seat) => (sidePips[this.sideOf(seat)] += p));
    let winSide = null;
    let points = 0;
    let reason;
    if (winnerSeat != null) {
      reason = 'domino';
      winSide = this.sideOf(winnerSeat);
      points = round5(sidePips.reduce((s, p, i) => (i === winSide ? s : s + p), 0)) / 5;
      this.nextStarter = winnerSeat;
    } else {
      reason = 'blocked';
      const min = Math.min(...sidePips);
      const lows = sidePips.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
      if (lows.length === 1) {
        winSide = lows[0];
        const others = sidePips.reduce((s, p, i) => (i === winSide ? s : s + p), 0);
        points = round5(others - min) / 5;
        let best = null;
        handPips.forEach((p, seat) => {
          if (this.sideOf(seat) === winSide && (best == null || p < handPips[best])) best = seat;
        });
        winnerSeat = best;
        this.nextStarter = best;
      } else {
        this.nextStarter = (this.starter + 1) % this.n;
      }
    }
    if (winSide != null) this.scores[winSide] += points;
    const result = { reason, winnerSeat, winSide, points, handPips, sidePips };
    if (winSide != null && this.scores[winSide] >= this.target) this.finish(winSide, result);
    else {
      this.state = 'handOver';
      this.handOverAt = Date.now();
      this.handResult = { ...result, hands: this.revealHands() };
      this.events.push({ type: 'handOver', ...result });
    }
  }

  finish(side, result) {
    this.state = 'gameOver';
    this.winnerSide = side;
    this.handResult = { ...result, handPips: this.hands.map(pipsOf), hands: this.revealHands() };
    this.events.push({ type: 'gameOver', winSide: side, ...result });
  }

  revealHands() {
    return this.hands.map((h) => h.map((t) => ({ id: t.id, a: t.a, b: t.b })));
  }

  markReady(seat) {
    if (this.state !== 'handOver') return;
    this.ready.add(seat);
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  view(seat) {
    const mine = seat != null && seat >= 0;
    const myTurn = mine && seat === this.turn && this.state === 'playing';
    const moves = myTurn ? this.movesFor(seat) : [];
    return {
      n: this.n,
      handNo: this.handNo,
      state: this.state,
      turn: this.turn,
      target: this.target,
      teams: this.teams,
      scores: this.scores,
      board: this.board,
      ends: openEnds(this.board),
      count: boardCount(this.board),
      boneyard: this.boneyard.length,
      handCounts: this.hands.map((h) => h.length),
      hand: mine ? this.hands[seat] : null,
      moves,
      canDraw: myTurn && !moves.length && this.boneyard.length > 0,
      canPass: myTurn && !moves.length && this.boneyard.length === 0,
      required: mine && seat === this.turn ? this.required : null,
      firstHandOpening: !this.board.center && this.handNo === 1,
      lastMove: this.lastMove,
      handResult: this.state === 'playing' ? null : this.handResult,
      ready: [...this.ready],
      winnerSide: this.winnerSide,
    };
  }
}

module.exports = { Game, TARGET, toPoints, boardCount, openEnds, placeOn, emptyBoard, round5, fullSet, HAND_SIZE };
