'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐻', '🐼', '🐸', '🦉', '🐙', '🦄', '🐲', '👑', '🎩', '🧔', '👵', '👴', '🧕', '🕵️', '🤠', '🥷'];
const QUICK = ['בהצלחה 🍀', 'יפה! 👏', 'איזה מזל 😅', 'יאללה, תורך ⏳', 'חחח 😂', 'סגרת אותי 😩', 'עוד משחק? 🔁', 'רגע, חוזר 🙏'];
const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏', '😭', '🙏'];
const TEAM_COLORS = ['#2f7de1', '#d9534f'];
const TEAM_NAMES = ['כחולים', 'אדומים'];

// ---------- אחסון מקומי ----------
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

let token = store.get('dm_token', null);
if (!token) {
  token = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)) + Math.random().toString(36).slice(2);
  store.set('dm_token', token);
}
let profile = store.get('dm_profile', null);
let hints = store.get('dm_hints', true);
let classic = store.get('dm_classic', false);
document.body.classList.toggle('classic', classic);

// ---------- מצב ----------
const S = {
  room: null,
  game: null,
  code: null,
  selected: null,
  handOrder: [],
  sortMode: 0,
  freshIds: new Set(),
  dealAnim: false,
  boardIds: new Set(),
  pendingFx: [],
  vb: null,
  vbAnim: null,
  chatOpen: false,
  unread: 0,
  clockSkew: 0,
  wasMyTurn: false,
  handModalFor: null,
  readySent: false,
  wakeLock: null,
  typing: new Map(),
  reach: {},
};

function codeFromUrl() {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})/);
  if (m) return m[1].toUpperCase();
  const q = new URLSearchParams(location.search).get('room');
  return q ? q.toUpperCase() : null;
}
const roomLink = (code) => `${location.origin}/r/${code}`;

// ---------- חיבור ----------
const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

function emit(ev, data = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(ev, data, (err, res) => {
      if (err) {
        toast('השרת לא ענה – נסה שוב');
        return resolve({ ok: false });
      }
      if (!res.ok && res.error) {
        toast(res.error);
        Sound.play('error');
      }
      resolve(res);
    });
  });
}

socket.on('connect', () => {
  $('#conn-banner').hidden = true;
  if (S.code && profile) emit('room:join', { code: S.code, ...profile });
});
socket.on('disconnect', () => ($('#conn-banner').hidden = false));
socket.on('connect_error', () => ($('#conn-banner').hidden = false));

socket.on('room', (room) => {
  S.clockSkew = room.now ? room.now - Date.now() : 0;
  const prev = S.game;
  S.room = room;
  S.game = room.game;
  if (room.game) {
    showScreen('game');
    renderGame(prev);
  } else {
    showScreen('lobby');
    renderLobby();
  }
});
socket.on('fx', (events) => S.pendingFx.push(...events));
socket.on('chat', (m) => addChat(m, true));
socket.on('chatHistory', (list) => {
  $('#chat-log').innerHTML = '';
  list.forEach((m) => addChat(m, false));
  S.unread = 0;
  updateBadge();
});
socket.on('typing', ({ pid }) => {
  S.typing.set(pid, Date.now());
  renderTyping();
  setTimeout(renderTyping, 2600);
});
socket.on('reach', ({ seat, index }) => {
  S.reach[seat] = index == null ? null : { index, t: Date.now() };
  if (S.game) renderSeats(S.game);
});
socket.on('react', ({ pid, emoji }) => {
  showBubble(pid, emoji, true);
  Sound.play('pop');
});
socket.on('toast', (t) => toast(t));

// ---------- מסכים ----------
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  placeChat();
  if (name === 'game') requestWakeLock();
}

const desktop = matchMedia('(min-width: 1000px)');
function placeChat() {
  const chat = $('#chat');
  const scrim = $('#chat-scrim');
  const active = $('.screen.active')?.id;
  const dock = active === 'screen-lobby' ? $('#lobby-chat-dock') : active === 'screen-game' ? $('#game-chat-dock') : null;
  if (desktop.matches && dock) {
    if (chat.parentElement !== dock) dock.appendChild(chat);
    S.chatOpen = true;
    S.unread = 0;
    updateBadge();
  } else if (chat.parentElement !== document.body) {
    document.body.insertBefore(chat, scrim);
    S.chatOpen = false;
    chat.classList.remove('open');
  }
}
desktop.addEventListener('change', placeChat);

// ---------- מסך הבית ----------
function initHome() {
  const logo = $('#logo-tiles');
  [[5, 0, -14, 0], [5, 5, 0, 0.12], [2, 3, 12, 0.24]].forEach(([a, b, r, d]) => {
    const el = document.createElement('div');
    el.className = 'lt';
    el.style.setProperty('--r', `${r}deg`);
    el.style.setProperty('--d', `${d}s`);
    el.innerHTML = Tiles.handTileSVG(a, b);
    logo.appendChild(el);
  });

  const grid = $('#avatar-grid');
  let avatar = profile?.avatar || AVATARS[Math.floor(Math.random() * 8)];
  AVATARS.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a;
    b.classList.toggle('sel', a === avatar);
    b.onclick = () => {
      avatar = a;
      $$('button', grid).forEach((x) => x.classList.toggle('sel', x === b));
      Sound.play('clack', 0.4);
    };
    grid.appendChild(b);
  });
  $('#name-input').value = profile?.name || '';

  let invite = codeFromUrl();
  const setInviteMode = () => {
    $('#invite-card').hidden = !invite;
    $('#invite-code').textContent = invite || '';
    $('#btn-main').textContent = invite ? 'שב לשולחן 🪑' : 'צור שולחן חדש';
    $('#join-row').hidden = !!invite;
    $('#btn-new-instead').hidden = !invite;
  };
  setInviteMode();
  $('#btn-new-instead').onclick = () => {
    invite = null;
    history.replaceState(null, '', '/');
    setInviteMode();
  };

  const saveProfile = () => {
    const name = $('#name-input').value.trim();
    if (!name) {
      toast('איך קוראים לך?');
      $('#name-input').focus();
      return false;
    }
    profile = { name, avatar };
    store.set('dm_profile', profile);
    Sound.unlock();
    return true;
  };

  $('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!saveProfile()) return;
    if (invite) return enterRoom(invite);
    const res = await emit('room:create', profile);
    if (res.ok) onEntered(res.code);
  };
  $('#btn-join-code').onclick = () => {
    const code = $('#code-input').value.trim().toUpperCase();
    if (code.length < 4) return toast('הקוד בן 5 תווים');
    if (saveProfile()) enterRoom(code);
  };

  // נכנס חזרה לשולחן אוטומטית אחרי רענון
  if (invite && profile) enterRoom(invite, true);
}

