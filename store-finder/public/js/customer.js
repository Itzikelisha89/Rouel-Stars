import { api, escapeHtml, formatPrice, resizeImage, getToken } from '/js/api.js';
import { renderMap, findPath, describeLocation, drawCrop, aisleSpot, planRoute, directions } from '/js/map.js';
import { t, lang, setLang, LANGS, aisleName, levelName, translatePage } from '/js/i18n.js';

const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
let store = null;
let results = [];
let hereShelf = null; // set when the page was opened from an aisle QR sticker
let voiceMode = false; // the shopper searched by voice, so we answer by voice too
let spokenAnswer = '';

// Spoken answers use the phone's built-in Hebrew voice (free, no server involved).
const canSpeak = 'speechSynthesis' in window;
function forSpeech(text) {
  return text.replace(/ס["״]מ/g, 'סנטימטר').replace(/מ["״]ל/g, 'מיליליטר').replace(/[·|/]/g, ',');
}
function speak(text) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  u.lang = LANGS[lang].voice;
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.rate = 1;
  speechSynthesis.speak(u);
}
const LAST_KEY = `storeFinder:last:${slug}`;
const LIST_KEY = `storeFinder:list:${slug}`;
let lastQuery = '';
let current = null; // product on the detail page

// Anonymous random id per phone, so the pilot report counts shoppers and not only searches.
const visitor = (() => {
  try {
    let v = localStorage.getItem('storeFinder:visitor');
    if (!v) { v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20); localStorage.setItem('storeFinder:visitor', v); }
    return v;
  } catch { return ''; }
})();
function track(type, extra = {}) {
  return api(`/api/public/${encodeURIComponent(slug)}/events`, { method: 'POST', body: { type, visitor, ...extra } });
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

async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  lastQuery = q;
  showList();
  document.body.classList.add('searching');
  $('status').innerHTML = `<span class="row"><span class="spinner"></span> ${t('searching')}</span>`;
  $('results').innerHTML = '';
  try {
    const data = await api(`/api/public/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}&v=${visitor}`);
    results = data.results;
    if (!results.length) {
      $('status').textContent = t('not_found', { q });
      $('request-done').classList.add('hidden');
      $('request-form').classList.remove('hidden');
      $('no-results').classList.remove('hidden');
      if (voiceMode) speak(t('voice_not_found', { q }));
      return;
    }
    showResults(data.expanded ? t('maybe_meant', { q }) : t('n_results', { n: results.length }));
  } catch (err) { $('status').textContent = err.message; }
}

