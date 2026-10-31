'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game, TARGET, toPoints: toPoint } = require('./game');

const PORT = process.env.PORT || 3000;
const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐻', '🐼', '🐸', '🦉', '🐙', '🦄', '🐲', '👑', '🎩', '🧔', '👵', '👴', '🧕', '🕵️', '🤠', '🥷'];
const TURN_MS = 30000; // גג של 30 שניות לכל תור
const TURN_GRACE_MS = 700; // מרווח קטן לעיכובי רשת
const HAND_BREAK_MS = 45000;
const BOT_MS = 3500;
// שחקני מחשב שהמארח מוסיף כדי להשלים שולחן
const BOTS = [
  { name: 'דוד', voice: 'm' },
  { name: 'רחל', voice: 'f' },
  { name: 'שלמה', voice: 'm' },
  { name: 'מרים', voice: 'f' },
]; // המחשב מחכה רגע – כדי שלשחקן הקודם יהיה זמן להכריז
const CLOSE_OPEN_MS = 6000; // אחרי האבן האחרונה: זמן להכריז לפני שסוגרים את היד
const CLOSE_DONE_MS = 1600;
const BANTER = require('./banter.json');
const BANTER_GAP_MS = 15000; // לא יותר מבדיחה אחת כל 15 שניות
const THINK_MS = 17000; // מישהו חושב יותר מדי זמן? הבדרן יגיד משהו
const PICK_MS = 30000; // זמן לבחור 7 אבנים מהשולחן
const FREISH_MS = 20000; // זמן להצביע על פרייש

const app = express();
const PUBLIC = path.join(__dirname, 'public');
// קוד המשחק (html/js/css) נבדק מחדש בכל טעינה – כדי שתיקונים יגיעו לטלפונים מיד. קולות נשמרים יום.
app.use(
  express.static(PUBLIC, {
    setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(mp3|wav|png|jpg|svg)$/.test(file) ? 'public, max-age=86400' : 'no-cache'),
  })
);
app.get('/r/:code', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
// מספר הגרסה (Render נותן את ה-commit) – מופיע בתפריט המשחק, כדי לדעת שהטלפון טען את הגרסה החדשה
const VERSION = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7);
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, version: VERSION }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newCode = () => {
  let c;
  do c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(c));
  return c;
};
const pidOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function profileFrom(data) {
  const name = clean(data?.name, 16);
  if (!name) throw new Error('צריך שם כדי לשבת לשולחן');
  const avatar = AVATARS.includes(data?.avatar) ? data.avatar : AVATARS[0];
  const voice = data?.voice === 'f' ? 'f' : 'm';
  return { name, avatar, voice };
}

