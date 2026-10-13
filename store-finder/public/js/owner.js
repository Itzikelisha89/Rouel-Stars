import { api, getToken, setToken, escapeHtml, resizeImage } from '/js/api.js';
import { renderMap, cellFromEvent, drawPreview, shelfAt, drawCrop } from '/js/map.js';

if (!getToken()) location.href = '/';
const $ = (id) => document.getElementById(id);

let store = null;      // { slug, name, map, aiEnabled }
let map = null;        // working copy being edited
let products = [];
let mapDirty = false;
let mode = 'draw';

// ---------- tabs ----------
function showTab(name) {
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of ['map', 'photo', 'products', 'share', 'demand']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  if (name === 'photo') renderPicker();
  if (name === 'products') loadProducts();
  if (name === 'share') loadShare();
  if (name === 'demand') loadDemand();
}
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
  location.href = '/';
});
window.addEventListener('beforeunload', (e) => { if (mapDirty) e.preventDefault(); });

// ---------- map editor ----------
const editor = $('map-editor');
let dragStart = null;

function setDirty(dirty) {
  mapDirty = dirty;
  $('map-status').textContent = dirty ? 'יש שינויים שלא נשמרו' : '';
}
function drawEditor() { renderMap(editor, map); }

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.classList.toggle('active', o === b);
  });
}

editor.addEventListener('pointerdown', (e) => {
  const cell = cellFromEvent(editor, map, e);
  if (mode === 'draw') {
    if (shelfAt(map, cell)) return;
    dragStart = cell;
    editor.setPointerCapture(e.pointerId);
    drawPreview(editor, cell, cell);
    return;
  }
  if (mode === 'entrance') {
    if (shelfAt(map, cell)) return alert('הכניסה צריכה להיות במעבר פנוי, לא על מדף');
    map.entrance = cell;
    setDirty(true);
    return drawEditor();
  }
  const shelf = shelfAt(map, cell);
  if (!shelf) return;
  if (mode === 'rename') {
    const name = prompt('שם המדף:', shelf.name);
    if (name && name.trim()) { shelf.name = name.trim().slice(0, 60); setDirty(true); drawEditor(); }
  } else if (mode === 'delete') {
    const count = products.filter((p) => p.shelfId === shelf.id).length;
    const msg = count ? `למחוק את "${shelf.name}"? ${count} מוצרים שעליו יימחקו בשמירה.` : `למחוק את "${shelf.name}"?`;
    if (confirm(msg)) { map.shelves = map.shelves.filter((s) => s !== shelf); setDirty(true); drawEditor(); }
  }
});
editor.addEventListener('pointermove', (e) => {
  if (dragStart) drawPreview(editor, dragStart, cellFromEvent(editor, map, e));
});
editor.addEventListener('pointerup', (e) => {
  if (!dragStart) return;
  const end = cellFromEvent(editor, map, e);
  const rect = {
    x: Math.min(dragStart.x, end.x), y: Math.min(dragStart.y, end.y),
    w: Math.abs(dragStart.x - end.x) + 1, h: Math.abs(dragStart.y - end.y) + 1,
  };
  dragStart = null;
  drawPreview(editor, null);
  const overlaps = map.shelves.some((s) => rect.x < s.x + s.w && rect.x + rect.w > s.x && rect.y < s.y + s.h && rect.y + rect.h > s.y);
  if (overlaps) return alert('המדף החדש חופף למדף קיים');
  const name = prompt('שם המדף / המעבר:', `מעבר ${map.shelves.length + 1}`);
  if (!name || !name.trim()) return;
  map.shelves.push({ id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 60), ...rect });
  setDirty(true);
  drawEditor();
});

