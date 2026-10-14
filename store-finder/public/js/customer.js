import { api, escapeHtml, formatPrice, resizeImage, getToken } from '/js/api.js';
import { renderMap, findPath, describeLocation, drawCrop, aisleSpot, planRoute, directions } from '/js/map.js';
import { t, lang, setLang, LANGS, aisleName, levelName, translatePage } from '/js/i18n.js';

const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const pub = (path) => `/api/public/${encodeURIComponent(slug)}${path}`;
let store = null;
let results = [];
let hereShelf = null; // set when the page was opened from an aisle QR sticker, or after reaching a shelf
let voiceMode = false; // the shopper searched by voice, so we answer by voice too
let spokenAnswer = '';
let lastQuery = '';
let current = null; // product on the detail page
let trending = [];

// ---------- voice: a real, clear human voice (premium, from the server) or the phone's own ----------
const canSpeak = 'speechSynthesis' in window;
function forSpeech(text) {
  return text.replace(/ס["״]מ/g, 'סנטימטר').replace(/מ["״]ל/g, 'מיליליטר').replace(/[·|/]/g, ',');
}
// Phones only allow sound after a tap, so the audio element is unlocked on the first touch and reused.
const player = new Audio();
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  // a few ms of silence, played inside the tap, lets later answers play out loud on iOS
  const sr = 8000, n = 80, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']].forEach(([o, str]) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))));
  v.setUint32(4, 36 + n * 2, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); v.setUint32(40, n * 2, true);
  player.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  player.play().catch(() => {});
}
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
function speakDevice(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  u.lang = LANGS[lang].voice;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
let speakSeq = 0;
async function speak(text) {
  if (!text) return;
  const seq = ++speakSeq;
  player.pause();
  if (canSpeak) speechSynthesis.cancel();
  if (store?.premiumVoice) {
    try {
      const res = await fetch(pub('/tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      if (seq !== speakSeq) return; // a newer answer started meanwhile
      player.src = URL.createObjectURL(blob);
      await player.play();
      return;
    } catch { /* fall back to the phone's voice */ }
  }
  if (seq === speakSeq) speakDevice(text);
}
const voiceOk = () => canSpeak || store?.premiumVoice;

// ---------- small comforts: toast, a light tap on the hand ----------
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

// ---------- anonymous visitor + events ----------
const LAST_KEY = `storeFinder:last:${slug}`;
const LIST_KEY = `storeFinder:list:${slug}`;
const SEEN_KEY = `storeFinder:seen:${slug}`;
const visitor = (() => {
  try {
    let v = localStorage.getItem('storeFinder:visitor');
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20); localStorage.setItem('storeFinder:visitor', v); }
    return v;
  } catch { return ''; }
})();
function track(type, extra = {}) {
  return api(pub('/events'), { method: 'POST', body: { type, visitor, ...extra } });
}
function rememberProduct(p) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ id: p.id, ts: Date.now() })); } catch { /* private mode */ }
}
function recentProductId() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return v && Date.now() - v.ts < 30 * 60 * 1000 ? v.id : null;
  } catch { return null; }
}

function shelfOf(p) { return store.map.shelves.find((s) => s.id === p.shelfId); }
// "מעבר 4 · פחים" -> "מעבר 4" for compact chips
function shortShelf(shelf) { return aisleName(shelf, { short: true }); }
function chip(text, cls = '') { return `<span class="chip ${cls}">${escapeHtml(text)}</span>`; }
function markBox(el, box) {
  el.classList.toggle('hidden', !box);
  if (box) Object.assign(el.style, { left: `${box.x0 / 10}%`, top: `${box.y0 / 10}%`, width: `${(box.x1 - box.x0) / 10}%`, height: `${(box.y1 - box.y0) / 10}%` });
}

// ---------- screens and the phone's back button ----------
// Every screen is a step in the browser history, so "back" on the phone moves between screens
// instead of leaving the store.
const VIEWS = ['home-view', 'home-extra', 'results-view', 'deals-view', 'detail', 'nav-view', 'arrived-view', 'list-view'];
const SHOWS = {
  home: ['home-view', 'home-extra'], results: ['results-view'], deals: ['deals-view'],
  detail: ['detail'], nav: ['nav-view'], arrived: ['arrived-view'], list: ['list-view'],
};
const TAB_OF = { home: 'home', results: 'home', deals: 'deals', list: 'list' };
function setView(name) {
  stopWalker();
  for (const id of VIEWS) $(id).classList.toggle('hidden', !SHOWS[name].includes(id));
  $('search-wrap').classList.toggle('hidden', !['home', 'results'].includes(name));
  document.body.dataset.view = name;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === TAB_OF[name]);
  renderListBadge();
  window.scrollTo({ top: 0 });
}
const screens = [];
let at = 0;
function go(render, url) {
  screens.length = at + 1;
  screens.push(render);
  at = screens.length - 1;
  history.pushState({ i: at }, '', url);
  render();
}
window.addEventListener('popstate', (e) => {
  at = Math.min(e.state?.i ?? 0, screens.length - 1);
  (screens[at] || renderHome)();
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) history.back(); });