async function enterRoom(code, silent) {
  const res = await emit('room:join', { code, ...profile });
  if (res.ok) {
    onEntered(res.code);
    if (res.role === 'spectator' && !silent) toast('השולחן מלא או שהמשחק כבר התחיל – אתה צופה 👀');
  } else {
    S.code = null;
    history.replaceState(null, '', '/');
    showScreen('home');
  }
}

function onEntered(code) {
  S.code = code;
  if (location.pathname !== `/r/${code}`) history.replaceState(null, '', `/r/${code}`);
}

function leaveRoom() {
  emit('room:leave');
  S.code = null;
  S.room = S.game = null;
  history.replaceState(null, '', '/');
  $$('.modal').forEach((m) => (m.hidden = true));
  showScreen('home');
  $('#invite-card').hidden = true;
  $('#btn-main').textContent = 'צור שולחן חדש';
  $('#join-row').hidden = false;
  $('#btn-new-instead').hidden = true;
}

// ---------- לובי ----------
function renderLobby() {
  const r = S.room;
  const isHost = r.hostPid === r.me;
  $('#lobby-code').textContent = r.code;
  $('#share-link').value = roomLink(r.code);
  $('#btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`בוא לשחק איתי דומינו חמישיות 🀄\n${roomLink(r.code)}`)}`;
  $('#btn-share-native').hidden = !navigator.share;

  const seats = $('#lobby-seats');
  seats.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = r.players[i];
    const el = document.createElement('div');
    if (!p) {
      el.className = 'seat-card';
      el.innerHTML = `<div class="av muted">🪑</div><div class="muted small">מקום פנוי…</div>`;
    } else {
      const team = r.settings.teams && r.players.length === 4 ? `<span class="team-tag" style="--team:${TEAM_COLORS[i % 2]}">${TEAM_NAMES[i % 2]}</span>` : '';
      el.className = `seat-card filled${p.pid === r.me ? ' me' : ''}`;
      el.innerHTML = `<div class="av">${esc(p.avatar)}</div>
        <div style="min-width:0"><div class="nm">${esc(p.name)}${p.pid === r.me ? ' (אתה)' : ''}</div>
        <div class="sub"><span class="dot${p.connected ? '' : ' off'}"></span>${p.connected ? 'מחובר' : 'מנותק'}${p.pid === r.hostPid ? ' · 👑 מארח' : ''}${team}</div></div>`;
      if (isHost) {
        const tools = document.createElement('div');
        tools.className = 'host-tools';
        if (i > 0) tools.append(mkBtn('▲', 'הזז קדימה', () => emit('room:move', { pid: p.pid, dir: -1 })));
        if (i < r.players.length - 1) tools.append(mkBtn('▼', 'הזז אחורה', () => emit('room:move', { pid: p.pid, dir: 1 })));
        if (p.pid !== r.me) tools.append(mkBtn('✕', 'העבר לצפייה', () => emit('room:kick', { pid: p.pid })));
        el.appendChild(tools);
      }
    }
    seats.appendChild(el);
  }
  $('#seat-count').textContent = `(${r.players.length}/4)`;
  $('#lobby-spectators').textContent = r.spectators.length ? `👀 צופים: ${r.spectators.map((s) => s.name).join(', ')}` : '';

  const s = r.settings;
  setSeg('#set-teams', s.teams ? 1 : 0, isHost, (v) => emit('room:settings', { teams: v === 1 }));
  $('#settings-note').textContent = isHost ? '' : '(רק המארח משנה)';

  const n = r.players.length;
  const start = $('#btn-start');
  start.hidden = !isHost;
  let hint = '';
  if (n < 2) hint = 'מחכים לעוד שחקן לפחות… שלח את הקישור 👆';
  else if (s.teams && n !== 4) hint = 'משחק בזוגות דורש 4 שחקנים';
  else if (!isHost) hint = `ממתינים ש${r.players.find((p) => p.pid === r.hostPid)?.name || 'המארח'} יתחיל את המשחק…`;
  else hint = `${n} שחקנים · 7 אבנים לכל אחד${n === 4 ? ' · בלי קופה' : ''}`;
  start.disabled = n < 2 || (s.teams && n !== 4);
  $('#start-hint').textContent = hint;
}

function mkBtn(label, title, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.onclick = fn;
  return b;
}

function setSeg(sel, value, editable, onPick) {
  const seg = $(sel);
  seg.classList.toggle('locked', !editable);
  $$('button', seg).forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) === Number(value));
    b.onclick = editable ? () => onPick(Number(b.dataset.v)) : null;
  });
}

$('#btn-copy').onclick = () => copyLink();
$('#m-copy').onclick = () => copyLink();
$('#btn-share-native').onclick = () => navigator.share?.({ title: 'דומינו חמישיות', text: 'בוא לשחק איתי דומינו חמישיות 🀄', url: roomLink(S.code) }).catch(() => {});
$('#lobby-leave').onclick = () => confirm('לצאת מהשולחן?') && leaveRoom();
$('#btn-start').onclick = () => {
  Sound.unlock();
  emit('game:start');
};

async function copyLink() {
  try {
    await navigator.clipboard.writeText(roomLink(S.code));
    toast('הקישור הועתק ✓ – הדבק לחברים');
  } catch {
    $('#share-link').select();
    toast('סמן והעתק את הקישור');
  }
}

// ---------- המשחק ----------
const memberOf = (pid) => S.room.players.find((p) => p.pid === pid) || S.room.spectators.find((p) => p.pid === pid) || { name: 'שחקן', avatar: '🙂' };
const playerAt = (seat) => memberOf(S.game.seats[seat]);
const sideOf = (g, seat) => (g.teams ? seat % 2 : seat);
const viewSeat = (g) => (g.mySeat >= 0 ? g.mySeat : 0);