function showResults(statusText) {
  $('status').textContent = statusText;
  for (const p of results) {
    const item = document.createElement('div');
    item.className = 'product-item result';
    const canvas = document.createElement('canvas');
    drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 168);
    const shelf = shelfOf(p);
    const info = document.createElement('div');
    info.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">${p.level ? escapeHtml(levelName(p.level)) : ''}</div>
      <div class="row" style="margin-top:8px;gap:8px"><span class="chip o">📍 ${escapeHtml(shortShelf(shelf))}</span>${p.price ? `<span class="price">${escapeHtml(formatPrice(p.price))}</span>` : ''}</div>
      ${p.promo ? `<div class="promo-tag" style="margin-top:6px">🏷️ ${escapeHtml(p.promo)}</div>` : ''}`;
    item.append(canvas, info);
    item.addEventListener('click', () => showDetail(p));
    $('results').appendChild(item);
  }
  if (results.length === 1) showDetail(results[0]);
  else if (voiceMode) speak(t('voice_n_results', { n: results.length }));
}

// Search by photo: snap the product (or a flyer / WhatsApp picture) and we find it in the store.
async function photoSearch(file) {
  showList();
  document.body.classList.add('searching');
  $('results').innerHTML = '';
  $('status').innerHTML = `<span class="row"><span class="spinner"></span> ${t('identifying')}</span>`;
  try {
    const form = new FormData();
    form.append('image', await resizeImage(file, 1024), 'photo.jpg');
    form.append('visitor', visitor);
    const data = await api(`/api/public/${encodeURIComponent(slug)}/photo-search`, { method: 'POST', form });
    results = data.results;
    if (!data.identified.found) {
      $('status').textContent = t('photo_unknown');
      return;
    }
    lastQuery = data.identified.name;
    $('q').value = data.identified.name;
    if (!results.length) {
      $('status').textContent = t('photo_not_in_store', { name: data.identified.name });
      $('request-done').classList.add('hidden');
      $('request-form').classList.remove('hidden');
      $('no-results').classList.remove('hidden');
      return;
    }
    showResults(t('photo_found', { name: data.identified.name }));
  } catch (err) { $('status').textContent = err.message; }
}
$('cam-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) photoSearch(file);
});

function hideNav() {
  $('nav-view').classList.add('hidden');
  $('arrived-view').classList.add('hidden');
  stopWalker();
}
function showList() {
  hideNav();
  $('detail').classList.add('hidden');
  $('list-view').classList.add('hidden');
  $('no-results').classList.add('hidden');
  renderListBar();
  $('results').classList.remove('hidden');
  $('status').classList.remove('hidden');
}

function showDetail(p) {
  hideNav();
  current = p;
  document.body.classList.add('searching');
  const shelf = shelfOf(p);
  $('list-view').classList.add('hidden');
  $('no-results').classList.add('hidden');
  $('results').classList.add('hidden');
  $('status').classList.add('hidden');
  $('detail').classList.remove('hidden');
  drawCrop($('detail-crop'), p.image || p.photo, p.image ? null : p.box, 480);
  $('detail-name').textContent = p.name;
  $('detail-desc').textContent = p.description;
  $('detail-chips').innerHTML = [shelf && chip(`📍 ${aisleName(shelf)}`, 'o'), p.level && chip(levelName(p.level))].filter(Boolean).join('');
  $('detail-price').textContent = p.price ? formatPrice(p.price) : '';
  $('detail-promo').textContent = p.promo ? t('promo', { p: p.promo }) : '';
  $('detail-promo').classList.toggle('hidden', !p.promo);
  loadRelated(p);
  $('detail-meters').textContent = '';
  if (shelf) {
    const here = hereShelf && aisleSpot(store.map, hereShelf);
    const path = findPath(store.map, shelf, here || store.map.entrance);
    const loc = describeLocation(store.map, shelf);
    $('detail-how').textContent = hereShelf?.id === shelf.id
      ? `${t('in_your_aisle')}${p.level ? ` · ${levelName(p.level)}` : ''}`
      : [t(`side_${loc.side}`), t(`depth_${loc.depth}`)].join(' · ');
    const n = path ? path.length - 1 : 0;
    if (path && hereShelf?.id !== shelf.id) $('detail-meters').textContent = t(here ? 'm_from_here' : 'm_from_entrance', { n });
    // Product names are in Hebrew, so other languages speak the aisle, shelf and distance only.
    spokenAnswer = [lang === 'he' ? p.name : '', aisleName(shelf), levelName(p.level), path && hereShelf?.id !== shelf.id ? t(here ? 'say_from_here' : 'say_from_entrance', { n }) : '']
      .filter(Boolean).join('. ');
    renderMap($('detail-map'), store.map, { targetShelfId: shelf.id, path, here, ...mapLabels() });
    navRoute = { shelf, path, here };
  }
  $('go-btn').classList.toggle('hidden', !(shelf && navRoute?.path && navRoute.shelf === shelf && hereShelf?.id !== shelf.id));
  rememberProduct(p);
  track('view', { productId: p.id }).catch(() => {});
  resetFeedback();
  updateListToggle();
  renderListBar();
  $('speak').classList.toggle('hidden', !canSpeak);
  if (voiceMode) speak(spokenAnswer);
  // The shelf photo with the product outlined, so the shopper recognises the spot when they get there.
  $('shelf-card').classList.toggle('hidden', !p.photo);
  if (p.photo) $('detail-photo').src = p.photo;
  $('shelf-level').textContent = levelName(p.level);
  const mark = $('shelf-mark');
  mark.classList.toggle('hidden', !p.box);
  if (p.box) Object.assign(mark.style, {
    left: `${p.box.x0 / 10}%`, top: `${p.box.y0 / 10}%`, width: `${(p.box.x1 - p.box.x0) / 10}%`, height: `${(p.box.y1 - p.box.y0) / 10}%`,
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('speak').addEventListener('click', () => speak(spokenAnswer));
$('back').addEventListener('click', () => { showList(); if (results.length === 1) $('q').focus(); });
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('q').blur();
  history.replaceState(null, '', `?q=${encodeURIComponent($('q').value.trim())}`);
  runSearch($('q').value);
});

// ---------- "take me there": step-by-step directions, the route walked on the map, arrival ----------
// There is no GPS indoors: the blue dot previews the way; the real position updates when the shopper
// scans an aisle's "you are here" sticker.
let navRoute = null;
let navStarted = 0;
let walkerRaf = 0;
function stopWalker() { cancelAnimationFrame(walkerRaf); walkerRaf = 0; }
const SIDE_KEY = { left: 'step_arrive_left', right: 'step_arrive_right', front: 'step_arrive_front' };
function showNav() {
  if (!current || !navRoute?.path) return;
  const { shelf, path, here } = navRoute;
  $('detail').classList.add('hidden');
  $('nav-view').classList.remove('hidden');
  drawCrop($('nav-thumb'), current.image || current.photo, current.image ? null : current.box, 144);
  $('nav-name').textContent = current.name;
  $('nav-chips').innerHTML = [chip(`📍 ${aisleName(shelf)}`, 'o'), current.level && chip(levelName(current.level)), chip(t(here ? 'm_from_here' : 'm_from_entrance', { n: path.length - 1 }))].filter(Boolean).join('');
  const dir = directions(store.map, path, shelf);
  const ICON = { straight: '⬆', right: '➡', left: '⬅' };
  const lines = dir.steps.map((st) => [ICON[st.turn], t(`step_${st.turn}`, { n: st.meters })]);
  lines.push(['📍', `${t(SIDE_KEY[dir.side], { a: aisleName(shelf, { short: true }) })} · ${current.level ? t('step_look', { l: levelName(current.level) }) : t('step_look_nolevel')}`]);
  $('nav-steps').innerHTML = `<li class="muted" style="font-size:.9rem;border-top:none;padding-top:0">${escapeHtml(t(here ? 'nav_from_here' : 'nav_from_entrance'))}</li>` +
    lines.map(([ico, txt], i) => `<li class="${i === lines.length - 1 ? 'last' : ''}"><span class="ico">${ico}</span><span>${escapeHtml(txt)}</span></li>`).join('');
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
  stopWalker();
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showArrived() {
  stopWalker();
  const { shelf, path } = navRoute;
  const dir = directions(store.map, path, shelf);
  $('nav-view').classList.add('hidden');
  $('arrived-view').classList.remove('hidden');
  $('arr-where').textContent = [t(SIDE_KEY[dir.side], { a: aisleName(shelf, { short: true }) }), levelName(current.level)].filter(Boolean).join(' · ');
  $('arr-shot').classList.toggle('hidden', !current.photo);
  if (current.photo) $('arr-photo').src = current.photo;
  const mark = $('arr-mark');
  mark.classList.toggle('hidden', !current.box);
  if (current.box) Object.assign(mark.style, { left: `${current.box.x0 / 10}%`, top: `${current.box.y0 / 10}%`, width: `${(current.box.x1 - current.box.x0) / 10}%`, height: `${(current.box.y1 - current.box.y0) / 10}%` });
  const secs = Math.max(1, Math.round((Date.now() - navStarted) / 1000));
  $('arr-time').textContent = t('arrived_time', { s: secs < 60 ? t('secs', { n: secs }) : t('mins', { m: Math.floor(secs / 60), s: String(secs % 60).padStart(2, '0') }) });
  $('arr-found').disabled = false;
  $('arr-found').textContent = t('fb_found');
  if (voiceMode) speak(`${t('arrived_title')} ${$('arr-where').textContent}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('go-btn').addEventListener('click', showNav);
$('nav-back').addEventListener('click', () => showDetail(current));
$('arrived-btn').addEventListener('click', showArrived);
$('arr-back').addEventListener('click', () => { showList(); $('q').focus(); });
$('arr-found').addEventListener('click', async () => {
  $('arr-found').disabled = true;
  await track('found', { productId: current.id }).catch(() => {});
  markPicked(current.id);
  $('arr-found').textContent = t('thanks_found');
});
$('arr-notfound').addEventListener('click', () => {
  // back to the product page with "what happened?" open, so the report reaches the staff
  showDetail(current);
  $('fb-ask').classList.add('hidden');
  $('fb-reasons').classList.remove('hidden');
  setTimeout(() => $('feedback').scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
});

// ---------- deals and "shoppers also looked at" ----------
function miniCard(p) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mini-card';
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 240);
  const shelf = shelfOf(p);
  card.innerHTML = `${p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : ''}
    <span class="mc-name">${escapeHtml(p.name)}</span>
    <span class="mc-meta">📍 ${escapeHtml(shortShelf(shelf))}${p.price ? ` · ${escapeHtml(formatPrice(p.price))}` : ''}</span>`;
  card.prepend(canvas);
  card.addEventListener('click', () => { results = [p]; showDetail(p); });
  return card;
}
async function loadDeals() {
  const deals = await api(`/api/public/${encodeURIComponent(slug)}/deals`).catch(() => []);
  $('deals-row').replaceChildren(...deals.map(miniCard));
  $('deals').classList.toggle('hidden', !deals.length);
}
let relatedFor = null;
async function loadRelated(p) {
  relatedFor = p.id;
  $('related').classList.add('hidden');
  const r = await api(`/api/public/${encodeURIComponent(slug)}/products/${p.id}/related`).catch(() => null);
  if (!r || relatedFor !== p.id || !r.products.length) return;
  $('related-title').textContent = t(r.kind === 'together' ? 'related_together' : 'related_aisle');
  $('related-row').replaceChildren(...r.products.map(miniCard));
  $('related').classList.remove('hidden');
}