// ---------- home: the buddy ----------
function greeting() {
  const h = new Date().getHours();
  return t(h >= 5 && h < 12 ? 'greet_morning' : h < 17 && h >= 12 ? 'greet_noon' : h >= 17 && h < 22 ? 'greet_evening' : 'greet_night');
}
let returning = false;
try { returning = Boolean(localStorage.getItem(SEEN_KEY)); localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
function renderHome() {
  setView('home');
  current = null;
  $('greet-title').textContent = t('buddy_intro', { g: greeting() });
  $('greet-sub').textContent = t(returning ? 'greet_back' : 'greet_first');
  const todo = loadList().filter((i) => !i.picked).length;
  $('continue-card').classList.toggle('hidden', !todo);
  $('continue-text').textContent = t('continue_list', { n: todo });
}
$('buddy-face').addEventListener('click', () => speak(`${$('greet-title').textContent.replace(/[^\p{L}\p{N}\s!?,.'׳]/gu, '')} ${$('greet-sub').textContent}`));
$('continue-card').addEventListener('click', () => go(renderListView));

// The search box shows a new example every few seconds: what people really search for in this store.
let phIdx = 0;
setInterval(() => {
  const q = $('q');
  if (!trending.length || q.value || document.activeElement === q) return;
  phIdx = (phIdx + 1) % trending.length;
  q.placeholder = t('try_q', { q: trending[phIdx] });
}, 2800);

async function loadHome() {
  const [home, deals] = await Promise.all([
    api(pub('/home')).catch(() => ({ trending: [], categories: [] })),
    api(pub('/deals')).catch(() => []),
  ]);
  // trending searches are what shoppers typed in Hebrew, so they're shown in Hebrew only
  trending = lang === 'he' ? home.trending : [];
  if (trending.length) $('q').placeholder = t('try_q', { q: trending[0] });
  $('trending').innerHTML = trending.map((q) => `<button type="button" class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  $('trending-box').classList.toggle('hidden', !trending.length);
  $('nr-chips').innerHTML = $('trending').innerHTML;
  $('nr-try').classList.toggle('hidden', !trending.length);
  $('cats').replaceChildren(...home.categories.map(catTile));
  $('cats-box').classList.toggle('hidden', !home.categories.length);
  $('deals-row').replaceChildren(...deals.slice(0, 10).map((p) => miniCard(p)));
  $('deals').classList.toggle('hidden', !deals.length);
  $('deal-grid').replaceChildren(...deals.map((p) => miniCard(p)));
  $('deals-empty').classList.toggle('hidden', deals.length > 0);
}
document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-q]')?.dataset.q;
  if (q) { buzz(); $('q').value = q; search(q); }
});

function catTile(c) {
  const shelf = store.map.shelves.find((s) => s.id === c.shelfId);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cat-tile';
  const canvas = document.createElement('canvas');
  if (c.sample) drawCrop(canvas, c.sample.image || c.sample.photo, c.sample.image ? null : c.sample.box, 200);
  const [aisle, dept] = lang === 'he' ? shelf.name.split('·').map((x) => x.trim()) : [aisleName(shelf), ''];
  el.innerHTML = `<span class="ct-name">${escapeHtml(dept || aisle)}</span><span class="ct-meta">${escapeHtml(dept ? aisle : '')}${dept ? ' · ' : ''}${escapeHtml(t('n_products', { n: c.count }))}</span>`;
  el.prepend(canvas);
  el.addEventListener('click', () => { buzz(); go(() => renderAisle(shelf)); });
  return el;
}
async function renderAisle(shelf) {
  setView('results');
  $('no-results').classList.add('hidden');
  $('results').innerHTML = '';
  $('status').innerHTML = '<span class="row"><span class="spinner"></span></span>';
  results = await api(pub(`/aisle/${encodeURIComponent(shelf.id)}`)).catch(() => []);
  $('status').textContent = t('aisle_status', { a: aisleName(shelf), n: results.length });
  showResultCards();
}

// ---------- search ----------
function search(q) {
  q = q.trim();
  if (!q) return;
  $('q').blur();
  const url = `?q=${encodeURIComponent(q)}${hereShelf ? `&at=${encodeURIComponent(hereShelf.id)}` : ''}`;
  const voice = voiceMode;
  go(() => { voiceMode = voice; runSearch(q); }, url);
}
let searchSeq = 0;
const searchCache = new Map(); // going back to a search shows it again without counting it twice
async function runSearch(q) {
  const seq = ++searchSeq;
  lastQuery = q;
  $('q').value = q;
  setView('results');
  $('no-results').classList.add('hidden');
  $('status').innerHTML = `<span class="row"><span class="spinner"></span> ${t('searching')}</span>`;
  $('results').innerHTML = '';
  try {
    const data = searchCache.get(q) || await api(pub(`/search?q=${encodeURIComponent(q)}&v=${visitor}`));
    searchCache.set(q, data);
    if (seq !== searchSeq) return;
    results = data.results;
    if (!results.length) return showNoResults(t('not_found', { q }), t('voice_not_found', { q }));
    $('status').textContent = data.expanded ? t('maybe_meant', { q }) : t('n_results_pick', { n: results.length, q });
    showResultCards();
    if (results.length === 1) openProduct(results[0], { replace: true });
    else if (voiceMode) speak(t('voice_n_results', { n: results.length }));
  } catch (err) { $('status').textContent = err.message; }
}
function showNoResults(text, spoken) {
  $('status').textContent = text;
  $('request-done').classList.add('hidden');
  $('request-form').classList.remove('hidden');
  $('no-results').classList.remove('hidden');
  if (voiceMode && spoken) speak(spoken);
}
function showResultCards() {
  $('results').replaceChildren(...results.map((p) => {
    const item = document.createElement('div');
    item.className = 'product-item result';
    const canvas = document.createElement('canvas');
    drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 168);
    const info = document.createElement('div');
    info.className = 'ri-main';
    info.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>
      <div class="row" style="margin-top:6px;gap:6px"><span class="chip o">📍 ${escapeHtml(shortShelf(shelfOf(p)))}</span>${p.level ? `<span class="meta">${escapeHtml(levelName(p.level))}</span>` : ''}</div>
      <div class="row" style="margin-top:6px;gap:8px">${p.price ? `<span class="price">${escapeHtml(formatPrice(p.price))}</span>` : ''}${p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : ''}</div>`;
    item.append(canvas, info, addButton(p));
    item.addEventListener('click', () => openProduct(p));
    return item;
  }));
}

