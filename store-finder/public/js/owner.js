import { api, getToken, setToken, escapeHtml, resizeImage, formatPrice, extractFrames } from '/js/api.js';
import { createAlertsFeed } from '/js/alerts.js';
import { renderMap, cellFromEvent, drawPreview, shelfAt, drawCrop } from '/js/map.js';
import { generateStoreMap } from '/js/mapwizard.js';
import { buildMap } from '/js/walkmap.js';
import { createWalkRecorder } from '/js/walkrec.js';

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
  if (name === 'home') loadHome();
  window.scrollTo({ top: 0 });
  for (const t of ['home', 'map', 'photo', 'products', 'share', 'demand', 'alerts', 'report', 'settings']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  if (name === 'photo') renderPicker();
  if (name === 'products') loadProducts();
  if (name === 'share') loadShare();
  if (name === 'demand') loadDemand();
  if (name === 'alerts') loadAlerts();
  if (name === 'report') loadReport();
  if (name === 'settings') loadSettings();
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

// ---------- quick map wizard ----------
function wizardOptions() {
  const num = (id, d) => Number($(id).value) || d;
  return {
    aisles: num('wz-n', 8), length: num('wz-len', 12), walk: num('wz-walk', 2), checkouts: Number($('wz-checkouts').value) || 0,
    entrance: $('wz-door').value, backWall: $('wz-back').checked,
    names: $('wz-names').value.split('\n').map((x) => x.trim()).filter(Boolean),
  };
}
function prefillWizard() {
  const aisles = map.shelves.filter((s) => /^a\d+$/.test(s.id)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  if (!aisles.length) return;
  $('wz-n').value = aisles.length;
  $('wz-names').value = aisles.map((s) => s.name.replace(/^מעבר\s*\d+\s*[·\-–]?\s*/, '')).join('\n');
  $('wizard').open = false; // a store that already has a map: the wizard stays folded
}
$('wz-make').addEventListener('click', () => {
  const next = generateStoreMap(wizardOptions());
  const keep = new Set(next.shelves.map((s) => s.id));
  const lost = products.filter((p) => !keep.has(p.shelfId)).length;
  if (map.shelves.length && !confirm(lost
    ? `המפה הנוכחית תוחלף. ${lost} מוצרים נמצאים במדפים שלא יהיו במפה החדשה, ויימחקו בשמירה. להמשיך?`
    : 'המפה הנוכחית תוחלף במפה החדשה (המוצרים נשארים במעברים שלהם). להמשיך?')) return;
  map = next;
  $('cols').value = map.cols; $('rows').value = map.rows;
  setDirty(true);
  drawEditor();
  $('wz-status').textContent = `✓ צוירו ${map.shelves.filter((s) => /^a\d+$/.test(s.id)).length} מעברים. בודקים, מתקנים אם צריך, ולוחצים "שמירת מפה".`;
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('wz-video').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const bar = $('wz-progress');
  bar.classList.remove('hidden');
  const ui = (text, pct) => { $('wz-status').innerHTML = `<span class="row"><span class="spinner"></span> ${escapeHtml(text)}</span>`; bar.firstElementChild.style.width = `${pct}%`; };
  try {
    ui('מכין את הסרטון…', 2);
    const frames = await extractFrames(file, { every: 2, max: 40, onProgress: (n, total) => ui(`בוחר תמונות מהסיור… ${n}/${total}`, 2 + (n / total) * 48) });
    const form = new FormData();
    frames.forEach((f, i) => form.append('frames', f, `frame-${i}.jpg`));
    const { aisles } = await upload('/api/store/walk', form, (f) => ui(f < 1 ? `מעלה… ${Math.round(f * 100)}%` : 'קורא את שלטי המעברים… (עד 2 דקות)', 50 + f * 45));
    if (!aisles.length) throw new Error('לא הצלחתי לזהות מעברים בסרטון. אפשר לכתוב את השמות ביד.');
    $('wz-n').value = aisles.length;
    $('wz-names').value = aisles.map((a) => a.name).join('\n');
    $('wz-status').textContent = `✓ זוהו ${aisles.length} מעברים מהסרטון. בודקים את השמות ולוחצים "ציור המפה".`;
  } catch (err) { $('wz-status').textContent = err.message; } finally { bar.classList.add('hidden'); }
});

// ---------- map by walking ----------
let walked = null; // { built, points, frames }
const recorder = createWalkRecorder({ onFinish: ({ walk, frames }) => {
  try {
    const points = walk.final();
    walked = { built: buildMap(points), points, frames };
  } catch (err) {
    walked = null;
    $('walk-result').classList.remove('hidden');
    $('wres-sum').textContent = err.message;
    $('wres-map').innerHTML = '';
    return;
  }
  showWalkResult();
} });
$('walk-open').addEventListener('click', () => recorder.open());
$('wres-again').addEventListener('click', () => recorder.open());
function walkedMap() {
  const names = $('wres-names').value.split('\n').map((x) => x.trim());
  const m = structuredClone(walked.built.map);
  for (const s of m.shelves) {
    const n = Number(s.name.match(/^מעבר (\d+)/)?.[1]);
    if (n && names[n - 1]) s.name = s.name.replace(/^מעבר \d+/, `מעבר ${n} · ${names[n - 1]}`).slice(0, 60);
  }
  return m;
}
function showWalkResult() {
  const { built, frames } = walked;
  $('walk-result').classList.remove('hidden');
  const m = walkedMap();
  $('wres-sum').textContent = `${built.aisles.length} מעברים, ${m.shelves.length} מדפים וקירות, שטח של כ-${m.cols}×${m.rows} מטר, ${frames.length} תמונות. בודקים שהמפה נראית כמו החנות, ושומרים.`;
  renderMap($('wres-map'), m);
  $('wres-ai').classList.toggle('hidden', !store.aiEnabled || !frames.length);
  $('walk-result').scrollIntoView({ behavior: 'smooth' });
}
$('wres-names').addEventListener('input', () => { if (walked) renderMap($('wres-map'), walkedMap()); });
$('wres-ai').addEventListener('click', async () => {
  const { built, points, frames } = walked;
  const bar = $('wres-progress');
  bar.classList.remove('hidden');
  try {
    // the photos in walking order, a few per aisle, so the AI reads the signs aisle by aisle
    const byAisle = built.aisles.map((a) => frames.filter((f) => built.shelfFor(points[Math.min(f.step, points.length - 1)]).join() === a.shelfIds.join()).slice(0, 4));
    const form = new FormData();
    byAisle.flat().slice(0, 40).forEach((f, i) => form.append('frames', f.blob, `frame-${i}.jpg`));
    const { aisles } = await upload('/api/store/walk', form, (f) => { $('wres-status').textContent = f < 1 ? `מעלה… ${Math.round(f * 100)}%` : 'קורא את השלטים…'; bar.firstElementChild.style.width = `${f * 90}%`; });
    $('wres-names').value = aisles.map((a) => a.name).slice(0, built.aisles.length).join('\n');
    renderMap($('wres-map'), walkedMap());
    $('wres-status').textContent = '✓ השמות מולאו מהשלטים. בודקים ושומרים.';
  } catch (err) { $('wres-status').textContent = err.message; } finally { bar.classList.add('hidden'); }
});
$('wres-save').addEventListener('click', async () => {
  const { built, points, frames } = walked;
  const next = walkedMap();
  const keep = new Set(next.shelves.map((s) => s.id));
  const lost = products.filter((p) => !keep.has(p.shelfId)).length;
  if (store.map.shelves.length && !confirm(lost ? `המפה הנוכחית תוחלף, ו-${lost} מוצרים שנמצאים במדפים הישנים יימחקו. להמשיך?` : 'המפה הנוכחית תוחלף במפה מההליכה. להמשיך?')) return;
  const bar = $('wres-progress');
  bar.classList.remove('hidden');
  $('wres-save').disabled = true;
  try {
    await api('/api/store/map', { method: 'PUT', body: next });
    store.map = structuredClone(next);
    map = structuredClone(next);
    $('cols').value = map.cols; $('rows').value = map.rows;
    setDirty(false);
    drawEditor();
    // each aisle's photos go to the shelves on both sides of it
    const jobs = [];
    for (const a of built.aisles) {
      const mine = frames.filter((f) => built.shelfFor(points[Math.min(f.step, points.length - 1)]).join() === a.shelfIds.join());
      const pick = mine.filter((_, i) => mine.length <= 6 || i % Math.ceil(mine.length / 6) === 0).slice(0, 6);
      if (pick.length) for (const id of a.shelfIds) jobs.push([id, pick]);
    }
    for (let j = 0; j < jobs.length; j++) {
      const [shelfId, pick] = jobs[j];
      const form = new FormData();
      form.append('shelfId', shelfId);
      pick.forEach((f, i) => form.append('frames', f.blob, `frame-${i}.jpg`));
      $('wres-status').textContent = `שומר תמונות… מדף ${j + 1} מתוך ${jobs.length}`;
      bar.firstElementChild.style.width = `${((j + 1) / jobs.length) * 100}%`;
      await upload('/api/videos', form, () => {});
    }
    products = await api('/api/products');
    $('wres-status').textContent = jobs.length ? `✓ נשמרו המפה והתמונות של ${new Set(jobs.map((x) => x[0])).size} מדפים. השלב הבא: לייבא את קובץ המוצרים.` : '✓ המפה נשמרה. השלב הבא: לייבא את קובץ המוצרים.';
  } catch (err) { $('wres-status').textContent = err.message; } finally { bar.classList.add('hidden'); $('wres-save').disabled = false; }
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
  loadSpot();
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
    spotPhoto = null;
    loadSpot();
    $('photo-status').textContent = result.aiError || `זוהו ${result.products.length} מוצרים ב"${shelfName(shelfId)}". אפשר לתקן בלשונית מוצרים.`;
    showPhotoResult(result.products);
  } catch (err) { $('photo-status').textContent = err.message; }
});

// Upload with a real progress bar (fetch can't report upload progress).
function upload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `שגיאה ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('אין חיבור לאינטרנט. נסו שוב'));
    xhr.send(form);
  });
}
// An aisle video: the phone keeps the sharpest frames, uploads them, and the server saves them as real
// shelf photos (and finds the products when AI is on). `ui(text, percent)` shows progress.
async function processVideo(file, shelfId, ui) {
  ui('מכין את הסרטון…', 2);
  const frames = await extractFrames(file, { onProgress: (n, total) => ui(`בוחר את התמונות החדות מהסרטון… ${n}/${total}`, 2 + (n / total) * 43) });
  if (!frames.length) throw new Error('לא הצלחתי לקרוא תמונות מהסרטון');
  const form = new FormData();
  form.append('shelfId', shelfId);
  frames.forEach((f, i) => form.append('frames', f, `frame-${i}.jpg`));
  const result = await upload('/api/videos', form, (f) => ui(f < 1 ? `מעלה… ${Math.round(f * 100)}%` : store.aiEnabled ? 'מזהה את המוצרים בסרטון… (עד 2 דקות)' : 'שומר את התמונות…', 45 + f * 50));
  products = await api('/api/products');
  return result;
}
function videoDone(result, shelfId) {
  return result.ai === false
    ? `✓ נשמרו ${result.keptFrames} תמונות אמיתיות של "${shelfName(shelfId)}". עכשיו מסמנים איפה כל מוצר`
    : `✓ זוהו ${result.products.length} מוצרים ב"${shelfName(shelfId)}" מתוך ${result.frames} תמונות. כדאי לעבור עליהם`;
}
async function onPhotoTabVideo(e) {
  const file = e.target.files[0];
  e.target.value = '';
  const shelfId = $('photo-shelf').value;
  if (!file) return;
  if (!shelfId) return ($('photo-status').textContent = 'קודם צייר ושמור מדפים במפה');
  const bar = $('photo-progress');
  bar.classList.remove('hidden');
  const ui = (text, pct) => { $('photo-status').innerHTML = `<span class="row"><span class="spinner"></span> ${escapeHtml(text)}</span>`; bar.firstElementChild.style.width = `${pct}%`; };
  try {
    const result = await processVideo(file, shelfId, ui);
    spotPhoto = null; // show the new frames first
    loadSpot();
    $('photo-status').textContent = videoDone(result, shelfId);
    if (result.ai === false) {
      $('photo-result').classList.add('hidden');
      $('spot-card').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    lastPhoto = null;
    $('photo-result').classList.remove('hidden');
    $('photo-preview').innerHTML = '';
    $('manual-add').classList.add('hidden');
    $('detected').innerHTML = '';
    for (const p of result.products) $('detected').appendChild(productItem(p));
  } catch (err) { $('photo-status').textContent = err.message; } finally { bar.classList.add('hidden'); }
}
$('video-input').addEventListener('change', onPhotoTabVideo);
$('video-gallery').addEventListener('change', onPhotoTabVideo);

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

// ---------- marking each product on the real shelf photo ----------
let spotPhotos = [];
let spotPhoto = null;
let spotBox = null;
let spotWanted = null; // product to select after switching here from the products tab
async function loadSpot() {
  const shelfId = $('photo-shelf').value;
  if (!shelfId) return;
  spotPhotos = await api(`/api/photos?shelfId=${encodeURIComponent(shelfId)}`).catch(() => []);
  if (!spotPhotos.some((ph) => ph.id === spotPhoto?.id)) spotPhoto = spotPhotos[0] || null;
  if (spotWanted?.photoId && spotPhotos.some((ph) => ph.id === spotWanted.photoId)) spotPhoto = spotPhotos.find((ph) => ph.id === spotWanted.photoId);
  $('spot-empty').classList.toggle('hidden', spotPhotos.length > 0);
  $('spot-editor').classList.toggle('hidden', !spotPhoto);
  $('spot-frames').innerHTML = spotPhotos.map((ph) => `<button type="button" class="spot-frame${ph.id === spotPhoto?.id ? ' on' : ''}" data-photo="${ph.id}"><img src="${escapeHtml(ph.url)}" alt=""><span>${ph.products ? `${ph.products} מסומנים` : 'חדש'}</span></button>`).join('');
  fillSpotProducts();
  renderSpot();
}
function fillSpotProducts() {
  const shelfId = $('photo-shelf').value;
  const keep = spotWanted?.id ?? Number($('spot-product').value);
  // a supermarket has thousands of products: the search box narrows the list
  const q = $('spot-search').value.trim().toLowerCase();
  const fits = (p) => !q || `${p.name} ${p.barcode || ''} ${p.keywords}`.toLowerCase().includes(q);
  const here = products.filter((p) => p.shelfId === shelfId && fits(p));
  const other = q ? products.filter((p) => p.shelfId !== shelfId && fits(p)).slice(0, 150) : [];
  const opt = (p) => `<option value="${p.id}">${p.photoId && p.box ? '✓' : '⚠️'} ${escapeHtml(p.name)}</option>`;
  $('spot-product').innerHTML = `<optgroup label="${escapeHtml(shelfName(shelfId))}">${here.map(opt).join('')}</optgroup>` +
    (other.length ? `<optgroup label="ממעברים אחרים (יועבר למעבר הזה)">${other.map(opt).join('')}</optgroup>` : '');
  const keepP = products.find((p) => p.id === keep);
  const pick = (keepP && (here.includes(keepP) || other.includes(keepP)) ? keepP : null) || here.find((p) => !(p.photoId && p.box)) || here[0] || other[0];
  if (pick) $('spot-product').value = pick.id;
  spotWanted = null;
}
function renderSpot() {
  if (!spotPhoto) return;
  $('spot-img').src = spotPhoto.url;
  const pid = Number($('spot-product').value);
  const pct = (b) => `left:${b.x0 / 10}%;top:${b.y0 / 10}%;width:${(b.x1 - b.x0) / 10}%;height:${(b.y1 - b.y0) / 10}%`;
  $('spot-marks').innerHTML = products.filter((p) => p.photoId === spotPhoto.id && p.box && p.id !== pid)
    .map((p) => `<div class="box" style="${pct(p.box)}"><span>${escapeHtml(p.name)}</span></div>`).join('');
  const current = products.find((p) => p.id === pid);
  spotBox = current?.photoId === spotPhoto.id && current.box ? { ...current.box } : null;
  drawSpotBox();
  $('spot-save').disabled = true;
  $('spot-status').textContent = '';
}
function drawSpotBox() {
  const el = $('spot-box');
  el.classList.toggle('hidden', !spotBox);
  if (spotBox) Object.assign(el.style, { left: `${spotBox.x0 / 10}%`, top: `${spotBox.y0 / 10}%`, width: `${(spotBox.x1 - spotBox.x0) / 10}%`, height: `${(spotBox.y1 - spotBox.y0) / 10}%` });
}
$('spot-frames').addEventListener('click', (e) => {
  const id = Number(e.target.closest('[data-photo]')?.dataset.photo);
  if (!id) return;
  spotPhoto = spotPhotos.find((ph) => ph.id === id);
  for (const b of $('spot-frames').children) b.classList.toggle('on', Number(b.dataset.photo) === id);
  renderSpot();
});
$('spot-product').addEventListener('change', renderSpot);
$('spot-search').addEventListener('input', () => { fillSpotProducts(); renderSpot(); });
{
  // tap = a box around the finger; drag = exactly the frame drawn
  let start = null;
  const at = (e) => {
    const r = $('spot-photo').getBoundingClientRect();
    return { x: Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)), y: Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)) };
  };
  $('spot-photo').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    start = at(e);
    $('spot-photo').setPointerCapture(e.pointerId);
  });
  $('spot-photo').addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = at(e);
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 30) return;
    spotBox = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) };
    drawSpotBox();
  });
  $('spot-photo').addEventListener('pointerup', (e) => {
    if (!start) return;
    const p = at(e);
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 30) {
      const w = 90, h = 140;
      const cx = Math.max(w, Math.min(1000 - w, p.x)), cy = Math.max(h, Math.min(1000 - h, p.y));
      spotBox = { x0: cx - w, y0: cy - h, x1: cx + w, y1: cy + h };
      drawSpotBox();
    }
    start = null;
    $('spot-save').disabled = !spotBox || !$('spot-product').value;
  });
}
$('spot-save').addEventListener('click', async () => {
  const id = Number($('spot-product').value);
  if (!id || !spotBox || !spotPhoto) return;
  try {
    const np = await api(`/api/products/${id}/spot`, { method: 'PUT', body: { photoId: spotPhoto.id, box: spotBox } });
    const i = products.findIndex((p) => p.id === id);
    if (i >= 0) products[i] = np;
    spotPhoto.products = products.filter((p) => p.photoId === spotPhoto.id).length;
    const next = products.find((p) => p.shelfId === np.shelfId && !p.photoId);
    if (next) spotWanted = next;
    fillSpotProducts();
    renderSpot();
    $('spot-status').textContent = `✓ נשמר: הלקוח יראה את "${np.name}" מסומן בתמונה הזו.${next ? ' עוברים למוצר הבא 👇' : ''}`;
  } catch (err) { $('spot-status').textContent = err.message; }
});
$('spot-del').addEventListener('click', async () => {
  if (!spotPhoto || !confirm('למחוק את התמונה הזו? מוצרים שסומנו עליה יצטרכו סימון מחדש.')) return;
  await api(`/api/photos/${spotPhoto.id}`, { method: 'DELETE' });
  products = await api('/api/products');
  spotPhoto = null;
  loadSpot();
});
function markOnShelf(p) {
  spotWanted = p;
  showTab('photo');
  if (store.map.shelves.some((s) => s.id === p.shelfId)) $('photo-shelf').value = p.shelfId;
  renderPicker();
  $('spot-card').scrollIntoView({ behavior: 'smooth' });
}

// ---------- home: is the store ready for the pilot? ----------
const flagKey = (k) => `storeFinder:${k}:${store.slug}`;
const getFlag = (k) => { try { return localStorage.getItem(flagKey(k)) === '1'; } catch { return false; } };
const setFlag = (k) => { try { localStorage.setItem(flagKey(k), '1'); } catch { /* private mode */ } };
let setup = null;
async function loadHome() {
  setup = await api('/api/store/setup').catch(() => null);
  if (!setup) return;
  const a = setup.aisles;
  const shot = a.filter((x) => x.photos).length;
  const withProducts = a.filter((x) => x.products).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const items = [
    [a.length > 0 && setup.entrance, 'מפת החנות', a.length ? `${a.length} מעברים במפה` : 'מציירים את המעברים ומסמנים את הכניסה', 'לפתוח את המפה', () => showTab('map')],
    [a.length > 0 && shot === a.length, 'סרטון לכל מעבר', `${shot} מתוך ${a.length} מעברים צולמו`, 'לצלם', () => $('aisle-board').scrollIntoView({ behavior: 'smooth' })],
    [a.length > 0 && withProducts === a.length, 'מוצרים בכל מעבר', `${setup.products} מוצרים · ${withProducts} מתוך ${a.length} מעברים`, 'להוסיף / לייבא', () => showTab('products')],
    [setup.products > 0 && setup.marked / setup.products >= 0.8, 'כל מוצר מסומן על המדף', `${setup.marked} מתוך ${setup.products} (${pct(setup.marked, setup.products)}%) מסומנים על תמונת המדף`, 'לסמן', () => openProducts({ show: 'unmarked' })],
    [setup.products > 0 && setup.priced / setup.products >= 0.8, 'מחירים', `${pct(setup.priced, setup.products)}% מהמוצרים עם מחיר`, 'להוסיף מחירים', () => openProducts({ show: 'noprice' })],
    [setup.staffPinSet, 'קוד לעובדים', setup.staffPinSet ? 'העובדים מקבלים קריאות של לקוחות בטלפון' : 'קובעים קוד, והעובדים נכנסים ממסך העובדים', 'לקבוע', () => showTab('settings')],
    [getFlag('qr'), 'שלט כניסה ומדבקות "אתה כאן"', getFlag('qr') ? 'הודפסו' : 'מדפיסים שלט QR לכניסה ומדבקה לכל מעבר', 'להדפיס', () => showTab('share')],
    [getFlag('tried'), 'בדיקה כמו לקוח', getFlag('tried') ? 'נבדק' : 'מחפשים 3 מוצרים מהטלפון והולכים אליהם', 'לפתוח', () => { setFlag('tried'); window.open(`/s/${store.slug}`, '_blank'); loadHome(); }],
  ];
  const done = items.filter((i) => i[0]).length;
  const p = Math.round((done / items.length) * 100);
  $('ready-pct').textContent = `${p}%`;
  $('ready-arc').style.strokeDasharray = `${p} 100`;
  $('ready-ring').classList.toggle('full', p === 100);
  $('ready-sub').textContent = p === 100 ? 'הכל מוכן. בהצלחה בפיילוט! 🎉' : `${done} מתוך ${items.length} מוכנים. מה שנשאר:`;
  $('ready-list').replaceChildren(...items.map(([ok, title, detail, cta, fn]) => {
    const li = document.createElement('li');
    li.className = ok ? 'ok' : '';
    li.innerHTML = `<span class="rl-mark">${ok ? '✓' : ''}</span><span class="rl-main"><b>${escapeHtml(title)}</b><span class="muted">${escapeHtml(detail)}</span></span>`;
    if (!ok) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = cta; b.addEventListener('click', fn);
      li.append(b);
    }
    return li;
  }), Object.assign(document.createElement('li'), { className: 'rl-extras', innerHTML:
    `<span class="chip ${setup.premiumVoice ? 'o' : ''}">🔊 קול של עומר: ${setup.premiumVoice ? 'פעיל' : 'כבוי'}</span>
     <span class="chip ${setup.aiEnabled ? 'o' : ''}">✨ זיהוי מוצרים מסרטון: ${setup.aiEnabled ? 'פעיל' : 'כבוי (אפשר להפעיל חינם במסך הנהלת הרשת)'}</span>` }));
  $('board-sum').textContent = `${shot}/${a.length} צולמו`;
  $('aisle-board').innerHTML = a.map((x) => `
    <div class="aisle-card${x.photos ? ' has' : ''}" data-aisle="${escapeHtml(x.id)}">
      <div class="ac-photo">${x.photo ? `<img src="${escapeHtml(x.photo)}" alt="" loading="lazy">` : '<span>🎥</span>'}</div>
      <div class="ac-body">
        <b class="ac-name">${escapeHtml(x.name)}</b>
        <span class="muted ac-stats">📷 ${x.photos} תמונות · 📦 ${x.products} מוצרים · 📍 ${x.marked}/${x.products} מסומנים</span>
        <span class="ac-bar"><i style="width:${pct(x.marked, x.products)}%"></i></span>
        <span class="ac-actions">
          <label class="btn primary">🎥 ${x.photos ? 'לצלם שוב' : 'לצלם'}<input type="file" accept="video/*" capture="environment" class="hidden" data-video></label>
          <label class="btn">🖼️ מהגלריה<input type="file" accept="video/*" class="hidden" data-video></label>
          <button type="button" data-mark>📍 לסמן</button>
        </span>
        <span class="ac-status hidden"></span>
        <span class="up-progress hidden"><i></i></span>
      </div>
    </div>`).join('') || '<p class="muted">קודם מציירים את המעברים במפה.</p>';
}
$('aisle-board').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-video]')) return;
  const file = e.target.files[0];
  e.target.value = '';
  const card = e.target.closest('[data-aisle]');
  if (!file || !card) return;
  const status = card.querySelector('.ac-status'), bar = card.querySelector('.up-progress');
  status.classList.remove('hidden'); bar.classList.remove('hidden');
  card.classList.add('busy');
  try {
    const result = await processVideo(file, card.dataset.aisle, (text, pct) => { status.textContent = text; bar.firstElementChild.style.width = `${pct}%`; });
    await loadHome();
    const fresh = $('aisle-board').querySelector(`[data-aisle="${CSS.escape(card.dataset.aisle)}"] .ac-status`);
    if (fresh) { fresh.textContent = videoDone(result, card.dataset.aisle); fresh.classList.remove('hidden'); fresh.classList.add('ok'); }
  } catch (err) {
    status.textContent = err.message;
    bar.classList.add('hidden');
    card.classList.remove('busy');
  }
});
$('aisle-board').addEventListener('click', (e) => {
  if (!e.target.closest('[data-mark]')) return;
  $('photo-shelf').value = e.target.closest('[data-aisle]').dataset.aisle;
  showTab('photo');
  setTimeout(() => $('spot-card').scrollIntoView({ behavior: 'smooth' }), 300);
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
        <label>🏷️ מבצע (לא חובה)</label>
        <input data-f="promo" value="${escapeHtml(p.promo || '')}" maxlength="60" placeholder="למשל: 2 ב-50 ₪ · 20% הנחה · השני ב-50%">
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
    item.className = `product-item row-item${p.active === false ? ' inactive' : ''}${selected.has(p.id) ? ' selected' : ''}`;
    item.innerHTML = '';
    const pick = document.createElement('input');
    pick.type = 'checkbox'; pick.className = 'ri-pick'; pick.checked = selected.has(p.id); pick.dataset.a = 'pick';
    pick.setAttribute('aria-label', `בחירת ${p.name}`);
    const body = document.createElement('div');
    body.className = 'ri-body';
    const marked = p.photoId && p.box;
    body.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">📍 ${escapeHtml(shelfName(p.shelfId))}${p.level ? ` · ${escapeHtml(p.level)}` : ''}${p.price ? ` · <b class="price">${escapeHtml(formatPrice(p.price))}</b>` : ''}${p.barcode ? ` · <span dir="ltr">${escapeHtml(p.barcode)}</span>` : ''}</div>
      <div class="ri-tags">${p.promo ? `<span class="promo-tag">🏷️ ${escapeHtml(p.promo)}</span>` : ''}${p.active === false ? '<span class="badge">🙈 מוסתר</span>' : ''}${marked ? '' : '<span class="badge warn">📍 לא מסומן</span>'}${p.price ? '' : '<span class="badge warn">💲 בלי מחיר</span>'}</div>`;
    const acts = document.createElement('div');
    acts.className = 'ri-acts';
    acts.innerHTML = `<button data-a="edit" title="עריכה">✏️</button><button data-a="spot" title="סימון על תמונת המדף">📍</button><button data-a="toggle" title="${p.active === false ? 'הצגה ללקוחות' : 'הסתרה מלקוחות'}">${p.active === false ? '👁️' : '🙈'}</button><button data-a="del" class="danger" title="מחיקה">🗑️</button>`;
    item.append(pick, thumbFor(p, 112), body, acts);
  };
  item.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (a === 'pick') { e.target.checked ? selected.add(p.id) : selected.delete(p.id); item.classList.toggle('selected', e.target.checked); updateBulk(); return; }
    if (a === 'edit') {
      item.className = 'product-item editing';
      productForm(item, p, { onSaved: (np) => { replace(np); view(); }, onCancel: view });
    }
    if (a === 'spot') markOnShelf(p);
    if (a === 'toggle') {
      replace(await api(`/api/products/${p.id}`, { method: 'PUT', body: { active: p.active === false } }));
      view();
    }
    if (a === 'del' && confirm(`למחוק את "${p.name}"?`)) {
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      products = products.filter((x) => x.id !== p.id);
      selected.delete(p.id);
      item.remove();
      $('product-count').textContent = products.length;
      updateBulk();
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

// The list for a supermarket: thousands of products, so search + filters + a page at a time.
const PAGE = 60;
let pfShow = '';
let pfLimit = PAGE;
const selected = new Set();
async function loadProducts() {
  products = await api('/api/products');
  fillAisleSelects();
  renderProducts();
}
function fillAisleSelects() {
  const opts = store.map.shelves.map((sh) => `<option value="${escapeHtml(sh.id)}">${escapeHtml(sh.name)}</option>`).join('');
  const keep = $('pf-aisle').value;
  $('pf-aisle').innerHTML = `<option value="">כל המעברים</option>${opts}`;
  $('pf-aisle').value = keep;
  $('bulk-aisle').innerHTML = `<option value="">📦 העברה למעבר…</option>${opts}`;
  const keepDef = $('import-default').value;
  $('import-default').innerHTML = `<option value="">— לדלג על מוצרים בלי מעבר —</option>${opts}`;
  $('import-default').value = keepDef;
}
function filteredProducts() {
  const q = $('product-filter').value.trim().toLowerCase();
  const aisle = $('pf-aisle').value;
  return products.filter((p) => (!q || `${p.name} ${p.keywords} ${p.barcode || ''} ${shelfName(p.shelfId)}`.toLowerCase().includes(q))
    && (!aisle || p.shelfId === aisle)
    && (pfShow !== 'unmarked' || !(p.photoId && p.box))
    && (pfShow !== 'noprice' || !p.price)
    && (pfShow !== 'promo' || p.promo)
    && (pfShow !== 'hidden' || p.active === false));
}
function renderProducts() {
  const list = $('product-list');
  const shown = filteredProducts();
  list.replaceChildren(...shown.slice(0, pfLimit).map(productItem));
  if (!products.length) list.innerHTML = '<p class="muted">אין מוצרים עדיין. מייבאים את קובץ המוצרים של החנות (למעלה), מסריטים מעבר, או מוסיפים מוצר חדש.</p>';
  else if (!shown.length) list.innerHTML = '<p class="muted">לא נמצאו מוצרים לפי הסינון.</p>';
  $('product-count').textContent = products.length;
  $('pf-summary').textContent = shown.length === products.length ? '' : `מוצגים ${shown.length} מתוך ${products.length}`;
  const rest = shown.length - pfLimit;
  $('pf-more').classList.toggle('hidden', rest <= 0);
  $('pf-more').textContent = `הצג עוד (${rest} נוספים)`;
  updateBulk();
}
const refilter = () => { pfLimit = PAGE; renderProducts(); };
$('product-filter').addEventListener('input', refilter);
$('pf-aisle').addEventListener('change', refilter);
$('pf-show').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (!b) return;
  pfShow = b.dataset.show;
  for (const x of $('pf-show').children) x.classList.toggle('on', x === b);
  refilter();
});
$('pf-more').addEventListener('click', () => { pfLimit += PAGE * 2; renderProducts(); });
// from the start screen: "show me what's not marked yet"
function openProducts({ show = '', aisle = '' } = {}) {
  pfShow = show;
  for (const x of $('pf-show').children) x.classList.toggle('on', x.dataset.show === show);
  $('product-filter').value = '';
  showTab('products');
  $('pf-aisle').value = aisle;
}

