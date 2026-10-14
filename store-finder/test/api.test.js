const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-test-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
const app = require('../server');

let base, server;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
  return { status: res.status, data: await res.json().catch(() => null), res };
}

const MAP = {
  cols: 10, rows: 8, entrance: { x: 5, y: 7 },
  shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }, { id: 'a2', name: 'מעבר 2', x: 4, y: 1, w: 1, h: 5 }],
};
// 1x1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test('full owner -> customer flow', async () => {
  let r = await call('POST', '/api/stores', { body: { name: 'כלי בית', slug: 'kli-bait', password: 'secret1' } });
  assert.equal(r.status, 200);
  const token = r.data.token;

  r = await call('POST', '/api/stores', { body: { name: 'x', slug: 'kli-bait', password: 'secret1' } });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/login', { body: { slug: 'kli-bait', password: 'wrong!!' } });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/products');
  assert.equal(r.status, 401);

  r = await call('PUT', '/api/store/map', { token, body: { ...MAP, shelves: [{ id: 'bad', name: 'x', x: 9, y: 0, w: 3, h: 1 }] } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/store/map', { token, body: MAP });
  assert.equal(r.status, 200);

  // Photo upload without an API key: stored, no AI products, clear message.
  const form = new FormData();
  form.append('shelfId', 'a2');
  form.append('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'shelf.jpg');
  r = await call('POST', '/api/photos', { token, form });
  assert.equal(r.status, 200);
  assert.match(r.data.aiError, /Gemini/);
  const photoId = r.data.photo.id;
  assert.equal((await fetch(base + r.data.photo.url)).status, 200);

  r = await call('POST', '/api/products', { token, body: { name: 'סיר נירוסטה 16 ס"מ', keywords: 'סיר קטן, סירים', level: 'מדף שני', shelfId: 'a2', photoId } });
  assert.equal(r.status, 200);
  const potId = r.data.id;
  r = await call('POST', '/api/products', { token, body: { name: 'מחבת', shelfId: 'nope' } });
  assert.equal(r.status, 400);

  // Customer side
  r = await call('GET', '/api/public/kli-bait');
  assert.equal(r.data.name, 'כלי בית');
  assert.equal(r.data.password_hash, undefined);
  r = await call('GET', `/api/public/kli-bait/search?q=${encodeURIComponent('סיר קטן')}`);
  assert.equal(r.data.results.length, 1);
  assert.equal(r.data.results[0].shelfId, 'a2');
  assert.match(r.data.results[0].photo, /^\/uploads\//);
  await call('GET', `/api/public/kli-bait/search?q=${encodeURIComponent('אופניים')}`);

  r = await call('GET', '/api/insights', { token });
  assert.equal(r.data.total, 2);
  assert.equal(r.data.missing[0].label, 'אופניים');
  assert.equal(r.data.foundRate, 50);
  assert.ok(Array.isArray(r.data.upcoming) && r.data.upcoming.length >= 5);

  r = await call('GET', `/api/public/kli-bait/products/${potId}`);
  assert.equal(r.data.name, 'סיר נירוסטה 16 ס"מ');
  assert.equal(r.data.shelfId, 'a2');
  r = await call('GET', '/api/public/other-store/products/1');
  assert.equal(r.status, 404);
  const aisleQr = await fetch(`${base}/api/public/kli-bait/qr.svg?at=a1`);
  assert.equal(aisleQr.status, 200);
  assert.equal((await fetch(`${base}/api/public/kli-bait/qr.svg?at=nope`)).status, 404);

  const qr = await fetch(`${base}/api/public/kli-bait/qr.svg`);
  assert.match(await qr.text(), /<svg/);
  assert.equal((await fetch(`${base}/s/kli-bait`)).status, 200);

  // Another store cannot touch this store's products.
  r = await call('POST', '/api/stores', { body: { name: 'אחר', slug: 'other', password: 'secret2' } });
  const other = r.data.token;
  r = await call('PUT', `/api/products/${potId}`, { token: other, body: { name: 'hacked' } });
  assert.equal(r.status, 404);

  // Removing a shelf from the map removes its products.
  r = await call('PUT', '/api/store/map', { token, body: { ...MAP, shelves: [MAP.shelves[0]] } });
  assert.equal(r.data.removedProducts, 1);
});

test('catalog import matches shelves by name or aisle number', async () => {
  let r = await call('POST', '/api/stores', { body: { name: 'יבוא', slug: 'import-test', password: 'secret1' } });
  const token = r.data.token;
  await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 },
    shelves: [{ id: 's4', name: 'מעבר 4 · פחים', x: 1, y: 1, w: 1, h: 5 }, { id: 's14', name: 'מעבר 14', x: 4, y: 1, w: 1, h: 5 }] } });
  r = await call('POST', '/api/products/import', { token, body: { rows: [
    { name: 'פח סנסור DUBLIN', shelf: '4', price: '199.90', keywords: 'פח אשפה' },
    { name: 'סל כביסה', shelf: 'מעבר 14' },
    { name: 'ואזה', shelf: '9' },
    { name: '', shelf: '4' },
  ] } });
  assert.equal(r.data.added, 2);
  assert.equal(r.data.skippedCount, 2);
  r = await call('GET', '/api/products', { token });
  const bin = r.data.find((p) => p.name === 'פח סנסור DUBLIN');
  assert.equal(bin.shelfId, 's4');
  assert.equal(bin.price, '199.90');
  assert.equal(r.data.find((p) => p.name === 'סל כביסה').shelfId, 's14');
});