// Search by photo: snap the product (or a flyer / WhatsApp picture) and we find it in the store.
async function photoSearch(file, memo) {
  setView('results');
  $('no-results').classList.add('hidden');
  $('results').innerHTML = '';
  $('status').innerHTML = `<span class="row"><span class="spinner"></span> ${t('identifying')}</span>`;
  try {
    const form = new FormData();
    if (!memo.data) {
      form.append('image', await resizeImage(file, 1024), 'photo.jpg');
      form.append('visitor', visitor);
    }
    const data = memo.data || await api(pub('/photo-search'), { method: 'POST', form });
    memo.data = data;
    results = data.results;
    if (!data.identified.found) { $('status').textContent = t('photo_unknown'); return; }
    lastQuery = data.identified.name;
    $('q').value = data.identified.name;
    if (!results.length) return showNoResults(t('photo_not_in_store', { name: data.identified.name }));
    $('status').textContent = t('photo_found', { name: data.identified.name });
    showResultCards();
  } catch (err) { $('status').textContent = err.message; }
}
$('cam-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const memo = {};
  if (file) go(() => photoSearch(file, memo));
});
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  voiceMode = false;
  search($('q').value);
});

// ---------- product cards: a deal / related product with a quick ➕ ----------
function addButton(p) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'add-btn';
  b.setAttribute('aria-label', t('add_aria'));
  const paint = () => { const on = inList(p.id); b.textContent = on ? '✓' : '+'; b.classList.toggle('on', on); };
  paint();
  b.addEventListener('click', (e) => { e.stopPropagation(); toggleList(p); paint(); });
  b.addEventListener('list-changed', paint);
  return b;
}
function miniCard(p) {
  const card = document.createElement('div');
  card.className = 'mini-card';
  card.tabIndex = 0;
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 240);
  card.innerHTML = `${p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : ''}
    <span class="mc-name">${escapeHtml(p.name)}</span>
    <span class="mc-meta">📍 ${escapeHtml(shortShelf(shelfOf(p)))}</span>
    ${p.price ? `<span class="mc-price">${escapeHtml(formatPrice(p.price))}</span>` : ''}`;
  card.prepend(canvas);
  card.append(addButton(p));
  card.addEventListener('click', () => openProduct(p));
  return card;
}

