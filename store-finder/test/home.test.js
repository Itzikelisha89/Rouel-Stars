const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-home-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const app = require('../server');

test('shopper home: trending searches, departments, aisle products, app manifest', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, type: res.headers.get('content-type'), data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'הבית · סניף', slug: 'home-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [
      { id: 'a1', name: 'מעבר 1 · מטבח', x: 1, y: 1, w: 1, h: 5 }, { id: 'a2', name: 'מעבר 2 · ריק', x: 4, y: 1, w: 1, h: 5 }] } });
    const add = async (body) => (await call('POST', '/api/products', { token, body })).data;
    await add({ name: 'סיר', shelfId: 'a1' });
    await add({ name: 'מחבת', shelfId: 'a1', promo: 'מבצע' });
    await add({ name: 'מוסתר', shelfId: 'a1', active: false });
    for (const q of ['סיר', 'סיר', 'מחבת', 'שולחן']) await call('GET', `/api/public/home-store/search?q=${encodeURIComponent(q)}`);

    const home = (await call('GET', '/api/public/home-store/home')).data;
    assert.deepEqual(home.trending, ['סיר', 'מחבת']); // most searched first, and only what we found
    assert.equal(home.categories.length, 1); // the empty aisle isn't shown
    assert.equal(home.categories[0].shelfId, 'a1');
    assert.equal(home.categories[0].count, 2);

    const aisle = (await call('GET', '/api/public/home-store/aisle/a1')).data;
    assert.deepEqual(aisle.map((p) => p.name), ['מחבת', 'סיר']); // deals first, hidden products left out

    const m = await call('GET', '/api/public/home-store/manifest.webmanifest');
    assert.match(m.type, /manifest\+json/);
    assert.equal(m.data.start_url, '/s/home-store');
    assert.equal((await call('GET', '/api/public/nope/home')).status, 404);
  } finally {
    server.close();
  }
});
