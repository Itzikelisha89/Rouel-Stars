const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-spot-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const app = require('../server');

test('video without AI keeps real shelf photos; the manager marks each product on one', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body, form } = {}) => {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: form || (body && JSON.stringify(body)) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const { data: { token } } = await call('POST', '/api/stores', { body: { name: 'מדפים', slug: 'spot-store', password: 'secret1' } });
    await call('PUT', '/api/store/map', { token, body: { cols: 10, rows: 8, entrance: { x: 5, y: 7 }, shelves: [
      { id: 'a1', name: 'מעבר 1', x: 1, y: 1, w: 1, h: 5 }, { id: 'a2', name: 'מעבר 2', x: 4, y: 1, w: 1, h: 5 }] } });
    const pot = (await call('POST', '/api/products', { token, body: { name: 'סיר', shelfId: 'a2' } })).data;

    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const form = new FormData();
    form.append('shelfId', 'a1');
    for (let i = 0; i < 20; i++) form.append('frames', new Blob([jpg], { type: 'image/jpeg' }), `f${i}.jpg`);
    const video = await call('POST', '/api/videos', { token, form });
    assert.equal(video.status, 200);
    assert.equal(video.data.ai, false);
    assert.equal(video.data.photos.length, 8); // a few frames along the aisle, not all twenty

    const photos = (await call('GET', '/api/photos?shelfId=a1', { token })).data;
    assert.equal(photos.length, 8);
    assert.equal(photos[0].products, 0);

    // a tap that's too small is refused; a real frame moves the product to the photo's aisle
    assert.equal((await call('PUT', `/api/products/${pot.id}/spot`, { token, body: { photoId: photos[0].id, box: { x0: 10, y0: 10, x1: 12, y1: 12 } } })).status, 400);
    const marked = (await call('PUT', `/api/products/${pot.id}/spot`, { token, body: { photoId: photos[0].id, box: { x0: 600, y0: 900, x1: 300, y1: 1400 } } })).data;
    assert.equal(marked.shelfId, 'a1');
    assert.equal(marked.photo, photos[0].url);
    assert.deepEqual(marked.box, { x0: 300, y0: 900, x1: 600, y1: 1000 });

    // the shopper sees that real photo with the product marked
    const shown = (await call('GET', `/api/public/spot-store/products/${pot.id}`)).data;
    assert.equal(shown.photo, photos[0].url);

    // deleting the photo clears the mark, so the product can be marked again
    await call('DELETE', `/api/photos/${photos[0].id}`, { token });
    const after = (await call('GET', `/api/public/spot-store/products/${pot.id}`)).data;
    assert.equal(after.photo, null);
    assert.equal(after.box, null);
    assert.equal((await call('GET', '/api/photos?shelfId=a1')).status, 401);
  } finally {
    server.close();
  }
});