// ---------- product page ----------
let navRoute = null;
function openProduct(p, { replace = false } = {}) {
  buzz(8);
  if (replace) { screens[at] = () => renderDetail(p); history.replaceState({ i: at }, ''); renderDetail(p); }
  else go(() => renderDetail(p));
}
function renderDetail(p) {
  current = p;
  setView('detail');
  const shelf = shelfOf(p);
  drawCrop($('detail-crop'), p.image || p.photo, p.image ? null : p.box, 560);
  $('detail-name').textContent = p.name;
  $('detail-desc').textContent = p.description || '';
  $('detail-price').textContent = p.price ? formatPrice(p.price) : '';
  $('detail-promo').textContent = p.promo ? `🏷️ ${p.promo}` : '';
  $('detail-promo').classList.toggle('hidden', !p.promo);
  loadRelated(p);
  navRoute = null;
  const chips = [shelf && chip(`📍 ${aisleName(shelf)}`, 'o'), p.level && chip(levelName(p.level))];
  if (shelf) {
    const here = hereShelf && aisleSpot(store.map, hereShelf);
    const path = findPath(store.map, shelf, here || store.map.entrance);
    const loc = describeLocation(store.map, shelf);
    const inAisle = hereShelf?.id === shelf.id;
    $('detail-how').textContent = inAisle ? `${t('in_your_aisle')}${p.level ? ` · ${levelName(p.level)}` : ''}` : [t(`side_${loc.side}`), t(`depth_${loc.depth}`)].join(' · ');
    const n = path ? path.length - 1 : 0;
    if (path && !inAisle) chips.push(chip(t(here ? 'm_from_here' : 'm_from_entrance', { n })));
    // Product names are in Hebrew, so other languages speak the aisle, shelf and distance only.
    spokenAnswer = [lang === 'he' ? p.name : '', aisleName(shelf, { short: true }), levelName(p.level), path && !inAisle ? t(here ? 'say_from_here' : 'say_from_entrance', { n }) : '']
      .filter(Boolean).join('. ');
    if (path && !inAisle) navRoute = { shelf, path, here };
  }
  $('detail-chips').innerHTML = chips.filter(Boolean).join('');
  $('go-btn').classList.toggle('hidden', !navRoute);
  rememberProduct(p);
  track('view', { productId: p.id }).catch(() => {});
  updateListToggle();
  $('speak').classList.toggle('hidden', !voiceOk());
  if (voiceMode) speak(spokenAnswer);
  // The shelf photo with the product outlined, so the shopper recognises the spot when they get there.
  $('shelf-card').classList.toggle('hidden', !p.photo);
  if (p.photo) $('detail-photo').src = p.photo;
  $('shelf-level').textContent = levelName(p.level);
  markBox($('shelf-mark'), p.box);
}
$('speak').addEventListener('click', () => speak(spokenAnswer));

let relatedFor = null;
async function loadRelated(p) {
  relatedFor = p.id;
  $('related').classList.add('hidden');
  const r = await api(pub(`/products/${p.id}/related`)).catch(() => null);
  if (!r || relatedFor !== p.id || !r.products.length) return;
  $('related-title').textContent = t(r.kind === 'together' ? 'related_together' : 'related_aisle');
  $('related-row').replaceChildren(...r.products.map((x) => miniCard(x)));
  $('related').classList.remove('hidden');
  return r;
}

