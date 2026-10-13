const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-staff-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.REGISTRATION_CODE;
const app = require('../server');

test('workers: sign in with the code, handle alerts, move products, nothing more', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'עובדים', slug: 'staff-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [
      { id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }, { id: 'a2', name: 'מעבר 2', x: 4, y: 1, w: 1, h: 5 }] } });
    const pot = (await call('POST', '/api/products', { token, body: { name: 'סיר', shelfId: 'a1', price: '50', promo: 'מבצע' } })).data;

    // No code yet: workers can't sign in.
    assert.equal((await call('POST', '/api/staff/login', { body: { slug: 'staff-store', pin: '2468' } })).status, 401);
    assert.equal((await call('PUT', '/api/store/settings', { token, body: { staffPin: '12' } })).status, 400);
    assert.equal((await call('PUT', '/api/store/settings', { token, body: { staffPin: '2468' } })).status, 200);
    assert.equal((await call('GET', '/api/me', { token })).data.staffPinSet, true);
    assert.equal((await call('POST', '/api/staff/login', { body: { slug: 'staff-store', pin: '1111' } })).status, 401);
    const staff = (await call('POST', '/api/staff/login', { body: { slug: 'staff-store', pin: '2468' } })).data.token;

    const me = (await call('GET', '/api/me', { token: staff })).data;
    assert.equal(me.role, 'staff');
    assert.equal((await call('GET', '/api/products', { token: staff })).status, 200);
    assert.equal((await call('GET', '/api/alerts', { token: staff })).status, 200);

    // Move + out of stock work; price/name/promo changes are ignored for workers.
    const r = await call('PUT', `/api/products/${pot.id}`, { token: staff, body: { shelfId: 'a2', level: 'מדף תחתון', active: false, name: 'שונה', price: '1', promo: '' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.shelfId, 'a2');
    assert.equal(r.data.level, 'מדף תחתון');
    assert.equal(r.data.active, false);
    assert.equal(r.data.name, 'סיר');
    assert.equal(r.data.price, '50');
    assert.equal(r.data.promo, 'מבצע');

    // Manager-only.
    for (const [m, u, body] of [['DELETE', `/api/products/${pot.id}`], ['POST', '/api/products', { name: 'x', shelfId: 'a1' }],
      ['PUT', '/api/store/map', { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [] }], ['GET', '/api/pilot-report'],
      ['GET', '/api/insights'], ['PUT', '/api/store/settings', { staffPin: '9999' }], ['GET', '/api/products/export.csv']]) {
      assert.equal((await call(m, u, { token: staff, body })).status, 403, `${m} ${u}`);
    }

    // A new code signs workers out.
    await call('PUT', '/api/store/settings', { token, body: { staffPin: '1357' } });
    assert.equal((await call('GET', '/api/me', { token: staff })).status, 401);
    assert.equal((await call('GET', '/api/me', { token })).status, 200);
  } finally {
    server.close();
  }
});