// ---------- "found it?" feedback: every answer is a shelf check done by a shopper ----------
function resetFeedback() {
  $('fb-ask').classList.remove('hidden');
  $('fb-reasons').classList.add('hidden');
  $('fb-done').classList.add('hidden');
}
$('feedback').addEventListener('click', async (e) => {
  const fb = e.target.closest('[data-fb]')?.dataset.fb;
  if (!fb || !current) return;
  if (fb === 'no') {
    $('fb-ask').classList.add('hidden');
    $('fb-reasons').classList.remove('hidden');
    return;
  }
  const thanks = { found: t('thanks_found'), empty: t('thanks_empty'), not_there: t('thanks_moved') };
  try {
    await track(fb, { productId: current.id });
    $('fb-done').textContent = thanks[fb];
  } catch (err) { $('fb-done').textContent = err.message; }
  $('fb-ask').classList.add('hidden');
  $('fb-reasons').classList.add('hidden');
  $('fb-done').classList.remove('hidden');
  if (fb === 'found') markPicked(current.id);
});

// ---------- request a product the store doesn't carry ----------
$('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await track('request', { query: lastQuery, phone: $('request-phone').value });
    $('request-done').textContent = $('request-phone').value.trim()
      ? t('req_done_phone', { q: lastQuery })
      : t('req_done', { q: lastQuery });
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
  renderListBar();
}
function inList(id) { return loadList().some((i) => i.id === id); }
function updateListToggle() {
  const on = current && inList(current.id);
  $('list-toggle').textContent = t(on ? 'in_list' : 'add_list');
  $('list-toggle').classList.toggle('on', Boolean(on));
}
function renderListBar() {
  const n = loadList().filter((i) => !i.picked).length;
  $('list-count').textContent = n;
  $('list-bar').classList.toggle('hidden', !n || !$('list-view').classList.contains('hidden'));
}
function markPicked(id) {
  const list = loadList();
  const item = list.find((i) => i.id === id);
  if (item) { item.picked = true; saveList(list); }
}
$('list-toggle').addEventListener('click', () => {
  if (!current) return;
  const list = loadList();
  const i = list.findIndex((x) => x.id === current.id);
  if (i >= 0) list.splice(i, 1);
  else list.push({ id: current.id, name: current.name, shelfId: current.shelfId, level: current.level, price: current.price, photo: current.photo, image: current.image, box: current.box, picked: false });
  saveList(list);
  updateListToggle();
});