function createRoom(hostPid) {
  const room = {
    code: newCode(),
    hostPid,
    players: [],
    spectators: [],
    settings: { target: TARGET, teams: false, turnTime: TURN_MS / 1000 },
    game: null,
    seatPids: [],
    chat: [],
    turnTimer: null,
    handTimer: null,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const findMember = (room, pid) => room.players.find((p) => p.pid === pid) || room.spectators.find((p) => p.pid === pid);
const seatOf = (room, pid) => (room.game ? room.seatPids.indexOf(pid) : -1);
const nameOf = (room, pid) => findMember(room, pid)?.name || 'שחקן';
const nameAtSeat = (room, seat) => nameOf(room, room.seatPids[seat]);

function sideLabel(room, side) {
  const g = room.game;
  if (!g.teams) return nameAtSeat(room, side);
  return `${nameAtSeat(room, side)} ו${nameAtSeat(room, side + 2)}`;
}

function pushChat(room, msg) {
  const full = { id: crypto.randomUUID(), ts: Date.now(), ...msg };
  room.chat.push(full);
  if (room.chat.length > 150) room.chat.shift();
  io.to(room.code).emit('chat', full);
}
const sys = (room, text, kind = 'system') => pushChat(room, { kind, text });
// הודעה בולטת לכל השולחן כשמישהו יוצא / מתנתק / חוזר
const presence = (room, kind, m, extra) => io.to(room.code).emit('fx', [{ type: 'presence', kind, pid: m.pid, name: m.name, ...extra }]);

function publicRoom(room, pid) {
  const seat = seatOf(room, pid);
  const g = room.game;
  return {
    code: room.code,
    now: Date.now(),
    version: VERSION,
    hostPid: room.hostPid,
    me: pid,
    role: room.players.some((p) => p.pid === pid) ? 'player' : 'spectator',
    players: room.players.map(({ pid, name, avatar, voice, connected, left, media, bot, disconnectedAt }) => ({ pid, name, avatar, voice, connected, left, bot: !!bot, media: media || null, awaySince: connected ? null : disconnectedAt || null })),
    spectators: room.spectators.map(({ pid, name, avatar, voice, media }) => ({ pid, name, avatar, voice, media: media || null })),
    settings: room.settings,
    game: g
      ? {
          ...g.view(seat >= 0 ? seat : null),
          seats: room.seatPids,
          mySeat: seat,
          deadline: g.deadline || null,
          pickDeadline: g.state === 'picking' ? g.pickDeadline || null : null,
          freishEnds: g.freish ? g.freish.at + FREISH_MS : null,
          handBreakEnds: g.state === 'handOver' && g.handOverAt ? g.handOverAt + HAND_BREAK_MS : null,
        }
      : null,
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const m of [...room.players, ...room.spectators]) {
    const payload = publicRoom(room, m.pid);
    for (const sid of m.sockets) io.to(sid).emit('room', payload);
  }
}

// "הבדרן של השולחן": לפעמים זורק משפט מצחיק. השרת בוחר כדי שכולם ישמעו אותו דבר באותו רגע.
function banter(room, key, chance) {
  const now = Date.now();
  const lines = BANTER[key];
  if (hooks.banter === false) return null;
  if (hooks.banter === true) chance = 1;
  if (!lines || Math.random() > chance || now - (room.lastBanter || 0) < BANTER_GAP_MS) return null;
  room.lastBanter = now;
  room.recentBanter = room.recentBanter || [];
  const fresh = lines.map((_, i) => i).filter((i) => !room.recentBanter.includes(`${key}${i}`));
  const i = (fresh.length ? fresh : lines.map((_, j) => j))[Math.floor(Math.random() * (fresh.length || lines.length))];
  const id = `${key}${i}`;
  room.recentBanter = [id, ...room.recentBanter].slice(0, 12);
  pushChat(room, { kind: 'banter', text: `🎙 ${lines[i]}` });
  return { type: 'banter', id, text: lines[i] };
}

function banterFor(room, events) {
  const g = room.game;
  for (const ev of events) {
    let b = null;
    if (ev.type === 'call' && ev.ok && ev.points >= 4) b = banter(room, 'big', 0.5);
    else if (ev.type === 'call' && !ev.ok) b = banter(room, 'wrong', 0.7);
    else if (ev.type === 'missed') b = banter(room, 'missed', 0.75);
    else if (ev.type === 'pass') b = banter(room, g.boneyard.length ? 'drawfail' : 'pass', g.boneyard.length ? 0.55 : 0.35);
    else if (ev.type === 'play' && ev.last) b = banter(room, 'domino', 0.6);
    else if ((ev.type === 'handOver' || ev.type === 'gameOver') && ev.reason === 'blocked') b = banter(room, 'blocked', 0.8);
    else if (ev.type === 'freishAsk') b = banter(room, 'freish', 0.6);
    else if (ev.type === 'freishResult' && !ev.ok) b = banter(room, 'freishno', 0.6);
    else if (ev.type === 'reachedTarget') b = banter(room, 'reached', 0.7);
    else if (ev.type === 'newHand' && !ev.redeal) b = banter(room, 'start', 0.3);
    if (ev.type === 'gameOver') {
      room.lastBanter = 0;
      b = banter(room, 'champ', 0.85) || b;
    }
    if (b) return b;
  }
  return null;
}

function scheduleTurn(room) {
  clearTimeout(room.thinkTimer);
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  const g = room.game;
  if (!g) return;
  g.deadline = null;
  if (g.state !== 'playing' || g.freish || hooks.freeze) return;
  const seat = g.turn;
  const p = room.players.find((x) => x.pid === room.seatPids[seat]);
  const bot = !p || p.left || p.bot;
  // אותו תור (גם אחרי שליפה, רענון או ניתוק) = אותו שעון. לא מתאפס.
  const placed = g.board.center ? 1 + Object.values(g.board.arms).reduce((n, a) => n + a.length, 0) : 0;
  const key = `${g.handNo}:${seat}:${placed}:${g.passes}`;
  if (g.turnKey !== key || !g.turnDeadline) {
    g.turnKey = key;
    g.turnDeadline = Date.now() + TURN_MS;
  }
  if (!bot) g.deadline = g.turnDeadline;
  if (!bot) {
    const key = g.turnKey;
    room.thinkTimer = setTimeout(() => {
      // פעם אחת לכל תור, גם אם הטיימר מתוזמן מחדש
      if (room.game !== g || g.state !== 'playing' || g.turnKey !== key || g.freish || g.thinkSaid === key) return;
      g.thinkSaid = key;
      const b = banter(room, 'think', 0.6);
      if (b) io.to(room.code).emit('fx', [b]);
    }, Math.max(0, g.turnDeadline - TURN_MS + THINK_MS - Date.now()));
  }
  // המחשב "חושב" קצת – כמו שחקן אמיתי (וגם כדי שלשחקן הקודם יהיה זמן להכריז)
  const ms = bot ? BOT_MS - 1200 + Math.random() * 1600 : Math.max(0, g.turnDeadline - Date.now()) + TURN_GRACE_MS;
  room.turnTimer = setTimeout(() => {
    if (room.game !== g || g.state !== 'playing' || g.turn !== seat) return;
    if (!bot) sys(room, `⏰ נגמר הזמן ל${p.name} – מהלך אוטומטי`);
    g.autoMove(seat);
    // המחשב (במקום שחקן שעזב) לא שוכח להכריז. מי שנגמר לו הזמן – עדיין יכול להכריז בעצמו.
    if (bot && g.call?.seat === seat && g.call.points) g.callPoints(seat, g.call.points);
    afterAction(room);
  }, ms);
}

const isBot = (room, seat) => {
  const p = room.players.find((x) => x.pid === room.seatPids[seat]);
  return !p || p.left || !!p.bot;
};

// בחירת אבנים מהשולחן: 30 שניות, ואז מי שלא סיים – המחשב בוחר לו. שחקן שעזב בוחר מיד.
function schedulePick(room) {
  clearTimeout(room.pickTimer);
  const g = room.game;
  if (!g || g.state !== 'picking' || hooks.freeze) return;
  if (!g.pickDeadline) g.pickDeadline = Date.now() + PICK_MS;
  const bots = room.seatPids.map((_, s) => s).filter((s) => isBot(room, s) && g.hands[s].length < g.view(s).handSize);
  const ms = bots.length ? 1500 : Math.max(0, g.pickDeadline - Date.now()) + TURN_GRACE_MS;
  room.pickTimer = setTimeout(() => {
    if (room.game !== g || g.state !== 'picking') return;
    const targets = bots.length ? bots : room.seatPids.map((_, s) => s);
    for (const s of targets) if (g.state === 'picking') g.autoPick(s);
    afterAction(room);
  }, ms);
}

function scheduleFreish(room) {
  clearTimeout(room.freishTimer);
  const g = room.game;
  if (!g?.freish) return;
  // המחשב (במקום מי שעזב) תמיד מסכים
  for (let s = 0; s < g.n; s++) if (g.freish && isBot(room, s) && !(s in g.freish.votes)) g.voteFreish(s, true);
  if (!g.freish) return;
  room.freishTimer = setTimeout(() => {
    if (room.game !== g || !g.freish) return;
    g.endFreish(false, true);
    g.turnDeadline = null;
    afterAction(room);
  }, Math.max(0, g.freish.at + FREISH_MS - Date.now()));
}

function scheduleClosing(room) {
  clearTimeout(room.closeTimer);
  const g = room.game;
  if (!g || g.state !== 'closing') return;
  const ms = g.call ? CLOSE_OPEN_MS : CLOSE_DONE_MS;
  room.closeTimer = setTimeout(() => {
    if (room.game !== g || g.state !== 'closing') return;
    g.closeHand();
    afterAction(room);
  }, ms);
}

function scheduleHandBreak(room) {
  clearTimeout(room.handTimer);
  room.handTimer = null;
  const g = room.game;
  if (!g || g.state !== 'handOver' || hooks.freeze) return;
  room.handTimer = setTimeout(() => {
    if (room.game === g && g.state === 'handOver') nextHand(room);
  }, HAND_BREAK_MS);
}

function nextHand(room) {
  const g = room.game;
  clearTimeout(room.handTimer);
  g.startHand();
  afterAction(room);
}

function maybeAllReady(room) {
  const g = room.game;
  if (!g || g.state !== 'handOver') return;
  const needed = room.seatPids
    .map((pid, seat) => ({ p: room.players.find((x) => x.pid === pid), seat }))
    .filter(({ p }) => p && p.connected && !p.left && !p.bot);
  if (needed.every(({ seat }) => g.ready.has(seat))) nextHand(room);
}

function afterAction(room) {
  const g = room.game;
  const events = g.drainEvents();
  for (const ev of events) {
    const pts = (n) => `${n} ${n === 1 ? 'נקודה' : 'נקודות'}`;
    if (ev.type === 'call' && ev.ok) sys(room, `📣 ${nameAtSeat(room, ev.seat)} אמר ${ev.value} ✓ +${pts(ev.points)} (${ev.count} על הלוח)`, 'score');
    if (ev.type === 'call' && !ev.ok)
      sys(room, ev.points ? `📣 ${nameAtSeat(room, ev.seat)} אמר ${ev.value} – אבל זה ${ev.points} (${ev.count} על הלוח) 😬 אין נקודות` : `📣 ${nameAtSeat(room, ev.seat)} אמר ${ev.value} – אבל על הלוח ${ev.count}, לא היה כלום 😅`);
    if (ev.type === 'missed') sys(room, `🤐 ${nameAtSeat(room, ev.seat)} שכח להגיד ${ev.points} – ${pts(ev.points)} הלכו!`, 'score');
    if (ev.type === 'play' && ev.last) sys(room, `${nameAtSeat(room, ev.seat)} הניח את האבן האחרונה – דומינו!`);
    if (ev.type === 'reachedTarget') sys(room, `🏁 ${sideLabel(room, ev.side)} הגיע${g.teams ? 'ו' : ''} ל-${g.target}! מסיימים את הסיבוב…`, 'score');
    if (ev.type === 'newHand') {
      g.pickDeadline = null;
      sys(room, ev.redeal ? '🔀 מערבבים מחדש – בחרו אבנים מהשולחן' : `🀄 יד ${ev.handNo} – האבנים על השולחן, כל אחד בוחר ${g.view(0).handSize}`);
    }
    if (ev.type === 'handReady') {
      const opener = ev.required ? `${nameAtSeat(room, ev.starter)} פותח עם ${ev.required[0]}|${ev.required[1]}` : `${nameAtSeat(room, ev.starter)} פותח`;
      sys(room, `▶ ${opener}`);
    }
    if (ev.type === 'redeal') sys(room, 'אף אחד לא קיבל כפולה – מערבבים מחדש');
    if (ev.type === 'freishAsk') sys(room, `🔄 ${nameAtSeat(room, ev.seat)} (פותח הסיבוב) מבקש פרייש! כולם צריכים לאשר`, 'score');
    if (ev.type === 'freishVote' && !ev.yes) sys(room, `✋ ${nameAtSeat(room, ev.seat)} לא מסכים לפרייש`);
    if (ev.type === 'freishResult') {
      g.turnDeadline = null;
      const who = (ev.declined || []).map((s) => nameAtSeat(room, s)).join(', ');
      sys(room, ev.ok ? '🔄 כולם אישרו – פרייש! מחלקים מחדש' : `❌ אין פרייש – ${who || 'לא כולם'} לא אישר${(ev.declined || []).length > 1 ? 'ו' : ''}${ev.timeout ? ' (נגמר הזמן)' : ''}`, 'score');
    }
    if (ev.type === 'handOver' && ev.tieAtTop) sys(room, '⚖️ תיקו בראש הטבלה – משחקים עוד יד!', 'score');
    if (ev.type === 'handOver' || ev.type === 'gameOver') {
      const handSide = ev.type === 'gameOver' ? ev.handWinSide : ev.winSide;
      if (ev.reason === 'domino') sys(room, `🙌 ${nameAtSeat(room, ev.winnerSeat)} גמר את האבנים! +${ev.points}`, 'score');
      if (ev.reason === 'blocked')
        sys(room, handSide == null ? '🔒 המשחק נחסם – תיקו, אף אחד לא מקבל' : `🔒 המשחק נחסם – ${sideLabel(room, handSide)} עם הכי מעט: +${ev.points}`, 'score');
    }
    if (ev.type === 'gameOver') sys(room, `🏆 ${sideLabel(room, ev.winSide)} ניצח${g.teams ? 'ו' : ''} את המשחק!`, 'score');
  }
  const joke = banterFor(room, events);
  if (joke) events.push(joke);
  hooks.onFx?.(room, events);
  if (events.length) io.to(room.code).emit('fx', events);
  scheduleTurn(room);
  schedulePick(room);
  scheduleFreish(room);
  scheduleClosing(room);
  if (g.state === 'handOver') scheduleHandBreak(room);
  broadcast(room);
}

function startGame(room) {
  const active = room.players.filter((p) => !p.left);
  if (active.length < 2) throw new Error('צריך לפחות 2 שחקנים');
  if (active.length > 4) throw new Error('מקסימום 4 שחקנים');
  if (room.settings.teams && active.length !== 4) throw new Error('משחק בזוגות דורש בדיוק 4 שחקנים');
  room.players = active;
  room.seatPids = active.map((p) => p.pid);
  room.game = new Game({ players: active.length, target: room.settings.target, teams: room.settings.teams });
  sys(room, `🎲 המשחק התחיל! עד ${room.settings.target} נקודות${room.game.teams ? ' · בזוגות' : ''}`);
  afterAction(room);
}

function backToLobby(room) {
  clearTimeout(room.turnTimer);
  clearTimeout(room.handTimer);
  clearTimeout(room.closeTimer);
  clearTimeout(room.pickTimer);
  clearTimeout(room.freishTimer);
  clearTimeout(room.thinkTimer);
  room.game = null;
  room.seatPids = [];
  room.players = room.players.filter((p) => !p.left);
  while (room.players.length < 4 && room.spectators.length) {
    const s = room.spectators.shift();
    room.players.push({ ...s, left: false });
  }
  if (!room.players.some((p) => p.pid === room.hostPid) && room.players.length) room.hostPid = room.players[0].pid;
  broadcast(room);
}

function detach(socket) {
  const code = socket.data.code;
  const room = code && rooms.get(code);
  socket.data.code = null;
  if (!room) return null;
  socket.leave(code);
  const m = findMember(room, socket.data.pid);
  if (m) {
    m.sockets.delete(socket.id);
    m.connected = m.sockets.size > 0;
    if (!m.connected) {
      m.disconnectedAt = Date.now();
      m.media = null;
    }
  }
  return { room, member: m };
}

function removeMember(room, pid) {
  const inGame = room.game && room.seatPids.includes(pid) && room.game.state !== 'gameOver';
  const p = room.players.find((x) => x.pid === pid);
  if (p && inGame) {
    p.left = true;
    p.connected = false;
    sys(room, `🚪 ${p.name} עזב – המחשב ישחק במקומו`);
    presence(room, 'left', p, { bot: true });
  } else if (p) {
    room.players = room.players.filter((x) => x.pid !== pid);
    sys(room, `🚪 ${p.name} עזב את השולחן`);
    presence(room, 'left', p, { bot: false });
  } else {
    room.spectators = room.spectators.filter((x) => x.pid !== pid);
  }
  if (room.hostPid === pid) {
    const next = room.players.find((x) => !x.left && !x.bot && x.connected) || room.players.find((x) => !x.left && !x.bot);
    if (next) {
      room.hostPid = next.pid;
      sys(room, `👑 ${next.name} מארח עכשיו את השולחן`);
    }
  }
  if (room.game) {
    if (room.game.state === 'playing') scheduleTurn(room);
    maybeAllReady(room);
  }
  broadcast(room);
}

function joinRoom(socket, room, profile) {
  detach(socket);
  const pid = socket.data.pid;
  let m = findMember(room, pid);
  if (m && m.left) {
    // חזר אחרי שעזב: חוזר לכיסא שלו
    m.left = false;
    sys(room, `👋 ${m.name} חזר לשולחן`);
    presence(room, 'back', m);
  }
  if (m) {
    if (!room.game) Object.assign(m, profile);
    if (!m.connected && Date.now() - (m.disconnectedAt || 0) > 8000) {
      sys(room, `🔌 ${m.name} התחבר מחדש`);
      presence(room, 'back', m);
    }
  } else {
    m = { pid, ...profile, sockets: new Set(), connected: false, left: false };
    if (!room.game && room.players.length < 4) {
      room.players.push(m);
      sys(room, `${m.avatar} ${m.name} התיישב לשולחן`);
    } else {
      room.spectators.push(m);
      sys(room, `👀 ${m.name} צופה במשחק`);
    }
  }
  m.sockets.add(socket.id);
  m.connected = true;
  socket.join(room.code);
  socket.data.code = room.code;
  socket.emit('chatHistory', room.chat);
  if (room.game && room.seatPids[room.game.turn] === pid) scheduleTurn(room);
  broadcast(room);
  return m;
}

const lastChat = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || token.length < 16 || token.length > 100) return next(new Error('bad token'));
  socket.data.pid = pidOf(token);
  next();
});

