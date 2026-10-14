const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-products-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.GEMINI_API_KEY;
const app = require('../server');
const ai = require('../ai');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test('manager adds products by hand: free text, own photo, hide from shoppers', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body, form } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'ידני', slug: 'manual-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }] } });

    let r = await call('POST', '/api/products', { token, body: { name: 'מחבת 28', description: 'ציפוי קרמי\nמתאים לאינדוקציה', price: '89.90', level: 'מדף תחתון', keywords: 'מחבת, טיגון', shelfId: 'a1' } });
    assert.equal(r.status, 200);
    const pan = r.data;
    assert.equal(pan.description, 'ציפוי קרמי\nמתאים לאינדוקציה');
    assert.equal(pan.active, true);
    assert.equal(pan.image, null);

    const form = new FormData();
    form.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'pan.jpg');
    r = await call('POST', `/api/products/${pan.id}/image`, { token, form });
    assert.equal(r.status, 200);
    assert.match(r.data.image, /^\/uploads\/.+\.jpg$/);
    assert.equal((await fetch(base + r.data.image)).status, 200);
    const firstImage = r.data.image;

    r = await call('GET', `/api/public/manual-store/search?q=${encodeURIComponent('מחבת')}`);
    assert.equal(r.data.results.length, 1);
    assert.equal(r.data.results[0].image, firstImage);

    // Hidden products disappear for shoppers but stay in the manager's list.
    r = await call('PUT', `/api/products/${pan.id}`, { token, body: { active: false } });
    assert.equal(r.data.active, false);
    assert.equal(r.data.price, '89.90');
    r = await call('GET', `/api/public/manual-store/search?q=${encodeURIComponent('מחבת')}`);
    assert.equal(r.data.results.length, 0);
    assert.equal((await call('GET', `/api/public/manual-store/products/${pan.id}`)).status, 404);
    r = await call('GET', '/api/products', { token });
    assert.equal(r.data.length, 1);
    await call('PUT', `/api/products/${pan.id}`, { token, body: { active: true } });

    r = await call('DELETE', `/api/products/${pan.id}/image`, { token });
    assert.equal(r.data.image, null);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal((await fetch(base + firstImage)).status, 404);
    assert.equal((await call('POST', `/api/products/99999/image`, { token, form })).status, 404);
  } finally {
    server.close();
  }
});

test('Gemini (free tier) is used when only GEMINI_API_KEY is set', async () => {
  assert.equal(ai.provider(), null);
  process.env.GEMINI_API_KEY = 'test-key';
  const realFetch = global.fetch;
  let sent;
  global.fetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ products: [
      { name: 'סיר קטן', description: 'נירוסטה', keywords: ['סיר'], level: 'מדף עליון', box: { x0: 900, y0: 10, x1: 100, y1: 1200 } },
    ] }) }] } }] }), { status: 200 });
  };
  try {
    assert.equal(ai.provider(), 'gemini');
    const products = await ai.detectProducts(JPEG, 'image/jpeg', 'מעבר 4');
    assert.match(sent.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    assert.equal(sent.opts.headers['x-goog-api-key'], 'test-key');
    assert.equal(sent.body.generationConfig.responseSchema.type, 'OBJECT');
    assert.equal(sent.body.generationConfig.responseSchema.properties.products.items.properties.box.type, 'OBJECT');
    assert.ok(!JSON.stringify(sent.body.generationConfig.responseSchema).includes('additionalProperties'));
    assert.equal(sent.body.contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
    assert.deepEqual(products[0].box, { x0: 100, y0: 10, x1: 900, y1: 1000 });

    global.fetch = async () => new Response('{}', { status: 429 });
    await assert.rejects(ai.detectProducts(JPEG, 'image/jpeg', 'x'), /המכסה החינמית/);
  } finally {
    global.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('photo of a single product -> name, description and many search words', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const realFetch = global.fetch;
  let body;
  global.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
      found: true, name: 'סיר יצקת 20 ס"מ', description: 'סיר שחור עם מכסה',
      keywords: ['סיר', 'סירים', 'סיר קטן', 'סיר למרק', 'סיר', 'כלים לפסח', 'pot'],
    }) }] } }] }), { status: 200 });
  };
  try {
    const r = await ai.identifyProduct(JPEG, 'image/jpeg');
    assert.equal(r.found, true);
    assert.equal(r.name, 'סיר יצקת 20 ס"מ');
    assert.deepEqual(r.keywords, ['סיר', 'סירים', 'סיר קטן', 'סיר למרק', 'כלים לפסח', 'pot']); // de-duplicated
    assert.match(body.systemInstruction.parts[0].text, /שימושים/);
    assert.ok(body.generationConfig.responseSchema.required.includes('keywords'));
  } finally {
    global.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('aisle video: frames in one request, products saved on the clearest frame', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = global.fetch;
  let geminiBody;
  global.fetch = async (url, opts) => {
    if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, opts);
    geminiBody = JSON.parse(opts.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ products: [
      { name: 'סיר קטן', description: '', keywords: ['סיר'], level: 'מדף תחתון', frame: 2, box: { x0: 10, y0: 10, x1: 200, y1: 300 } },
      { name: 'סיר קטן', description: '', keywords: ['סיר'], level: 'מדף תחתון', frame: 3, box: { x0: 10, y0: 10, x1: 200, y1: 300 } },
      { name: 'מחבת', description: '', keywords: ['מחבת'], level: 'מדף עליון', frame: 2, box: { x0: 300, y0: 10, x1: 500, y1: 200 } },
      { name: 'פריים לא קיים', description: '', keywords: [], level: '', frame: 99, box: { x0: 0, y0: 0, x1: 1, y1: 1 } },
    ] }) }] } }] }), { status: 200 });
  };
  const call = async (method, url, { token, body, form } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await realFetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'וידאו', slug: 'video-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [{ id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }] } });
    const form = () => {
      const f = new FormData();
      f.append('shelfId', 'a1');
      for (let i = 0; i < 4; i++) f.append('frames', new Blob([JPEG], { type: 'image/jpeg' }), `f${i}.jpg`);
      return f;
    };
    const noKey = await call('POST', '/api/videos', { token, form: form() }); // no key yet: real shelf photos only
    assert.equal(noKey.status, 200);
    assert.equal(noKey.data.ai, false);
    assert.equal(noKey.data.photos.length, 4);
    assert.deepEqual(noKey.data.products, []);

    process.env.GEMINI_API_KEY = 'test-key';
    const r = await call('POST', '/api/videos', { token, form: form() });
    assert.equal(r.status, 200);
    assert.equal(r.data.frames, 4);
    assert.deepEqual(r.data.products.map((p) => p.name), ['סיר קטן', 'מחבת']); // duplicate and bad frame dropped
    assert.equal(r.data.keptFrames, 1);
    assert.equal(r.data.products[0].photo, r.data.products[1].photo);
    assert.equal(geminiBody.contents[0].parts.filter((p) => p.inline_data).length, 4);
    assert.ok(geminiBody.generationConfig.responseSchema.properties.products.items.required.includes('frame'));
    const s = await call('GET', `/api/public/video-store/search?q=${encodeURIComponent('סיר')}`);
    assert.equal(s.data.results[0].name, 'סיר קטן');
  } finally {
    global.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    server.close();
  }
});