// ---------- "take me there": step-by-step directions, the route walked on the map, arrival ----------
// There is no GPS indoors: the blue dot previews the way; the real position updates when the shopper
// scans an aisle's "you are here" sticker.
let navStarted = 0;
let walkerRaf = 0;
function stopWalker() { cancelAnimationFrame(walkerRaf); walkerRaf = 0; }
const SIDE_KEY = { left: 'step_arrive_left', right: 'step_arrive_right', front: 'step_arrive_front' };
function renderNav() {
  if (!current || !navRoute?.path) return renderHome();
  setView('nav');
  const { shelf, path, here } = navRoute;
  drawCrop($('nav-thumb'), current.image || current.photo, current.image ? null : current.box, 144);
  $('nav-name').textContent = current.name;
  $('nav-chips').innerHTML = [chip(`📍 ${aisleName(shelf)}`, 'o'), current.level && chip(levelName(current.level)), chip(t(here ? 'm_from_here' : 'm_from_entrance', { n: path.length - 1 }))].filter(Boolean).join('');
  const dir = directions(store.map, path, shelf);
  const ICON = { straight: '⬆', right: '➡', left: '⬅' };
  const lines = dir.steps.map((st) => [ICON[st.turn], t(`step_${st.turn}`, { n: st.meters })]);
  lines.push(['📍', `${t(SIDE_KEY[dir.side], { a: aisleName(shelf, { short: true }) })} · ${current.level ? t('step_look', { l: levelName(current.level) }) : t('step_look_nolevel')}`]);
  $('nav-steps').innerHTML = `<li class="muted" style="font-size:.9rem;border-top:none;padding-top:0">${escapeHtml(t(here ? 'nav_from_here' : 'nav_from_entrance'))}</li>` +
    lines.map(([ico, txt], i) => `<li class="${i === lines.length - 1 ? 'last' : ''}"><span class="ico">${ico}</span><span>${escapeHtml(txt)}</span></li>`).join('');
  $('nav-here').classList.toggle('hidden', !here);
  if (here) $('nav-here').textContent = `${t('here', { name: aisleName(hereShelf) })} · ${t('m_from_here', { n: path.length - 1 })}`;
  const svgEl = $('nav-map');
  renderMap(svgEl, store.map, { targetShelfId: shelf.id, path, here, ...mapLabels() });
  // the walker: walks the route at a calm pace, waits a moment at the shelf, then starts again
  const CELL = 20;
  const pts = path.map((c) => [c.x * CELL + CELL / 2, c.y * CELL + CELL / 2]);
  const walker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  walker.setAttribute('r', 11); walker.setAttribute('class', 'map-walker');
  svgEl.appendChild(walker);
  // which step each cell of the path belongs to, to highlight the current instruction
  const stepOf = []; let k = 0;
  dir.steps.forEach((st, i) => { for (let m = 0; m < st.meters; m++) stepOf[++k] = i; });
  stepOf[0] = 0;
  const items = [...$('nav-steps').querySelectorAll('li:not(.muted)')];
  const walkMs = Math.max(3000, (pts.length - 1) * 350), cycle = walkMs + 1500;
  const t0 = performance.now();
  const frame = (now) => {
    const f = Math.min(1, ((now - t0) % cycle) / walkMs);
    const pos = f * (pts.length - 1), i = Math.floor(pos), r = pos - i;
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    walker.setAttribute('cx', a[0] + (b[0] - a[0]) * r);
    walker.setAttribute('cy', a[1] + (b[1] - a[1]) * r);
    const cur = f >= 1 ? items.length - 1 : stepOf[Math.min(i + 1, stepOf.length - 1)] ?? 0;
    items.forEach((li, j) => li.classList.toggle('on', j === cur));
    walkerRaf = requestAnimationFrame(frame);
  };
  walkerRaf = requestAnimationFrame(frame);
  navStarted = Date.now();
  spokenAnswer = lines.map((l) => l[1]).join('. ');
  if (voiceMode) speak(spokenAnswer);
}
function renderArrived() {
  if (!current || !navRoute) return renderHome();
  setView('arrived');
  const { shelf, path } = navRoute;
  const dir = directions(store.map, path, shelf);
  $('arr-where').textContent = [t(SIDE_KEY[dir.side], { a: aisleName(shelf, { short: true }) }), levelName(current.level)].filter(Boolean).join(' · ');
  $('arr-shot').classList.toggle('hidden', !current.photo);
  if (current.photo) $('arr-photo').src = current.photo;
  markBox($('arr-mark'), current.box);
  const secs = Math.max(1, Math.round((Date.now() - navStarted) / 1000));
  $('arr-time').textContent = t('arrived_time', { s: secs < 60 ? t('secs', { n: secs }) : t('mins', { m: Math.floor(secs / 60), s: String(secs % 60).padStart(2, '0') }) });
  for (const id of ['arr-reasons', 'arr-done', 'arr-next', 'arr-more']) $(id).classList.add('hidden');
  $('arr-ask').classList.remove('hidden');
  for (const b of $('arr-reasons').querySelectorAll('button')) b.disabled = false;
  buzz([20, 60, 20]);
  if (voiceMode) speak(`${t('arrived_title')} ${$('arr-where').textContent}`);
  // the shopper is standing at this shelf now: the next route starts from here
  hereShelf = shelf;
}
$('go-btn').addEventListener('click', () => { buzz(); go(renderNav); });
$('arrived-btn').addEventListener('click', () => go(renderArrived));
$('arr-back').addEventListener('click', () => go(renderHome, location.pathname + (hereShelf ? `?at=${encodeURIComponent(hereShelf.id)}` : '')));

