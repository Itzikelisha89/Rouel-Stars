const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + __dirname + '/index.html'); await p.evaluate(() => document.fonts.ready);
  const times = process.argv.slice(2).map(Number);
  for (const t of times) { await p.evaluate(t => render(t), t); await p.screenshot({ path: `shot_${t}.jpg`, quality: 70, type: 'jpeg' }); }
  await b.close();
})();
