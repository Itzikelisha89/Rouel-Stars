'use strict';
// מנוע המשחק: דומינו "חמישיות" (All Fives / Muggins)
// השרת הוא הסמכות היחידה – הלקוח רק מציג ושולח בקשות.

const crypto = require('crypto');

// כל שחקן מקבל 7. בארבעה מחלקים את כל 28 האבנים, ולכן 6:6 תמיד אצל מישהו.
const HAND_SIZE = { 2: 7, 3: 7, 4: 7 };
const TARGET = 51;
const MAX_DRAWS = 2; // אין מה לשים? מושכים עד פעמיים באותו תור, ואז פאס
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

// האבנים מפוזרות הפוכות על השולחן: מיקום וסיבוב לכל אחת (x,y בין 0 ל-1)
function makePool() {
  const tiles = shuffle(fullSet());
  const cells = shuffle([...Array(28).keys()]);
  return tiles.map((tile, i) => {
    const col = cells[i] % 7;
    const row = Math.floor(cells[i] / 7);
    return {
      tile,
      taken: false,
      x: +((col + 0.5) / 7 + (Math.random() - 0.5) * 0.05).toFixed(3),
      y: +((row + 0.5) / 4 + (Math.random() - 0.5) * 0.07).toFixed(3),
      r: Math.round((Math.random() - 0.5) * 50 + (Math.random() < 0.35 ? 90 : 0)),
    };
  });
}

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
    this.history = []; // דף הניקוד: { hand, side, seat, pts, kind, count }
    this.startHand();
  }

  get sides() {
    return this.teams ? 2 : this.n;
  }

  sideOf(seat) {
    return this.teams ? seat % 2 : seat;
  }

  // יד חדשה: האבנים נשפכות הפוכות על השולחן וכל שחקן בוחר לעצמו 7 (pick)
  startHand(redeal = false) {
    if (!redeal) {
      this.handNo++;
      this.freishUsed = new Set();
    }
    this.pool = makePool();
    this.hands = Array.from({ length: this.n }, () => []);
    this.boneyard = [];
    this.starter = null;
    this.turn = null;
    this.required = null;
    this.board = emptyBoard();
    this.passes = 0;
    this.state = 'picking';
    this.lastMove = null;
    this.handResult = null;
    this.ready = new Set();
    this.handOverAt = null;
    this.call = null; // הכרזה פתוחה: { seat, side, count, points }
    this.closingSeat = null;
    this.freish = null;
    this.events.push({ type: 'newHand', handNo: this.handNo, redeal });
  }

  pick(seat, idx) {
    if (this.state !== 'picking') throw new Error('עכשיו לא בוחרים אבנים');
    if (this.hands[seat].length >= HAND_SIZE[this.n]) throw new Error(`כבר יש לך ${HAND_SIZE[this.n]} אבנים`);
    const slot = this.pool[idx];
    if (!slot || slot.taken) throw new Error('מישהו כבר לקח את האבן הזו');
    slot.taken = true;
    this.hands[seat].push(slot.tile);
    this.events.push({ type: 'pick', seat, slot: idx });
    if (this.hands.every((h) => h.length === HAND_SIZE[this.n])) this.beginPlay();
  }

  autoPick(seat) {
    while (this.state === 'picking' && this.hands[seat].length < HAND_SIZE[this.n]) {
      const free = this.pool.map((s, i) => (s.taken ? -1 : i)).filter((i) => i >= 0);
      this.pick(seat, free[crypto.randomInt(free.length)]);
    }
  }

  beginPlay() {
    this.boneyard = this.pool.map((s, idx) => ({ idx, tile: s.tile, taken: s.taken })).filter((s) => !s.taken);
    let starter = this.nextStarter;
    let required = null;
    if (starter == null) {
      // יד ראשונה: 6:6 פותח. אם היא בקופה (פחות מ-4 שחקנים) – 5:5, וכן הלאה
      let best = -1;
      this.hands.forEach((h, seat) =>
        h.forEach((t) => {
          if (isDouble(t) && t.a > best) {
            best = t.a;
            starter = seat;
            required = t.id;
          }
        })
      );
      if (best < 0) {
        this.events.push({ type: 'redeal' });
        return this.startHand(true);
      }
    }
    this.starter = starter;
    this.turn = starter;
    this.required = required;
    this.draws = 0;
    this.state = 'playing';
    this.events.push({ type: 'handReady', handNo: this.handNo, starter, required });
  }

  // פרייש: מי שקיבל יד גרועה מבקש לחלק מחדש. רק לפני האבן הראשונה, וכולם צריכים להסכים.
  proposeFreish(seat) {
    if (this.state !== 'playing' || this.board.center) throw new Error('פרייש מבקשים רק לפני שמניחים את האבן הראשונה');
    if (this.freish) throw new Error('כבר יש הצבעה על פרייש');
    if (this.freishUsed.has(seat)) throw new Error('כבר ביקשת פרייש ביד הזו');
    this.freishUsed.add(seat);
    this.freish = { by: seat, votes: { [seat]: true }, at: Date.now() };
    this.events.push({ type: 'freishAsk', seat });
  }

  voteFreish(seat, yes) {
    const f = this.freish;
    if (!f) throw new Error('אין הצבעה פתוחה');
    if (seat in f.votes) return;
    f.votes[seat] = !!yes;
    this.events.push({ type: 'freishVote', seat, yes: !!yes });
    if (!yes) return this.endFreish(false);
    if (Object.keys(f.votes).length === this.n) this.endFreish(true);
  }

  endFreish(ok, timeout = false) {
    const f = this.freish;
    if (!f) return;
    this.freish = null;
    this.events.push({ type: 'freishResult', ok, by: f.by, timeout });
    if (ok) this.startHand(true);
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
    if (this.freish) throw new Error('מחכים להצבעה על פרייש');
    if (seat !== this.turn) throw new Error('זה לא התור שלך');
  }

  // מי שעשה נקודות חייב להגיד. כשהשחקן הבא מתחיל (מניח / שולף / פאס) – ההזדמנות הלכה.
  closeCall(actorSeat) {
    const c = this.call;
    if (!c || c.seat === actorSeat) return;
    if (c.points) this.events.push({ type: 'missed', seat: c.seat, count: c.count, points: c.points });
    this.call = null;
  }

  callPoints(seat, value) {
    const c = this.call;
    if (!c || c.seat !== seat || (this.state !== 'playing' && this.state !== 'closing')) throw new Error('אין מה להכריז עכשיו');
    value = Number(value);
    // אומרים את מספר הנקודות: 20 על הלוח = "4"
    if (!Number.isInteger(value) || value < 0 || value > 12) throw new Error('מספר לא חוקי');
    this.call = null;
    if (c.points && value === c.points) {
      this.scores[c.side] += c.points;
      this.history.push({ hand: this.handNo, side: c.side, seat, pts: c.points, kind: 'call', count: c.count });
      this.events.push({ type: 'call', seat, value, ok: true, points: c.points, count: c.count, tileId: this.lastMove?.tileId });
      // הגעה ל-51 לא עוצרת את המשחק – מסיימים את הסיבוב, ורק אז בודקים מי ניצח
      const s = this.scores[c.side];
      if (s >= this.target && s - c.points < this.target) this.events.push({ type: 'reachedTarget', seat, side: c.side, score: s });
    } else {
      this.events.push({ type: 'call', seat, value, ok: false, count: c.count, points: c.points });
    }
    return c.points && value === c.points ? c.points : 0;
  }

  play(seat, tileId, end) {
    this.assertTurn(seat);
    this.closeCall(seat);
    if (!ENDS.includes(end) && end !== 'center') throw new Error('קצה לא חוקי');
    const move = this.movesFor(seat).find((m) => m.tileId === tileId && m.end === end);
    if (!move) throw new Error('אי אפשר להניח את האבן הזו כאן');
    const hand = this.hands[seat];
    const tile = hand.splice(hand.findIndex((t) => t.id === tileId), 1)[0];
    placeOn(this.board, tile, end);
    this.required = null;
    this.passes = 0;
    const count = boardCount(this.board);
    // הניקוד לא נכנס לבד – צריך להכריז עליו (callPoints)
    this.call = { seat, side: this.sideOf(seat), count, points: toPoints(count) };
    this.lastMove = { seat, tileId, end, count };
    this.draws = 0;
    this.events.push({ type: 'play', seat, tile: { a: tile.a, b: tile.b }, tileId, end, count, last: hand.length === 0 });

    if (hand.length === 0) {
      // גמר את האבנים: רגע להכריז על האבן האחרונה, ואז השרת סוגר את היד (closeHand)
      this.state = 'closing';
      this.closingSeat = seat;
    } else {
      this.turn = (this.turn + 1) % this.n;
    }
  }

  closeHand() {
    if (this.state !== 'closing') return;
    if (this.call?.points) this.events.push({ type: 'missed', seat: this.call.seat, count: this.call.count, points: this.call.points });
    this.call = null;
    this.endHand(this.closingSeat);
  }

  // שליפה: השחקן בוחר איזו אבן הפוכה לקחת מהקופה (slot), ואם לא בחר – אקראית
  draw(seat, slot) {
    this.assertTurn(seat);
    if (this.movesFor(seat).length) throw new Error('יש לך אבן לשחק – אין צורך לשלוף');
    if (!this.boneyard.length) throw new Error('הקופה ריקה');
    if (this.draws >= MAX_DRAWS) throw new Error(`מושכים עד ${MAX_DRAWS} פעמים בתור – עכשיו פאס`);
    this.draws++;
    this.closeCall(seat);
    let i = this.boneyard.findIndex((s) => s.idx === slot);
    if (i < 0) i = crypto.randomInt(this.boneyard.length);
    const { tile, idx } = this.boneyard.splice(i, 1)[0];
    if (this.pool?.[idx]) this.pool[idx].taken = true;
    this.hands[seat].push(tile);
    this.events.push({ type: 'draw', seat, tileId: tile.id, slot: idx, left: this.boneyard.length });
    return tile;
  }

  pass(seat) {
    this.assertTurn(seat);
    this.closeCall(seat);
    if (this.movesFor(seat).length) throw new Error('יש לך מהלך חוקי');
    if (this.boneyard.length && this.draws < MAX_DRAWS) throw new Error('צריך למשוך מהקופה קודם');
    this.passes++;
    this.draws = 0;
    this.events.push({ type: 'pass', seat });
    // נחסם: כולם דפקו ברצף והקופה ריקה
    if (this.passes >= this.n && !this.boneyard.length) this.endHand(null);
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
      if (this.boneyard.length && this.draws < MAX_DRAWS) this.draw(seat);
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
    if (winSide != null && points) this.history.push({ hand: this.handNo, side: winSide, seat: winnerSeat, pts: points, kind: 'bonus' });
    this.history.push({ hand: this.handNo, side: winSide, seat: winnerSeat, pts: 0, kind: 'result', reason });
    const result = { reason, winnerSeat, winSide, points, handPips, sidePips };
    // סוף סיבוב: אם מישהו עבר את היעד – המוביל מנצח. תיקו בראש = עוד יד.
    const top = Math.max(...this.scores);
    const leaders = this.scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
    if (top >= this.target && leaders.length === 1) this.finish(leaders[0], result);
    else {
      if (top >= this.target) result.tieAtTop = true;
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
    this.events.push({ type: 'gameOver', ...result, handWinSide: result.winSide, winSide: side });
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
    const myTurn = mine && seat === this.turn && this.state === 'playing' && !this.freish;
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
      canCall: mine && !!this.call && this.call.seat === seat,
      // השולחן עם האבנים ההפוכות (בלי לחשוף מה יש בהן)
      pool: this.state === 'picking' ? this.pool.map(({ x, y, r, taken }) => ({ x, y, r, taken })) : null,
      boneSlots: this.state === 'playing' ? this.boneyard.map((s) => ({ idx: s.idx, x: this.pool[s.idx]?.x ?? 0.5, y: this.pool[s.idx]?.y ?? 0.5, r: this.pool[s.idx]?.r ?? 0 })) : [],
      handSize: HAND_SIZE[this.n],
      freish: this.freish ? { by: this.freish.by, votes: this.freish.votes } : null,
      canFreish: mine && this.state === 'playing' && !this.board.center && !this.freish && !this.freishUsed.has(seat),
      closingSeat: this.state === 'closing' ? this.closingSeat : null,
      history: this.history,
      moves,
      canDraw: myTurn && !this.freish && !moves.length && this.boneyard.length > 0 && this.draws < MAX_DRAWS,
      canPass: myTurn && !moves.length && (this.boneyard.length === 0 || this.draws >= MAX_DRAWS),
      draws: this.draws,
      maxDraws: MAX_DRAWS,
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