function seatPosition(g, seat) {
  const rel = (seat - viewSeat(g) + g.n) % g.n;
  if (rel === 0) return 'bottom';
  if (g.n === 2) return 'top';
  if (g.n === 3) return rel === 1 ? 'left' : 'right';
  return ['bottom', 'left', 'top', 'right'][rel];
}

function sideName(g, side) {
  if (!g.teams) return playerAt(side).name;
  return `${playerAt(side).name} ו${playerAt(side + 2).name}`;
}

function renderGame(prev) {
  const g = S.game;
  const newHand = !prev || prev.handNo !== g.handNo;
  if (newHand) {
    S.handOrder = [];
    S.selected = null;
    S.boardIds = new Set();
    S.freshIds.clear();
    S.dealAnim = true;
    S.readySent = false;
  }
  // אבנים חדשות ביד (שליפה)
  if (g.hand && prev && !newHand && prev.hand) {
    const had = new Set(prev.hand.map((t) => t.id));
    g.hand.forEach((t) => !had.has(t.id) && S.freshIds.add(t.id));
  }
  if (S.selected && !g.hand?.some((t) => t.id === S.selected)) S.selected = null;
  if (!g.moves.length) S.selected = null;

  renderScoreboard(g, prev);
  renderSeats(g);
  renderBoard(g);
  renderHand(g);
  renderStatus(g);
  renderCallBar(g);
  processFx(g);
  renderHandModal(g);
  notifyTurn(g);
  S.dealAnim = false;
}

function renderScoreboard(g, prev) {
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  for (let side = 0; side < g.scores.length; side++) {
    const seats = g.teams ? [side, side + 2] : [side];
    const el = document.createElement('div');
    const turnSide = g.state === 'playing' && sideOf(g, g.turn) === side;
    const mine = g.mySeat >= 0 && sideOf(g, g.mySeat) === side;
    el.className = `score-pill${turnSide ? ' turn' : ''}`;
    if (prev && prev.scores[side] !== g.scores[side]) el.classList.add('bump');
    const label = g.teams ? `<span class="team-chip" style="background:${TEAM_COLORS[side]}">${mine ? 'אנחנו' : TEAM_NAMES[side]}</span>` : '';
    el.innerHTML = `<span class="av">${seats.map((s) => esc(playerAt(s).avatar)).join('')}</span>${label}
      <span class="pts">${g.scores[side]}</span><span class="tg">/${g.target}</span>
      <span class="bar"><i style="--p:${Math.min(100, (g.scores[side] / g.target) * 100)}%"></i></span>`;
    el.title = sideName(g, side);
    sb.appendChild(el);
  }
}

function renderSeats(g) {
  ['top', 'left', 'right'].forEach((p) => ($(`#slot-${p}`).innerHTML = ''));
  for (let seat = 0; seat < g.n; seat++) {
    const pos = seatPosition(g, seat);
    if (pos === 'bottom') continue;
    const p = playerAt(seat);
    const el = document.createElement('div');
    el.className = `opp${g.state === 'playing' && g.turn === seat ? ' turn' : ''}${!p.connected || p.left ? ' off' : ''}`;
    el.id = `seat-${seat}`;
    const count = g.handCounts[seat];
    // היריב "מושיט יד" לאבן – רואים אותה מורמת אצלו
    const reach = S.reach[seat];
    const upIdx = g.turn === seat && reach && Date.now() - reach.t < 6000 ? Math.min(reach.index, Math.min(count, 12) - 1) : -1;
    const backs = Array.from({ length: Math.min(count, 12) }, (_, i) => Tiles.backSVG(false).replace('class="tile-svg back"', `class="tile-svg back${i === upIdx ? ' up' : ''}"`)).join('');
    const team = g.teams ? `<span class="team-chip" style="background:${TEAM_COLORS[seat % 2]}">${sideOf(g, seat) === sideOf(g, viewSeat(g)) && g.mySeat >= 0 ? 'שותף' : 'יריב'}</span>` : '';
    const thinking = g.state === 'playing' && g.turn === seat && p.connected && !p.left ? '<span class="think"><i></i><i></i><i></i></span>' : '';
    const sub = p.left ? '🤖 מחשב' : !p.connected ? '📴 מנותק' : `${count} אבנים${thinking}`;
    el.innerHTML = `<div class="avatar-ring">${esc(p.avatar)}<div class="timer" hidden></div></div>
      <div class="info"><div class="nm">${esc(p.name)}</div><div class="sub">${sub} ${team}</div></div>
      <div class="backs">${backs}</div>`;
    $(`#slot-${pos}`).appendChild(el);
  }
  const me = $('#me-badge');
  if (g.mySeat >= 0) {
    const p = playerAt(g.mySeat);
    me.dataset.seat = g.mySeat;
    me.innerHTML = `<div class="avatar-ring">${esc(p.avatar)}<div class="timer" hidden></div></div>`;
  } else {
    me.innerHTML = `<div class="avatar-ring">👀</div>`;
  }
}

function boardOpts() {
  const f = $('#felt');
  const r = f.clientWidth / Math.max(1, f.clientHeight);
  if (r > 1.35) return { lr: 9, ud: 3 };
  if (r > 0.95) return { lr: 6, ud: 4 };
  return { lr: 4, ud: 6 };
}

