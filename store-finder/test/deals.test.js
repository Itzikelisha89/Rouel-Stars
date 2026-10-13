const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-deals-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const app = require('../server');

test('deals on the home screen and "shoppers also looked at"', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'מבצעים', slug: 'deals-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [
      { id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }, { id: 'a2', name: 'מעבר 2', x: 4, y: 1, w: 1, h: 5 }] } });
    const add = async (body) => (await call('POST', '/api/products', { token, body })).data;
    const bag = await add({ name: 'תיק גב', shelfId: 'a1', promo: '2 ב-150 ₪' });
    const box = await add({ name: 'קופסת אוכל', shelfId: 'a2' });
    const pen = await add({ name: 'קלמר', shelfId: 'a1' });
    await add({ name: 'מבצע מוסתר', shelfId: 'a1', promo: 'x', active: false });

    let r = await call('GET', '/api/public/deals-store/deals');
    assert.deepEqual(r.data.map((p) => p.name), ['תיק גב']);
    assert.equal(r.data[0].promo, '2 ב-150 ₪');

    // Not enough shoppers yet: same aisle.
    r = await call('GET', `/api/public/deals-store/products/${bag.id}/related`);
    assert.equal(r.data.kind, 'aisle');
    assert.deepEqual(r.data.products.map((p) => p.name), ['קלמר']);

    // Two shoppers opened both the bag and the lunch box.
    for (const v of ['shopperaaa1', 'shopperbbb2']) {
      for (const id of [bag.id, box.id]) await call('POST', '/api/public/deals-store/events', { body: { type: 'view', productId: id, visitor: v } });
    }
    r = await call('GET', `/api/public/deals-store/products/${bag.id}/related`);
    assert.equal(r.data.kind, 'together');
    assert.deepEqual(r.data.products.map((p) => p.name), ['קופסת אוכל']);
    assert.ok(pen.id);
  } finally {
    server.close();
  }
});