function resize() {
  const cols = Math.max(5, Math.min(120, parseInt($('cols').value, 10) || map.cols));
  const rows = Math.max(5, Math.min(120, parseInt($('rows').value, 10) || map.rows));
  const outside = map.shelves.filter((s) => s.x + s.w > cols || s.y + s.h > rows);
  if (outside.length && !confirm(`${outside.length} מדפים ייצאו מהמפה וימחקו. להמשיך?`)) {
    $('cols').value = map.cols; $('rows').value = map.rows;
    return;
  }
  map.shelves = map.shelves.filter((s) => !outside.includes(s));
  map.cols = cols; map.rows = rows;
  map.entrance = { x: Math.min(map.entrance.x, cols - 1), y: Math.min(map.entrance.y, rows - 1) };
  setDirty(true);
  drawEditor();
}
$('cols').addEventListener('change', resize);
$('rows').addEventListener('change', resize);

$('save-map').addEventListener('click', async () => {
  try {
    const { removedProducts } = await api('/api/store/map', { method: 'PUT', body: map });
    store.map = structuredClone(map);
    setDirty(false);
    $('map-status').textContent = removedProducts ? `נשמר ✓ (${removedProducts} מוצרים הוסרו)` : 'נשמר ✓';
    if (removedProducts) loadProducts();
  } catch (err) { $('map-status').textContent = err.message; }
});

// ---------- photo capture ----------
const picker = $('map-picker');
function shelfName(id) { return store.map.shelves.find((s) => s.id === id)?.name ?? 'מדף שנמחק'; }

function renderPicker() {
  const sel = $('photo-shelf');
  const current = sel.value;
  if (mapDirty) $('photo-status').textContent = 'שים לב: יש שינויים במפה שלא נשמרו — שמור אותם קודם.';
  sel.innerHTML = store.map.shelves.length
    ? store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')
    : '<option value="">— קודם צייר מדפים במפה —</option>';
  if (store.map.shelves.some((s) => s.id === current)) sel.value = current;
  renderMap(picker, store.map, { targetShelfId: sel.value, onShelfClick: (s) => { sel.value = s.id; renderPicker(); } });
}
$('photo-shelf').addEventListener('change', renderPicker);

let lastPhoto = null;
$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const shelfId = $('photo-shelf').value;
  if (!file) return;
  if (!shelfId) return ($('photo-status').textContent = 'קודם צייר ושמור מדפים במפה');
  $('photo-status').innerHTML = '<span class="row"><span class="spinner"></span> מעלה ומזהה מוצרים… (עד דקה)</span>';
  try {
    const form = new FormData();
    form.append('shelfId', shelfId);
    form.append('photo', await resizeImage(file), 'shelf.jpg');
    const result = await api('/api/photos', { method: 'POST', form });
    lastPhoto = { ...result.photo, shelfId };
    $('photo-status').textContent = result.aiError || `זוהו ${result.products.length} מוצרים ב"${shelfName(shelfId)}". אפשר לתקן בלשונית מוצרים.`;
    showPhotoResult(result.products);
  } catch (err) { $('photo-status').textContent = err.message; }
});

function showPhotoResult(detected) {
  $('photo-result').classList.remove('hidden');
  const boxes = detected.filter((p) => p.box).map((p) => {
    const b = p.box;
    return `<div class="box" style="left:${b.x0 / 10}%;top:${b.y0 / 10}%;width:${(b.x1 - b.x0) / 10}%;height:${(b.y1 - b.y0) / 10}%"><span>${escapeHtml(p.name)}</span></div>`;
  }).join('');
  $('photo-preview').innerHTML = `<img src="${escapeHtml(lastPhoto.url)}" alt="תמונת המדף">${boxes}`;
  $('detected').innerHTML = '';
  for (const p of detected) $('detected').appendChild(productItem(p));
}

$('manual-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!lastPhoto) return;
  try {
    const p = await api('/api/products', {
      method: 'POST',
      body: { name: $('m-name').value, keywords: $('m-keywords').value, level: $('m-level').value, shelfId: lastPhoto.shelfId, photoId: lastPhoto.id },
    });
    $('detected').appendChild(productItem(p));
    $('manual-add').reset();
  } catch (err) { alert(err.message); }
});