function renderBoard(g) {
  const svg = $('#board');
  const lay = Tiles.layout(g.board, boardOpts());
  const last = g.lastMove?.tileId;
  const fromPos = g.lastMove ? seatPosition(g, g.lastMove.seat) : 'bottom';
  const off = { bottom: [0, 9], top: [0, -9], left: [-9, 0], right: [9, 0] }[fromPos];
  let html = '';
  for (const p of lay.placed) {
    const isNew = !S.boardIds.has(p.id) && p.id === last;
    html += `<g class="placed${p.id === last ? ' last' : ''}" data-id="${p.id}"><g class="${isNew ? 'anim' : ''}" style="--fx:${off[0]}px;--fy:${off[1]}px">${Tiles.face(p.cx, p.cy, p.horiz, p.first, p.second)}</g></g>`;
  }
  S.boardIds = new Set(lay.placed.map((p) => p.id));

  const ghosts = [];
  for (const m of g.moves) {
    const gh = Tiles.ghostFor(lay, m);
    if (gh) ghosts.push({ ...gh, move: m });
  }
  for (const gh of ghosts) {
    if (gh.move.tileId !== S.selected) continue;
    const w = gh.horiz ? 2 : 1, h = gh.horiz ? 1 : 2;
    const badge = hints && gh.move.score ? `<g><circle class="ghost-badge" cx="${gh.cx}" cy="${gh.cy}" r="0.48"/><text class="ghost-label" x="${gh.cx}" y="${gh.cy + 0.22}" text-anchor="middle">${gh.move.score}</text></g>` : '';
    html += `<g class="ghost" data-tile="${gh.move.tileId}" data-end="${gh.move.end}">
      <rect class="gbox" x="${gh.cx - w / 2}" y="${gh.cy - h / 2}" width="${w}" height="${h}" rx="0.13"/>
      ${Tiles.face(gh.cx, gh.cy, gh.horiz, gh.first, gh.second)}${badge}</g>`;
  }
  svg.innerHTML = html;
  $$('.ghost', svg).forEach((el) => (el.onclick = () => playMove(el.dataset.tile, el.dataset.end)));

  // התאמת התצוגה לכל האבנים + מקומות אפשריים, באותו יחס כמו השולחן
  const b = Tiles.bounds([...lay.placed, ...ghosts]);
  const pad = 1.4;
  let x = b.x0 - pad, y = b.y0 - pad - 0.8, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2 + 1.6;
  const f = $('#felt');
  const aspect = f.clientWidth / Math.max(1, f.clientHeight);
  const minW = 13;
  if (w < minW) { x -= (minW - w) / 2; w = minW; }
  if (w / h > aspect) { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
  else { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
  tweenViewBox([x, y, w, h]);

  // סכום הקצוות
  const pill = $('#count-pill');
  if (!hints) pill.textContent = '';
  else if (g.board.center) {
    const pts = g.count > 0 && g.count % 5 === 0 ? g.count / 5 : 0;
    pill.textContent = pts ? `סכום הקצוות: ${g.count} = ${pts} נק׳` : `סכום הקצוות: ${g.count}`;
    pill.classList.toggle('five', g.count > 0 && g.count % 5 === 0);
  } else pill.textContent = g.state === 'playing' ? 'השולחן ריק' : '';

  // קופה
  const by = $('#boneyard');
  const stack = Array.from({ length: Math.min(3, g.boneyard) }, (_, i) => `<div style="bottom:${i * 3}px;left:${i * 2}px">${Tiles.backSVG(true)}</div>`).join('');
  by.innerHTML = `<div class="stack">${stack}</div><span class="n">${g.boneyard ? `קופה: ${g.boneyard}` : 'הקופה ריקה'}</span>`;
  by.classList.toggle('can', g.canDraw);
  by.onclick = g.canDraw ? doDraw : null;
  $('#hand-no').textContent = `יד ${g.handNo}`;
}

function tweenViewBox(target) {
  const svg = $('#board');
  const from = S.vb;
  S.vb = target;
  cancelAnimationFrame(S.vbAnim);
  if (!from) return svg.setAttribute('viewBox', target.join(' '));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 380);
    const e = 1 - Math.pow(1 - k, 3);
    svg.setAttribute('viewBox', from.map((v, i) => v + (target[i] - v) * e).join(' '));
    if (k < 1) S.vbAnim = requestAnimationFrame(step);
  };
  S.vbAnim = requestAnimationFrame(step);
}

function sortedHand(g) {
  const hand = g.hand || [];
  const ids = new Set(hand.map((t) => t.id));
  S.handOrder = S.handOrder.filter((id) => ids.has(id));
  const known = new Set(S.handOrder);
  const extra = hand.filter((t) => !known.has(t.id));
  if (!S.handOrder.length) extra.sort((x, y) => y.a + y.b - (x.a + x.b) || y.a - x.a);
  S.handOrder.push(...extra.map((t) => t.id));
  const byId = Object.fromEntries(hand.map((t) => [t.id, t]));
  return S.handOrder.map((id) => byId[id]);
}

function renderHand(g) {
  const el = $('#hand');
  el.innerHTML = '';
  const myTurn = g.state === 'playing' && g.mySeat === g.turn;
  el.classList.toggle('myturn', myTurn);
  if (g.mySeat < 0) {
    const n = g.handCounts[0];
    el.innerHTML = `<div class="hand-empty">👀 אתה צופה במשחק · ${esc(playerAt(0).name)} מחזיק ${n} אבנים</div>`;
    return;
  }
  const hand = sortedHand(g);
  const playable = new Set(g.moves.map((m) => m.tileId));
  const n = hand.length;
  const avail = el.clientWidth || window.innerWidth - 20;
  const size = Math.max(30, Math.min(desktop.matches ? 54 : 48, Math.floor((avail - 6 * Math.min(n, 9)) / Math.min(Math.max(n, 1), 9))));
  el.style.setProperty('--hand-tile', `${size}px`);
  hand.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'ht';
    if (myTurn) b.classList.add(playable.has(t.id) ? 'ok' : 'no');
    if (S.selected === t.id) b.classList.add('sel');
    if (S.freshIds.has(t.id)) {
      b.classList.add('fresh');
      S.freshIds.delete(t.id);
    }
    if (S.dealAnim) {
      b.classList.add('dealt');
      b.style.setProperty('--d', `${i * 0.07}s`);
    }
    b.innerHTML = Tiles.handTileSVG(t.a, t.b);
    b.onclick = () => onTileClick(t);
    el.appendChild(b);
  });
  if (!n && g.state === 'playing') el.innerHTML = `<div class="hand-empty">אין לך אבנים</div>`;
}

function onTileClick(t) {
  const g = S.game;
  Sound.unlock();
  const myTurn = g.state === 'playing' && g.mySeat === g.turn;
  if (!myTurn) {
    S.selected = S.selected === t.id ? null : t.id;
    renderHand(g);
    return;
  }
  const opts = g.moves.filter((m) => m.tileId === t.id);
  if (!opts.length) {
    Sound.play('error');
    toast(g.required ? `צריך לפתוח עם ${g.required[0]}|${g.required[1]}` : g.canDraw ? 'אין לך אבן מתאימה – שלוף מהקופה' : 'האבן הזו לא מתאימה לאף קצה');
    return;
  }
  // אם יש רק מקום אחד – מניחים מיד, כמו בשולחן אמיתי
  const uniqueEnds = new Set(opts.map((o) => o.end));
  if (uniqueEnds.size === 1) return playMove(t.id, opts[0].end);
  S.selected = S.selected === t.id ? null : t.id;
  Sound.play('clack', 0.25);
  socket.emit('game:reach', { index: S.selected ? S.handOrder.indexOf(S.selected) : null });
  renderHand(g);
  renderBoard(g);
  if (S.selected) renderStatus(g);
}

