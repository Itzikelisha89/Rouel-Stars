// Map a store by walking it: the phone counts steps and follows turns, and the walk becomes the map.
// Supermarkets are built at right angles, so every heading snaps to one of four directions (relative
// to the way the manager faced at the door). That removes most of the drift of phone sensors.
//
// Walk: start at the door, go up and down every aisle to its end. The walked lines are the walkways;
// what lies between two neighbouring walkways is a shelf unit; past the outermost walkways and beyond
// the far cross-aisle are the walls. One map cell = 1 meter.

// 0 = straight ahead from the door (up on the map), 1 = right, 2 = back, 3 = left
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function snapHeading(heading, start) {
  return ((Math.round((((heading - start) % 360) + 360) % 360 / 90) % 4) + 4) % 4;
}

// The store's own orientation from every heading of the walk: headings folded onto 90° (4×angle),
// averaged on the circle. One wobbly first step can't tilt the whole map.
export function storeOrientation(headings) {
  let sx = 0, sy = 0;
  for (const h of headings) { const r = (h * 4 * Math.PI) / 180; sx += Math.sin(r); sy += Math.cos(r); }
  const base = ((Math.atan2(sx, sy) * 180) / Math.PI / 4 + 360) % 90;
  // of the four directions of the store, "ahead" is the one closest to how the walk began
  const first = headings.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, headings.length);
  return base + 90 * snapHeading(first, base);
}
export function trace(headings, stepLength, start = storeOrientation(headings)) {
  const points = [{ x: 0, y: 0, d: 0 }];
  for (const h of headings) {
    const d = snapHeading(h, start);
    const last = points[points.length - 1];
    points.push({ x: last.x + DIRS[d][0] * stepLength, y: last.y + DIRS[d][1] * stepLength, d });
  }
  return points;
}

// The walk as it happens: one call per detected step, with the phone's heading at that moment.
// (The live path uses the first heading; the final map re-reads the whole walk.)
export class Walk {
  constructor(stepLength = 0.7) {
    this.stepLength = stepLength;
    this.headings = [];
    this.points = [{ x: 0, y: 0, d: 0 }];
  }
  step(heading) {
    this.headings.push(heading);
    const d = snapHeading(heading, this.headings[0]);
    const last = this.points[this.points.length - 1];
    this.points.push({ x: last.x + DIRS[d][0] * this.stepLength, y: last.y + DIRS[d][1] * this.stepLength, d });
    return this.points[this.points.length - 1];
  }
  get here() { return this.points[this.points.length - 1]; }
  get meters() { return this.headings.length * this.stepLength; }
  final() { return trace(this.headings, this.stepLength); }
}

// straight runs of the walk: { d, a: start point, b: end point, len, c: the coordinate across the run }
function segmentsOf(points) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    const last = segs[segs.length - 1];
    if (last && last.d === p.d) { last.b = p; last.pts.push(p); } else segs.push({ d: p.d, a: q, b: p, pts: [q, p] });
  }
  for (const s of segs) {
    const vertical = s.d % 2 === 0;
    s.len = Math.abs(vertical ? s.b.y - s.a.y : s.b.x - s.a.x);
    s.c = s.pts.reduce((t, p) => t + (vertical ? p.x : p.y), 0) / s.pts.length;
    s.lo = Math.min(vertical ? s.a.y : s.a.x, vertical ? s.b.y : s.b.x);
    s.hi = Math.max(vertical ? s.a.y : s.a.x, vertical ? s.b.y : s.b.x);
  }
  return segs;
}

/**
 * Turn a walk into a store map.
 * @returns { map, aisles: [{ n, c, lo, hi, shelfIds }], shelfFor(point) -> shelf ids for a photo taken there }
 */