io.on('connection', (socket) => {
  const pid = socket.data.pid;
  const roomOf = () => rooms.get(socket.data.code);

  const on = (event, fn) =>
    socket.on(event, (data, ack) => {
      try {
        const res = fn(data || {});
        if (typeof ack === 'function') ack({ ok: true, ...(res || {}) });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

  const gameCtx = () => {
    const room = roomOf();
    if (!room?.game) throw new Error('אין משחק פעיל');
    const seat = seatOf(room, pid);
    if (seat < 0) throw new Error('אתה צופה במשחק הזה');
    return { room, g: room.game, seat };
  };

  const hostCtx = () => {
    const room = roomOf();
    if (!room) throw new Error('לא נמצא שולחן');
    if (room.hostPid !== pid) throw new Error('רק המארח יכול לעשות את זה');
    return room;
  };

  on('room:create', (data) => {
    const profile = profileFrom(data);
    const room = createRoom(pid);
    joinRoom(socket, room, profile);
    return { code: room.code };
  });

  on('room:join', (data) => {
    const room = rooms.get(clean(data.code, 8).toUpperCase());
    if (!room) throw new Error('השולחן לא נמצא – אולי הקישור ישן?');
    const m = joinRoom(socket, room, profileFrom(data));
    return { code: room.code, role: room.players.includes(m) ? 'player' : 'spectator' };
  });

  on('room:leave', () => {
    const r = detach(socket);
    if (r) removeMember(r.room, pid);
  });

  on('room:settings', (data) => {
    const room = hostCtx();
    if (room.game) throw new Error('אי אפשר לשנות הגדרות באמצע משחק');
    const s = room.settings;
    if (typeof data.teams === 'boolean') s.teams = data.teams;
    broadcast(room);
  });

  on('room:kick', (data) => {
    const room = hostCtx();
    if (room.game) throw new Error('אפשר להוציא שחקנים רק בלובי');
    const target = room.players.find((p) => p.pid === data.pid);
    if (!target || target.pid === pid) return;
    room.players = room.players.filter((p) => p !== target);
    if (target.bot) {
      sys(room, `🤖 ${target.name} (מחשב) קם מהשולחן`);
      return broadcast(room);
    }
    room.spectators.push({ ...target });
    for (const sid of target.sockets) io.to(sid).emit('toast', 'המארח העביר אותך לצפייה');
    sys(room, `${target.name} הועבר לצפייה`);
    broadcast(room);
  });

  // השלמת שחקנים: המארח מוסיף שחקן מחשב לכיסא פנוי
  on('room:addBot', () => {
    const room = hostCtx();
    if (room.game) throw new Error('מוסיפים שחקן מחשב רק בלובי');
    if (room.players.length >= 4) throw new Error('השולחן מלא');
    const taken = new Set(room.players.map((p) => p.name));
    const b = BOTS.find((x) => !taken.has(x.name)) || BOTS[0];
    room.players.push({ pid: `bot-${crypto.randomUUID().slice(0, 8)}`, name: b.name, avatar: '🤖', voice: b.voice, sockets: new Set(), connected: true, left: false, bot: true });
    sys(room, `🤖 ${b.name} (מחשב) התיישב לשולחן`);
    broadcast(room);
  });

  on('room:move', (data) => {
    const room = hostCtx();
    if (room.game) return;
    const i = room.players.findIndex((p) => p.pid === data.pid);
    const j = i + (data.dir > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= room.players.length) return;
    [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    broadcast(room);
  });

  on('game:start', () => {
    const room = hostCtx();
    if (room.game && room.game.state !== 'gameOver') throw new Error('המשחק כבר רץ');
    startGame(room);
  });

  on('game:rematch', () => {
    const room = hostCtx();
    if (!room.game || room.game.state !== 'gameOver') throw new Error('המשחק עוד לא נגמר');
    if (room.players.some((p) => p.left)) {
      backToLobby(room);
      return;
    }
    startGame(room);
  });

  on('room:lobby', () => {
    const room = hostCtx();
    if (room.game && room.game.state === 'playing') throw new Error('המשחק עוד באמצע');
    backToLobby(room);
  });

  on('game:play', (data) => {
    const { room, g, seat } = gameCtx();
    g.play(seat, String(data.tileId), String(data.end));
    afterAction(room);
  });

  on('game:pick', (data) => {
    const { room, g, seat } = gameCtx();
    g.pick(seat, Number(data.slot));
    afterAction(room);
  });

  on('game:freish', () => {
    const { room, g, seat } = gameCtx();
    g.proposeFreish(seat);
    afterAction(room);
  });

  on('game:freishVote', (data) => {
    const { room, g, seat } = gameCtx();
    g.voteFreish(seat, !!data.yes);
    afterAction(room);
  });

  // וידאו וקול בין השחקנים (WebRTC): השרת רק מעביר הודעות חיבור בין הדפדפנים
  on('rtc:state', (data) => {
    const room = roomOf();
    const m = room && findMember(room, pid);
    if (!m) return;
    m.media = data.cam || data.mic ? { cam: !!data.cam, mic: !!data.mic } : null;
    broadcast(room);
  });

  socket.on('rtc:signal', (data) => {
    const room = roomOf();
    const to = room && findMember(room, String(data?.to || ''));
    if (!to || !data.data || JSON.stringify(data.data).length > 20000) return;
    for (const sid of to.sockets) io.to(sid).emit('rtc:signal', { from: pid, data: data.data });
  });

  on('game:draw', (data) => {
    const { room, g, seat } = gameCtx();
    const tile = g.draw(seat, Number.isInteger(data.slot) ? data.slot : undefined);
    afterAction(room);
    return { tileId: tile.id };
  });

  on('game:pass', () => {
    const { room, g, seat } = gameCtx();
    g.pass(seat);
    afterAction(room);
  });

  on('game:call', (data) => {
    const { room, g, seat } = gameCtx();
    g.callPoints(seat, data.value);
    afterAction(room);
  });

  let lastReach = 0;
  on('game:reach', (data) => {
    const room = roomOf();
    const seat = room?.game ? seatOf(room, pid) : -1;
    if (seat < 0 || Date.now() - lastReach < 120) return;
    lastReach = Date.now();
    const index = Number.isInteger(data.index) && data.index >= 0 && data.index < 30 ? data.index : null;
    socket.to(room.code).emit('reach', { seat, index });
  });

  on('game:ready', () => {
    const { room, g, seat } = gameCtx();
    g.markReady(seat);
    broadcast(room);
    maybeAllReady(room);
  });

  on('chat:send', (data) => {
    const room = roomOf();
    if (!room) throw new Error('לא בשולחן');
    const now = Date.now();
    if (now - (lastChat.get(pid) || 0) < 500) throw new Error('לאט לאט 🙂');
    lastChat.set(pid, now);
    const text = clean(data.text, 300);
    if (!text) return;
    const m = findMember(room, pid);
    pushChat(room, { kind: 'user', pid, name: m.name, avatar: m.avatar, text });
    // הכרזה בצ'אט: מי שיש לו הכרזה פתוחה וכותב רק מספר ("15" / "15!") – זה נחשב כאילו אמר
    const num = text.match(/^\s*(\d{1,2})\s*!*\s*$/);
    const g = room.game;
    if (num && g && g.call && g.call.seat === seatOf(room, pid)) {
      g.callPoints(g.call.seat, Number(num[1]));
      afterAction(room);
    }
  });

  on('chat:typing', () => {
    const room = roomOf();
    if (room) socket.to(room.code).emit('typing', { pid });
  });

  on('react', (data) => {
    const room = roomOf();
    const emoji = clean(data.emoji, 4);
    if (room && ['👍', '😂', '😮', '😡', '🔥', '👏', '😭', '🙏'].includes(emoji)) io.to(room.code).emit('react', { pid, emoji });
  });

  socket.on('disconnect', () => {
    const r = detach(socket);
    if (!r || !r.member) return;
    const { room, member } = r;
    if (!member.connected) {
      setTimeout(() => {
        if (!member.connected && !member.left && findMember(room, member.pid) === member) {
          sys(room, `📴 ${member.name} התנתק`);
          presence(room, 'gone', member, { inGame: !!room.game && room.seatPids.includes(member.pid) });
          if (room.game) maybeAllReady(room);
          broadcast(room);
        }
      }, 8000);
      if (room.game && room.seatPids[room.game.turn] === member.pid) scheduleTurn(room);
    }
    broadcast(room);
  });
});

// תחזוקה: העברת אירוח משחקן מנותק, ניקוי שולחנות נטושים
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const everyone = [...room.players, ...room.spectators];
    if (!everyone.some((m) => m.connected && !m.bot) && now - room.lastActive > 2 * 3600 * 1000) {
      clearTimeout(room.turnTimer);
      clearTimeout(room.handTimer);
      clearTimeout(room.closeTimer);
      clearTimeout(room.pickTimer);
      clearTimeout(room.freishTimer);
      clearTimeout(room.thinkTimer);
      rooms.delete(room.code);
      continue;
    }
    const host = room.players.find((p) => p.pid === room.hostPid);
    if ((!host || !host.connected) && now - (host?.disconnectedAt || 0) > 30000) {
      const next = room.players.find((p) => p.connected && !p.left && !p.bot);
      if (next && next.pid !== room.hostPid) {
        room.hostPid = next.pid;
        sys(room, `👑 ${next.name} מארח עכשיו את השולחן`);
        broadcast(room);
      }
    }
    if (!room.game) {
      const stale = room.players.filter((p) => !p.connected && now - (p.disconnectedAt || now) > 10 * 60 * 1000);
      if (stale.length) {
        room.players = room.players.filter((p) => !stale.includes(p));
        broadcast(room);
      }
    }
  }
}, 5000).unref();

// לסקריפט הסרטון: גישה לשולחנות כדי לביים מצבים במשחק
const hooks = {};
module.exports = { rooms, broadcast, afterAction, hooks, banter, io };

server.listen(PORT, () => console.log(`🀄 דומינו חמישיות רץ על http://localhost:${PORT}`));