async function playMove(tileId, end) {
  S.selected = null;
  const res = await emit('game:play', { tileId, end });
  if (!res.ok) renderGame(S.game);
}

async function doDraw() {
  if (!S.game?.canDraw) return;
  await emit('game:draw');
}

$('#btn-draw').onclick = doDraw;
$('#btn-pass').onclick = () => emit('game:pass');
$('#btn-sort').onclick = () => {
  const g = S.game;
  if (!g?.hand) return;
  S.sortMode = (S.sortMode + 1) % 2;
  const hand = [...g.hand];
  if (S.sortMode === 0) hand.sort((x, y) => y.a + y.b - (x.a + x.b) || y.a - x.a);
  else hand.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b));
  S.handOrder = hand.map((t) => t.id);
  Sound.play('shuffle');
  renderHand(g);
  toast(S.sortMode === 0 ? 'מסודר לפי סכום' : 'מסודר לפי מספר');
};

// ---------- הכרזה ----------
const CALLS = [5, 10, 15, 20, 25, 30, 35, 40, 45];
function renderCallBar(g) {
  const bar = $('#call-bar');
  const open = !!g.canCall;
  if (open && bar.hidden) {
    // הכפתור מופיע אחרי כל מהלך שלך – גם כשאין נקודות. לשים לב זה חלק מהמשחק.
    $('#call-chips').innerHTML = CALLS.map((v) => `<button data-v="${v}">${v}</button>`).join('');
    $$('#call-chips button').forEach((b) => (b.onclick = () => doCall(Number(b.dataset.v))));
  }
  bar.hidden = !open;
}
async function doCall(value) {
  $('#call-bar').hidden = true;
  Sound.unlock();
  await emit('game:call', { value });
}

const NUM_WORDS = { 0: 'אפס', 5: 'חמש', 10: 'עשר', 15: 'חמש עשרה', 20: 'עשרים', 25: 'עשרים וחמש', 30: 'שלושים', 35: 'שלושים וחמש', 40: 'ארבעים', 45: 'ארבעים וחמש', 50: 'חמישים' };
const numberWord = (n) => NUM_WORDS[n] || String(n);

// קריינות: כל שחקן "אומר" את ההכרזה שלו בקול, בגובה קול אחר
function say(text, seat = 0) {
  if (Sound.muted || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'he-IL';
    const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('he'));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.pitch = [1, 0.75, 1.25, 0.9][seat % 4];
    speechSynthesis.speak(u);
  } catch {}
}

function stamp(text) {
  const el = document.createElement('div');
  el.className = 'stamp';
  el.textContent = text;
  $('#floaters').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function shuffleAnim() {
  const box = document.createElement('div');
  box.className = 'shuffle';
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('div');
    d.style.setProperty('--x', `${(Math.random() - 0.5) * 180}px`);
    d.style.setProperty('--y', `${(Math.random() - 0.5) * 120}px`);
    d.style.setProperty('--r', `${Math.random() * 360}deg`);
    d.style.setProperty('--r2', `${Math.random() * 360}deg`);
    d.innerHTML = Tiles.backSVG(true);
    box.appendChild(d);
  }
  $('#floaters').appendChild(box);
  setTimeout(() => box.remove(), 1500);
}

