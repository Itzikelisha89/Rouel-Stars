const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { report } = require('../pilot');

const now = new Date('2026-10-13T12:00:00Z');
const at = (min) => new Date(now.getTime() - min * 60000).toISOString().slice(0, 19).replace('T', ' ');

test('pilot report: shoppers, success rate, time to find, saved staff time', () => {
  const searches = [
    { query: 'סיר קטן', result_count: 3, visitor: 'aaaaaaaa', created_at: at(100) },
    { query: 'סיר קטן', result_count: 3, visitor: 'bbbbbbbb', created_at: at(50) },
    { query: 'צידנית', result_count: 0, visitor: 'bbbbbbbb', created_at: at(48) },
    { query: 'מצעים', result_count: 2, visitor: 'aaaaaaaa', created_at: at(60 * 24 * 3) }, // came back another day
    { query: 'ישן', result_count: 1, visitor: 'cccccccc', created_at: at(60 * 24 * 40) }, // outside 30 days
  ];
  const events = [
    { type: 'view', visitor: 'aaaaaaaa', product_id: 1, query: '', note: '', created_at: at(99) },
    { type: 'found', visitor: 'aaaaaaaa', product_id: 1, query: '', note: '', created_at: at(98) }, // 60s
    { type: 'view', visitor: 'bbbbbbbb', product_id: 2, query: '', note: '', created_at: at(49) },
    { type: 'found', visitor: 'bbbbbbbb', product_id: 2, query: '', note: '', created_at: at(47) }, // 120s
    { type: 'view', visitor: 'bbbbbbbb', product_id: 3, query: '', note: '', created_at: at(46) },
    { type: 'empty', visitor: 'bbbbbbbb', product_id: 3, query: '', note: '', created_at: at(45) },
    { type: 'help', visitor: 'bbbbbbbb', product_id: null, query: '', note: '', created_at: at(44), resolved_at: at(42) },
    { type: 'request', visitor: 'bbbbbbbb', product_id: null, query: 'צידנית', note: '0541234567', created_at: at(47) },
  ];
  const r = report(searches, events, { now, productNames: new Map([[3, 'מחבת']]) });
  assert.equal(r.visitors, 2);
  assert.equal(r.returning, 1);
  assert.equal(r.searches, 4);
  assert.equal(r.searchFoundRate, 75);
  assert.equal(r.found, 2);
  assert.equal(r.problems, 1);
  assert.equal(r.successRate, 67);
  assert.equal(r.medianSecondsToFind, 90);
  assert.equal(r.questionsSaved, 2);
  assert.equal(r.staffHoursSaved, 0.1);
  assert.equal(r.help, 1);
  assert.equal(r.medianHelpResponseSeconds, 120);
  assert.deepEqual(r.topRequests, [{ query: 'צידנית', count: 1, withPhone: 1 }]);
  assert.equal(r.problemProducts[0].name, 'מחבת');
  assert.equal(r.topSearches[0].query, 'סיר קטן');
  assert.equal(r.topSearches.find((q) => q.query === 'צידנית').found, 0);
  assert.equal(r.hours.reduce((a, b) => a + b), 4);
  assert.equal(r.daily.length, 31);
});

test('shopper events, live alerts and the pilot report over the API', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-pilot-'));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
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
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'פיילוט', slug: 'pilot-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }] } });
    const { data: pot } = await call('POST', '/api/products', { token, body: { name: 'סיר קטן', shelfId: 'a1' } });
    const v = 'visitor123';

    let r = await call('GET', `/api/public/pilot-store/search?q=${encodeURIComponent('סיר')}&v=${v}`);
    assert.equal(r.data.results.length, 1);
    const ev = (body) => call('POST', '/api/public/pilot-store/events', { body: { visitor: v, ...body } });
    assert.equal((await ev({ type: 'view', productId: pot.id })).status, 200);
    assert.equal((await ev({ type: 'found', productId: pot.id })).status, 200);
    assert.equal((await ev({ type: 'empty', productId: pot.id })).status, 200);
    assert.equal((await ev({ type: 'help', shelfId: 'a1' })).status, 200);
    assert.equal((await ev({ type: 'request', query: 'צידנית', phone: '054-123-4567' })).status, 200);
    assert.equal((await ev({ type: 'request', query: 'צידנית', phone: '12' })).status, 400);
    assert.equal((await ev({ type: 'request' })).status, 400);
    assert.equal((await ev({ type: 'found', productId: 99999 })).status, 400);
    assert.equal((await ev({ type: 'hack' })).status, 400);
    // into the cart: what they searched for, and one extra from the discovery route
    assert.equal((await ev({ type: 'cart', productId: pot.id, source: 'search' })).status, 200);
    assert.equal((await ev({ type: 'cart', productId: pot.id, source: 'detour' })).status, 200);
    assert.equal((await ev({ type: 'cart', productId: pot.id, source: '<script>' })).status, 200); // unknown source counts as search
    assert.equal((await ev({ type: 'cart' })).status, 400);
    // discovery route setting
    assert.equal((await call('PUT', '/api/store/settings', { token, body: { detourPct: 70 } })).status, 400);
    r = await call('PUT', '/api/store/settings', { token, body: { detourPct: 30 } });
    assert.equal(r.data.detourPct, 30);
    assert.equal((await call('GET', '/api/public/pilot-store')).data.detourPct, 30);

    assert.equal((await call('GET', '/api/alerts')).status, 401);
    r = await call('GET', '/api/alerts', { token });
    assert.deepEqual(r.data.map((a) => a.type).sort(), ['empty', 'help', 'request']);
    const help = r.data.find((a) => a.type === 'help');
    assert.equal(help.shelfId, 'a1');
    assert.equal(r.data.find((a) => a.type === 'request').phone, '0541234567');
    assert.equal(r.data.find((a) => a.type === 'empty').productName, 'סיר קטן');

    await call('POST', `/api/alerts/${help.id}/resolve`, { token });
    r = await call('GET', '/api/alerts', { token });
    assert.ok(r.data.find((a) => a.id === help.id).resolvedAt);

    r = await call('GET', '/api/pilot-report?days=7', { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.visitors, 1);
    assert.equal(r.data.searches, 1);
    assert.equal(r.data.found, 1);
    assert.equal(r.data.problems, 1);
    assert.equal(r.data.help, 1);
    assert.equal(r.data.requests, 1);
    assert.equal(r.data.days, 7);
    assert.equal(r.data.basket.items, 3);
    assert.equal(r.data.basket.extraItems, 1);
    assert.deepEqual(r.data.basket.bySource, { search: 2, detour: 1 });
    assert.equal(r.data.basket.topExtra[0].name, 'סיר קטן');
  } finally {
    server.close();
  }
});

test('pilot report: the bigger basket', () => {
  const ev = (visitor, product_id, note) => ({ type: 'cart', visitor, product_id, query: '', note, created_at: at(30) });
  const events = [ev('a', 1, 'search'), ev('a', 2, 'suggest'), ev('a', 3, 'detour'), ev('b', 1, 'search'), ev('c', 2, 'deal')];
  const r = report([], events, { now, productNames: new Map([[2, 'מגבת'], [3, 'נר']]) });
  assert.equal(r.basket.carts, 3);
  assert.equal(r.basket.items, 5);
  assert.equal(r.basket.avgItems, 1.7);
  assert.equal(r.basket.extraItems, 3);
  assert.equal(r.basket.extraShare, 60);
  assert.equal(r.basket.cartsWithExtraRate, 67);
  assert.equal(r.basket.topExtra[0].name, 'מגבת');
  assert.equal(r.basket.topExtra[0].count, 2);
});
