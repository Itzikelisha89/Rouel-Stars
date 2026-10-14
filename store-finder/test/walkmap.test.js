const test = require('node:test');
const assert = require('node:assert/strict');

// a manager walking a supermarket: up aisle 1 from the door, across, down aisle 2, ... with the
// heading wobbling the way a phone's sensor does
function serpentine(Walk, { aisles = 6, length = 14, spacing = 4, wobble = 20, seed = 7 } = {}) {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const w = new Walk(0.7);
  const tilt = 23; // the store isn't aligned with north, and the phone doesn't care
  const go = (heading, meters) => { for (let i = 0; i < Math.round(meters / 0.7); i++) w.step(heading + tilt + (rnd() - 0.5) * 2 * wobble); };
  go(0, 2);
  for (let i = 0; i < aisles; i++) {
    go(i % 2 ? 180 : 0, length);
    if (i < aisles - 1) go(270, spacing);
  }
  return w;
}

test('walk to map: aisles, shelves between them, walls, every aisle reachable', async () => {
  const { Walk, buildMap, snapHeading } = await import('../public/js/walkmap.js');
  const { findPath } = await import('../public/js/map.js');
  assert.equal(snapHeading(100, 10), 1);
  assert.equal(snapHeading(5, 350), 0);
  assert.equal(snapHeading(170, 350), 2);
  for (const opts of [{}, { aisles: 9, spacing: 5, length: 20 }, { aisles: 4, spacing: 3, length: 10, wobble: 35, seed: 3 }]) {
    const walk = serpentine(Walk, opts);
    const points = walk.final();
    const { map, aisles, shelfFor } = buildMap(points);
    const n = opts.aisles || 6;
    assert.equal(aisles.length, n, 'one aisle per walked aisle');
    assert.ok(map.cols <= 120 && map.rows <= 120);
    for (const s of map.shelves) {
      assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= map.cols && s.y + s.h <= map.rows, `${s.name} inside the map`);
      assert.ok(!map.shelves.some((o) => o !== s && o.x < s.x + s.w && s.x < o.x + o.w && o.y < s.y + s.h && s.y < o.y + o.h), `${s.name} overlaps`);
      assert.ok(findPath(map, s), `walkable to ${s.name}`);
    }
    for (const a of aisles) assert.ok(a.shelfIds.length >= 1, `aisle ${a.n} has shelves`);
    assert.ok(map.shelves.some((s) => s.id === 'w-back'), 'back wall');
    // aisle 1 is at the door; a photo taken half way up aisle 2 belongs to aisle 2's shelves
    assert.deepEqual(shelfFor(points[Math.round(10 / 0.7)]), aisles[0].shelfIds);
    const e = map.entrance;
    assert.ok(!map.shelves.some((s) => e.x >= s.x && e.x < s.x + s.w && e.y >= s.y && e.y < s.y + s.h), 'door free');
  }
  assert.throws(() => buildMap([{ x: 0, y: 0, d: 0 }]), /קצר/);
});