function flyFromBoneyard(seat) {
  const g = S.game;
  const from = $('#boneyard .stack')?.getBoundingClientRect();
  const target = seat === g.mySeat ? $('#hand') : $(`#seat-${seat} .backs`) || $(`#seat-${seat}`);
  if (!from || !target) return;
  const to = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'flyer';
  el.innerHTML = Tiles.backSVG(false);
  el.style.left = `${from.left}px`;
  el.style.top = `${from.top - 20}px`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translate(${to.left + to.width / 2 - from.left - 12}px, ${to.top + to.height / 2 - from.top}px) rotate(${seat === g.mySeat ? 0 : 90}deg) scale(${seat === g.mySeat ? 1.6 : 0.7})`;
    el.style.opacity = '0.2';
  });
  setTimeout(() => el.remove(), 650);
}

// ---------- דף ניקוד ----------
function renderPad() {
  const g = S.game;
  if (!g) return;
  const sides = g.scores.length;
  const hands = [...new Set(g.history.map((h) => h.hand))];
  if (!hands.includes(g.handNo)) hands.push(g.handNo);
  const head = Array.from({ length: sides }, (_, s) => `<th>${esc(g.teams ? (s === sideOf(g, viewSeat(g)) && g.mySeat >= 0 ? 'אנחנו' : 'הם') : playerAt(s).name)}</th>`).join('');
  const rows = hands
    .map((h) => {
      const cells = Array.from({ length: sides }, (_, s) => {
        const items = g.history.filter((x) => x.hand === h && x.side === s);
        const marks = items.map((x) => (x.kind === 'call' ? `<span>${x.pts}</span>` : `<span class="bonus">${x.pts}★</span>`)).join(' ');
        return `<td>${marks || '<span class="dash">–</span>'}</td>`;
      }).join('');
      return `<tr><th class="hn">${h}</th>${cells}</tr>`;
    })
    .join('');
  const totals = g.scores.map((s) => `<td class="tot">${s}</td>`).join('');
  $('#pad').innerHTML = `<table><thead><tr><th class="hn">יד</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot><tr><th class="hn">סה״כ</th>${totals}</tr></tfoot></table>
    <div class="pad-note">★ = בונוס סוף יד · עד ${g.target}</div>`;
}
$('#scoreboard').onclick = () => {
  renderPad();
  $('#pad-modal').hidden = false;
};

function renderStatus(g) {
  const st = $('#status');
  const myTurn = g.state === 'playing' && g.mySeat === g.turn;
  st.classList.toggle('myturn', myTurn);
  $('#btn-draw').hidden = !g.canDraw;
  $('#btn-pass').hidden = !g.canPass;
  $('#btn-sort').hidden = g.mySeat < 0;
  let text = '';
  if (g.state === 'closing') text = `🁫 ${esc(playerAt(g.closingSeat).name)} גמר! ${g.canCall ? 'הכרז על האבן האחרונה' : 'רגע…'}`;
  else if (g.state !== 'playing') text = g.state === 'gameOver' ? 'המשחק נגמר' : 'סוף היד';
  else if (myTurn) {
    if (g.required) text = `תורך לפתוח! הנח את <b>${g.required[0]}|${g.required[1]}</b>`;
    else if (!g.board.center) text = 'תורך לפתוח – הנח איזו אבן שתרצה';
    else if (g.canDraw) text = 'אין לך מה לשים – שלוף מהקופה';
    else if (g.canPass) text = 'אין מהלך והקופה ריקה – פאס';
    else if (S.selected) text = 'בחר איפה להניח (המקומות המסומנים)';
    else {
      const best = Math.max(...g.moves.map((m) => m.score));
      text = hints && best ? `תורך! יש לך מהלך ששווה <b>${best === 1 ? 'נקודה' : `${best} נקודות`}</b> 👀` : 'תורך! בחר אבן';
    }
  } else {
    const p = playerAt(g.turn);
    text = p.left ? `🤖 המחשב משחק במקום ${esc(p.name)}…` : `ממתינים ל<b>${esc(p.name)}</b>${p.connected ? '…' : ' (מנותק)'}`;
    if (g.mySeat < 0) text = '👀 ' + text;
  }
  st.innerHTML = text;
}

function processFx(g) {
  const list = S.pendingFx.splice(0);
  for (const ev of list) {
    const pid = g.seats[ev.seat];
    if (ev.type === 'play') {
      Sound.play('clack', ev.last ? 1.4 : 1);
      S.reach[ev.seat] = null;
      if (ev.last) {
        stamp('דומינו!');
        say('דומינו!', ev.seat);
      }
    } else if (ev.type === 'call') {
      say(numberWord(ev.value), ev.seat);
      if (ev.ok) {
        showBubble(pid, `${ev.value}! 📣`);
        setTimeout(() => {
          Sound.play('score', ev.count);
          floatAtTile(ev.tileId, `+${ev.points}`);
        }, 350);
        navigator.vibrate?.(30);
      } else {
        showBubble(pid, `${ev.value}?`);
        setTimeout(() => floatMsg(`❌ על הלוח ${ev.count}`), 400);
      }
    } else if (ev.type === 'missed') {
      Sound.play('lose');
      showBubble(pid, '😶');
      floatMsg(ev.seat === g.mySeat ? `🤐 שכחת להגיד ${ev.count}! ${ev.points} נק׳ הלכו` : `🤐 ${playerAt(ev.seat).name} שכח להגיד ${ev.count}!`);
    } else if (ev.type === 'draw') {
      Sound.play('draw');
      flyFromBoneyard(ev.seat);
      if (ev.seat !== g.mySeat) showBubble(pid, 'שולף 🂠');
    } else if (ev.type === 'pass') {
      Sound.play('knock');
      showBubble(pid, '✊ טוק-טוק (פאס)');
    } else if (ev.type === 'newHand') {
      Sound.play('shuffle');
      shuffleAnim();
      setTimeout(() => floatMsg(`יד ${ev.handNo}`), 900);
    } else if (ev.type === 'gameOver') {
      const won = g.mySeat >= 0 && sideOf(g, g.mySeat) === ev.winSide;
      setTimeout(() => {
        Sound.play(won || g.mySeat < 0 ? 'win' : 'lose');
        if (won) confetti();
      }, 900);
    } else if (ev.type === 'reachedTarget') {
      setTimeout(() => floatMsg(`🏁 ${sideName(g, ev.side)} עבר ${g.target} – מסיימים את הסיבוב`), 700);
    } else if (ev.type === 'handOver' && ev.reason === 'blocked') {
      floatMsg('המשחק נחסם 🔒');
    }
  }
}

function floatAtTile(tileId, text) {
  const felt = $('#felt');
  const el = $(`#board .placed[data-id="${tileId}"]`);
  const fr = felt.getBoundingClientRect();
  let x = fr.width / 2, y = fr.height / 2;
  if (el) {
    const r = el.getBoundingClientRect();
    x = r.left + r.width / 2 - fr.left;
    y = r.top + r.height / 2 - fr.top;
  }
  const f = document.createElement('div');
  f.className = 'float-score';
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  f.textContent = text;
  $('#floaters').appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

function floatMsg(text) {
  const f = document.createElement('div');
  f.className = 'float-msg';
  f.textContent = text;
  $('#floaters').appendChild(f);
  setTimeout(() => f.remove(), 1900);
}

let titleTimer = null;
function notifyTurn(g) {
  const myTurn = g.state === 'playing' && g.mySeat === g.turn;
  const was = S.wasMyTurn;
  S.wasMyTurn = myTurn;
  if (!myTurn || was) return;
  setTimeout(() => Sound.play('turn'), 450);
  navigator.vibrate?.([40, 60, 40]);
  if (document.hidden && !titleTimer) {
    let on = false;
    titleTimer = setInterval(() => {
      document.title = (on = !on) ? '🔔 תורך!' : 'דומינו חמישיות';
    }, 900);
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clearInterval(titleTimer);
    titleTimer = null;
    document.title = 'דומינו חמישיות';
    if (S.room?.game) requestWakeLock();
  }
});

// טיימר תור – טבעת סביב האווטאר
setInterval(() => {
  const g = S.game;
  $$('.avatar-ring .timer').forEach((t) => (t.hidden = true));
  $$('.avatar-ring .secs').forEach((t) => t.remove());
  if (!g || g.state !== 'playing' || !g.deadline) return;
  const left = g.deadline - (Date.now() + S.clockSkew);
  const total = (S.room.settings.turnTime || 30) * 1000;
  const frac = Math.max(0, Math.min(1, left / total));
  const host = g.turn === g.mySeat ? $('#me-badge .timer') : $(`#seat-${g.turn} .timer`);
  if (!host) return;
  host.hidden = false;
  host.style.setProperty('--t', `${frac * 100}%`);
  host.classList.toggle('low', left < 6000);
  const secs = document.createElement('span');
  secs.className = `secs${left < 10000 ? ' low' : ''}`;
  secs.textContent = Math.max(0, Math.ceil(left / 1000));
  host.parentElement.appendChild(secs);
  if (g.turn === g.mySeat && left < 10000 && left > 0 && !S.warned10) {
    S.warned10 = true;
    toast('⏱ נשארו 10 שניות!');
  }
  if (g.turn !== g.mySeat) S.warned10 = false;
  if (g.turn === g.mySeat && left < 6000 && left > 0 && Math.floor(left / 1000) !== S.lastTick) {
    S.lastTick = Math.floor(left / 1000);
    Sound.play('pop');
  }
}, 250);