async function afterFound() {
  $('arr-ask').classList.add('hidden');
  $('arr-done').textContent = `${t('found_party')} ${t('thanks_found')}`;
  $('arr-done').classList.remove('hidden');
  buzz(30);
  // next on the list, closest first from this shelf
  const todo = loadList().filter((i) => !i.picked);
  const shelves = todo.map((i) => store.map.shelves.find((s) => s.id === i.shelfId)).filter(Boolean);
  if (shelves.length) {
    const route = planRoute(store.map, shelves, aisleSpot(store.map, hereShelf) || store.map.entrance);
    const firstShelf = route.legs[0]?.shelf;
    const next = todo.find((i) => i.shelfId === firstShelf?.id) || todo[0];
    drawCrop($('next-thumb'), next.image || next.photo, next.image ? null : next.box, 112);
    $('next-name').textContent = next.name;
    $('next-meta').textContent = `📍 ${shortShelf(store.map.shelves.find((s) => s.id === next.shelfId))}${next.level ? ` · ${levelName(next.level)}` : ''}`;
    $('next-go').onclick = () => goToItem(next.id);
    $('arr-next').classList.remove('hidden');
  }
  // what else is right here: the easiest extra purchase there is
  const aisle = await api(pub(`/aisle/${encodeURIComponent(current.shelfId)}`)).catch(() => []);
  const more = aisle.filter((x) => x.id !== current.id).slice(0, 8);
  if (more.length) {
    $('arr-more-row').replaceChildren(...more.map((x) => miniCard(x)));
    $('arr-more').classList.remove('hidden');
  }
}
$('arr-found').addEventListener('click', () => {
  track('found', { productId: current.id }).catch(() => {});
  markPicked(current.id);
  afterFound();
});
$('arr-notfound').addEventListener('click', () => {
  $('arr-ask').classList.add('hidden');
  $('arr-reasons').classList.remove('hidden');
});
$('arr-reasons').addEventListener('click', async (e) => {
  const fb = e.target.closest('[data-fb]')?.dataset.fb;
  if (!fb) return;
  await track(fb, { productId: current.id }).catch(() => {});
  $('arr-done').textContent = t(fb === 'empty' ? 'thanks_empty' : 'thanks_moved');
  $('arr-done').classList.remove('hidden');
  for (const b of $('arr-reasons').querySelectorAll('[data-fb]')) b.disabled = true;
});
$('arr-staff').addEventListener('click', async () => {
  $('arr-staff').disabled = true;
  try {
    await track('help', { shelfId: current.shelfId, productId: current.id, query: lastQuery });
    $('arr-done').textContent = t('help_sent', { at: t('help_at', { a: shortShelf(shelfOf(current)) }) });
  } catch (err) { $('arr-done').textContent = err.message; $('arr-staff').disabled = false; }
  $('arr-done').classList.remove('hidden');
});
// open a list item and start walking to it right away
async function goToItem(id) {
  buzz();
  const p = await api(pub(`/products/${id}`)).catch(() => null);
  if (!p) return;
  go(() => renderDetail(p));
  if (!navRoute) return; // it's in this very aisle
  const route = navRoute;
  go(() => { current = p; navRoute = route; renderNav(); });
}

// ---------- request a product the store doesn't carry ----------
$('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await track('request', { query: lastQuery, phone: $('request-phone').value });
    $('request-done').textContent = $('request-phone').value.trim() ? t('req_done_phone', { q: lastQuery }) : t('req_done', { q: lastQuery });
    $('request-form').classList.add('hidden');
    $('request-done').classList.remove('hidden');
  } catch (err) { $('request-done').textContent = err.message; $('request-done').classList.remove('hidden'); }
});

// ---------- shopping list with the shortest route through the store ----------
function loadList() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; }
}
function saveList(list) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  renderListBadge();
  for (const b of document.querySelectorAll('.add-btn')) b.dispatchEvent(new Event('list-changed'));
}
function inList(id) { return loadList().some((i) => i.id === id); }
function toggleList(p) {
  const list = loadList();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) { list.splice(i, 1); toast(t('removed')); buzz(8); }
  else {
    list.push({ id: p.id, name: p.name, shelfId: p.shelfId, level: p.level, price: p.price, photo: p.photo, image: p.image, box: p.box, picked: false });
    const shelf = shelfOf(p);
    toast(t('added', { a: shelf ? shortShelf(shelf) : '' }));
    buzz(15);
    const badge = $('list-count');
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }
  saveList(list);
}
function updateListToggle() {
  const on = current && inList(current.id);
  $('list-toggle').textContent = t(on ? 'in_short' : 'add_short');
  $('list-toggle').classList.toggle('on', Boolean(on));
}
function renderListBadge() {
  const n = loadList().filter((i) => !i.picked).length;
  $('list-count').textContent = n;
  $('list-count').classList.toggle('hidden', !n);
}
function markPicked(id) {
  const list = loadList();
  const item = list.find((i) => i.id === id);
  if (item) { item.picked = true; saveList(list); }
}
$('list-toggle').addEventListener('click', () => { if (current) { toggleList(current); updateListToggle(); } });

