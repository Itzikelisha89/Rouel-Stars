// בדיקת עשן: מריץ את כל הפריימים של הסרט ברזולוציה נמוכה ומדווח על שגיאות
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.end(fs.readFileSync(p)); });
srv.listen(0, async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 320, height: 180 } });
  await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?render=1&w=320&h=180`);
  await pg.waitForFunction(() => window.FILM_READY);
  const errs = await pg.evaluate(() => { const out = []; const n = Math.round(window.FILM_READY * 30); for (let f = 0; f < n; f++) { try { window.frameAt(f / 30); } catch (e) { out.push(`frame ${f} (t=${(f / 30).toFixed(2)}): ${e.message}`); } } return { n, out }; });
  console.log(`${errs.n} frames checked, ${errs.out.length} errors`); errs.out.slice(0, 20).forEach((e) => console.log(' ', e));
  await b.close(); srv.close(); process.exit(errs.out.length ? 1 : 0);
});
