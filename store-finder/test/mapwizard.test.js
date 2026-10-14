const test = require('node:test');
const assert = require('node:assert/strict');

test('quick map: valid, every aisle reachable from the door, names and ids kept', async () => {
  const { generateStoreMap } = await import('../public/js/mapwizard.js');
  const { findPath } = await import('../public/js/map.js');
  for (const entrance of ['right', 'center', 'left']) {
    for (const opts of [{ aisles: 8, length: 12 }, { aisles: 1, length: 3, backWall: false }, { aisles: 20, length: 30, walk: 3, checkouts: 8 }]) {
      const m = generateStoreMap({ ...opts, entrance, names: ['מוצרי חלב', 'מעבר 2 · לחמים'] });
      assert.ok(m.cols <= 120 && m.rows <= 120 && m.cols >= 5 && m.rows >= 5);
      const ids = new Set();
      for (const s of m.shelves) {
        assert.ok(!ids.has(s.id)); ids.add(s.id);
        assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= m.cols && s.y + s.h <= m.rows, `${s.name} inside`);
        assert.ok(!m.shelves.some((o) => o !== s && o.x < s.x + s.w && s.x < o.x + o.w && o.y < s.y + s.h && s.y < o.y + o.h), `${s.name} overlaps`);
        assert.ok(!(m.entrance.x >= s.x && m.entrance.x < s.x + s.w && m.entrance.y >= s.y && m.entrance.y < s.y + s.h), 'door is free');
      }
      for (const s of m.shelves) assert.ok(findPath(m, s), `${entrance}: path to ${s.name}`);
      const a = m.shelves.filter((s) => /^a\d+$/.test(s.id));
      assert.equal(a.length, opts.aisles);
      assert.equal(a[0].name, 'מעבר 1 · מוצרי חלב');
      if (a[1]) assert.equal(a[1].name, 'מעבר 2 · לחמים');
      // aisle 1 is the one nearest the door
      const near = [...a].sort((p, q) => Math.abs(p.x - m.entrance.x) - Math.abs(q.x - m.entrance.x))[0];
      if (entrance !== 'center') assert.equal(near.id, 'a1');
    }
  }
  // more aisles than fit in 120 m: as many as fit, never outside the map
  const big = generateStoreMap({ aisles: 40, length: 200, walk: 3 });
  assert.ok(big.cols <= 120 && big.rows <= 120);
  assert.equal(big.shelves.filter((s) => /^a\d+$/.test(s.id)).length, 23);
});
