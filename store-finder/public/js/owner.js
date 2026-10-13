import { api, getToken, setToken, escapeHtml, resizeImage, formatPrice, extractFrames } from '/js/api.js';
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
  for (const t of ['map', 'photo', 'products', 'share', 'demand', 'alerts', 'report', 'settings']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  if (name === 'photo') renderPicker();
  if (name === 'products') loadProducts();
  if (name === 'share') loadShare();
  if (name === 'demand') loadDemand();
  if (name === 'alerts') loadAlerts();
  if (name === 'report') loadReport();
  if (name === 'settings') $('s-name').value = store.name;
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

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

$('video-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const shelfId = $('photo-shelf').value;
  if (!file) return;
  if (!shelfId) return ($('photo-status').textContent = 'קודם צייר ושמור מדפים במפה');
  const status = (text) => { $('photo-status').innerHTML = `<span class="row"><span class="spinner"></span> ${escapeHtml(text)}</span>`; };
  try {
    status('מכין את הסרטון…');
    const frames = await extractFrames(file, { onProgress: (n, total) => status(`מכין את הסרטון… ${n}/${total}`) });
    status(`מזהה מוצרים ב-${frames.length} תמונות מהסרטון… (עד 2 דקות)`);
    const form = new FormData();
    form.append('shelfId', shelfId);
    frames.forEach((f, i) => form.append('frames', f, `frame-${i}.jpg`));
    const result = await api('/api/videos', { method: 'POST', form });
    $('photo-status').textContent = `זוהו ${result.products.length} מוצרים ב"${shelfName(shelfId)}" מתוך ${result.frames} תמונות בסרטון. אפשר לתקן בלשונית מוצרים.`;
    lastPhoto = null;
    $('photo-result').classList.remove('hidden');
    $('photo-preview').innerHTML = '';
    $('manual-add').classList.add('hidden');
    $('detected').innerHTML = '';
    for (const p of result.products) $('detected').appendChild(productItem(p));
  } catch (err) { $('photo-status').textContent = err.message; }
});

function showPhotoResult(detected) {
  $('manual-add').classList.remove('hidden');
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

// ---------- products: the manager controls every detail ----------
function thumbFor(p, size = 168) {
  if (p.image) {
    const img = document.createElement('img');
    img.className = 'thumb'; img.src = p.image; img.alt = '';
    return img;
  }
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.photo, p.box, size);
  return canvas;
}

