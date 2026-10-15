const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('buying from the couch: pickup orders for the staff, the daily treasure hunt and its prize', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-couch-'));
  const app = require('../server');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'ספה', slug: 'couch-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }] } });
    const ids = [];
    for (const [name, price] of [['סיר קטן', '49.90'], ['מגבת', '20'], ['נר', '2 ב-25'], ['ספל', '15']]) {
      ids.push((await call('POST', '/api/products', { token, body: { name, shelfId: 'a1', price } })).data.id);
    }
    const v = 'visitor12345';

    // a pickup order: phone required, prices from the catalog, the staff see it
    assert.equal((await call('POST', '/api/public/couch-store/orders', { body: { visitor: v, items: [{ id: ids[0] }] } })).status, 400);
    assert.equal((await call('POST', '/api/public/couch-store/orders', { body: { visitor: v, phone: '0541234567', items: [] } })).status, 400);
    let r = await call('POST', '/api/public/couch-store/orders', { body: { visitor: v, name: 'דנה', phone: '054-123-4567', items: [{ id: ids[0] }, { id: ids[1], qty: 2 }, { id: ids[2] }, { id: 99999 }] } });
    assert.equal(r.status, 200);
    assert.match(r.data.code, /^\d{4}$/);
    assert.equal(r.data.total, 89.9); // 49.90 + 2 × 20; a deal text adds nothing
    assert.equal(r.data.reward, '');
    assert.equal((await call('GET', '/api/orders')).status, 401);
    let orders = (await call('GET', '/api/orders', { token })).data;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].items.length, 3);
    assert.equal(orders[0].status, 'new');
    assert.equal((await call('POST', `/api/orders/${orders[0].id}/ready`, { token })).status, 200);
    assert.equal((await call('GET', '/api/orders', { token })).data[0].status, 'ready');
    await call('POST', `/api/orders/${orders[0].id}/done`, { token });
    assert.equal((await call('POST', `/api/orders/${orders[0].id}/lost`, { token })).status, 400);
    const rep = (await call('GET', '/api/pilot-report?days=7', { token })).data;
    assert.deepEqual(rep.couch, { orders: 1, value: 90, collected: 1 });

    // the treasure hunt: off until the manager sets a prize
    assert.equal((await call('GET', '/api/public/couch-store/hunt')).data.on, false);
    r = await call('PUT', '/api/store/settings', { token, body: { huntReward: '10% הנחה' } });
    assert.equal(r.data.huntReward, '10% הנחה');
    const h = (await call('GET', '/api/public/couch-store/hunt')).data;
    assert.equal(h.on, true);
    assert.equal(h.ids.length, 3);
    assert.equal(new Set(h.ids).size, 3);
    assert.deepEqual((await call('GET', '/api/public/couch-store/hunt')).data.ids, h.ids); // the same for everyone today
    assert.equal((await call('POST', '/api/public/couch-store/hunt', { body: { visitor: v, found: h.ids.slice(0, 2) } })).status, 400);
    r = await call('POST', '/api/public/couch-store/hunt', { body: { visitor: v, found: h.ids } });
    assert.equal(r.status, 200);
    const code = r.data.code;
    // the prize rides on an order with this phone's code, not with someone else's
    r = await call('POST', '/api/public/couch-store/orders', { body: { visitor: 'someoneelse1', phone: '0541234567', items: [{ id: ids[3] }], huntCode: code } });
    assert.equal(r.data.reward, '');
    r = await call('POST', '/api/public/couch-store/orders', { body: { visitor: v, phone: '0541234567', items: [{ id: ids[3] }], huntCode: code.toLowerCase() } });
    assert.equal(r.data.reward, '10% הנחה');

    // "added to N carts this week" comes from real cart events
    for (const who of ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3']) await call('POST', '/api/public/couch-store/events', { body: { type: 'cart', visitor: who, productId: ids[0], source: 'tour' } });
    const tour = (await call('GET', '/api/public/couch-store/tour')).data;
    assert.equal(tour[0].products.find((p) => p.id === ids[0]).carts, 3);
  } finally {
    server.close();
  }
});