// ---------- products ----------
function productItem(p) {
  const item = document.createElement('div');
  item.className = 'product-item';
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.photo, p.box, 168);
  const body = document.createElement('div');
  item.append(canvas, body);

  const view = () => {
    body.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">📍 ${escapeHtml(shelfName(p.shelfId))}${p.level ? ` · ${escapeHtml(p.level)}` : ''}</div>
      <div class="meta">${escapeHtml(p.keywords)}</div>
      <div class="row" style="margin-top:6px"><button data-a="edit">עריכה</button><button data-a="del" class="danger">מחיקה</button></div>`;
  };
  const edit = () => {
    body.innerHTML = `
      <input data-f="name" value="${escapeHtml(p.name)}" placeholder="שם">
      <input data-f="keywords" value="${escapeHtml(p.keywords)}" placeholder="מילות חיפוש, מופרדות בפסיק" style="margin-top:6px">
      <div class="row" style="margin-top:6px">
        <select data-f="shelfId" class="grow">${store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === p.shelfId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
        <input data-f="level" value="${escapeHtml(p.level)}" placeholder="קומת מדף" class="grow">
      </div>
      <div class="row" style="margin-top:6px"><button data-a="save" class="primary">שמירה</button><button data-a="cancel">ביטול</button></div>`;
  };
  body.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (a === 'edit') edit();
    if (a === 'cancel') view();
    if (a === 'save') {
      const data = Object.fromEntries([...body.querySelectorAll('[data-f]')].map((f) => [f.dataset.f, f.value]));
      try {
        Object.assign(p, await api(`/api/products/${p.id}`, { method: 'PUT', body: data }));
        const i = products.findIndex((x) => x.id === p.id);
        if (i >= 0) products[i] = p;
        view();
      } catch (err) { alert(err.message); }
    }
    if (a === 'del' && confirm(`למחוק את "${p.name}"?`)) {
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      products = products.filter((x) => x.id !== p.id);
      item.remove();
      $('product-count').textContent = products.length;
    }
  });
  view();
  return item;
}

async function loadProducts() {
  products = await api('/api/products');
  renderProducts();
}
function renderProducts() {
  const q = $('product-filter').value.trim().toLowerCase();
  const list = $('product-list');
  list.innerHTML = '';
  const shown = products.filter((p) => !q || `${p.name} ${p.keywords} ${shelfName(p.shelfId)}`.toLowerCase().includes(q));
  for (const p of shown) list.appendChild(productItem(p));
  if (!shown.length) list.innerHTML = '<p class="muted">אין מוצרים עדיין — צלם מדף בלשונית 2.</p>';
  $('product-count').textContent = products.length;
}
$('product-filter').addEventListener('input', renderProducts);

// ---------- share / insights ----------
async function loadShare() {
  const url = `${location.origin}/s/${store.slug}`;
  $('qr-title').textContent = `${store.name} — סרקו ומצאו כל מוצר`;
  $('qr-img').src = `/api/public/${encodeURIComponent(store.slug)}/qr.svg`;
  $('qr-url').textContent = url;
  $('aisle-stickers').innerHTML = store.map.shelves.map((s) => `
    <div class="sticker">
      <div class="sticker-title">📍 אתה כאן</div>
      <div class="sticker-name">${escapeHtml(s.name)}</div>
      <img src="/api/public/${encodeURIComponent(store.slug)}/qr.svg?at=${encodeURIComponent(s.id)}" alt="QR ${escapeHtml(s.name)}">
      <div class="muted" style="font-size:.85rem">סרקו כדי לראות את הדרך מכאן</div>
    </div>`).join('') || '<p class="muted">קודם צייר מדפים במפה.</p>';
}

// ---------- demand insights ----------
function sparkline(weeks) {
  const w = 120, h = 34, max = Math.max(1, ...weeks);
  const pts = weeks.map((v, i) => [i * (w / (weeks.length - 1)), h - 3 - (v / max) * (h - 8)]);
  const dots = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7" fill="transparent"><title>לפני ${weeks.length - 1 - i} שבועות: ${weeks[i]} חיפושים</title></circle>`).join('');
  return `<svg class="spark" viewBox="-2 0 ${w + 4} ${h}" width="${w}" height="${h}" role="img" aria-label="חיפושים לפי שבוע">
    <polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="var(--accent)"/>${dots}</svg>`;
}
const TREND = { up: '<span class="trend up">▲ עולה</span>', down: '<span class="trend down">▼ יורד</span>', flat: '<span class="trend">● יציב</span>' };
const dateHe = (iso) => { const [y, m, d] = iso.split('-'); return `${+d}.${+m}.${y}`; };

