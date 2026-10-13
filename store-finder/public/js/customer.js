import { api, escapeHtml, formatPrice } from '/js/api.js';
import { renderMap, findPath, describeLocation, drawCrop, aisleSpot } from '/js/map.js';

const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
let store = null;
let results = [];
let hereShelf = null; // set when the page was opened from an aisle QR sticker
const LAST_KEY = `storeFinder:last:${slug}`;
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

async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  showList();
  $('status').innerHTML = '<span class="row"><span class="spinner"></span> מחפש…</span>';
  $('results').innerHTML = '';
  try {
    const data = await api(`/api/public/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}`);
    results = data.results;
    if (!results.length) {
      $('status').textContent = `לא מצאנו "${q}". נסה מילה אחרת, או שאל את אחד העובדים 🙂`;
      return;
    }
    $('status').textContent = data.expanded ? `לא מצאנו בדיוק "${q}", אבל אולי התכוונת לזה:` : `נמצאו ${results.length} תוצאות`;
    for (const p of results) {
      const item = document.createElement('div');
      item.className = 'product-item result';
      const canvas = document.createElement('canvas');
      drawCrop(canvas, p.photo, p.box, 168);
      const shelf = shelfOf(p);
      const info = document.createElement('div');
      info.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>
        <div class="meta">📍 ${escapeHtml(shelf?.name ?? '')}${p.level ? ` · ${escapeHtml(p.level)}` : ''}</div>${p.price ? `<div class="price">${escapeHtml(formatPrice(p.price))}</div>` : ''}`;
      item.append(canvas, info);
      item.addEventListener('click', () => showDetail(p));
      $('results').appendChild(item);
    }
    if (results.length === 1) showDetail(results[0]);
  } catch (err) { $('status').textContent = err.message; }
}

function showList() {
  $('detail').classList.add('hidden');
  $('results').classList.remove('hidden');
  $('status').classList.remove('hidden');
}

function showDetail(p) {
  const shelf = shelfOf(p);
  $('results').classList.add('hidden');
  $('status').classList.add('hidden');
  $('detail').classList.remove('hidden');
  drawCrop($('detail-crop'), p.photo, p.box, 480);
  $('detail-name').textContent = p.name;
  $('detail-desc').textContent = p.description;
  $('detail-where').textContent = `📍 ${shelf?.name ?? ''}${p.level ? ` · ${p.level}` : ''}${p.price ? ` · ${formatPrice(p.price)}` : ''}`;
  if (shelf) {
    const here = hereShelf && aisleSpot(store.map, hereShelf);
    const path = findPath(store.map, shelf, here || store.map.entrance);
    const loc = describeLocation(store.map, shelf, path, Boolean(here));
    $('detail-how').textContent = hereShelf?.id === shelf.id
      ? `המוצר נמצא במעבר שבו אתה עומד${p.level ? ` · ${p.level}` : ''}`
      : [loc.side, loc.depth, loc.meters].filter(Boolean).join(' · ');
    renderMap($('detail-map'), store.map, { targetShelfId: shelf.id, path, here });
  }
  rememberProduct(p);
  if (p.photo) $('detail-photo').src = p.photo;
  $('detail-photo').closest('details').classList.toggle('hidden', !p.photo);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('back').addEventListener('click', () => { showList(); if (results.length === 1) $('q').focus(); });
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('q').blur();
  history.replaceState(null, '', `?q=${encodeURIComponent($('q').value.trim())}`);
  runSearch($('q').value);
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
    rec.onresult = (e) => { $('q').value = e.results[0][0].transcript; runSearch($('q').value); };
    rec.onend = () => { $('mic').textContent = '🎤'; };
    rec.start();
  });
}

(async () => {
  try {
    store = await api(`/api/public/${encodeURIComponent(slug)}`);
    $('store-name').textContent = store.name;
    document.title = `${store.name} — איפה זה בחנות?`;
    const params = new URLSearchParams(location.search);
    hereShelf = store.map.shelves.find((s) => s.id === params.get('at')) || null;
    if (hereShelf) {
      $('here-banner').textContent = `📍 אתה ליד: ${hereShelf.name}`;
      $('here-banner').classList.remove('hidden');
    }
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