// One form for "new product" and "edit product": name, free text, aisle, shelf level, price,
// search words, the product's own photo, and whether shoppers can see it.
function productForm(container, p, { onSaved, onCancel }) {
  const isNew = !p.id;
  let pendingImage = null;
  let removeImage = false;
  const shelves = store.map.shelves;
  container.innerHTML = `
    <form class="product-form">
      <div class="pf-image">
        <div class="pf-preview">${p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : '<span class="muted">אין תמונה</span>'}</div>
        <div class="row">
          <label class="btn" style="margin:0">📷 ${p.image ? 'החלפת תמונה' : 'הוספת תמונה'}<input type="file" accept="image/*" data-img class="hidden"></label>
          <button type="button" data-a="rmimg" class="danger${p.image ? '' : ' hidden'}">הסרה</button>
        </div>
        ${store.aiEnabled ? `<button type="button" data-a="identify" class="${p.image ? '' : 'hidden'}">✨ מילוי פרטים מהתמונה</button>
        <span class="muted pf-ai" data-ai></span>` : ''}
      </div>
      <div class="pf-fields">
        <label>שם המוצר *</label>
        <input data-f="name" value="${escapeHtml(p.name || '')}" placeholder="למשל: סיר ORIENT 20 ס״מ" required maxlength="120">
        <label>תיאור (מלל חופשי ללקוח)</label>
        <textarea data-f="description" maxlength="500" placeholder="חומר, מידות, צבעים, מבצע, הערה ללקוח…">${escapeHtml(p.description || '')}</textarea>
        <div class="pf-row">
          <div><label>מעבר *</label><select data-f="shelfId" required>${shelves.length ? shelves.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === p.shelfId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('') : '<option value="">קודם צייר מעברים במפה</option>'}</select></div>
          <div><label>מיקום במדף</label><input data-f="level" list="levels" value="${escapeHtml(p.level || '')}" placeholder="מדף תחתון"></div>
          <div><label>מחיר</label><input data-f="price" value="${escapeHtml(p.price || '')}" placeholder="99.90" inputmode="decimal"></div>
        </div>
        <label>מילות חיפוש</label>
        <input data-f="keywords" value="${escapeHtml(p.keywords || '')}" placeholder="סיר קטן, סיר בישול, pot — מילים שלקוחות עשויים לחפש">
        <label class="pf-check"><input type="checkbox" data-f="active"${p.active === false ? '' : ' checked'}> מוצג ללקוחות (בטלו כשהמוצר אזל או הוצא מהמבצע)</label>
        <div class="row" style="margin-top:12px">
          <button type="submit" class="primary">${isNew ? 'הוספת המוצר' : 'שמירה'}</button>
          <button type="button" data-a="cancel">ביטול</button>
          <span class="muted" data-status></span>
        </div>
      </div>
    </form>`;
  const form = container.querySelector('form');
  const preview = form.querySelector('.pf-preview');
  form.querySelector('[data-img]').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImage = file; removeImage = false;
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
    form.querySelector('[data-a=rmimg]').classList.remove('hidden');
    form.querySelector('[data-a=identify]')?.classList.remove('hidden');
    // A new product with no name yet: fill it straight from the photo.
    if (store.aiEnabled && !form.querySelector('[data-f=name]').value.trim()) identify();
  });

  // AI reads the photo and suggests name, description and search words; the manager reviews them.
  async function identify() {
    const out = form.querySelector('[data-ai]');
    const btn = form.querySelector('[data-a=identify]');
    btn.disabled = true;
    out.innerHTML = '<span class="row"><span class="spinner"></span> מזהה…</span>';
    try {
      const blob = pendingImage ? await resizeImage(pendingImage, 1024) : await (await fetch(p.image)).blob();
      const f = new FormData();
      f.append('image', blob, 'product.jpg');
      const r = await api('/api/products/identify', { method: 'POST', form: f });
      if (!r.found) { out.textContent = 'לא זוהה מוצר ברור בתמונה'; return; }
      const field = (name) => form.querySelector(`[data-f=${name}]`);
      if (!field('name').value.trim()) field('name').value = r.name;
      if (!field('description').value.trim()) field('description').value = r.description;
      const words = new Set(field('keywords').value.split(',').map((w) => w.trim()).filter(Boolean));
      r.keywords.forEach((w) => words.add(w));
      field('keywords').value = [...words].join(', ');
      out.textContent = `✨ זוהה: ${r.name}. בדקו ותקנו לפני שמירה.`;
    } catch (err) {
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }
  form.addEventListener('click', (e) => {
    if (e.target.dataset.a === 'cancel') onCancel();
    if (e.target.dataset.a === 'identify') identify();
    if (e.target.dataset.a === 'rmimg') {
      pendingImage = null; removeImage = true;
      preview.innerHTML = '<span class="muted">אין תמונה</span>';
      e.target.classList.add('hidden');
      form.querySelector('[data-a=identify]')?.classList.add('hidden');
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('[data-status]');
    const data = Object.fromEntries([...form.querySelectorAll('[data-f]')].map((f) => [f.dataset.f, f.type === 'checkbox' ? f.checked : f.value]));
    form.querySelector('[type=submit]').disabled = true;
    status.textContent = 'שומר…';
    try {
      let saved = await api(isNew ? '/api/products' : `/api/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body: data });
      if (pendingImage) {
        const f = new FormData();
        f.append('image', await resizeImage(pendingImage, 1200), 'product.jpg');
        saved = await api(`/api/products/${saved.id}/image`, { method: 'POST', form: f });
      } else if (removeImage && p.image) {
        saved = await api(`/api/products/${saved.id}/image`, { method: 'DELETE' });
      }
      onSaved(saved);
    } catch (err) {
      status.textContent = err.message;
      form.querySelector('[type=submit]').disabled = false;
    }
  });
  form.querySelector('[data-f=name]').focus();
}

function productItem(p) {
  const item = document.createElement('div');
  const replace = (np) => {
    Object.assign(p, np);
    const i = products.findIndex((x) => x.id === p.id);
    if (i >= 0) products[i] = p;
  };
  const view = () => {
    item.className = `product-item${p.active === false ? ' inactive' : ''}`;
    item.innerHTML = '';
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="name">${escapeHtml(p.name)}${p.active === false ? ' <span class="badge">🙈 מוסתר מלקוחות</span>' : ''}</div>
      <div class="meta">📍 ${escapeHtml(shelfName(p.shelfId))}${p.level ? ` · ${escapeHtml(p.level)}` : ''}${p.price ? ` · ${escapeHtml(formatPrice(p.price))}` : ''}</div>
      ${p.description ? `<div class="meta pf-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="meta">${escapeHtml(p.keywords)}</div>
      <div class="row" style="margin-top:6px"><button data-a="edit">✏️ עריכה</button><button data-a="toggle">${p.active === false ? '👁️ הצגה' : '🙈 הסתרה'}</button><button data-a="del" class="danger">מחיקה</button></div>`;
    item.append(thumbFor(p), body);
  };
  item.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (a === 'edit') {
      item.className = 'product-item editing';
      productForm(item, p, { onSaved: (np) => { replace(np); view(); }, onCancel: view });
    }
    if (a === 'toggle') {
      replace(await api(`/api/products/${p.id}`, { method: 'PUT', body: { active: p.active === false } }));
      view();
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

$('new-product-btn').addEventListener('click', () => {
  const box = $('new-product');
  box.classList.remove('hidden');
  $('new-product-btn').classList.add('hidden');
  const close = () => { box.classList.add('hidden'); box.innerHTML = ''; $('new-product-btn').classList.remove('hidden'); };
  productForm(box, { active: true }, {
    onSaved: (p) => { products.unshift(p); renderProducts(); close(); },
    onCancel: close,
  });
});

async function loadProducts() {
  products = await api('/api/products');
  loadAlerts();
  setInterval(loadAlerts, 15000);
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

// ---------- catalog import ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}
const COLUMNS = {
  name: ['שם', 'שם מוצר', 'מוצר', 'name'], shelf: ['מעבר', 'מיקום', 'aisle', 'shelf'], keywords: ['מילות חיפוש', 'מילים נרדפות', 'keywords'],
  level: ['מדף', 'קומת מדף', 'level'], price: ['מחיר', 'price'], description: ['תיאור', 'description'],
};
$('import-template').href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿שם,מעבר,מדף,מחיר,מילות חיפוש\nפח סנסור DUBLIN 30 ליטר,4,מדף תחתון,199.90,"פח אשפה, פח חכם, פח למטבח"\n');
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const [header, ...data] = parseCsv(await file.text());
  const idx = {};
  header.forEach((h, i) => {
    for (const [key, names] of Object.entries(COLUMNS)) if (!(key in idx) && names.includes(h.trim().toLowerCase())) idx[key] = i;
  });
  if (!('name' in idx) || !('shelf' in idx)) return ($('import-status').textContent = 'חסרות עמודות "שם" ו"מעבר" בשורה הראשונה של הקובץ.');
  const rows = data.map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i] ?? ''])));
  $('import-status').textContent = `מייבא ${rows.length} מוצרים…`;
  try {
    const res = await api('/api/products/import', { method: 'POST', body: { rows } });
    $('import-status').textContent = `נוספו ${res.added} מוצרים.` + (res.skippedCount ? ` ${res.skippedCount} שורות דולגו: ${res.skipped.slice(0, 5).map((s) => `שורה ${s.row} (${s.reason})`).join(', ')}` : '');
    loadProducts();
  } catch (err) { $('import-status').textContent = err.message; }
});

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

// ---------- live alerts from shoppers ----------
const shelfLabel = (id) => (id ? shelfName(id) : 'ליד הכניסה');
const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(`${iso.replace(' ', 'T')}Z`)) / 60000);
  return mins < 1 ? 'עכשיו' : mins < 60 ? `לפני ${mins} דק׳` : `לפני ${Math.round(mins / 60)} שע׳`;
};
const ALERT_VIEW = {
  help: (a) => ['🙋', 'לקוח מבקש עזרה', [shelfLabel(a.shelfId), a.productName && `מחפש: ${a.productName}`, !a.productName && a.query && `חיפש: "${a.query}"`]],
  not_there: (a) => ['🔀', `לא במקום: ${a.productName || 'מוצר'}`, [`אמור להיות ב${shelfLabel(a.shelfId)}`]],
  empty: (a) => ['📭', `מדף ריק: ${a.productName || 'מוצר'}`, [shelfLabel(a.shelfId), 'צריך למלא מלאי']],
  request: (a) => ['📣', `לקוח ביקש שנביא: "${a.query}"`, [a.phone ? `<a href="tel:${escapeHtml(a.phone)}" dir="ltr">${escapeHtml(a.phone)}</a>` : 'בלי טלפון']],
};
let soundOn = false;
let seenAlerts = null;
function beep() {
  try {
    const ctx = new AudioContext();
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.17);
    }
  } catch { /* no audio */ }
}
$('notify-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  $('notify-btn').textContent = soundOn ? '🔔 התראה קולית פעילה' : '🔊 התראה קולית במסך הזה';
  $('notify-btn').classList.toggle('active', soundOn);
  if (soundOn) beep();
});

async function loadAlerts() {
  let alerts;
  try { alerts = await api('/api/alerts'); } catch { return; }
  // Only help calls and shelf problems need someone now; product requests are counted but don't nag.
  const open = alerts.filter((a) => !a.resolvedAt);
  const urgent = open.filter((a) => a.type !== 'request');
  $('alert-count').textContent = urgent.length;
  $('alert-count').classList.toggle('hidden', !urgent.length);
  document.title = `${urgent.length ? `(${urgent.length}) ` : ''}${store.name} — ניהול`;
  const ids = new Set(urgent.map((a) => a.id));
  if (seenAlerts && soundOn && [...ids].some((id) => !seenAlerts.has(id))) beep();
  seenAlerts = ids;
  $('alert-list').innerHTML = alerts.map((a) => {
    const [ico, title, meta] = ALERT_VIEW[a.type](a);
    return `<div class="alert t-${a.type} ${a.resolvedAt ? 'done' : 'open'}">
      <div class="a-ico">${ico}</div>
      <div class="a-main"><div class="a-title">${escapeHtml(title)}</div>
        <div class="a-meta">${meta.filter(Boolean).map((m) => (m.startsWith('<a ') ? m : escapeHtml(m))).join(' · ')} · ${ago(a.createdAt)}</div></div>
      ${a.resolvedAt ? '<span class="muted">✓ טופל</span>' : `<button type="button" class="primary" data-resolve="${a.id}">טופל ✓</button>`}
    </div>`;
  }).join('') || '<p class="muted">אין התראות פתוחות 👌</p>';
}
$('alert-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.resolve;
  if (!id) return;
  e.target.disabled = true;
  await api(`/api/alerts/${id}/resolve`, { method: 'POST' }).catch(() => {});
  loadAlerts();
});

// ---------- pilot report ----------
const fmtSecs = (s) => (s == null ? '—' : s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} דק׳`);
const num = (n) => (n ?? 0).toLocaleString('he-IL');
function barChart(values, labels, { cls = '', every = 1 } = {}) {
  const max = Math.max(1, ...values);
  return `<div class="bars ${cls}">${values.map((v, i) => `
    <div class="bar-col" title="${escapeHtml(labels[i])}: ${v}">
      <div class="bar-v">${values.length <= 18 && v ? v : ''}</div>
      <div class="bar ${cls === 'daily' ? 'alt' : ''}" style="height:${(v / max) * 100}%"></div>
      <div class="bar-l">${i % every === 0 ? escapeHtml(labels[i]) : '&nbsp;'}</div>
    </div>`).join('')}</div>`;
}
function rankList(rows, label, value, { miss = () => false, sub = () => '' } = {}) {
  if (!rows.length) return '<p class="muted">אין עדיין נתונים</p>';
  const max = Math.max(1, ...rows.map(value));
  return rows.map((r) => `<div><div class="rank-row"><span><b>${escapeHtml(label(r))}</b> <span class="muted" style="font-size:.85rem">${sub(r)}</span></span><span class="badge">${value(r)}</span></div>
    <div class="rank-bar${miss(r) ? ' miss' : ''}" style="width:${(value(r) / max) * 100}%"></div></div>`).join('');
}
async function loadReport() {
  const r = await api(`/api/pilot-report?days=${$('r-days').value}`);
  $('r-title').textContent = `דוח פיילוט · ${r.store}`;
  $('r-period').textContent = `${dateHe(r.from)} – ${dateHe(r.to)} · ${r.days} ימים · ${num(r.products)} מוצרים במערכת`;
  if (store.slug === 'demo') $('r-period').textContent += ' · ⚠️ חנות הדגמה: הנתונים הם סימולציה, לא תוצאות אמיתיות';
  const kpi = (v, k, sub = '', hero = false) => `<div class="card kpi${hero ? ' hero-kpi' : ''}"><div class="kpi-v">${v}</div><div>${k}</div><div class="kpi-sub">${sub}</div></div>`;
  $('r-kpis').innerHTML = [
    kpi(num(r.visitors), 'לקוחות השתמשו', `${num(r.returning)} חזרו שוב`, true),
    kpi(r.successRate == null ? '—' : `${r.successRate}%`, 'מצאו את המוצר', `${num(r.found)} מצאו · ${num(r.problems)} דיווחו בעיה`, true),
    kpi(fmtSecs(r.medianSecondsToFind), 'זמן עד המוצר', 'חציון, מפתיחת המוצר ועד "מצאתי"', true),
    kpi(num(r.staffHoursSaved), 'שעות עבודה נחסכו*', `${num(r.questionsSaved)} שאלות שלא הגיעו לעובד`, true),
    kpi(num(r.searches), 'חיפושים', r.searchFoundRate == null ? '' : `${r.searchFoundRate}% מצאו תוצאה`),
    kpi(num(r.help), 'קריאות לעובד', r.medianHelpResponseSeconds == null ? '' : `זמן תגובה: ${fmtSecs(r.medianHelpResponseSeconds)}`),
    kpi(num(r.problems), 'דיווחי מדף', 'מדף ריק / מוצר לא במקום'),
    kpi(num(r.requests), 'בקשות למוצרים חדשים', `${num(r.requestsWithPhone)} השאירו טלפון`),
  ].join('');
  const first = r.hours.findIndex((v) => v > 0), last = 23 - [...r.hours].reverse().findIndex((v) => v > 0);
  const hrs = first < 0 ? [] : r.hours.slice(first, last + 1).map((v, i) => [v, `${first + i}:00`]);
  $('r-hours').innerHTML = hrs.length ? barChart(hrs.map((h) => h[0]), hrs.map((h) => h[1]), { cls: 'hours', every: hrs.length > 12 ? 2 : 1 }) : '<p class="muted">אין עדיין נתונים</p>';
  $('r-daily').innerHTML = barChart(r.daily.map((d) => d.visitors), r.daily.map((d) => dateHe(d.date).slice(0, -5)), { cls: 'daily', every: Math.ceil(r.daily.length / 8) });
  $('r-top').innerHTML = rankList(r.topSearches, (q) => q.query, (q) => q.count, { miss: (q) => !q.found, sub: (q) => (q.found ? '' : 'לא נמצא בחנות') });
  $('r-problems').innerHTML = rankList(r.problemProducts, (p) => p.name, (p) => p.count, { miss: () => true, sub: (p) => (p.empty ? `${p.empty} מדף ריק` : '') });
  $('r-requests').innerHTML = rankList(r.topRequests, (q) => q.query, (q) => q.count, { sub: (q) => (q.withPhone ? `${q.withPhone} השאירו טלפון` : '') });
}
$('r-days').addEventListener('change', loadReport);

// ---------- settings ----------
$('name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/store/settings', { method: 'PUT', body: { name: $('s-name').value } });
    store.name = r.name;
    $('store-name').textContent = r.name;
    $('s-name-status').textContent = 'נשמר ✓';
  } catch (err) { $('s-name-status').textContent = err.message; }
});
$('pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/store/settings', { method: 'PUT', body: { currentPassword: $('s-cur').value, newPassword: $('s-new').value } });
    $('pass-form').reset();
    $('s-pass-status').textContent = 'הסיסמה הוחלפה ✓';
  } catch (err) { $('s-pass-status').textContent = err.message; }
});
$('export-btn').addEventListener('click', async () => {
  const res = await fetch('/api/products/export.csv', { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return alert('ההורדה נכשלה');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = `${store.slug}-קטלוג.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

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
  loadAlerts();
  setInterval(loadAlerts, 15000);
  $('video-box').classList.toggle('hidden', !store.aiEnabled);
  if (!store.aiEnabled) $('photo-status').textContent = 'זיהוי אוטומטי כבוי — אפשר לצלם את המדף ולהוסיף מוצרים ידנית, או להוסיף מוצרים בלשונית "מוצרים".';
})();
