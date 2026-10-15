import { api, escapeHtml, formatPrice, resizeImage, getToken } from '/js/api.js';
import { renderMap, findPath, describeLocation, drawCrop, aisleSpot, planRoute, directions } from '/js/map.js';
import { rankShelves } from '/js/locate.js';
import { Store3D, loadThree, webglOk } from '/js/store3d.js';
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
  return text.replace(/₪\s*([\d.,]+)/g, '$1 שקלים').replace(/([\d.,]+)\s*₪/g, '$1 שקלים').replace(/₪/g, ' שקל').replace(/ס["״]מ/g, 'סנטימטר').replace(/מ["״]ל/g, 'מיליליטר').replace(/(\d)\s*מ['׳]/g, '$1 מטר').replace(/[·|/]/g, ',');
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
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LANGS[lang].voice;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}
let speakSeq = 0;
async function speak(text) {
  text = forSpeech(String(text || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')).replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
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
    } catch { /* stay quiet: the answer is on the screen, and the phone's robot voice isn't Omer */ }
    return;
  }
  if (seq === speakSeq) speakDevice(text);
}
const voiceOk = () => canSpeak || store?.premiumVoice;
// Omer talks the shopper through the store (greeting, where the product is, the way, arrival).
// One tap on 🔊/🔇 in the header keeps him quiet, remembered on this phone.
let talk = (() => { try { return localStorage.getItem('storeFinder:talk') !== '0'; } catch { return true; } })();
function say(text) { if (talk && voiceOk()) speak(text); }
function paintTalk() {
  $('talk-toggle').textContent = talk ? '🔊' : '🔇';
  $('talk-toggle').setAttribute('aria-label', t(talk ? 'talk_on' : 'talk_off'));
  $('talk-toggle').classList.toggle('off', !talk);
}
$('talk-toggle').addEventListener('click', () => {
  talk = !talk;
  try { localStorage.setItem('storeFinder:talk', talk ? '1' : '0'); } catch { /* private mode */ }
  paintTalk();
  if (talk) speak(t('talk_hi')); else { speakSeq++; player.pause(); if (canSpeak) speechSynthesis.cancel(); }
});

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
const VIEWS = ['home-view', 'home-extra', 'results-view', 'deals-view', 'detail', 'nav-view', 'arrived-view', 'list-view', 'tour-view', 's3d-view'];
const SHOWS = {
  home: ['home-view', 'home-extra'], results: ['results-view'], deals: ['deals-view'],
  detail: ['detail'], nav: ['nav-view'], arrived: ['arrived-view'], list: ['list-view'], tour: ['tour-view'], s3d: ['s3d-view'],
};
const TAB_OF = { home: 'home', results: 'home', deals: 'deals', list: 'list', tour: 'home' };
function setView(name) {
  stopWalker();
  if (name !== 's3d') { stop3d(); document.body.classList.remove('in3d'); }
  $('upsell-sheet').classList.add('hidden');
  $('tour-sheet').classList.add('hidden');
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

// ---------- staying up to date ----------
// Phones keep a tab open for days. When a new version goes live, reload at a calm moment: right away
// on the home screen, otherwise the next time the shopper comes back to it (the list is kept).
let build = null;
let updateReady = false;
async function checkBuild() {
  const b = await fetch('/healthz', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.build).catch(() => null);
  if (!b) return;
  if (build === null) build = b;
  else if (b !== build) {
    updateReady = true;
    if (document.body.dataset.view === 'home') location.reload();
  }
}
checkBuild();
setInterval(checkBuild, 2 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuild(); });

// ---------- home: the buddy ----------
function greeting() {
  const h = new Date().getHours();
  return t(h >= 5 && h < 12 ? 'greet_morning' : h < 17 && h >= 12 ? 'greet_noon' : h >= 17 && h < 22 ? 'greet_evening' : 'greet_night');
}
let returning = false;
try { returning = Boolean(localStorage.getItem(SEEN_KEY)); localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
function renderHome() {
  if (updateReady) return location.reload();
  setView('home');
  current = null;
  $('greet-title').textContent = t('buddy_intro', { g: greeting() });
  $('greet-sub').textContent = t(returning ? 'greet_back' : 'greet_first');
  const todo = loadList().filter((i) => !i.picked).length;
  $('continue-card').classList.toggle('hidden', !todo);
  $('continue-text').textContent = t('continue_list', { n: todo });
}
const greetingSpeech = () => `${$('greet-title').textContent.replace(/[\p{Extended_Pictographic}\s]+$/u, '')}. ${$('greet-sub').textContent}`;
$('buddy-face').addEventListener('click', () => speak(greetingSpeech()));
// Phones only allow sound after a touch: Omer says hello on the shopper's first tap on the home screen
// (not when it's the microphone, he'd be talking into it).
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#mic, #talk-btn, #talk-toggle, #buddy-face, #lang, #tour-card') || document.body.dataset.view !== 'home') return;
  setTimeout(() => say(greetingSpeech()), 150);
}, { once: true });
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
  allDeals = deals;
  $('deals-row').replaceChildren(...deals.slice(0, 10).map((p) => miniCard(p, { source: 'deal' })));
  $('deals').classList.toggle('hidden', !deals.length);
  $('deal-grid').replaceChildren(...deals.map((p) => miniCard(p, { source: 'deal' })));
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
  syncClear();
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
    else say(t('voice_n_results', { n: results.length }));
  } catch (err) { $('status').textContent = err.message; }
}
function showNoResults(text, spoken) {
  $('status').textContent = text;
  $('request-done').classList.add('hidden');
  $('request-form').classList.remove('hidden');
  $('no-results').classList.remove('hidden');
  if (spoken) say(spoken);
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
// ✕ empties the box and opens the keyboard for the next product
const syncClear = () => $('q-clear').classList.toggle('hidden', !$('q').value);
$('q').addEventListener('input', syncClear);
function newSearch() {
  $('q').value = '';
  syncClear();
  if (document.body.dataset.view !== 'home') go(renderHome, location.pathname + (hereShelf ? `?at=${encodeURIComponent(hereShelf.id)}` : ''));
  $('q').focus();
}
$('q-clear').addEventListener('click', newSearch);
$('new-search').addEventListener('click', newSearch);
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  voiceMode = false;
  search($('q').value);
});

// ---------- product cards: a deal / related product with a quick ➕ ----------
function addButton(p, source = 'search') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'add-btn';
  b.setAttribute('aria-label', t('add_aria'));
  const paint = () => { const on = inList(p.id); b.textContent = on ? '✓' : '+'; b.classList.toggle('on', on); };
  paint();
  b.addEventListener('click', (e) => { e.stopPropagation(); toggleList(p, source); paint(); });
  b.addEventListener('list-changed', paint);
  return b;
}
function miniCard(p, { why = '', source = why ? 'suggest' : 'search' } = {}) {
  const card = document.createElement('div');
  card.className = 'mini-card';
  card.tabIndex = 0;
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 240);
  const whyTag = !p.promo && why && why !== 'deal' ? `<span class="promo-tag why">${escapeHtml(t(`why_${why}`))}</span>` : '';
  card.innerHTML = `${p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : whyTag}
    <span class="mc-name">${escapeHtml(p.name)}</span>
    <span class="mc-meta">📍 ${escapeHtml(shortShelf(shelfOf(p)))}</span>
    ${p.price ? `<span class="mc-price">${escapeHtml(formatPrice(p.price))}</span>` : ''}`;
  card.prepend(canvas);
  card.append(addButton(p, source));
  card.addEventListener('click', () => openProduct(p, { source }));
  return card;
}