export function buildMap(points, { minAisle = 4 } = {}) {
  if (points.length < 10) throw new Error('המסלול קצר מדי. הולכים לאורך כל המעברים ולוחצים "סיימתי" בסוף.');
  const segs = segmentsOf(points);
  const along = (vertical) => segs.filter((s) => (s.d % 2 === 0) === vertical).reduce((t, s) => t + s.len, 0);
  const vertical = along(true) >= along(false); // the direction most of the walking went is the aisles' direction
  // in "u/v" terms: u runs along the aisles, v across them
  const runs = segs.filter((s) => (s.d % 2 === 0) === vertical && s.len >= minAisle);
  if (!runs.length) throw new Error('לא זוהו מעברים. הולכים לאורך כל מעבר עד הסוף שלו.');
  // walking the same aisle twice (up and back) is one aisle
  const lines = [];
  for (const s of [...runs].sort((a, b) => a.c - b.c)) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(s.c - l.c) <= 1.6) {
      l.c = (l.c * l.w + s.c * s.len) / (l.w + s.len); l.w += s.len;
      l.lo = Math.min(l.lo, s.lo); l.hi = Math.max(l.hi, s.hi);
    } else lines.push({ c: s.c, w: s.len, lo: s.lo, hi: s.hi });
  }
  // the door is where the walk started: aisle 1 is the one nearest to it
  const door = points[0];
  const doorV = vertical ? door.x : door.y, doorU = vertical ? door.y : door.x;
  [...lines].sort((a, b) => Math.abs(a.c - doorV) - Math.abs(b.c - doorV)).forEach((l, i) => { l.n = i + 1; });
  for (const l of lines) { l.c = Math.round(l.c); l.lo = Math.round(l.lo); l.hi = Math.round(l.hi); }

  // shelf units in u/v cells: { id, name, v0, v1 (inclusive), u0, u1 }
  const units = [];
  const faces = new Map(lines.map((l) => [l, []]));
  const add = (line, id, name, v0, v1, u0, u1) => {
    if (v1 < v0 || u1 - u0 < 1) return;
    units.push({ id, name: name.slice(0, 60), v0, v1, u0, u1 });
    faces.get(line)?.push(id);
  };
  const gapEnd = 2; // keep the cross-aisles at both ends of an aisle free
  // the side of aisle X that faces its neighbour Y: "צד א" towards lower numbers, "צד ב" towards higher
  const face = (X, Y) => ({ id: `a${X.n}-${Y.n > X.n ? 'b' : 'a'}`, name: `מעבר ${X.n} · ${Y.n > X.n ? 'צד ב' : 'צד א'}` });
  for (let i = 0; i < lines.length - 1; i++) {
    const A = lines[i], B = lines[i + 1];
    const gap = B.c - A.c;
    const u0 = Math.max(A.lo, B.lo) + gapEnd, u1 = Math.min(A.hi, B.hi) - gapEnd;
    if (gap < 3 || u1 - u0 < 1) continue;
    const half = gap >= 5 ? 1 : 0; // a meter of walkway on each side of the walked line
    if (gap > 9) { // open floor between them: a shelf along each walkway
      add(A, face(A, B).id, face(A, B).name, A.c + 1 + half, A.c + 2 + half, u0, u1);
      add(B, face(B, A).id, face(B, A).name, B.c - 2 - half, B.c - 1 - half, u0, u1);
      continue;
    }
    const v0 = A.c + 1 + half, v1 = B.c - 1 - half;
    const w = v1 - v0 + 1;
    if (w >= 2) { // a double-sided unit: each side belongs to the walkway it faces
      const mid = v0 + Math.floor(w / 2) - 1;
      add(A, face(A, B).id, face(A, B).name, v0, mid, u0, u1);
      add(B, face(B, A).id, face(B, A).name, mid + 1, v1, u0, u1);
    } else {
      add(A, `a${A.n}-${B.n}`, `מעבר ${Math.min(A.n, B.n)}–${Math.max(A.n, B.n)}`, v0, v1, u0, u1);
      faces.get(B).push(`a${A.n}-${B.n}`);
    }
  }
  // walls past the outermost walkways
  const first = lines[0], last = lines[lines.length - 1];
  add(first, `a${first.n}-w`, `מעבר ${first.n} · קיר`, first.c - 2, first.c - 2, first.lo, first.hi);
  if (last !== first) add(last, `a${last.n}-w`, `מעבר ${last.n} · קיר`, last.c + 2, last.c + 2, last.lo, last.hi);
  // the back wall, beyond the far cross-aisle (on the side away from the door)
  const farHigh = Math.abs(Math.max(...lines.map((l) => l.hi)) - doorU) > Math.abs(Math.min(...lines.map((l) => l.lo)) - doorU);
  const farU = farHigh ? Math.max(...lines.map((l) => l.hi)) + 2 : Math.min(...lines.map((l) => l.lo)) - 2;
  units.push({ id: 'w-back', name: 'קיר אחורי', v0: first.c - 2, v1: last.c + 2, u0: farU, u1: farU });

  // walked cells stay free: trim or drop any unit that covers the walk
  const walked = new Set(points.map((p) => `${Math.round(vertical ? p.x : p.y)},${Math.round(vertical ? p.y : p.x)}`));
  const covers = (u, vv, uu) => vv >= u.v0 && vv <= u.v1 && uu >= u.u0 && uu <= u.u1;
  const kept = units.filter((u) => {
    for (const k of walked) {
      const [vv, uu] = k.split(',').map(Number);
      if (!covers(u, vv, uu)) continue;
      if (uu - u.u0 < u.u1 - uu) u.u0 = uu + 1; else u.u1 = uu - 1; // shrink from the nearer end
      if (u.u1 < u.u0) return false;
    }
    return true;
  });

  // to map cells: a 1 m margin around everything, x/y from u/v
  const vs = [...kept.flatMap((u) => [u.v0, u.v1]), ...points.map((p) => Math.round(vertical ? p.x : p.y))];
  const us = [...kept.flatMap((u) => [u.u0, u.u1]), ...points.map((p) => Math.round(vertical ? p.y : p.x))];
  const vMin = Math.min(...vs) - 1, uMin = Math.min(...us) - 1;
  const vLen = Math.max(...vs) - vMin + 2, uLen = Math.max(...us) - uMin + 2;
  const cols = vertical ? vLen : uLen, rows = vertical ? uLen : vLen;
  if (cols > 120 || rows > 120) throw new Error(`יצא שטח של ${cols}×${rows} מטר, יותר מ-120 מטר. כדאי לבדוק את אורך הצעד ולנסות שוב.`);
  const toXY = (v, u) => (vertical ? { x: v - vMin, y: u - uMin } : { x: u - uMin, y: v - vMin });
  const shelves = kept.map((u) => {
    const a = toXY(u.v0, u.u0), b = toXY(u.v1, u.u1);
    return { id: u.id, name: u.name, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
  });
  const d0 = toXY(Math.round(vertical ? door.x : door.y), Math.round(vertical ? door.y : door.x));
  const keptIds = new Set(shelves.map((s) => s.id));
  const aisles = lines.map((l) => ({ n: l.n, c: l.c, lo: l.lo, hi: l.hi, shelfIds: faces.get(l).filter((id) => keptIds.has(id)) }))
    .sort((a, b) => a.n - b.n);
  // a photo taken while walking an aisle belongs to the shelves on both sides of it
  const shelfFor = (p) => {
    const v = vertical ? p.x : p.y, u = vertical ? p.y : p.x;
    const l = lines.find((x) => Math.abs(x.c - v) <= 1.6 && u >= x.lo - 1 && u <= x.hi + 1);
    return l ? aisles.find((a) => a.n === l.n).shelfIds : [];
  };
  return { map: { cols, rows, entrance: d0, shelves }, aisles, shelfFor, size: { width: cols, depth: rows } };
}
