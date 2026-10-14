const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'store-finder-tts-'));
process.env.TTS_DAILY_CHARS = '60';
delete process.env.ELEVENLABS_API_KEY;
const app = require('../server');

test('premium voice: off without a key, cached per sentence, daily cap', async () => {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = global.fetch;
  const sent = [];
  const call = (url, body) => realFetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await realFetch(`${base}/api/stores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'קול', slug: 'voice-store', password: 'secret1' }) });
    assert.equal((await (await realFetch(`${base}/api/public/voice-store`)).json()).premiumVoice, false);
    assert.equal((await call('/api/public/voice-store/tts', { text: 'שלום' })).status, 503);

    process.env.ELEVENLABS_API_KEY = 'test-key';
    global.fetch = async (url, opts) => {
      if (!String(url).includes('api.elevenlabs.io')) return realFetch(url, opts);
      sent.push(JSON.parse(opts.body));
      return new Response(Buffer.from('ID3fake-mp3'), { status: 200 });
    };
    assert.equal((await (await realFetch(`${base}/api/public/voice-store`)).json()).premiumVoice, true);
    let r = await call('/api/public/voice-store/tts', { text: 'סיר ORIENT 20 ס"מ. מעבר 4, 5 מ׳', lang: 'he' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal(sent[0].text, 'סיר ORIENT 20 סנטימטר. מעבר 4, 5 מטר');
    assert.equal(sent[0].language_code, 'he');
    assert.equal(sent[0].model_id, 'eleven_v3');
    // the same sentence again comes from disk, no second call
    r = await call('/api/public/voice-store/tts', { text: 'סיר ORIENT 20 ס"מ. מעבר 4, 5 מ׳', lang: 'he' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    // daily cap (60 chars): a long new sentence is refused, the phone's voice takes over
    r = await call('/api/public/voice-store/tts', { text: 'משפט חדש וארוך מספיק כדי לעבור את התקרה היומית שהוגדרה לבדיקה', lang: 'he' });
    assert.equal(r.status, 429);
    assert.equal(sent.length, 1);
  } finally {
    global.fetch = realFetch;
    delete process.env.ELEVENLABS_API_KEY;
    server.close();
  }
});