// ---------- product page ----------
let navRoute = null;
// ---------- discovery route: the way to the product passes a deal, a little longer at most ----------
// Like the path through IKEA, but per shopper and within what the store allows (detourPct).
let allDeals = [];
function discoveryRoute(shelf, start, direct, product) {
  const pct = store.detourPct ?? 20;
  if (!pct || !direct || direct.length < 2 || !allDeals.length) return null;
  const limit = (direct.length - 1) * (1 + pct / 100);
  let best = null;
  for (const d of allDeals) {
    if (d.id === product.id || inList(d.id)) continue;
    const ds = shelfOf(d);
    if (!ds || ds.id === shelf.id) continue;
    const a = findPath(store.map, ds, start);
    const b = a && findPath(store.map, shelf, a[a.length - 1]);
    if (!b) continue;
    const total = a.length - 1 + b.length - 1;
    if (total > limit || (best && total >= best.total)) continue;
    best = { total, path: [...a, ...b.slice(1)], at: a.length - 1, deal: d, dealShelf: ds };
  }
  return best;
}
let currentSource = 'search'; // how the shopper got to the product on screen, for the basket report
function openProduct(p, { replace = false, source = 'search' } = {}) {
  currentSource = source;
  buzz(8);
  if (replace) { screens[at] = () => renderDetail(p); history.replaceState({ i: at }, ''); renderDetail(p); }
  else go(() => renderDetail(p));
}
function renderDetail(p, { quiet = false } = {}) {
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
    const via = path && !inAisle ? discoveryRoute(shelf, here || store.map.entrance, path, p) : null;
    const n = via ? via.total : path ? path.length - 1 : 0;
    if (path && !inAisle) chips.push(chip(t(here ? 'm_from_here' : 'm_from_entrance', { n })));
    $('detail-via').textContent = via ? t('via_detail', { name: shortName(via.deal), promo: via.deal.promo }) : '';
    $('detail-via').classList.toggle('hidden', !via);
    // Product names are in Hebrew, so other languages speak the aisle, shelf and distance only.
    spokenAnswer = [lang === 'he' ? p.name : '', aisleName(shelf, { short: true }), levelName(p.level), path && !inAisle ? t(here ? 'say_from_here' : 'say_from_entrance', { n }) : '']
      .filter(Boolean).join('. ');
    if (path && !inAisle) navRoute = { shelf, path: via ? via.path : path, here, via };
  }
  $('detail-chips').innerHTML = chips.filter(Boolean).join('');
  $('go-btn').classList.toggle('hidden', !navRoute);
  rememberProduct(p);
  if (!quiet) track('view', { productId: p.id }).catch(() => {});
  updateListToggle();
  $('speak').classList.toggle('hidden', !voiceOk());
  say(spokenAnswer);
  // The shelf photo with the product outlined, so the shopper recognises the spot when they get there.
  $('shelf-card').classList.toggle('hidden', !p.photo);
  $('detail-3d').classList.toggle('hidden', !has3d || !shelf);
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
  $('related-row').replaceChildren(...r.products.map((x) => miniCard(x, { source: 'related' })));
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
  const dir = directions(store.map, path, shelf);
  const ICON = { straight: '⬆', right: '➡', left: '⬅' };
  const steps = dir.steps.map((st) => ({ turn: st.turn, meters: st.meters, big: t(`go_${st.turn}`), text: t(`step_${st.turn}`, { n: st.meters }), ico: ICON[st.turn],
    speech: st.turn === 'straight' ? t('step_straight', { n: st.meters }) : `${t(`go_${st.turn}`)}, ${t('m_more', { n: st.meters })}` }));
  // From an aisle we don't know which way the shopper faces, so the first step names a landmark.
  if (here && steps.length && path.length > 1) {
    const [a, b] = path, e = store.map.entrance, n = steps[0].meters;
    const toEntrance = Math.abs(b.x - e.x) + Math.abs(b.y - e.y) < Math.abs(a.x - e.x) + Math.abs(a.y - e.y);
    const sideways = a.y === b.y;
    const toward = sideways && (Math.sign(shelf.x - a.x) === Math.sign(b.x - a.x) ? shelf : store.map.shelves.filter((s) => s.id !== hereShelf?.id && Math.sign(s.x - a.x) === Math.sign(b.x - a.x))
      .sort((s1, s2) => Math.abs(s1.x - a.x) - Math.abs(s2.x - a.x))[0]);
    const text = toward ? t('step_toward', { n, a: aisleName(toward, { short: true }) }) : t(toEntrance ? 'step_to_entrance' : 'step_from_entrance', { n });
    Object.assign(steps[0], { turn: 'straight', ico: '🚶', text, speech: text, big: text.replace(/^\S+\s+\S+\s+\S+\s*/, '') || text });
  }
  // the discovery route: a stop at the deal on the way, splitting the step it falls in
  const via = navRoute.via;
  if (via) {
    const d = via.deal;
    const stop = { turn: 'deal', meters: 0, ico: '🔥', big: t('via_big'), sub: `${shortName(d)} · ${d.promo}`, text: t('via_text', { name: shortName(d), promo: d.promo }), speech: t('via_say', { name: shortName(d), promo: d.promo }), deal: d };
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (acc + st.meters < via.at) { acc += st.meters; continue; }
      const before = via.at - acc, after = st.meters - before;
      const parts = [];
      if (before > 0) parts.push({ ...st, meters: before, text: t(`step_${st.turn}`, { n: before }), speech: st.turn === 'straight' ? t('step_straight', { n: before }) : `${t(`go_${st.turn}`)}, ${t('m_more', { n: before })}` });
      parts.push(stop);
      if (after > 0) parts.push(before > 0 ? { turn: 'straight', meters: after, ico: '⬆', big: t('go_straight'), text: t('step_straight', { n: after }), speech: t('step_straight', { n: after }) } : st);
      steps.splice(i, 1, ...parts);
      break;
    }
  }
  const look = current.level ? t('step_look', { l: levelName(current.level) }) : t('step_look_nolevel');
  const sideText = t(SIDE_KEY[dir.side], { a: aisleName(shelf, { short: true }) });
  const arrive = { turn: `arrive-${dir.side}`, meters: 0, ico: '📍', big: sideText, sub: current.level ? t('look_level', { l: levelName(current.level) }) : t('look_here'), text: `${sideText} · ${look}` };
  arrive.speech = arrive.text;
  const all = [...steps, arrive];
  $('nav-steps').innerHTML = `<li class="muted" style="font-size:.9rem;border-top:none;padding-top:0">${escapeHtml(t(here ? 'nav_from_here' : 'nav_from_entrance'))}</li>` +
    all.map((st, i) => `<li class="${i === all.length - 1 ? 'last' : ''}" data-step="${i}"><span class="ico">${st.ico}</span><span>${escapeHtml(st.text)}</span></li>`).join('');
  $('nav-here').classList.toggle('hidden', !here);
  for (const b of document.querySelectorAll('[data-where]')) b.textContent = t(hereShelf ? 'where_again' : b.closest('#nav-view') ? 'where_btn' : 'where_home');
  if (here) $('nav-here').textContent = `${t('here', { name: aisleName(hereShelf) })} · ${t('m_from_here', { n: path.length - 1 })}`;
  $('nav-shelf').classList.add('hidden');
  if (current.photo) $('nav-photo').src = current.photo;
  markBox($('nav-mark'), current.box);

  // the map, zoomed to the route, with the walked part lit up and the goal pulsing
  const svgEl = $('nav-map');
  renderMap(svgEl, store.map, { targetShelfIds: via ? [shelf.id, via.dealShelf.id] : [shelf.id], path, here, ...mapLabels() });
  const CELL = 20, NS = 'http://www.w3.org/2000/svg';
  const pts = path.map((c) => [c.x * CELL + CELL / 2, c.y * CELL + CELL / 2]);
  const xs = [...pts.map((p) => p[0]), shelf.x * CELL, (shelf.x + shelf.w) * CELL], ys = [...pts.map((p) => p[1]), shelf.y * CELL, (shelf.y + shelf.h) * CELL];
  let x0 = Math.min(...xs) - 2 * CELL, x1 = Math.max(...xs) + 2 * CELL, y0 = Math.min(...ys) - 2 * CELL, y1 = Math.max(...ys) + 2 * CELL;
  const minW = 10 * CELL, minH = 8 * CELL;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
  if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
  svgEl.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  const goal = document.createElementNS(NS, 'circle');
  goal.setAttribute('cx', pts[pts.length - 1][0]); goal.setAttribute('cy', pts[pts.length - 1][1]); goal.setAttribute('r', 14);
  goal.setAttribute('class', 'map-goal');
  svgEl.appendChild(goal);
  const trail = document.createElementNS(NS, 'polyline');
  trail.setAttribute('class', 'map-done');
  svgEl.appendChild(trail);
  const halo = document.createElementNS(NS, 'circle');
  halo.setAttribute('r', 22); halo.setAttribute('class', 'map-halo');
  svgEl.appendChild(halo);
  const walker = document.createElementNS(NS, 'circle');
  walker.setAttribute('r', 11); walker.setAttribute('class', 'map-walker');
  svgEl.appendChild(walker);

  // A calm walking pace; every step stays on screen long enough for Omer to say it.
  const MS_PER_M = 850, MIN_STEP_MS = 2600;
  const sched = []; let tAcc = 0, cAcc = 0;
  for (const st of steps) {
    const dur = st.turn === 'deal' ? 4200 : Math.max(st.meters * MS_PER_M, MIN_STEP_MS); // a real pause at the deal
    sched.push({ t0: tAcc, dur, c0: cAcc, c1: cAcc + st.meters });
    tAcc += dur; cAcc += st.meters;
  }
  const total = path.length - 1, totalMs = tAcc;
  let elapsed = 0, last = null, shown = -1, paused = false, finished = false;
  const items = [...$('nav-steps').querySelectorAll('li[data-step]')];
  const arrowEl = $('nav-arrow');
  function showStep(i) {
    shown = i;
    const st = all[i];
    arrowEl.className = `nav-arrow turn-${st.turn}`;
    void arrowEl.offsetWidth;
    arrowEl.classList.add('pop');
    $('nav-big').textContent = st.big;
    $('nav-sub').textContent = st.sub || t('m_more', { n: st.meters });
    const next = all[i + 1];
    $('nav-then').textContent = !next ? '' : next.turn.startsWith('arrive') ? t('then_shelf') : next.turn === 'deal' ? t('then_deal') : next.turn === 'straight' ? '' : t(`then_${next.turn}`);
    items.forEach((li, j) => { li.classList.toggle('on', j === i); li.classList.toggle('done', j < i); });
    const isEnd = i === all.length - 1;
    $('nav-hero').classList.toggle('arrive', isEnd);
    $('nav-hero').classList.toggle('deal', st.turn === 'deal');
    $('nav-deal-add').classList.toggle('hidden', st.turn !== 'deal');
    if (st.deal) { navDeal = st.deal; $('nav-deal-add').textContent = t(inList(st.deal.id) ? 'in_short' : 'add_short'); }
    $('nav-shelf').classList.toggle('hidden', !isEnd || !current.photo);
    $('arrived-btn').classList.toggle('pulse', isEnd);
    buzz(isEnd ? [30, 60, 30] : 15);
    say(i === 0 ? `${t('say_go')} ${st.speech}` : st.speech);
    if (isEnd && current.photo) setTimeout(() => $('nav-shelf').scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
  }
  function place(dist) {
    const i = Math.min(Math.floor(dist), total - 1), r = dist - i;
    const a = pts[i], b = pts[Math.min(i + 1, total)];
    const x = a[0] + (b[0] - a[0]) * r, y = a[1] + (b[1] - a[1]) * r;
    for (const el of [walker, halo]) { el.setAttribute('cx', x); el.setAttribute('cy', y); }
    trail.setAttribute('points', [...pts.slice(0, i + 1), [x, y]].map((p) => p.join(',')).join(' '));
  }
  const frame = (now) => {
    if (last === null) last = now;
    if (!paused) elapsed += Math.max(0, Math.min(100, now - last)); // the first frame can be stamped before the last
    last = now;
    let step = sched.findIndex((sc) => elapsed < sc.t0 + sc.dur);
    let dist;
    if (step < 0) { step = all.length - 1; dist = total; finished = true; }
    else { const sc = sched[step]; dist = sc.c0 + (sc.c1 - sc.c0) * Math.min(1, (elapsed - sc.t0) / sc.dur); }
    place(dist);
    if (step !== shown) showStep(step);
    if (!finished) $('nav-sub').textContent = all[step].sub || t('m_more', { n: Math.max(1, Math.ceil(sched[step].c1 - dist)) });
    $('nav-bar').style.width = `${(dist / Math.max(1, total)) * 100}%`;
    const left = Math.max(0, total - dist);
    $('nav-eta').textContent = finished ? t('nav_there') : t('nav_eta', { m: Math.ceil(left), s: Math.max(1, Math.round((totalMs - elapsed) / 1000)) });
    walkerRaf = finished ? 0 : requestAnimationFrame(frame);
  };
  const start = () => { stopWalker(); last = null; finished = false; walkerRaf = requestAnimationFrame(frame); };
  $('nav-pause').onclick = () => {
    paused = !paused;
    $('nav-pause').textContent = paused ? '▶' : '⏸';
    if (!paused && finished) { elapsed = 0; shown = -1; start(); }
  };
  $('nav-replay').onclick = () => { elapsed = 0; shown = -1; paused = false; $('nav-pause').textContent = '⏸'; start(); };
  $('nav-speak').onclick = () => speak(all[Math.max(0, shown)].text);
  $('nav-steps').onclick = (e) => {
    const i = Number(e.target.closest('[data-step]')?.dataset.step);
    if (Number.isNaN(i)) return;
    elapsed = i < sched.length ? sched[i].t0 : totalMs;
    shown = -1;
    if (finished) start();
  };
  $('nav-pause').textContent = '⏸';
  navStarted = Date.now();
  spokenAnswer = all.map((st) => st.text).join('. ');
  start();
}
let navDeal = null;
$('nav-deal-add').addEventListener('click', () => {
  if (!navDeal) return;
  if (!inList(navDeal.id)) toggleList(navDeal, 'detour');
  $('nav-deal-add').textContent = t('in_short');
});
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
  say(`${t('arrived_title')} ${$('arr-where').textContent}`);
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
    say(lang === 'he' ? t('found_next', { name: next.name }) : t('found_say'));
  } else say(t('found_say'));
  // what else is right here: the easiest extra purchase there is
  const aisle = await api(pub(`/aisle/${encodeURIComponent(current.shelfId)}`)).catch(() => []);
  const more = aisle.filter((x) => x.id !== current.id).slice(0, 8);
  if (more.length) {
    $('arr-more-row').replaceChildren(...more.map((x) => miniCard(x, { source: 'aisle' })));
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
    say(t('help_say'));
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

// ---------- "where am I?": photo of the shelf in front of you, or a tap on the map ----------
let shelfPhotos = null;
function openLocate() {
  buzz();
  $('loc-status').classList.add('hidden');
  $('loc-guesses').innerHTML = '';
  renderMap($('loc-map'), store.map, { here: hereShelf && aisleSpot(store.map, hereShelf), onShelfClick: setHere, ...mapLabels() });
  $('locate-sheet').classList.remove('hidden');
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-where]')) openLocate(); });
$('loc-cancel').addEventListener('click', () => $('locate-sheet').classList.add('hidden'));
$('locate-sheet').addEventListener('click', (e) => { if (e.target === $('locate-sheet')) $('locate-sheet').classList.add('hidden'); });
$('loc-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('loc-status').innerHTML = `<span class="row"><span class="spinner"></span> ${t('loc_thinking')}</span>`;
  $('loc-status').classList.remove('hidden');
  $('loc-guesses').innerHTML = '';
  try {
    shelfPhotos ||= await api(pub('/shelf-photos'));
    // the AI guess when the store has it; otherwise (and as a backup) compare with the shelf photos
    const form = new FormData();
    form.append('image', await resizeImage(file, 1024), 'shelf.jpg');
    const [aiGuess, ranked] = await Promise.all([
      store.photoSearch ? api(pub('/locate'), { method: 'POST', form }).catch(() => ({ shelfIds: [] })) : { shelfIds: [] },
      rankShelves(file, shelfPhotos).catch(() => []),
    ]);
    const ids = [...new Set([...aiGuess.shelfIds, ...ranked.filter((r) => r.score >= ranked[0].score - 0.05).map((r) => r.shelfId)])].slice(0, 3);
    const guesses = ids.map((id) => store.map.shelves.find((s) => s.id === id)).filter(Boolean);
    if (!guesses.length) { $('loc-status').textContent = t('loc_none'); return; }
    $('loc-status').textContent = t('loc_guess');
    renderMap($('loc-map'), store.map, { targetShelfId: guesses[0].id, onShelfClick: setHere, ...mapLabels() });
    $('loc-guesses').replaceChildren(...guesses.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `loc-guess${i ? '' : ' best'}`;
      const photo = shelfPhotos.find((x) => x.shelfId === s.id)?.urls[0];
      b.innerHTML = `${photo ? `<img src="${escapeHtml(photo)}" alt="">` : ''}<span class="lg-name">${escapeHtml(aisleName(s))}</span><span class="lg-yes">${escapeHtml(t('loc_yes'))}</span>`;
      b.addEventListener('click', () => setHere(s));
      return b;
    }));
    buzz(15);
  } catch (err) { $('loc-status').textContent = err.message; }
});
function setHere(shelf) {
  hereShelf = shelf;
  buzz(25);
  $('locate-sheet').classList.add('hidden');
  $('here-banner').textContent = t('here', { name: aisleName(shelf) });
  $('here-banner').classList.remove('hidden');
  toast(t('loc_done', { a: aisleName(shelf, { short: true }) }));
  const v = document.body.dataset.view;
  if ((v === 'nav' || v === 'detail') && current) {
    const p = current;
    renderDetail(p, { quiet: true }); // routes again, from where the shopper stands
    if (v === 'nav' && navRoute) {
      const route = navRoute;
      screens[at] = () => { current = p; navRoute = route; renderNav(); };
      renderNav();
      say(spokenAnswer);
    } else screens[at] = () => renderDetail(p, { quiet: true });
  } else if (v === 'list') renderListView();
}

