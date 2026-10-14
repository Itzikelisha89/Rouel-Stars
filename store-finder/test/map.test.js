const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The browser map module (public/js/map.js): routes, the shopping-list order and turn-by-turn directions.
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'map.js')).href);
const MAP = {
  cols: 40, rows: 25, entrance: { x: 20, y: 24 },
  shelves: [34, 29, 24, 19, 14, 9, 4].map((x, i) => ({ id: `a${i + 1}`, name: `מעבר ${i + 1}`, x, y: 4, w: 2, h: 15 })),
};

test('the customer page gets every map function it imports', async () => {
  const m = await load();
  for (const name of ['renderMap', 'findPath', 'describeLocation', 'drawCrop', 'aisleSpot', 'planRoute', 'directions']) {
    assert.equal(typeof m[name], 'function', name);
  }
});

test('routes walk into the store first and turn as little as possible', async () => {
  const { findPath, directions } = await load();
  const a7 = MAP.shelves[6];
  const p = findPath(MAP, a7);
  assert.equal(p.length - 1, 20);
  assert.deepEqual(directions(MAP, p, a7), { steps: [{ turn: 'straight', meters: 5 }, { turn: 'left', meters: 15 }], side: 'right' });
  const a1 = MAP.shelves[0];
  assert.deepEqual(directions(MAP, findPath(MAP, a1), a1).steps.map((s) => s.turn), ['straight', 'right']);
  const a4 = MAP.shelves[3];
  assert.deepEqual(directions(MAP, findPath(MAP, a4), a4), { steps: [{ turn: 'straight', meters: 5 }], side: 'front' });
});

test('shopping list is ordered by the shortest walk', async () => {
  const { planRoute } = await load();
  const [a3, a4, a6] = [MAP.shelves[2], MAP.shelves[3], MAP.shelves[5]];
  const r = planRoute(MAP, [a6, a3, a4, a3]);
  assert.deepEqual(r.legs.map((l) => l.shelf.id), ['a4', 'a3', 'a6']);
  assert.ok(r.meters > 0);
});