// ---------- סיכום יד / סוף משחק ----------
function renderHandModal(g) {
  const modal = $('#hand-modal');
  if (g.state === 'playing' || !g.handResult) {
    modal.hidden = true;
    S.handModalFor = null;
    return;
  }
  const key = `${g.handNo}:${g.state}`;
  const r = g.handResult;
  const build = () => {
    const winnerName = r.winnerSeat != null ? playerAt(r.winnerSeat).name : '';
    let title = '';
    if (r.reason === 'domino') title = `${esc(winnerName)} גמר את האבנים! 🙌`;
    else if (r.reason === 'blocked') title = 'המשחק נחסם 🔒';

    let sub = '';
    if (r.winSide != null && r.points) sub = `+${r.points} ${r.points === 1 ? 'נקודה' : 'נקודות'} ל${esc(sideName(g, r.winSide))} (מה שנשאר ליריבים, מעוגל ל-5 ומחולק ב-5)`;
    else if (r.reason === 'blocked' && r.winSide == null) sub = 'תיקו בספירה – אף אחד לא מקבל נקודות';
    if (r.tieAtTop) sub += `${sub ? '<br>' : ''}⚖️ תיקו מעל ${g.target} – משחקים עוד יד`;
    if (g.state === 'gameOver') {
      const won = g.mySeat >= 0 && sideOf(g, g.mySeat) === g.winnerSide;
      title = `<div class="winner-big">🏆</div>${won ? (g.teams ? 'ניצחתם!' : 'ניצחת!') : `${esc(sideName(g, g.winnerSide))} ניצח${g.teams ? 'ו' : ''}!`}`;
      sub = `${sub ? sub + ' · ' : ''}סוף הסיבוב: ${g.scores[g.winnerSide]} נקודות`;
    }
    $('#hand-title').innerHTML = title;
    $('#hand-sub').innerHTML = sub;
    $('#hand-reveal').innerHTML = r.hands
      .map((h, seat) => {
        const p = playerAt(seat);
        const win = r.winSide != null && sideOf(g, seat) === r.winSide;
        const tiles = h.length ? h.map((t) => Tiles.flatTileSVG(t.a, t.b)).join('') : '<span class="muted small">גמר! ✨</span>';
        return `<div class="reveal-row${win ? ' win' : ''}"><div class="who">${esc(p.avatar)} ${esc(p.name)}</div><div class="tiles">${tiles}</div><div class="p">${r.handPips[seat]}</div></div>`;
      })
      .join('');
    $('#hand-totals').innerHTML = g.scores
      .map((s, side) => `<div class="total-row"><div class="nm">${esc(sideName(g, side))}</div><div class="track"><i style="--p:${Math.min(100, (s / g.target) * 100)}%"></i></div><div class="pts">${s}</div></div>`)
      .join('');
  };
  if (S.handModalFor !== key) {
    S.handModalFor = key;
    // השהיה קצרה כדי לראות את האבן האחרונה נוחתת
    modal.hidden = true;
    setTimeout(() => {
      if (S.handModalFor === key) {
        build();
        modal.hidden = false;
      }
    }, 1300);
  } else if (!modal.hidden) build();
  renderHandActions(g);
}

function renderHandActions(g) {
  const isHost = S.room.hostPid === S.room.me;
  const actions = $('#hand-actions');
  const chatBtn = `<button class="btn modal-chat" id="btn-modal-chat">💬 צ'אט${S.unread ? ` (${S.unread})` : ''}</button>`;
  const ready = $('#ready-row');
  if (g.state === 'handOver') {
    ready.innerHTML = g.seats
      .map((pid, seat) => {
        const p = memberOf(pid);
        if (p.left) return '';
        const ok = g.ready.includes(seat);
        return `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '…'} ${esc(p.name)}</span>`;
      })
      .join('');
    const meReady = g.mySeat >= 0 && g.ready.includes(g.mySeat);
    actions.innerHTML = g.mySeat >= 0 ? `<button class="btn primary big" id="btn-ready" ${meReady ? 'disabled' : ''}>${meReady ? 'ממתין לשאר…' : 'מוכן ליד הבאה ▶'}</button>` : '<span class="muted">היד הבאה תתחיל בקרוב…</span>';
    actions.insertAdjacentHTML('beforeend', chatBtn);
    const btn = $('#btn-ready');
    if (btn) btn.onclick = () => emit('game:ready');
    tickHandBreak();
  } else {
    ready.innerHTML = '';
    actions.innerHTML = isHost
      ? `<button class="btn primary" id="btn-rematch">🔁 משחק חוזר</button><button class="btn" id="btn-lobby">↩ ללובי</button><button class="btn" id="btn-exit">יציאה</button>`
      : `<span class="muted">ממתינים למארח…</span><button class="btn" id="btn-exit">יציאה</button>`;
    actions.insertAdjacentHTML('beforeend', chatBtn);
    if (isHost) {
      $('#btn-rematch').onclick = () => emit('game:rematch');
      $('#btn-lobby').onclick = () => emit('room:lobby');
    }
    $('#btn-exit').onclick = () => confirm('לצאת מהשולחן?') && leaveRoom();
  }
  $('#btn-modal-chat').onclick = () => openChat(true);
}

function tickHandBreak() {
  const g = S.game;
  if (!g || g.state !== 'handOver' || !g.handBreakEnds) return;
  const secs = Math.max(0, Math.round((g.handBreakEnds - (Date.now() + S.clockSkew)) / 1000));
  let el = $('#break-left');
  if (!el) {
    el = document.createElement('div');
    el.id = 'break-left';
    el.className = 'muted small center';
    el.style.marginTop = '8px';
    $('#hand-actions').after(el);
  }
  el.textContent = `היד הבאה תתחיל אוטומטית בעוד ${secs} שניות`;
}
setInterval(() => {
  if (S.game?.state === 'handOver') tickHandBreak();
  else $('#break-left')?.remove();
}, 1000);