// ---------- virtual tour: the real aisles, in walking order, shoppable ----------
let tour = null; // { aisles, i }
async function loadTour() {
  if (tour) return tour;
  const aisles = await api(pub('/tour')).catch(() => []);
  // walking order from the entrance, the way you'd actually go through the store
  const shelves = aisles.map((a) => store.map.shelves.find((s) => s.id === a.shelfId)).filter(Boolean);
  const order = planRoute(store.map, shelves, store.map.entrance).legs.map((l) => l.shelf.id);
  aisles.sort((a, b) => order.indexOf(a.shelfId) - order.indexOf(b.shelfId));
  tour = { aisles, i: 0 };
  return tour;
}
async function prepTourCard() {
  const tr = await loadTour();
  const first = tr.aisles.find((a) => a.photos.length);
  $('tour-card').classList.toggle('hidden', !tr.aisles.length);
  if (first) $('tour-card-bg').style.backgroundImage = `url("${first.photos[0].url}")`;
}
function openTour(i = tour?.i || 0) { go(() => renderTour(i)); }
const has3d = webglOk();
$('tc-3d').classList.toggle('hidden', !has3d);
$('tour-card').addEventListener('click', () => { buzz(); if (has3d) open3d(); else openTour(0); });
function renderTour(i) {
  if (!tour?.aisles.length) return renderHome();
  setView('tour');
  tour.i = Math.max(0, Math.min(tour.aisles.length - 1, i));
  const a = tour.aisles[tour.i];
  const shelf = store.map.shelves.find((s) => s.id === a.shelfId);
  $('tour-count').textContent = t('tour_count', { i: tour.i + 1, n: tour.aisles.length });
  $('tour-name').textContent = aisleName(shelf);
  // the photos, swiped sideways, each with tappable product spots
  const stage = $('tour-stage');
  stage.scrollLeft = 0;
  if (a.photos.length) {
    stage.innerHTML = a.photos.map((ph, k) => `<div class="tour-shot"><div class="shot-wrap"><img src="${escapeHtml(ph.url)}" alt="" draggable="false">${ph.products.map((p) => {
      const cx = (p.box.x0 + p.box.x1) / 20, cy = (p.box.y0 + p.box.y1) / 20;
      return `<button type="button" class="hot${inList(p.id) ? ' in' : ''}${p.promo ? ' deal' : ''}" data-hot="${p.id}" data-shot="${k}" style="left:${cx}%;top:${cy}%" aria-label="${escapeHtml(p.name)}"><span class="hot-dot"></span>${p.price ? `<span class="hot-tag">${escapeHtml(formatPrice(p.price))}</span>` : ''}</button>`;
    }).join('')}</div></div>`).join('');
  } else {
    stage.innerHTML = `<div class="tour-shot"><div class="shot-empty"><span>🛒</span><b>${escapeHtml(aisleName(shelf))}</b><span class="muted">${escapeHtml(t('tour_nophoto'))}</span></div></div>`;
  }
  $('tour-dots').innerHTML = a.photos.length > 1 ? a.photos.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('') : '';
  $('tour-hint').classList.toggle('hidden', !a.photos.some((ph) => ph.products.length));
  $('tour-prev').disabled = tour.i === 0;
  $('tour-next').textContent = tour.i === tour.aisles.length - 1 ? t('tour_done') : t('tour_next');
  $('tour-products').replaceChildren(...a.products.slice(0, 20).map((p) => miniCard(p, { source: 'tour' })));
  $('tour-products-title').classList.toggle('hidden', !a.products.length);
  renderMap($('tour-map'), store.map, { targetShelfId: a.shelfId, ...mapLabels() });
  const deals = a.products.filter((p) => p.promo).length;
  say(`${aisleName(shelf, { short: lang !== 'he' })}. ${t('tour_n', { n: a.products.length })}${deals ? ` ${t('tour_deals', { n: deals })}` : ''}`);
}
$('tour-stage').addEventListener('scroll', () => {
  const st = $('tour-stage');
  const k = Math.round(Math.abs(st.scrollLeft) / Math.max(1, st.clientWidth));
  [...$('tour-dots').children].forEach((d, j) => d.classList.toggle('on', j === k));
}, { passive: true });
const stepTour = (d) => {
  buzz();
  if (d > 0 && tour.i === tour.aisles.length - 1) return go(renderListView);
  screens[at] = () => renderTour(tour.i + d);
  history.replaceState({ i: at }, '');
  renderTour(tour.i + d);
};
$('tour-prev').addEventListener('click', () => stepTour(-1));
$('tour-next').addEventListener('click', () => stepTour(1));
$('tour-speak').addEventListener('click', () => { const a = tour.aisles[tour.i]; speak(`${aisleName(store.map.shelves.find((s) => s.id === a.shelfId))}. ${t('tour_n', { n: a.products.length })}`); });
// swipe on the last photo goes to the next aisle, like walking on
let tourTouch = null;
$('tour-stage').addEventListener('touchstart', (e) => { tourTouch = e.touches[0].clientX; }, { passive: true });
$('tour-stage').addEventListener('touchend', (e) => {
  if (tourTouch === null) return;
  const dx = e.changedTouches[0].clientX - tourTouch, st = $('tour-stage');
  tourTouch = null;
  const atEnd = Math.abs(st.scrollLeft) + st.clientWidth >= st.scrollWidth - 4, atStart = Math.abs(st.scrollLeft) < 4;
  const forward = document.documentElement.dir === 'rtl' ? dx > 60 : dx < -60, back = document.documentElement.dir === 'rtl' ? dx < -60 : dx > 60;
  if (forward && atEnd && tour.i < tour.aisles.length - 1) stepTour(1);
  else if (back && atStart && tour.i > 0) stepTour(-1);
});
let tourPick = null;
$('tour-stage').addEventListener('click', (e) => {
  const hot = e.target.closest('[data-hot]');
  if (!hot) return;
  const a = tour.aisles[tour.i];
  tourPick = a.photos[Number(hot.dataset.shot)].products.find((p) => p.id === Number(hot.dataset.hot));
  if (!tourPick) return;
  buzz(10);
  drawCrop($('tp-thumb'), tourPick.image || tourPick.photo, tourPick.image ? null : tourPick.box, 200);
  $('tp-name').textContent = tourPick.name;
  $('tp-price').textContent = tourPick.price ? formatPrice(tourPick.price) : '';
  $('tp-promo').innerHTML = tourPick.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(tourPick.promo)}</span>` : '';
  paintTourAdd();
  $('tour-sheet').classList.remove('hidden');
  say(lang === 'he' ? `${shortName(tourPick)}${tourPick.price ? `, ${formatPrice(tourPick.price)}` : ''}${tourPick.promo ? `. ${tourPick.promo}` : ''}` : '');
});
function paintTourAdd() {
  const on = tourPick && inList(tourPick.id);
  $('tp-add').textContent = t(on ? 'in_short' : 'add_short');
  $('tp-add').classList.toggle('on', Boolean(on));
}
$('tp-add').addEventListener('click', () => {
  if (!tourPick) return;
  $('tour-sheet').classList.add('hidden');
  const adding = !inList(tourPick.id);
  toggleList(tourPick, 'tour');
  if (s3d && document.body.dataset.view === 's3d') {
    if (adding) { s3d.flyToCart(tourPick); setTimeout(kaching, 450); } else s3d.refreshTag(tourPick.id);
    setTimeout(paintCart3d, adding ? 650 : 0);
  }
  for (const h of document.querySelectorAll(`[data-hot="${tourPick.id}"]`)) h.classList.toggle('in', inList(tourPick.id));
});
$('tp-more').addEventListener('click', () => { $('tour-sheet').classList.add('hidden'); if (tourPick) openProduct(tourPick, { source: 'tour' }); });
$('tour-sheet').addEventListener('click', (e) => { if (e.target === $('tour-sheet')) $('tour-sheet').classList.add('hidden'); });

// ---------- the store in 3D ----------
let s3d = null;
let s3dPick = null;
function stop3d() { s3d?.stop(); stopMusic(); }
// the cart button: how many and how much, like the screen on a smart cart
function paintCart3d() {
  const todo = loadList().filter((i) => !i.picked);
  const total = todo.reduce((sum, i) => sum + priceValue(i.price), 0);
  $('s3d-count').textContent = todo.length;
  $('s3d-total').textContent = total ? `₪${total.toFixed(2).replace(/\.00$/, '')}` : '';
  $('s3d-checkout').classList.toggle('hidden', !todo.length);
  const b = $('s3d-cart'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}

// ---------- sound in the 3D store: soft music, a "ka-ching" for every product ----------
// Made on the phone with Web Audio (nothing to download), quiet, and lower while Omer talks.
const sound = { ctx: null, master: null, timer: 0, on: (() => { try { return localStorage.getItem('storeFinder:music') !== '0'; } catch { return true; } })() };
const MUSIC_LEVEL = 0.05;
function audioCtx() {
  if (!sound.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; sound.ctx = new AC(); }
  sound.ctx.resume?.();
  return sound.ctx;
}
function startMusic() {
  $('s3d-music').classList.toggle('off', !sound.on);
  if (!sound.on || sound.timer) return;
  const ctx = audioCtx(); if (!ctx) return;
  const master = sound.master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(player.paused ? MUSIC_LEVEL : MUSIC_LEVEL * 0.3, ctx.currentTime + 2.5);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
  lp.connect(master); master.connect(ctx.destination);
  // Cmaj7 · Am7 · Fmaj7 · G6: warm, unhurried, a little sunny
  const chords = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 329.63]];
  const bells = [523.25, 587.33, 659.25, 783.99, 880];
  let bar = 0;
  const play = () => {
    const t0 = ctx.currentTime + 0.05;
    for (const f of chords[bar % 4]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f / 2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 1.2); g.gain.linearRampToValueAtTime(0, t0 + 4.2);
      o.connect(g); g.connect(lp); o.start(t0); o.stop(t0 + 4.3);
    }
    for (let k = 0; k < 3; k++) if (Math.random() < 0.55) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t0 + 0.6 + k * 1.1;
      o.type = 'sine'; o.frequency.value = bells[Math.floor(Math.random() * bells.length)];
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.07, at + 0.02); g.gain.exponentialRampToValueAtTime(0.001, at + 1.6);
      o.connect(g); g.connect(lp); o.start(at); o.stop(at + 1.7);
    }
    bar++;
  };
  play();
  sound.timer = setInterval(play, 4000);
}
function stopMusic() {
  clearInterval(sound.timer); sound.timer = 0;
  const m = sound.master; sound.master = null;
  if (m && sound.ctx) { m.gain.cancelScheduledValues(sound.ctx.currentTime); m.gain.linearRampToValueAtTime(0, sound.ctx.currentTime + 0.6); setTimeout(() => m.disconnect(), 800); }
}
// quieter while Omer speaks
player.addEventListener('play', () => { if (sound.master) sound.master.gain.linearRampToValueAtTime(MUSIC_LEVEL * 0.3, sound.ctx.currentTime + 0.3); });
for (const ev of ['ended', 'pause']) player.addEventListener(ev, () => { if (sound.master) sound.master.gain.linearRampToValueAtTime(MUSIC_LEVEL, sound.ctx.currentTime + 0.8); });
function kaching() {
  if (!sound.on) return;
  const ctx = audioCtx(); if (!ctx) return;
  const t0 = ctx.currentTime;
  [[1318.5, 0], [1760, 0.09], [2637, 0.18]].forEach(([f, d]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(0.16, t0 + d + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 0.45);
    o.connect(g); g.connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 0.5);
  });
}
function open3d(opts = {}) { go(() => render3d(opts)); }
async function render3d({ productId = null } = {}) {
  setView('s3d');
  document.body.classList.add('in3d');
  $('s3d-loading').classList.remove('hidden');
  $('s3d-hint').classList.remove('hidden');
  try {
    const [THREE, tr] = await Promise.all([loadThree(), loadTour()]);
    if (document.body.dataset.view !== 's3d') return;
    if (!s3d) {
      s3d = new Store3D(THREE, $('s3d-canvas'), store.map, tr.aisles, {
        storeName: () => store.name,
        price: (p) => (p.price ? formatPrice(p.price) : ''),
        inCart: (id) => inList(id),
        where: (shelf) => {
          $('s3d-where').textContent = shelf ? aisleName(shelf) : t('s3d_walk');
          clearTimeout(s3d?.sayTimer);
          if (shelf && s3d) s3d.sayTimer = setTimeout(() => { if (s3d.whereId === shelf.id && !s3d.path) say(aisleName(shelf, { short: lang !== 'he' })); }, 1200);
        },
      });
      s3d.fillCart(loadList().filter((i) => !i.picked));
      bind3dControls();
      // the first time: glide down from above the store to the door, with a welcome
      if (!productId) {
        $('s3d-store').textContent = store.name;
        $('s3d-welcome').classList.add('show');
        s3d.playIntro(() => { $('s3d-welcome').classList.remove('show'); say(t('s3d_welcome')); });
      }
    }
    s3d.resize();
    s3d.start();
    startMusic();
    $('s3d-loading').classList.add('hidden');
    paintCart3d();
    setTimeout(() => $('s3d-hint').classList.add('hidden'), 7000);
    tick3dMini();
    if (s3d.intro) return;
    if (productId) {
      const ok = s3d.walkToProduct(productId, (p) => show3dPick(p));
      if (!ok) {
        const p = await api(pub(`/products/${productId}`)).catch(() => null);
        const shelf = p && shelfOf(p);
        if (shelf) s3d.walkToShelf(shelf);
      }
      say(t('s3d_taking'));
    }
  } catch (err) {
    $('s3d-loading').innerHTML = `<span>${escapeHtml(err.message)}</span>`;
  }
}
function tick3dMini() {
  if (document.body.dataset.view !== 's3d' || !s3d) return;
  s3d.minimap($('s3d-mini'));
  setTimeout(tick3dMini, 120);
}
function show3dPick(p) {
  tourPick = p;
  s3dPick = p;
  buzz(10);
  drawCrop($('tp-thumb'), p.image || p.photo, p.image ? null : p.box, 200);
  $('tp-name').textContent = p.name;
  $('tp-price').textContent = p.price ? formatPrice(p.price) : '';
  $('tp-promo').innerHTML = p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : '';
  paintTourAdd();
  $('tour-sheet').classList.remove('hidden');
  say(lang === 'he' ? `${shortName(p)}${p.price ? `, ${formatPrice(p.price)}` : ''}${p.promo ? `. ${p.promo}` : ''}` : '');
}
let bound3d = false;
function bind3dControls() {
  if (bound3d) return;
  bound3d = true;
  const cv = $('s3d-canvas');
  // drag to look, tap to buy or to walk to that spot
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (s3d?.intro) { s3d.skipIntro(); return; }
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() }; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !s3d) return;
    s3d.yaw -= (e.clientX - drag.x) * 0.006; // drag right, look right
    s3d.pitch = Math.max(-0.6, Math.min(0.5, s3d.pitch + (e.clientY - drag.y) * 0.004));
    s3d.turnTo = undefined;
    drag.x = e.clientX; drag.y = e.clientY;
  });
  cv.addEventListener('pointerup', (e) => {
    if (!drag || !s3d) return;
    const tap = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8 && performance.now() - drag.t < 400;
    drag = null;
    if (!tap) return;
    const hit = s3d.pick(e.clientX, e.clientY);
    if (hit?.product) show3dPick(hit.product);
    else if (hit?.floor) { s3d.walkToPoint(hit.floor.x, hit.floor.z); buzz(6); }
  });
  // joystick: up/down walks, sideways steps aside
  const stick = $('s3d-stick'), knob = stick.firstElementChild;
  let sid = null;
  const setStick = (e) => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    s3d.move.f = -dy / R; s3d.move.s = dx / R;
    if (Math.abs(s3d.move.f) < 0.15) s3d.move.f = 0;
    if (Math.abs(s3d.move.s) < 0.25) s3d.move.s = 0;
    s3d.path = null; s3d.tour = null;
  };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); setStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) setStick(e); });
  const release = () => { sid = null; knob.style.transform = ''; if (s3d) { s3d.move.f = 0; s3d.move.s = 0; } };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  // keyboard on a computer
  const keys = new Set();
  const applyKeys = () => {
    if (!s3d || document.body.dataset.view !== 's3d') return;
    s3d.move.f = (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('s') ? 1 : 0);
    s3d.turnKeys = (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('d') ? 1 : 0);
  };
  window.addEventListener('keydown', (e) => { if (document.body.dataset.view === 's3d') { keys.add(e.key); applyKeys(); } });
  window.addEventListener('keyup', (e) => { keys.delete(e.key); applyKeys(); });
  setInterval(() => { if (s3d?.turnKeys && s3d.running) s3d.yaw += s3d.turnKeys * 0.04; }, 16);
  // a guided walk through the aisles, in walking order, a pause at each one
  $('s3d-auto').addEventListener('click', () => {
    if (!s3d) return;
    if (s3d.tour) { s3d.tour = null; s3d.path = null; $('s3d-auto').textContent = t('s3d_auto'); return; }
    const shelves = tour.aisles.map((a) => store.map.shelves.find((s) => s.id === a.shelfId)).filter(Boolean);
    const order = planRoute(store.map, shelves, store.map.entrance).legs.map((l) => l.shelf);
    s3d.tour = { order, i: 0 };
    $('s3d-auto').textContent = t('s3d_stop');
    const next = () => {
      if (!s3d.tour) return;
      const sh = s3d.tour.order[s3d.tour.i++];
      if (!sh) { s3d.tour = null; $('s3d-auto').textContent = t('s3d_auto'); say(t('s3d_tour_end')); return; }
      s3d.walkToShelf(sh, () => {
        const a = tour.aisles.find((x) => x.shelfId === sh.id);
        const deals = a ? a.products.filter((p) => p.promo).length : 0;
        say(`${aisleName(sh, { short: lang !== 'he' })}. ${a ? t('tour_n', { n: a.products.length }) : ''}${deals ? ` ${t('tour_deals', { n: deals })}` : ''}`);
        setTimeout(next, 4200);
      });
    };
    next();
  });
  $('s3d-cart').addEventListener('click', () => go(renderListView));
  $('s3d-music').addEventListener('click', () => {
    sound.on = !sound.on;
    try { localStorage.setItem('storeFinder:music', sound.on ? '1' : '0'); } catch { /* private mode */ }
    if (sound.on) startMusic(); else { stopMusic(); $('s3d-music').classList.add('off'); }
  });
  // checkout: walk to the tills, then a little celebration and what's next
  $('s3d-checkout').addEventListener('click', () => {
    buzz();
    const tills = store.map.shelves.filter((s) => /^c\d+$/.test(s.id) || /קופ/.test(s.name));
    const near = tills.sort((a, b) => Math.hypot(a.x - s3d.pos.x, a.y - s3d.pos.z) - Math.hypot(b.x - s3d.pos.x, b.y - s3d.pos.z))[0];
    s3d.tour = null;
    if (near) s3d.walkToShelf(near, showFinale);
    else { const e = store.map.entrance; s3d.walkToPoint(e.x + 0.5, e.y + 0.5); setTimeout(showFinale, 1200); }
  });
  $('fin-more').addEventListener('click', () => $('s3d-finale').classList.add('hidden'));
  $('fin-nav').addEventListener('click', () => { $('s3d-finale').classList.add('hidden'); go(renderListView); setTimeout(() => $('list-start').click(), 300); });
  $('fin-share').addEventListener('click', () => {
    const todo = loadList().filter((i) => !i.picked);
    const lines = todo.map((i) => `• ${i.name}${i.price ? ` · ${formatPrice(i.price)}` : ''} · ${shortShelf(store.map.shelves.find((s) => s.id === i.shelfId))}`);
    const text = `${t('fin_wa', { store: store.name })}\n${lines.join('\n')}\n\n${location.origin}/s/${encodeURIComponent(slug)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });
  $('s3d-photos').addEventListener('click', () => openTour(0));
}
$('detail-3d').addEventListener('click', () => { if (current) open3d({ productId: current.id }); });
function showFinale() {
  const todo = loadList().filter((i) => !i.picked);
  const total = todo.reduce((sum, i) => sum + priceValue(i.price), 0);
  $('fin-sum').textContent = t('fin_sum', { n: todo.length, total: total ? `₪${total.toFixed(2).replace(/\.00$/, '')}` : '' }).replace(/ · $/, '');
  $('fin-thumbs').replaceChildren(...todo.slice(0, 8).map((i) => { const c = document.createElement('canvas'); drawCrop(c, i.image || i.photo, i.image ? null : i.box, 96); return c; }));
  // confetti in the store's colours
  const colors = ['#ff7a1a', '#ff3d6e', '#22c55e', '#4f7cff', '#ffd166', '#ffffff'];
  $('confetti').innerHTML = Array.from({ length: 70 }, (_, k) => `<i style="left:${Math.random() * 100}%;background:${colors[k % colors.length]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2.2 + Math.random() * 1.6}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join('');
  $('s3d-finale').classList.remove('hidden');
  kaching(); buzz([30, 60, 30, 60, 60]);
  say(t('fin_say', { n: todo.length }));
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

// ---------- shopping list: one route through the store, past deals on the way ----------
function loadList() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; }
}
function saveList(list) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  renderListBadge();
  for (const b of document.querySelectorAll('.add-btn')) b.dispatchEvent(new Event('list-changed'));
}
function inList(id) { return loadList().some((i) => i.id === id); }
function toggleList(p, source = 'search') {
  const list = loadList();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) { list.splice(i, 1); toast(t('removed')); buzz(8); }
  else {
    list.push({ id: p.id, name: p.name, shelfId: p.shelfId, level: p.level, price: p.price, photo: p.photo, image: p.image, box: p.box, picked: false });
    const shelf = shelfOf(p);
    toast(t('added', { a: shelf ? shortShelf(shelf) : '' }));
    buzz(15);
    track('cart', { productId: p.id, source }).catch(() => {});
    offerWith(p, list);
    const badge = $('list-count');
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }
  saveList(list);
}
// ---------- "goes well with": after something goes on the list, offer what fits it ----------
// Deals first, then what other shoppers took with it, then what naturally goes with it.
const offered = new Set();
// "כוס קפה קר MOOSH בצבעי פסטל 550 מ"ל" -> "כוס קפה קר": short enough to say out loud
const shortName = (p) => { const w = []; for (const x of p.name.split(/\s+/)) { if (!/^[\u0590-\u05FF'׳-]+$/.test(x) || w.length === 3) break; w.push(x); } return w.join(' ') || p.name; };
async function offerWith(p, list) {
  const inSheet = !$('upsell-sheet').classList.contains('hidden');
  if (inSheet || offered.has(p.id)) return say(t('added_say'));
  offered.add(p.id);
  const ids = list.map((i) => i.id).join(',');
  const sugg = await api(pub(`/suggest?ids=${p.id}&exclude=${ids}&limit=4`)).catch(() => []);
  if (!sugg.length) return say(t('added_say'));
  $('up-added').textContent = p.name;
  $('up-title').textContent = lang === 'he' ? t('up_title', { name: shortName(p) }) : t('up_title_any');
  $('up-row').replaceChildren(...sugg.map((s) => miniCard(s.product, { why: s.reason })));
  $('upsell-sheet').classList.remove('hidden');
  $('toast').classList.remove('show'); // the sheet already says it was added
  const deal = sugg.find((s) => s.product.promo);
  say(deal && lang === 'he' ? t('up_say_deal', { name: shortName(deal.product), promo: deal.product.promo }) : t('up_say'));
}
const closeUpsell = () => $('upsell-sheet').classList.add('hidden');
$('up-done').addEventListener('click', closeUpsell);
$('upsell-sheet').addEventListener('click', (e) => { if (e.target === $('upsell-sheet')) closeUpsell(); });
$('up-row').addEventListener('click', (e) => { if (!e.target.closest('.add-btn')) closeUpsell(); }, true);

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
$('list-toggle').addEventListener('click', () => { if (current) { toggleList(current, currentSource); updateListToggle(); } });

// "89.90" counts toward the estimate; deals written as text ("2 ב-25") don't
const priceValue = (p) => (/^\s*₪?\s*\d+(\.\d+)?\s*₪?\s*$/.test(p || '') ? Number(p.replace(/[^\d.]/g, '')) : 0);
// The list's route takes in up to two deals on the way, within the walk the store allows (detourPct)
function listWithDeals(shelves, start) {
  const base = planRoute(store.map, shelves, start);
  const pct = store.detourPct ?? 20;
  if (!pct || !shelves.length || !allDeals.length) return { route: base, deals: [] };
  const limit = Math.max(base.meters * (1 + pct / 100), base.meters + 4);
  const taken = new Set(shelves.map((s) => s.id));
  const deals = [];
  let route = base;
  for (let k = 0; k < 2; k++) {
    let best = null;
    for (const d of allDeals) {
      const ds = shelfOf(d);
      if (!ds || taken.has(ds.id) || inList(d.id)) continue;
      const r = planRoute(store.map, [...shelves, ...deals.map(shelfOf), ds], start);
      if (r.unreachable.length || r.meters > limit || (best && r.meters >= best.r.meters)) continue;
      best = { d, ds, r };
    }
    if (!best) break;
    deals.push(best.d); taken.add(best.ds.id); route = best.r;
  }
  return { route, deals };
}
let routeSpeech = '';
let listRoute = null;
let listSuggestFor = '';
async function loadListSuggest(todo) {
  const key = todo.map((i) => i.id).join(',');
  listSuggestFor = key;
  if (!todo.length) return $('list-suggest').classList.add('hidden');
  const all = loadList().map((i) => i.id).join(',');
  const sugg = await api(pub(`/suggest?ids=${key}&exclude=${all}&limit=6`)).catch(() => []);
  if (listSuggestFor !== key) return;
  $('list-suggest-row').replaceChildren(...sugg.map((s) => miniCard(s.product, { why: s.reason })));
  $('list-suggest').classList.toggle('hidden', !sugg.length);
}
function renderListView() {
  setView('list');
  const list = loadList();
  const todo = list.filter((i) => !i.picked);
  const shelves = todo.map((i) => store.map.shelves.find((s) => s.id === i.shelfId)).filter(Boolean);
  const here = hereShelf && aisleSpot(store.map, hereShelf);
  const { route, deals: dealStops } = listWithDeals(shelves, here || store.map.entrance);
  listRoute = route;
  const order = new Map(route.legs.map((l, n) => [l.shelf.id, n + 1])); // place along the route, deals included
  const dealShelves = new Set(dealStops.map((d) => d.shelfId));
  let stopNo = 0;
  const number = new Map(route.legs.filter((l) => !dealShelves.has(l.shelf.id)).map((l) => [l.shelf.id, ++stopNo])); // what the shopper sees
  const sorted = [...list].sort((a, b) => (a.picked - b.picked) || ((order.get(a.shelfId) ?? 99) - (order.get(b.shelfId) ?? 99)));
  $('list-meters').textContent = route.legs.length ? t('list_meters', { m: route.meters, s: stopNo }) : '';
  $('list-hint').textContent = t(todo.length ? 'list_hint' : list.length ? 'list_done' : 'list_empty');
  const rows = sorted.map((i) => {
    const shelf = store.map.shelves.find((s) => s.id === i.shelfId);
    const n = number.get(i.shelfId);
    return `<li class="list-item${i.picked ? ' picked' : ''}" data-id="${i.id}">
      <span class="stop-n">${i.picked ? '✓' : (n ?? '?')}</span>
      <span class="li-main"><span class="name">${escapeHtml(i.name)}</span><span class="meta">${escapeHtml(shortShelf(shelf))}${i.level ? ` · ${escapeHtml(levelName(i.level))}` : ''}${i.price ? ` · ${escapeHtml(formatPrice(i.price))}` : ''}</span></span>
      <button type="button" class="li-check" aria-label="${t(i.picked ? 'put_back' : 'taken')}">${i.picked ? '↩︎' : t('taken')}</button>
    </li>`;
  }).map((html, k) => ({ key: sorted[k].picked ? 1e6 : order.get(sorted[k].shelfId) ?? 999, html }));
  // deals the route passes: a stop of their own, one tap to add
  for (const d of dealStops) {
    rows.push({ key: order.get(d.shelfId) ?? 999, html: `<li class="list-item deal" data-deal="${d.id}">
      <span class="stop-n">🔥</span>
      <span class="li-main"><span class="name">${escapeHtml(t('list_deal', { name: shortName(d) }))}</span><span class="meta">${escapeHtml(d.promo)} · ${escapeHtml(shortShelf(shelfOf(d)))}</span></span>
      <button type="button" class="li-add">${t('add_short')}</button>
    </li>` });
  }
  $('list-items').innerHTML = rows.sort((a, b) => a.key - b.key).map((r) => r.html).join('');
  const total = todo.reduce((sum, i) => sum + priceValue(i.price), 0);
  $('list-total').textContent = t('list_total', { p: total.toFixed(2).replace(/\.00$/, '') });
  $('list-total').classList.toggle('hidden', !total);
  loadListSuggest(todo);
  $('list-start').classList.toggle('hidden', !todo.length);
  $('list-deals').classList.toggle('hidden', todo.length > 0);
  $('list-map-box').classList.toggle('hidden', !route.legs.length);
  $('list-clear').classList.toggle('hidden', !list.length);
  if (route.legs.length) {
    const stops = route.legs.map((l) => (dealShelves.has(l.shelf.id) ? { ...l.path[l.path.length - 1], n: '🔥', deal: true } : { ...l.path[l.path.length - 1], n: number.get(l.shelf.id) }));
    renderMap($('list-map'), store.map, { targetShelfIds: [...shelves.map((s) => s.id), ...dealShelves], path: route.path, here, stops, ...mapLabels() });
  }
  routeSpeech = route.legs.map((l) => (dealShelves.has(l.shelf.id)
    ? `${shortShelf(l.shelf)}: ${t('list_deal', { name: dealStops.filter((d) => d.shelfId === l.shelf.id).map(shortName).join(', ') })}`
    : `${number.get(l.shelf.id)}. ${shortShelf(l.shelf)}: ${todo.filter((i) => i.shelfId === l.shelf.id).map((i) => i.name).join(', ')}`)).join('. ');
  $('list-speak').classList.toggle('hidden', !voiceOk() || !route.legs.length);
}
$('list-items').addEventListener('click', async (e) => {
  const li = e.target.closest('.list-item');
  if (!li) return;
  if (li.dataset.deal) {
    const d = allDeals.find((x) => x.id === Number(li.dataset.deal));
    if (!d) return;
    if (e.target.closest('.li-add')) { toggleList(d, 'detour'); renderListView(); } else openProduct(d, { source: 'detour' });
    return;
  }
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
    say(t('help_say'));
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
// The browser's own recognition where it works (free). iPhones and in-app browsers (WhatsApp, Telegram)
// often don't have it, so there the phone records a few seconds and the server turns it into text.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let browserVoiceFailed = false;
let stopListening = null;
let cancelListening = null;
function openListen() {
  $('listen-text').textContent = '';
  $('listen-label').textContent = t('listening');
  $('listen-sheet').classList.remove('hidden');
  $('listen-sheet').classList.add('live');
  $('listen-done').disabled = false;
  buzz();
}
function closeListen(delay = 0) {
  setTimeout(() => $('listen-sheet').classList.add('hidden'), delay);
  stopListening = cancelListening = null;
}
function heardIt(text) {
  $('listen-text').textContent = `"${text}"`;
  $('listen-label').textContent = t('understood');
  $('listen-sheet').classList.remove('live');
  closeListen(700);
  voiceMode = true;
  $('q').value = text;
  search(text);
}
$('listen-done').addEventListener('click', () => stopListening?.());
$('listen-cancel').addEventListener('click', () => { cancelListening?.(); closeListen(); });

function listenBrowser() {
  const rec = new Recognition();
  rec.lang = LANGS[lang].voice;
  rec.interimResults = true;
  let heard = '';
  let failed = false;
  let cancelled = false;
  openListen();
  rec.onresult = (e) => {
    heard = [...e.results].map((r) => r[0].transcript).join('');
    $('listen-text').textContent = `"${heard}"`;
  };
  rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') failed = true; };
  rec.onend = () => {
    if (cancelled) return;
    if (heard.trim()) return heardIt(heard.trim());
    if (failed && canRecord && store.voiceInput) {
      // this browser can't do it: the next tap records instead
      browserVoiceFailed = true;
      $('listen-label').textContent = t('mic_retry');
      $('listen-sheet').classList.remove('live');
      return;
    }
    $('listen-label').textContent = t('mic_nothing');
    $('listen-sheet').classList.remove('live');
    closeListen(1600);
  };
  stopListening = () => rec.stop();
  cancelListening = () => { cancelled = true; rec.abort(); };
  rec.start();
}

async function listenRecord() {
  openListen();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $('listen-label').textContent = t('mic_blocked');
    $('listen-sheet').classList.remove('live');
    return;
  }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  let cancelled = false;
  const started = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // stop by itself after the shopper finishes talking (a second of quiet), or after 8 seconds
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let spoke = false, quietSince = 0;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) ** 2;
    const loud = Math.sqrt(sum / buf.length) > 6;
    if (loud) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = Date.now();
    if ((spoke && quietSince && Date.now() - quietSince > 1100) || Date.now() - started > 8000) stop();
  }, 100);
  function stop() {
    clearInterval(timer);
    if (rec.state !== 'inactive') rec.stop();
  }
  rec.onstop = async () => {
    stream.getTracks().forEach((tr) => tr.stop());
    ctx.close().catch(() => {});
    if (cancelled) return;
    $('listen-sheet').classList.remove('live');
    $('listen-label').innerHTML = `<span class="row" style="justify-content:center"><span class="spinner"></span> ${escapeHtml(t('mic_thinking'))}</span>`;
    $('listen-done').disabled = true;
    try {
      const form = new FormData();
      form.append('audio', new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), 'voice');
      form.append('seconds', String(Math.ceil((Date.now() - started) / 1000)));
      form.append('lang', lang);
      const { text } = await api(pub('/stt'), { method: 'POST', form });
      if (text) return heardIt(text);
      $('listen-label').textContent = t('mic_nothing');
      closeListen(1600);
    } catch (err) {
      $('listen-label').textContent = err.message;
      closeListen(2500);
    }
  };
  stopListening = stop;
  cancelListening = () => { cancelled = true; stop(); };
  rec.start();
}

function listen() {
  unlockAudio();
  speakSeq++; player.pause(); if (canSpeak) speechSynthesis.cancel(); // quiet while the shopper talks
  const useRecorder = canRecord && store.voiceInput && (!Recognition || isIos || browserVoiceFailed);
  if (useRecorder) listenRecord();
  else if (Recognition) listenBrowser();
}

// ---------- start ----------// ---------- start ----------
(async () => {
  try {
    store = await api(pub(''));
    document.head.insertAdjacentHTML('beforeend', `<link rel="manifest" href="${pub('/manifest.webmanifest')}">`);
    $('store-name').textContent = store.name;
    $('talk-toggle').classList.toggle('hidden', !voiceOk());
    paintTalk();
    $('cam').classList.toggle('hidden', !store.photoSearch);
    if (Recognition || (canRecord && store.voiceInput)) {
      $('mic').classList.remove('hidden');
      $('talk-btn').classList.remove('hidden');
      $('mic').addEventListener('click', listen);
      $('talk-btn').addEventListener('click', listen);
    }
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
    prepTourCard();
    const q = params.get('q');
    const lastId = hereShelf && !q ? recentProductId() : null;
    // ?tour=1 opens the store in 3D (the photo tour on phones without 3D, or with ?tour=photos)
    if (params.get('tour')) { await loadTour(); if (has3d && params.get('tour') !== 'photos') open3d(); else openTour(0); } else if (q) search(q);
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