// "89.90" counts toward the estimate; deals written as text ("2 ב-25") don't
const priceValue = (p) => (/^\s*₪?\s*\d+(\.\d+)?\s*₪?\s*$/.test(p || '') ? Number(p.replace(/[^\d.]/g, '')) : 0);
let routeSpeech = '';
let listRoute = null;
function renderListView() {
  setView('list');
  const list = loadList();
  const todo = list.filter((i) => !i.picked);
  const shelves = todo.map((i) => store.map.shelves.find((s) => s.id === i.shelfId)).filter(Boolean);
  const here = hereShelf && aisleSpot(store.map, hereShelf);
  const route = planRoute(store.map, shelves, here || store.map.entrance);
  listRoute = route;
  const order = new Map(route.legs.map((l, n) => [l.shelf.id, n + 1]));
  const sorted = [...list].sort((a, b) => (a.picked - b.picked) || ((order.get(a.shelfId) ?? 99) - (order.get(b.shelfId) ?? 99)));
  $('list-meters').textContent = route.legs.length ? t('list_meters', { m: route.meters, s: route.legs.length }) : '';
  $('list-hint').textContent = t(todo.length ? 'list_hint' : list.length ? 'list_done' : 'list_empty');
  $('list-items').innerHTML = sorted.map((i) => {
    const shelf = store.map.shelves.find((s) => s.id === i.shelfId);
    const n = order.get(i.shelfId);
    return `<li class="list-item${i.picked ? ' picked' : ''}" data-id="${i.id}">
      <span class="stop-n">${i.picked ? '✓' : (n ?? '?')}</span>
      <span class="li-main"><span class="name">${escapeHtml(i.name)}</span><span class="meta">${escapeHtml(shortShelf(shelf))}${i.level ? ` · ${escapeHtml(levelName(i.level))}` : ''}${i.price ? ` · ${escapeHtml(formatPrice(i.price))}` : ''}</span></span>
      <button type="button" class="li-check" aria-label="${t(i.picked ? 'put_back' : 'taken')}">${i.picked ? '↩︎' : t('taken')}</button>
    </li>`;
  }).join('');
  const total = todo.reduce((sum, i) => sum + priceValue(i.price), 0);
  $('list-total').textContent = t('list_total', { p: total.toFixed(2).replace(/\.00$/, '') });
  $('list-total').classList.toggle('hidden', !total);
  $('list-start').classList.toggle('hidden', !todo.length);
  $('list-deals').classList.toggle('hidden', todo.length > 0);
  $('list-map-box').classList.toggle('hidden', !route.legs.length);
  $('list-clear').classList.toggle('hidden', !list.length);
  if (route.legs.length) {
    const stops = route.legs.map((l, n) => ({ ...l.path[l.path.length - 1], n: n + 1 }));
    renderMap($('list-map'), store.map, { targetShelfIds: shelves.map((s) => s.id), path: route.path, here, stops, ...mapLabels() });
  }
  routeSpeech = route.legs.map((l, n) => `${n + 1}. ${shortShelf(l.shelf)}: ${todo.filter((i) => i.shelfId === l.shelf.id).map((i) => i.name).join(', ')}`).join('. ');
  $('list-speak').classList.toggle('hidden', !voiceOk() || !route.legs.length);
}
$('list-items').addEventListener('click', async (e) => {
  const li = e.target.closest('.list-item');
  if (!li) return;
  const id = Number(li.dataset.id);
  const list = loadList();
  const item = list.find((i) => i.id === id);
  if (!item) return;
  if (e.target.closest('.li-check')) {
    item.picked = !item.picked;
    if (item.picked) { track('found', { productId: id }).catch(() => {}); buzz(15); }
    saveList(list);
    renderListView();
  } else {
    const p = await api(pub(`/products/${id}`)).catch(() => item);
    openProduct(p);
  }
});
$('list-start').addEventListener('click', () => {
  const first = listRoute?.legs[0]?.shelf;
  const item = loadList().find((i) => !i.picked && i.shelfId === first?.id) || loadList().find((i) => !i.picked);
  if (item) goToItem(item.id);
});
$('list-deals').addEventListener('click', () => go(() => setView('deals')));
$('list-clear').addEventListener('click', () => { saveList([]); renderListView(); });
$('list-speak').addEventListener('click', () => speak(routeSpeech));

// ---------- tab bar ----------
$('tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (!tab) return;
  buzz(8);
  if (tab === 'help') return openHelp();
  if (tab === document.body.dataset.view) return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'home') { voiceMode = false; $('q').value = ''; go(renderHome, location.pathname + (hereShelf ? `?at=${encodeURIComponent(hereShelf.id)}` : '')); }
  if (tab === 'deals') go(() => setView('deals'));
  if (tab === 'list') go(renderListView);
});
$('deals-all').addEventListener('click', () => go(() => setView('deals')));

