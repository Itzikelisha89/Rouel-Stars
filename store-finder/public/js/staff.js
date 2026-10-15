// Workers' phone screen: live alerts (sound, vibration, notification), and keeping products in place:
// move a product to another aisle, mark it out of stock. Opened from an aisle sticker (?to=<shelfId>),
// "move here" is one tap.
import { api, getToken, setToken, escapeHtml, formatPrice } from '/js/api.js?v=22';
import { drawCrop } from '/js/map.js?v=22';
import { createAlertsFeed } from '/js/alerts.js?v=22';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let store = null;
let products = [];
let moveTo = null; // aisle the worker is standing at (scanned sticker)

function shelf(id) { return store.map.shelves.find((s) => s.id === id); }
const shelfName = (id) => shelf(id)?.name ?? 'מדף שנמחק';

// ---------- sign in ----------
$('staff-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('s-error').textContent = '';
  try {
    const { token } = await api('/api/staff/login', { method: 'POST', body: { slug: $('s-slug').value, pin: $('s-pin').value } });
    setToken(token);
    start();
  } catch (err) { $('s-error').textContent = err.message; }
});
$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
  location.href = '/staff.html';
});

// ---------- tabs ----------
function showTab(name) {
  for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of ['alerts', 'products']) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  if (name === 'products') loadProducts();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

// ---------- alerts ----------
let feed = null;
$('sound-btn').addEventListener('click', () => {
  feed.enableSound(true);
  $('sound-btn').textContent = '🔔 צליל והתראות פעילים';
  $('sound-btn').classList.remove('primary');
  $('sound-btn').disabled = true;
});

// ---------- products: move / out of stock ----------
async function loadProducts() {
  products = await api('/api/products');
  renderProducts();
}
function renderProducts() {
  const q = $('p-search').value.trim().toLowerCase();
  const shown = products.filter((p) => !q || `${p.name} ${p.keywords} ${shelfName(p.shelfId)}`.toLowerCase().includes(q)).slice(0, 60);
  $('p-list').replaceChildren(...shown.map(productCard));
  if (!shown.length) $('p-list').innerHTML = '<p class="muted">לא נמצאו מוצרים</p>';
}
$('p-search').addEventListener('input', renderProducts);

function productCard(p) {
  const item = document.createElement('div');
  item.className = `product-item${p.active === false ? ' inactive' : ''}`;
  const canvas = document.createElement('canvas');
  drawCrop(canvas, p.image || p.photo, p.image ? null : p.box, 168);
  const body = document.createElement('div');
  const here = moveTo && p.shelfId === moveTo.id;
  body.innerHTML = `
    <div class="name">${escapeHtml(p.name)}${p.active === false ? ' <span class="badge">🙈 אזל</span>' : ''}</div>
    <div class="meta">📍 ${escapeHtml(shelfName(p.shelfId))}${p.level ? ` · ${escapeHtml(p.level)}` : ''}${p.price ? ` · ${escapeHtml(formatPrice(p.price))}` : ''}</div>
    <div class="row" style="margin-top:8px">
      ${moveTo && !here ? `<button type="button" class="primary" data-a="here">📦 העברה ל${escapeHtml(moveTo.name.split('·')[0].trim())}</button>` : ''}
      ${here ? '<span class="ok">✓ כבר במעבר הזה</span>' : ''}
      <button type="button" data-a="move">${moveTo ? 'מעבר אחר' : '📦 העברה'}</button>
      <button type="button" data-a="stock">${p.active === false ? '👁️ חזר למלאי' : '🙈 אזל'}</button>
    </div>`;
  item.append(canvas, body);
  const save = async (changes) => {
    try {
      Object.assign(p, await api(`/api/products/${p.id}`, { method: 'PUT', body: changes }));
      item.replaceWith(productCard(p));
    } catch (err) { alert(err.message); }
  };
  body.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'here') save({ shelfId: moveTo.id });
    if (a === 'stock') save({ active: p.active === false });
    if (a === 'move') {
      body.querySelector('.row').innerHTML = `
        <select data-f="shelfId" class="grow">${store.map.shelves.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === p.shelfId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
        <input data-f="level" class="grow" list="levels" value="${escapeHtml(p.level || '')}" placeholder="מיקום במדף">
        <button type="button" class="primary" data-a="save">שמירה</button>`;
    }
    if (a === 'save') save({ shelfId: body.querySelector('[data-f=shelfId]').value, level: body.querySelector('[data-f=level]').value });
  });
  return item;
}

// ---------- start ----------
async function start() {
  try {
    store = await api('/api/me');
  } catch {
    setToken(null);
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    return;
  }
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('store-name').textContent = `${store.name} · עובד`;
  document.body.insertAdjacentHTML('beforeend', '<datalist id="levels"><option value="מדף עליון"><option value="מדף אמצעי"><option value="מדף תחתון"><option value="בקצה המעבר"></datalist>');
  feed = createAlertsFeed({ list: $('alert-list'), count: $('alert-count'), store: () => store, title: 'עובד' });
  feed.load();
  setInterval(feed.load, 10000);
  moveTo = shelf(params.get('to')) || null;
  if (moveTo) {
    $('move-banner').textContent = `📍 אתה ב${moveTo.name}. בחר מוצר כדי להעביר אותו לכאן.`;
    $('move-banner').classList.remove('hidden');
    showTab('products');
    $('p-search').focus();
  }
}

if (getToken()) start();
else {
  $('login-view').classList.remove('hidden');
  if (params.get('store')) $('s-slug').value = params.get('store');
}
