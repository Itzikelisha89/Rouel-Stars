const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-hq-'));
process.env.REGISTRATION_CODE = 'pilot2026';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const app = require('../server');

test('chain headquarters: off without HQ_PASSWORD, then branches side by side', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    delete process.env.HQ_PASSWORD;
    assert.equal((await call('POST', '/api/hq/login', { body: { password: 'x' } })).status, 404);
    process.env.HQ_PASSWORD = 'chain-secret';
    assert.equal((await call('POST', '/api/hq/login', { body: { password: 'nope' } })).status, 401);
    const { token } = (await call('POST', '/api/hq/login', { body: { password: 'chain-secret' } })).data;
    assert.equal((await call('GET', '/api/hq/overview')).status, 401);
    // A branch manager's token is not an HQ token.
    const branch = (await call('POST', '/api/stores', { body: { name: 'סניף ב', slug: 'branch-b', password: 'secret1', code: 'pilot2026' } })).data.token;
    assert.equal((await call('GET', '/api/hq/overview', { token: branch })).status, 401);
    await call('PUT', '/api/store/map', { token: branch, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }] } });
    await call('GET', `/api/public/branch-b/search?q=${encodeURIComponent('צידנית')}&v=visitor0001`);
    await call('POST', '/api/public/branch-b/events', { body: { type: 'request', query: 'צידניות', visitor: 'visitor0001' } });

    await call('POST', '/api/stores', { body: { name: 'סניף א', slug: 'branch-a', password: 'secret1', code: 'pilot2026' } });
    const r = await call('GET', '/api/hq/overview?days=7', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.stores.map((s) => s.slug).sort(), ['branch-a', 'branch-b']);
    const b = r.data.stores.find((s) => s.slug === 'branch-b');
    assert.equal(b.visitors, 1);
    assert.equal(b.requests, 1);
    assert.equal(r.data.chain.branches, r.data.stores.length);
    // "צידנית" searched and "צידניות" requested are one missing product.
    const cooler = r.data.missing.find((m) => m.query.startsWith('צידני'));
    assert.equal(cooler.count, 2);

    // Headquarters turns on the human voice; the key is checked with ElevenLabs and never sent back.
    delete process.env.ELEVENLABS_API_KEY;
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => (String(url).startsWith('https://api.elevenlabs.io')
      ? new Response('{}', { status: opts?.headers?.['xi-api-key'] === 'good_key_1234567890abcd' ? 200 : 401 })
      : realFetch(url, opts));
    try {
      assert.equal((await call('PUT', '/api/hq/voice', { token: branch, body: { key: 'x' } })).status, 401);
      assert.equal((await call('GET', '/api/public/branch-b')).data.premiumVoice, false);
      assert.equal((await call('PUT', '/api/hq/voice', { token, body: { key: 'bad_key_1234567890abcdef' } })).status, 400);
      assert.deepEqual((await call('PUT', '/api/hq/voice', { token, body: { key: 'good_key_1234567890abcd' } })).data, { set: true });
      const v = await call('GET', '/api/hq/voice', { token });
      assert.deepEqual(v.data, { set: true, fromServer: false });
      const pub = (await call('GET', '/api/public/branch-b')).data;
      assert.equal(pub.premiumVoice, true);
      assert.equal(pub.voiceInput, true);
      await call('PUT', '/api/hq/voice', { token, body: { key: '' } });
      // the same for the free Gemini key: checked with Google, then product recognition is on
      global.fetch = async (url, opts) => (String(url).startsWith('https://generativelanguage.googleapis.com')
        ? new Response('{}', { status: opts?.headers?.['x-goog-api-key'] === 'gemini_good_1234567890' ? 200 : 400 })
        : realFetch(url, opts));
      assert.equal((await call('PUT', '/api/hq/ai', { token, body: { key: 'gemini_bad_12345678901' } })).status, 400);
      assert.equal((await call('GET', '/api/public/branch-b')).data.photoSearch, false);
      assert.deepEqual((await call('PUT', '/api/hq/ai', { token, body: { key: 'gemini_good_1234567890' } })).data, { set: true });
      assert.equal((await call('GET', '/api/public/branch-b')).data.photoSearch, true);
      await call('PUT', '/api/hq/ai', { token, body: { key: '' } });
      assert.equal((await call('GET', '/api/public/branch-b')).data.photoSearch, false);
      assert.equal((await call('GET', '/api/public/branch-b')).data.premiumVoice, false);
    } finally { global.fetch = realFetch; }
  } finally {
    delete process.env.HQ_PASSWORD;
    server.close();
  }
});