let routeSpeech = '';
function showListView() {
  document.body.classList.add('searching');
  hideNav();
  for (const id of ['detail', 'results', 'status', 'no-results']) $(id).classList.add('hidden');
  $('list-view').classList.remove('hidden');
  $('list-bar').classList.add('hidden');
  renderListView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderListView() {
  const list = loadList();
  const todo = list.filter((i) => !i.picked);
  const shelves = todo.map((i) => store.map.shelves.find((s) => s.id === i.shelfId)).filter(Boolean);
  const here = hereShelf && aisleSpot(store.map, hereShelf);
  const route = planRoute(store.map, shelves, here || store.map.entrance);
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
  const stops = route.legs.map((l, n) => ({ ...l.path[l.path.length - 1], n: n + 1 }));
  renderMap($('list-map'), store.map, { targetShelfIds: shelves.map((s) => s.id), path: route.path, here, stops, ...mapLabels() });
  routeSpeech = route.legs.map((l, n) => `${n + 1}. ${shortShelf(l.shelf)}: ${todo.filter((i) => i.shelfId === l.shelf.id).map((i) => i.name).join(', ')}`).join('. ');
  $('list-speak').classList.toggle('hidden', !canSpeak || !route.legs.length);
}
$('list-items').addEventListener('click', (e) => {
  const li = e.target.closest('.list-item');
  if (!li) return;
  const id = Number(li.dataset.id);
  const list = loadList();
  const item = list.find((i) => i.id === id);
  if (!item) return;
  if (e.target.closest('.li-check')) {
    item.picked = !item.picked;
    if (item.picked) track('found', { productId: id }).catch(() => {});
    saveList(list);
    renderListView();
  } else {
    showDetail(item);
  }
});
$('list-bar').addEventListener('click', showListView);
$('list-back').addEventListener('click', () => { showList(); renderListBar(); });
$('list-clear').addEventListener('click', () => { saveList([]); renderListView(); });
$('list-speak').addEventListener('click', () => speak(routeSpeech));

// ---------- call a staff member to where the shopper stands ----------
function openHelp() {
  const guess = hereShelf || (current && !$('detail').classList.contains('hidden') ? shelfOf(current) : null);
  $('help-shelf').innerHTML = `<option value="">${escapeHtml(t('entrance_unsure'))}</option>` +
    store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}"${guess?.id === s.id ? ' selected' : ''}>${escapeHtml(aisleName(s))}</option>`).join('');
  $('help-where').textContent = t('help_where');
  $('help-done').classList.add('hidden');
  $('help-send').disabled = false;
  $('help-sheet').classList.remove('hidden');
}
$('help-btn').addEventListener('click', openHelp);
$('help-cancel').addEventListener('click', () => $('help-sheet').classList.add('hidden'));
$('help-sheet').addEventListener('click', (e) => { if (e.target === $('help-sheet')) $('help-sheet').classList.add('hidden'); });
$('help-send').addEventListener('click', async () => {
  $('help-send').disabled = true;
  try {
    await track('help', { shelfId: $('help-shelf').value || null, productId: current?.id ?? null, query: lastQuery });
    const s = store.map.shelves.find((x) => x.id === $('help-shelf').value);
    $('help-done').textContent = t('help_sent', { at: s ? t('help_at', { a: shortShelf(s) }) : '' });
    $('help-done').classList.remove('hidden');
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

// Voice search where the browser supports it.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  $('mic').classList.remove('hidden');
  $('mic').addEventListener('click', () => {
    const rec = new Recognition();
    rec.lang = LANGS[lang].voice;
    rec.interimResults = false;
    $('mic').textContent = '🔴';
    rec.onresult = (e) => { voiceMode = true; $('q').value = e.results[0][0].transcript; runSearch($('q').value); };
    rec.onend = () => { $('mic').textContent = '🎤'; };
    rec.start();
  });
}

(async () => {
  try {
    store = await api(`/api/public/${encodeURIComponent(slug)}`);
    $('store-name').textContent = store.name;
    $('cam').classList.toggle('hidden', !store.photoSearch);
    const cats = store.map.shelves.map((s) => s.name.split('·')[1]?.trim()).filter(Boolean);
    // Category chips are the manager's Hebrew aisle names, so they are shown in Hebrew only.
    if (lang !== 'he') cats.length = 0;
    $('quick').innerHTML = [...new Set(cats)].slice(0, 8).map((c) => `<button type="button" class="chip" data-q="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    $('quick').addEventListener('click', (e) => { const q = e.target.dataset.q; if (q) { $('q').value = q; runSearch(q); } });
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
    renderListBar();
    loadDeals();
    const q = params.get('q');
    const lastId = hereShelf && !q ? recentProductId() : null;
    if (q) { $('q').value = q; runSearch(q); }
    else if (lastId) {
      // Scanned an aisle sticker mid-trip: continue to the product chosen a moment ago.
      const p = await api(`/api/public/${encodeURIComponent(slug)}/products/${lastId}`).catch(() => null);
      if (p) { results = [p]; showDetail(p); }
    }
  } catch (err) {
    $('store-name').textContent = t('store_missing');
    $('search-form').classList.add('hidden');
  }
})();
