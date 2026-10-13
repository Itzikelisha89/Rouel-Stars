const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-security-'));
process.env.REGISTRATION_CODE = 'pilot2026';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const app = require('../server');
const { db } = require('../db');

test('public-server safety: registration code, login limit, sessions, password change, export', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null), res };
  };
  try {
    assert.equal((await call('GET', '/healthz')).status, 200);
    assert.equal((await call('GET', '/api/config')).data.registrationCode, true);
    const store = { name: 'סניף', slug: 'secure-store', password: 'secret1' };
    assert.equal((await call('POST', '/api/stores', { body: store })).status, 403);
    assert.equal((await call('POST', '/api/stores', { body: { ...store, code: 'wrong' } })).status, 403);
    const { data: { token } } = await call('POST', '/api/stores', { body: { ...store, code: 'pilot2026' } });
    assert.ok(token);
    assert.equal((await call('GET', '/healthz')).res.headers.get('x-content-type-options'), 'nosniff');

    // Second device logs in; changing the password signs it out but keeps this one.
    const other = (await call('POST', '/api/login', { body: { slug: 'secure-store', password: 'secret1' } })).data.token;
    assert.equal((await call('PUT', '/api/store/settings', { token, body: { currentPassword: 'nope', newPassword: 'newpass1' } })).status, 403);
    assert.equal((await call('PUT', '/api/store/settings', { token, body: { name: 'סניף חדש', currentPassword: 'secret1', newPassword: 'newpass1' } })).status, 200);
    assert.equal((await call('GET', '/api/me', { token: other })).status, 401);
    assert.equal((await call('GET', '/api/me', { token })).data.name, 'סניף חדש');

    // Export opens in Excel (BOM) and uses the shelf name so it imports back.
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1 · סירים', x: 1, y: 1, w: 1, h: 5 }] } });
    await call('POST', '/api/products', { token, body: { name: 'סיר "גדול"', price: '99', shelfId: 'a1' } });
    const bytes = Buffer.from(await (await fetch(`${base}/api/products/export.csv`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM, so Excel reads Hebrew correctly
    const csv = bytes.subarray(3).toString('utf8');
    assert.ok(csv.startsWith('שם,מעבר'));
    assert.ok(csv.includes('"סיר ""גדול""","מעבר 1 · סירים"'));

    // Sessions expire after 30 days.
    db.prepare("UPDATE sessions SET created_at = datetime('now', '-31 days') WHERE token = ?").run(token);
    assert.equal((await call('GET', '/api/me', { token })).status, 401);

    // Password guessing is cut off.
    let last;
    for (let i = 0; i < 12; i++) last = await call('POST', '/api/login', { body: { slug: 'secure-store', password: `guess${i}` } });
    assert.equal(last.status, 429);
  } finally {
    server.close();
  }
});