// ---------- call a staff member to where the shopper stands ----------
function openHelp() {
  const guess = hereShelf || (current && document.body.dataset.view !== 'home' ? shelfOf(current) : null);
  $('help-shelf').innerHTML = `<option value="">${escapeHtml(t('entrance_unsure'))}</option>` +
    store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}"${guess?.id === s.id ? ' selected' : ''}>${escapeHtml(aisleName(s))}</option>`).join('');
  $('help-where').textContent = t('help_where');
  $('help-done').classList.add('hidden');
  $('help-send').disabled = false;
  $('help-sheet').classList.remove('hidden');
}
for (const b of document.querySelectorAll('.need-help')) b.addEventListener('click', openHelp);
$('help-cancel').addEventListener('click', () => $('help-sheet').classList.add('hidden'));
$('help-sheet').addEventListener('click', (e) => { if (e.target === $('help-sheet')) $('help-sheet').classList.add('hidden'); });
$('help-send').addEventListener('click', async () => {
  $('help-send').disabled = true;
  try {
    await track('help', { shelfId: $('help-shelf').value || null, productId: current?.id ?? null, query: lastQuery });
    const s = store.map.shelves.find((x) => x.id === $('help-shelf').value);
    $('help-done').textContent = t('help_sent', { at: s ? t('help_at', { a: shortShelf(s) }) : '' });
    $('help-done').classList.remove('hidden');
    buzz(30);
    setTimeout(() => $('help-sheet').classList.add('hidden'), 3500);
  } catch (err) {
    $('help-done').textContent = err.message;
    $('help-done').classList.remove('hidden');
    $('help-send').disabled = false;
  }
});

// ---------- language ----------
function mapLabels() {
  return lang === 'he' ? {} : { label: (s) => aisleName(s), entranceLabel: t('entrance') };
}
$('lang').innerHTML = Object.entries(LANGS).map(([code, l]) => `<option value="${code}"${code === lang ? ' selected' : ''}>${l.name}</option>`).join('');
$('lang').addEventListener('change', () => {
  setLang($('lang').value);
  // Simplest way to re-render everything in the new language, keeping the search in the URL.
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url);
});
translatePage();

// ---------- voice search ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  const rec = new Recognition();
  rec.lang = LANGS[lang].voice;
  rec.interimResults = true;
  let heard = '';
  $('listen-text').textContent = '';
  $('listen-label').textContent = t('listening');
  $('listen-sheet').classList.remove('hidden');
  $('listen-sheet').classList.add('live');
  buzz();
  rec.onresult = (e) => {
    heard = [...e.results].map((r) => r[0].transcript).join('');
    $('listen-text').textContent = `"${heard}"`;
    if (e.results[e.results.length - 1].isFinal) {
      $('listen-label').textContent = t('understood');
      $('listen-sheet').classList.remove('live');
    }
  };
  rec.onerror = () => { heard = ''; };
  rec.onend = () => {
    setTimeout(() => $('listen-sheet').classList.add('hidden'), heard ? 700 : 0);
    if (heard) { voiceMode = true; $('q').value = heard; search(heard); }
  };
  $('listen-cancel').onclick = () => { heard = ''; rec.abort(); $('listen-sheet').classList.add('hidden'); };
  rec.start();
}
if (Recognition) {
  $('mic').classList.remove('hidden');
  $('talk-btn').classList.remove('hidden');
  $('mic').addEventListener('click', listen);
  $('talk-btn').addEventListener('click', listen);
}

// ---------- start ----------
(async () => {
  try {
    store = await api(pub(''));
    document.head.insertAdjacentHTML('beforeend', `<link rel="manifest" href="${pub('/manifest.webmanifest')}">`);
    $('store-name').textContent = store.name;
    $('cam').classList.toggle('hidden', !store.photoSearch);
    document.title = t('title', { name: store.name });
    const params = new URLSearchParams(location.search);
    hereShelf = store.map.shelves.find((s) => s.id === params.get('at')) || null;
    if (hereShelf) {
      $('here-banner').textContent = t('here', { name: aisleName(hereShelf) });
      $('here-banner').classList.remove('hidden');
      // A worker (signed in on this phone) scanning an aisle sticker: offer to move a product here.
      if (getToken()) {
        $('here-banner').insertAdjacentHTML('afterend', `<a class="btn primary staff-bar" href="/staff.html?to=${encodeURIComponent(hereShelf.id)}">👷 מצב עובד: העברת מוצר למעבר הזה</a>`);
      }
    }
    screens[0] = renderHome;
    history.replaceState({ i: 0 }, '', location.pathname + (hereShelf ? `?at=${encodeURIComponent(hereShelf.id)}` : ''));
    renderHome();
    loadHome();
    const q = params.get('q');
    const lastId = hereShelf && !q ? recentProductId() : null;
    if (q) search(q);
    else if (lastId) {
      // Scanned an aisle sticker mid-trip: continue to the product chosen a moment ago.
      const p = await api(pub(`/products/${lastId}`)).catch(() => null);
      if (p) openProduct(p);
    }
  } catch {
    $('store-name').textContent = t('store_missing');
    $('search-form').classList.add('hidden');
  }
})();