// ---------- צ'אט ----------
function addChat(m, live) {
  const log = $('#chat-log');
  const el = document.createElement('div');
  const time = new Date(m.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (m.kind === 'user') {
    const mine = m.pid === S.room?.me;
    el.className = `msg${mine ? ' mine' : ''}`;
    el.innerHTML = `<div class="av">${esc(m.avatar)}</div><div class="txt">${mine ? '' : `<div class="who">${esc(m.name)}</div>`}${esc(m.text)}<span class="time">${time}</span></div>`;
    if (live) {
      showBubble(m.pid, m.text);
      S.typing.delete(m.pid);
      renderTyping();
      if (!mine) {
        Sound.play('pop');
        if (!S.chatOpen) {
          S.unread++;
          updateBadge();
        }
      }
    }
  } else {
    el.className = `msg sys${m.kind === 'score' ? ' score' : ''}`;
    el.textContent = m.text;
  }
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.appendChild(el);
  while (log.children.length > 200) log.firstChild.remove();
  if (atBottom || !live || m.pid === S.room?.me) log.scrollTop = log.scrollHeight;
}

function renderTyping() {
  const now = Date.now();
  const names = [...S.typing.entries()].filter(([, t]) => now - t < 2500).map(([pid]) => memberOf(pid).name);
  $('#typing').textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'מקלידים' : 'מקליד/ה'}…` : '';
}

function updateBadge() {
  const b = $('#chat-badge');
  b.hidden = !S.unread;
  b.textContent = S.unread > 9 ? '9+' : S.unread;
}

function seatElFor(pid) {
  const g = S.game;
  if (!g) return null;
  const seat = g.seats.indexOf(pid);
  if (seat < 0) return null;
  return seat === g.mySeat ? $('#me-badge') : $(`#seat-${seat}`);
}

function showBubble(pid, text, emoji) {
  const host = seatElFor(pid);
  if (!host || !$('#screen-game').classList.contains('active')) return;
  host.querySelector('.bubble')?.remove();
  const b = document.createElement('div');
  b.className = `bubble${emoji ? ' emoji' : ''}`;
  b.textContent = text.length > 80 ? text.slice(0, 78) + '…' : text;
  host.appendChild(b);
  setTimeout(() => b.remove(), emoji ? 2200 : 4200);
}

function openChat(open) {
  if (desktop.matches) return;
  S.chatOpen = open;
  $('#chat').classList.toggle('open', open);
  if (open) {
    S.unread = 0;
    updateBadge();
    const log = $('#chat-log');
    log.scrollTop = log.scrollHeight;
  }
}
$('#btn-chat').onclick = () => openChat(true);
$('#chat-close').onclick = () => openChat(false);
$('#chat-scrim').onclick = () => openChat(false);

let lastTypingSent = 0;
$('#chat-input').addEventListener('input', () => {
  if (Date.now() - lastTypingSent > 2000) {
    lastTypingSent = Date.now();
    socket.emit('chat:typing');
  }
});
$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  emit('chat:send', { text });
  input.value = '';
};
QUICK.forEach((q) => {
  const b = document.createElement('button');
  b.textContent = q;
  b.onclick = () => emit('chat:send', { text: q });
  $('#quick-phrases').appendChild(b);
});
REACTIONS.forEach((r) => {
  const b = document.createElement('button');
  b.textContent = r;
  b.onclick = () => socket.emit('react', { emoji: r });
  $('#reactions').appendChild(b);
});

// ---------- תפריט וחלונות ----------
function renderMenu() {
  $('#m-sound').textContent = Sound.muted ? '🔇 צלילים כבויים' : '🔊 צלילים פעילים';
  $('#m-hints').textContent = hints ? '💡 עזרה בספירה: פעיל' : '💡 עזרה בספירה: כבוי';
  $('#m-colors').textContent = classic ? '⚫ אבנים: קלאסיות (שחור)' : '🎨 אבנים: צבעוניות';
  const g = S.game;
  $('#m-lobby').hidden = !(S.room && S.room.hostPid === S.room.me && g && g.state !== 'playing');
}
$('#game-menu').onclick = () => {
  renderMenu();
  $('#menu-modal').hidden = false;
};
$('#m-sound').onclick = () => {
  Sound.toggle();
  renderMenu();
};
$('#m-colors').onclick = () => {
  classic = !classic;
  store.set('dm_classic', classic);
  document.body.classList.toggle('classic', classic);
  renderMenu();
};
$('#m-hints').onclick = () => {
  hints = !hints;
  store.set('dm_hints', hints);
  renderMenu();
  if (S.game) renderGame(S.game);
};
$('#m-lobby').onclick = () => {
  $('#menu-modal').hidden = true;
  emit('room:lobby');
};
$('#m-leave').onclick = () => {
  if (confirm(S.game?.state === 'playing' ? 'לעזוב באמצע? המחשב ימשיך לשחק במקומך.' : 'לצאת מהשולחן?')) leaveRoom();
};
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) {
    $('#menu-modal').hidden = true;
    if (open.dataset.open === 'pad-modal') renderPad();
    $(`#${open.dataset.open}`).hidden = false;
  }
  if (e.target.closest('[data-close]')) e.target.closest('.modal').hidden = true;
  if (e.target.classList.contains('modal') && e.target.id !== 'hand-modal') e.target.hidden = true;
});

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !S.wakeLock) {
      S.wakeLock = await navigator.wakeLock.request('screen');
      S.wakeLock.addEventListener('release', () => (S.wakeLock = null));
    }
  } catch {}
}

function confetti() {
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth;
  c.height = innerHeight;
  const colors = ['#e8b84a', '#fff4d6', '#57d18a', '#2f7de1', '#d9534f'];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * c.width,
    y: -20 - Math.random() * c.height * 0.5,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    s: 6 + Math.random() * 6,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - t0 < 4500) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, c.width, c.height);
  };
  requestAnimationFrame(frame);
}

let resizeT;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => S.game && renderGame(S.game), 150);
});

initHome();