async function loadDemand() {
  const d = await api('/api/insights');
  $('kpis').innerHTML = [
    ['חיפושים', d.total.toLocaleString('he-IL')],
    ['נמצאו', d.foundRate === null ? '—' : `${d.foundRate}%`],
    ['לא נמצאו', (d.notFound || 0).toLocaleString('he-IL')],
  ].map(([k, v]) => `<div class="card kpi"><div class="kpi-v">${v}</div><div class="muted">${k}</div></div>`).join('');

  $('upcoming').innerHTML = d.upcoming.map((u) => `
    <div class="up-item${u.items.length ? ' has' : ''}">
      <div class="up-name">${escapeHtml(u.name)}</div>
      <div class="muted">${dateHe(u.date)} · בעוד ${u.daysLeft} ימים</div>
      ${u.items.length ? `<div class="up-start">קמפיין מ-${dateHe(u.campaignStart)}</div>
      <div class="chips">${u.items.map((i) => `<span class="badge">${escapeHtml(i)}</span>`).join('')}</div>` : '<div class="muted" style="font-size:.85rem">אין ביקוש עונתי חסר</div>'}
    </div>`).join('');

  $('missing').innerHTML = d.missing.length ? d.missing.map((m) => `
    <div class="demand-row">
      <div class="dr-main">
        <div class="name">${escapeHtml(m.label)} <span class="badge">${m.count} חיפושים</span>${m.variants > 1 ? ` <span class="muted" style="font-size:.85rem">(${m.variants} צורות כתיבה)</span>` : ''}</div>
        <div class="meta">${TREND[m.trend]} · ${m.holiday ? `🗓️ שיא לפני ${escapeHtml(m.holiday.name)}` : `שיא בחודש ${escapeHtml(m.peakMonth)}`} · ${m.last30} בחודש האחרון</div>
        <div class="advice">💡 ${m.advice.map(escapeHtml).join(' ')}</div>
      </div>
      ${sparkline(m.weeks)}
    </div>`).join('') : '<p class="muted">עדיין אין חיפושים שלא נמצאו.</p>';

  $('popular').innerHTML = d.popular.map((p) => `
    <div class="demand-row"><div class="dr-main"><div class="name">${escapeHtml(p.label)} <span class="badge">${p.count}</span></div><div class="meta">${TREND[p.trend]}</div></div>${sparkline(p.weeks)}</div>`).join('') || '<p class="muted">אין עדיין</p>';

  // one series: unfound searches per month (no legend needed; the title names it)
  const max = Math.max(1, ...d.months.map((m) => m.notFound));
  $('months-chart').innerHTML = `<div class="bars">${d.months.map((m) => `
    <div class="bar-col" title="${m.month}: ${m.notFound} חיפושים שלא נמצאו מתוך ${m.searches}">
      <div class="bar-v">${m.notFound || ''}</div>
      <div class="bar" style="height:${(m.notFound / max) * 100}%"></div>
      <div class="bar-l">${m.month.slice(0, 3)}</div>
    </div>`).join('')}</div>`;
}

// ---------- init ----------
(async () => {
  store = await api('/api/me');
  map = structuredClone(store.map);
  $('store-name').textContent = store.name;
  document.title = `${store.name} — ניהול`;
  $('customer-link').href = `/s/${store.slug}`;
  $('cols').value = map.cols;
  $('rows').value = map.rows;
  drawEditor();
  products = await api('/api/products');
  if (!store.aiEnabled) $('photo-status').textContent = 'זיהוי אוטומטי כבוי בשרת (חסר ANTHROPIC_API_KEY) — אפשר עדיין לצלם ולהוסיף מוצרים ידנית.';
})();
