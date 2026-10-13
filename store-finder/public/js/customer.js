import { api, escapeHtml, formatPrice, resizeImage, getToken } from '/js/api.js';
import { renderMap, findPath, describeLocation, drawCrop, aisleSpot, planRoute } from '/js/map.js';

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
  u.lang = 'he-IL';
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('he'));
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
function shortShelf(shelf) { return (shelf?.name ?? '').split('·')[0].trim(); }
function chip(text, cls = '') { return `<span class="chip ${cls}">${escapeHtml(text)}</span>`; }

async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  lastQuery = q;
  showList();
  document.body.classList.add('searching');
  $('status').innerHTML = '<span class="row"><span class="spinner"></span> מחפש…</span>';
  $('results').innerHTML = '';
  try {
    const data = await api(`/api/public/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}&v=${visitor}`);
    results = data.results;
    if (!results.length) {
      $('status').textContent = `לא מצאנו "${q}". אפשר לנסות מילה אחרת 🙂`;
      $('request-done').classList.add('hidden');
      $('request-form').classList.remove('hidden');
      $('no-results').classList.remove('hidden');
      if (voiceMode) speak(`לא מצאנו ${q} בחנות. אפשר לבקש שנביא את זה.`);
      return;
    }
    showResults(data.expanded ? `לא מצאנו בדיוק "${q}", אבל אולי התכוונת לזה:` : `נמצאו ${results.length} תוצאות`);
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
      <div class="meta">${p.level ? escapeHtml(p.level) : ''}</div>
      <div class="row" style="margin-top:8px;gap:8px"><span class="chip o">📍 ${escapeHtml(shortShelf(shelf))}</span>${p.price ? `<span class="price">${escapeHtml(formatPrice(p.price))}</span>` : ''}</div>
      ${p.promo ? `<div class="promo-tag" style="margin-top:6px">🏷️ ${escapeHtml(p.promo)}</div>` : ''}`;
    item.append(canvas, info);
    item.addEventListener('click', () => showDetail(p));
    $('results').appendChild(item);
  }
  if (results.length === 1) showDetail(results[0]);
  else if (voiceMode) speak(`מצאתי ${results.length} תוצאות. בחר מוצר מהרשימה.`);
}

// Search by photo: snap the product (or a flyer / WhatsApp picture) and we find it in the store.
async function photoSearch(file) {
  showList();
  document.body.classList.add('searching');
  $('results').innerHTML = '';
  $('status').innerHTML = '<span class="row"><span class="spinner"></span> מזהה את המוצר בתמונה…</span>';
  try {
    const form = new FormData();
    form.append('image', await resizeImage(file, 1024), 'photo.jpg');
    form.append('visitor', visitor);
    const data = await api(`/api/public/${encodeURIComponent(slug)}/photo-search`, { method: 'POST', form });
    results = data.results;
    if (!data.identified.found) {
      $('status').textContent = 'לא הצלחנו לזהות מוצר בתמונה. נסו לצלם קרוב יותר, או לכתוב מה מחפשים 🙂';
      return;
    }
    lastQuery = data.identified.name;
    $('q').value = data.identified.name;
    if (!results.length) {
      $('status').textContent = `זיהינו: "${data.identified.name}", אבל אין לנו את זה בחנות כרגע.`;
      $('request-done').classList.add('hidden');
      $('request-form').classList.remove('hidden');
      $('no-results').classList.remove('hidden');
      return;
    }
    showResults(`📷 זיהינו: "${data.identified.name}". הנה מה שיש לנו:`);
  } catch (err) { $('status').textContent = err.message; }
}
$('cam-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) photoSearch(file);
});

function showList() {
  $('detail').classList.add('hidden');
  $('list-view').classList.add('hidden');
  $('no-results').classList.add('hidden');
  renderListBar();
  $('results').classList.remove('hidden');
  $('status').classList.remove('hidden');
}

function showDetail(p) {
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
  $('detail-chips').innerHTML = [shelf && chip(`📍 ${shelf.name}`, 'o'), p.level && chip(p.level)].filter(Boolean).join('');
  $('detail-price').textContent = p.price ? formatPrice(p.price) : '';
  $('detail-promo').textContent = p.promo ? `🏷️ מבצע: ${p.promo}` : '';
  $('detail-promo').classList.toggle('hidden', !p.promo);
  loadRelated(p);
  $('detail-meters').textContent = '';
  if (shelf) {
    const here = hereShelf && aisleSpot(store.map, hereShelf);
    const path = findPath(store.map, shelf, here || store.map.entrance);
    const loc = describeLocation(store.map, shelf, path, Boolean(here));
    $('detail-how').textContent = hereShelf?.id === shelf.id
      ? `המוצר נמצא במעבר שבו אתה עומד${p.level ? ` · ${p.level}` : ''}`
      : [loc.side, loc.depth].filter(Boolean).join(' · ');
    if (path && hereShelf?.id !== shelf.id) $('detail-meters').textContent = `🚶 ${path.length - 1} מ׳ ${here ? 'מכאן' : 'מהכניסה'}`;
    spokenAnswer = [p.name, shelf.name, p.level, path && hereShelf?.id !== shelf.id ? `${path.length - 1} מטר ${here ? 'מכאן' : 'מהכניסה'}` : '']
      .filter(Boolean).join('. ');
    renderMap($('detail-map'), store.map, { targetShelfId: shelf.id, path, here });
  }
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
  $('shelf-level').textContent = p.level || '';
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
  $('related-title').textContent = r.kind === 'together' ? '🛒 לקוחות שחיפשו את זה, חיפשו גם' : '📍 עוד באותו מעבר';
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
  const thanks = { found: 'איזה כיף! תודה שעזרת לנו לדעת 🙌', empty: 'תודה! הצוות קיבל התראה למלא את המדף.', not_there: 'תודה! הצוות קיבל התראה, ועובד יכול לעזור לך למצוא אותו.' };
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
      ? `קיבלנו! נעדכן אותך כש"${lastQuery}" יגיע לסניף.`
      : `קיבלנו! מנהל הסניף יראה שחיפשת "${lastQuery}".`;
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
  $('list-toggle').textContent = on ? '✓ ברשימת הקניות' : '➕ הוספה לרשימת הקניות';
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
  $('list-meters').textContent = route.legs.length ? `🚶 ${route.meters} מ׳ · ${route.legs.length} עצירות` : '';
  $('list-hint').textContent = todo.length ? 'המסלול הקצר ביותר בחנות, לפי הסדר. סמנו כל מוצר שלקחתם.' : (list.length ? 'לקחת הכל! 🎉' : 'הרשימה ריקה. מוסיפים מוצרים מדף המוצר.');
  $('list-items').innerHTML = sorted.map((i) => {
    const shelf = store.map.shelves.find((s) => s.id === i.shelfId);
    const n = order.get(i.shelfId);
    return `<li class="list-item${i.picked ? ' picked' : ''}" data-id="${i.id}">
      <span class="stop-n">${i.picked ? '✓' : (n ?? '?')}</span>
      <span class="li-main"><span class="name">${escapeHtml(i.name)}</span><span class="meta">${escapeHtml(shortShelf(shelf))}${i.level ? ` · ${escapeHtml(i.level)}` : ''}${i.price ? ` · ${escapeHtml(formatPrice(i.price))}` : ''}</span></span>
      <button type="button" class="li-check" aria-label="${i.picked ? 'החזרה לרשימה' : 'לקחתי'}">${i.picked ? '↩︎' : 'לקחתי'}</button>
    </li>`;
  }).join('');
  const stops = route.legs.map((l, n) => ({ ...l.path[l.path.length - 1], n: n + 1 }));
  renderMap($('list-map'), store.map, { targetShelfIds: shelves.map((s) => s.id), path: route.path, here, stops });
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
  $('help-shelf').innerHTML = `<option value="">ליד הכניסה / לא בטוח</option>` +
    store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}"${guess?.id === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  $('help-where').textContent = 'עובד יקבל התראה בטלפון ויגיע אליכם.';
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
    $('help-done').textContent = `✅ הקריאה נשלחה. עובד בדרך אליכם${s ? ` ל${shortShelf(s)}` : ''}.`;
    $('help-done').classList.remove('hidden');
    setTimeout(() => $('help-sheet').classList.add('hidden'), 3500);
  } catch (err) {
    $('help-done').textContent = err.message;
    $('help-done').classList.remove('hidden');
    $('help-send').disabled = false;
  }
});

// Voice search where the browser supports it.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  $('mic').classList.remove('hidden');
  $('mic').addEventListener('click', () => {
    const rec = new Recognition();
    rec.lang = 'he-IL';
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
    $('quick').innerHTML = [...new Set(cats)].slice(0, 8).map((c) => `<button type="button" class="chip" data-q="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    $('quick').addEventListener('click', (e) => { const q = e.target.dataset.q; if (q) { $('q').value = q; runSearch(q); } });
    document.title = `${store.name} — איפה זה בחנות?`;
    const params = new URLSearchParams(location.search);
    hereShelf = store.map.shelves.find((s) => s.id === params.get('at')) || null;
    if (hereShelf) {
      $('here-banner').textContent = `📍 אתה ליד: ${hereShelf.name}`;
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
    $('store-name').textContent = 'החנות לא נמצאה';
    $('search-form').classList.add('hidden');
  }
})();