function updateBulk() {
  for (const id of [...selected]) if (!products.some((p) => p.id === id)) selected.delete(id);
  $('bulk-bar').classList.toggle('active', selected.size > 0);
  $('bulk-bar').classList.toggle('hidden', !products.length);
  $('bulk-acts').classList.toggle('hidden', !selected.size);
  $('bulk-label').textContent = selected.size ? `${selected.size} נבחרו` : 'בחירת כל המוצגים';
  const shown = filteredProducts();
  $('bulk-all').checked = shown.length > 0 && shown.every((p) => selected.has(p.id));
}
$('bulk-all').addEventListener('change', (e) => {
  for (const p of filteredProducts()) e.target.checked ? selected.add(p.id) : selected.delete(p.id);
  renderProducts();
});
async function bulk(action, extra = {}) {
  const ids = [...selected];
  const names = { move: 'להעביר', hide: 'להסתיר', show: 'להציג', delete: 'למחוק' };
  if (action === 'delete' && !confirm(`למחוק ${ids.length} מוצרים? אי אפשר לבטל.`)) return;
  try {
    const r = await api('/api/products/bulk', { method: 'POST', body: { ids, action, ...extra } });
    selected.clear();
    await loadProducts();
    $('pf-summary').textContent = `✓ ${r.changed} מוצרים עודכנו (${names[action]})`;
  } catch (err) { alert(err.message); }
}
$('bulk-bar').addEventListener('click', (e) => { const a = e.target.closest('[data-bulk]')?.dataset.bulk; if (a) bulk(a); });
$('bulk-aisle').addEventListener('change', (e) => {
  if (!e.target.value) return;
  const name = shelfName(e.target.value);
  if (confirm(`להעביר ${selected.size} מוצרים ל"${name}"? הסימון שלהם על תמונת המדף יימחק.`)) bulk('move', { shelfId: e.target.value });
  e.target.value = '';
});

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
  name: ['שם', 'שם מוצר', 'שם המוצר', 'שם פריט', 'מוצר', 'פריט', 'name', 'product'], shelf: ['מעבר', 'מיקום', 'aisle', 'shelf'], keywords: ['מילות חיפוש', 'מילים נרדפות', 'keywords'],
  level: ['מדף', 'קומת מדף', 'level'], price: ['מחיר', 'מחיר לצרכן', 'מחיר מכירה', 'price'], description: ['תיאור', 'description'], promo: ['מבצע', 'promo'],
  barcode: ['ברקוד', 'קוד פריט', 'מק"ט', 'מקט', 'barcode', 'ean', 'sku'], department: ['מחלקה', 'קטגוריה', 'department', 'category'],
};
// Excel files are read on the phone/computer with SheetJS, loaded only when one is chosen.
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => resolve(window.XLSX);
    sc.onerror = () => reject(new Error('לא הצלחתי לפתוח קובץ Excel. אפשר לשמור אותו כ-CSV ולנסות שוב'));
    document.head.appendChild(sc);
  });
}
async function readTable(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await loadSheetJs();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim()));
  }
  return parseCsv(await file.text());
}
$('import-template').href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿שם,ברקוד,מחיר,מבצע,מעבר,מחלקה,מדף,מילות חיפוש\nחלב תנובה 3% 1 ליטר,7290004131074,6.90,,4,מוצרי חלב,מדף אמצעי,"חלב, חלב טרי"\nפח סנסור DUBLIN 30 ליטר,,199.90,השני ב-50%,6,,מדף תחתון,"פח אשפה, פח חכם"\n');
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('import-status').innerHTML = '<span class="row"><span class="spinner"></span> קורא את הקובץ…</span>';
  let table;
  try { table = await readTable(file); } catch (err) { $('import-status').textContent = err.message; return; }
  const [header = [], ...data] = table;
  const idx = {};
  header.forEach((h, i) => {
    for (const [key, names] of Object.entries(COLUMNS)) if (!(key in idx) && names.includes(h.trim().toLowerCase())) idx[key] = i;
  });
  if (!('name' in idx)) return ($('import-status').textContent = `לא מצאתי עמודת "שם" בשורה הראשונה. העמודות בקובץ: ${header.slice(0, 8).join(', ')}`);
  if (!('shelf' in idx) && !('department' in idx) && !$('import-default').value) return ($('import-status').textContent = 'בקובץ אין עמודת "מעבר" או "מחלקה": בחרו למעלה לאיזה מעבר להכניס את המוצרים (ואחר כך אפשר להעביר בקבוצות).');
  const rows = data.map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i] ?? ''])));
  $('import-status').innerHTML = `<span class="row"><span class="spinner"></span> מייבא ${rows.length} שורות…</span>`;
  try {
    const res = await api('/api/products/import', { method: 'POST', body: { rows, defaultShelfId: $('import-default').value } });
    $('import-status').textContent = `✓ נוספו ${res.added} מוצרים חדשים, עודכנו ${res.updated}.` + (res.skippedCount ? ` ${res.skippedCount} שורות דולגו: ${res.skipped.slice(0, 5).map((s) => `שורה ${s.row} (${s.reason})`).join(', ')}` : '');
    await loadProducts();
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
const alertsFeed = createAlertsFeed({ list: $('alert-list'), count: $('alert-count'), store: () => store, title: 'ניהול' });
const loadAlerts = alertsFeed.load;
let soundOn = false;
$('notify-btn').addEventListener('click', () => {
  soundOn = alertsFeed.enableSound(!soundOn);
  $('notify-btn').textContent = soundOn ? '🔔 התראה קולית פעילה' : '🔊 התראה קולית במסך הזה';
  $('notify-btn').classList.toggle('active', soundOn);
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
  const b = r.basket || {};
  $('r-basket-kpis').innerHTML = [
    kpi(num(b.extraItems || 0), 'מוצרים נוספים לסל', 'מעבר למה שחיפשו', true),
    kpi(b.extraShare == null ? '—' : `${b.extraShare}%`, 'מכל ההוספות לעגלה', 'הגיעו מהצעות, מבצעים וסיור', true),
    kpi(b.cartsWithExtraRate == null ? '—' : `${b.cartsWithExtraRate}%`, 'מהלקוחות הוסיפו עוד משהו', `${num(b.carts || 0)} לקוחות מילאו עגלה`),
    kpi(b.avgItems == null ? '—' : b.avgItems, 'מוצרים בעגלה בממוצע', `${num(b.items || 0)} הוספות סה״כ`),
  ].join('');
  const SRC = { suggest: '💡 "הולך עם"', deal: '🏷️ מבצעים', aisle: '🧭 באותו מעבר', tour: '🛒 סיור בחנות', detour: '🔥 מסלול מגלה', related: '👥 לקחו גם' };
  $('r-basket-src').innerHTML = rankList(Object.entries(b.bySource || {}).filter(([k, v]) => k !== 'search' && v).sort((x, y) => y[1] - x[1]), ([k]) => SRC[k] || k, ([, v]) => v);
  $('r-basket-top').innerHTML = rankList(b.topExtra || [], (p) => p.name, (p) => p.count);
}
$('r-days').addEventListener('change', loadReport);

// ---------- settings ----------
function loadSettings() {
  $('s-name').value = store.name;
  $('s-detour').value = String(store.detourPct ?? 20);
  const url = `${location.origin}/staff.html?store=${encodeURIComponent(store.slug)}`;
  $('staff-url').textContent = url;
  $('staff-qr').src = `/api/public/${encodeURIComponent(store.slug)}/staff-qr.svg`;
  $('staff-link').classList.toggle('hidden', !store.staffPinSet);
  $('s-pin-status').textContent = store.staffPinSet ? 'יש קוד עובדים פעיל. קוד חדש ינתק את העובדים המחוברים.' : 'עוד לא נקבע קוד עובדים.';
}
$('staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/store/settings', { method: 'PUT', body: { staffPin: $('s-pin').value } });
    store.staffPinSet = Boolean($('s-pin').value);
    $('s-pin').value = '';
    loadSettings();
    $('s-pin-status').textContent = 'הקוד נשמר ✓';
  } catch (err) { $('s-pin-status').textContent = err.message; }
});
$('detour-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/store/settings', { method: 'PUT', body: { detourPct: Number($('s-detour').value) } });
    store.detourPct = r.detourPct;
    $('s-detour-status').textContent = Number(r.detourPct) ? `נשמר ✓ מסלולים יעברו ליד מבצעים כשזה מוסיף עד ${r.detourPct}% הליכה.` : 'נשמר ✓ מסלול מגלה כבוי.';
  } catch (err) { $('s-detour-status').textContent = err.message; }
});
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
  if (store.role === 'staff') { location.href = '/staff.html'; return; }
  map = structuredClone(store.map);
  $('store-name').textContent = store.name;
  document.title = `${store.name} — ניהול`;
  $('customer-link').href = `/s/${store.slug}`;
  $('cols').value = map.cols;
  $('rows').value = map.rows;
  drawEditor();
  prefillWizard();
  products = await api('/api/products');
  fillAisleSelects();
  loadHome();
  window.addEventListener('beforeprint', () => setFlag('qr'));
  loadAlerts();
  setInterval(loadAlerts, 15000);
  if (!store.aiEnabled) $('photo-status').textContent = 'זיהוי אוטומטי כבוי: מצלמים או מסריטים את המעבר, ומסמנים כל מוצר על התמונה האמיתית (למטה).';
})();
