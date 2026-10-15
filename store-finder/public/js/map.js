// Store map: SVG rendering, shortest walking path (BFS on the grid), product photo crops.
const CELL = 20;
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function renderMap(svg, map, { targetShelfId = null, targetShelfIds = null, path = null, onShelfClick = null, here = null, stops = null, label = (s) => s.name, entranceLabel = 'כניסה' } = {}) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${map.cols * CELL} ${map.rows * CELL}`);
  const grid = el('g', { class: 'map-grid' }, svg);
  for (let x = 0; x <= map.cols; x++) el('line', { x1: x * CELL, y1: 0, x2: x * CELL, y2: map.rows * CELL }, grid);
  for (let y = 0; y <= map.rows; y++) el('line', { x1: 0, y1: y * CELL, x2: map.cols * CELL, y2: y * CELL }, grid);

  for (const s of map.shelves) {
    const isTarget = s.id === targetShelfId || targetShelfIds?.includes(s.id);
    const g = el('g', { class: `map-shelf${isTarget ? ' target' : ''}${onShelfClick ? ' selectable' : ''}`, 'data-id': s.id }, svg);
    el('rect', { x: s.x * CELL + 1, y: s.y * CELL + 1, width: s.w * CELL - 2, height: s.h * CELL - 2 }, g);
    const t = el('text', { x: (s.x + s.w / 2) * CELL, y: (s.y + s.h / 2) * CELL + 4, 'text-anchor': 'middle' }, g);
    t.textContent = label(s);
    if (s.h > s.w * 2 && s.h >= 3) t.setAttribute('transform', `rotate(-90 ${(s.x + s.w / 2) * CELL} ${(s.y + s.h / 2) * CELL})`);
    if (onShelfClick) g.addEventListener('click', (e) => { e.stopPropagation(); onShelfClick(s); });
  }

  if (path && path.length > 1) {
    el('polyline', { class: 'map-path', points: path.map((p) => `${p.x * CELL + CELL / 2},${p.y * CELL + CELL / 2}`).join(' ') }, svg);
  }

  // Numbered stops of a shopping-list route.
  for (const stop of stops || []) {
    const g2 = el('g', { class: stop.deal ? 'map-stop deal' : 'map-stop' }, svg);
    el('circle', { cx: stop.x * CELL + CELL / 2, cy: stop.y * CELL + CELL / 2, r: CELL * 0.8 }, g2);
    el('text', { x: stop.x * CELL + CELL / 2, y: stop.y * CELL + CELL / 2 + 5, 'text-anchor': 'middle' }, g2).textContent = stop.n;
  }

  if (here) {
    const h = el('g', { class: 'map-here' }, svg);
    el('circle', { cx: here.x * CELL + CELL / 2, cy: here.y * CELL + CELL / 2, r: CELL * 0.7 }, h);
  }

  const e = map.entrance;
  const g = el('g', { class: 'map-entrance' }, svg);
  el('circle', { cx: e.x * CELL + CELL / 2, cy: e.y * CELL + CELL / 2, r: CELL * 1.1 }, g);
  const t = el('text', { x: e.x * CELL + CELL / 2, y: e.y * CELL + CELL / 2 + 4, 'text-anchor': 'middle' }, g);
  t.textContent = entranceLabel;
  return svg;
}

export function cellFromEvent(svg, map, event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX; pt.y = event.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return {
    x: Math.max(0, Math.min(map.cols - 1, Math.floor(p.x / CELL))),
    y: Math.max(0, Math.min(map.rows - 1, Math.floor(p.y / CELL))),
  };
}

export function drawPreview(svg, a, b) {
  svg.querySelector('.map-preview')?.remove();
  if (!a) return;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  el('rect', { class: 'map-preview', x: x * CELL, y: y * CELL, width: (Math.abs(a.x - b.x) + 1) * CELL, height: (Math.abs(a.y - b.y) + 1) * CELL }, svg);
}

export function shelfAt(map, cell) {
  return map.shelves.find((s) => cell.x >= s.x && cell.x < s.x + s.w && cell.y >= s.y && cell.y < s.y + s.h);
}

// Shortest walk from the entrance to a free cell touching the shelf. Among routes of the same
// length it picks the one with the fewest turns (each turn costs a tiny extra), so directions read
// "straight 5 m, right 13 m" instead of a staircase. Dijkstra over (cell, heading); grids are small.
export function findPath(map, shelf, start = map.entrance) {
  const W = map.cols, H = map.rows, N = W * H;
  const blocked = new Uint8Array(N);
  for (const s of map.shelves) {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) blocked[y * W + x] = 1;
  }
  const goal = (x, y) => x >= shelf.x - 1 && x <= shelf.x + shelf.w && y >= shelf.y - 1 && y <= shelf.y + shelf.h &&
    !((x === shelf.x - 1 || x === shelf.x + shelf.w) && (y === shelf.y - 1 || y === shelf.y + shelf.h)); // no diagonal corners
  const DIRS = [[0, -1], [1, 0], [-1, 0], [0, 1]]; // up first: facing into the store
  const TURN = 0.001;
  const cost = new Float64Array(N * 4).fill(Infinity);
  const prev = new Int32Array(N * 4).fill(-1);
  const startIdx = start.y * W + start.x;
  const heap = []; // [cost, state]
  const push = (c, st) => { heap.push([c, st]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  cost[startIdx * 4] = 0; push(0, startIdx * 4); // start heading: up
  while (heap.length) {
    const [c, st] = pop();
    if (c > cost[st]) continue;
    const idx = st >> 2, d = st & 3, x = idx % W, y = (idx / W) | 0;
    if (idx !== startIdx && goal(x, y) && !blocked[idx]) {
      const path = [];
      for (let k = st; k !== -1; k = prev[k]) path.push({ x: (k >> 2) % W, y: ((k >> 2) / W) | 0 });
      return path.reverse();
    }
    if (idx === startIdx && goal(x, y)) return [{ x, y }];
    DIRS.forEach(([dx, dy], nd) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      const n = ny * W + nx;
      if (blocked[n]) return;
      const ns = n * 4 + nd, nc = c + 1 + (nd !== d ? TURN : 0);
      if (nc < cost[ns]) { cost[ns] = nc; prev[ns] = st; push(nc, ns); }
    });
  }
  return null;
}

// Order a shopping list by walking distance: from where the shopper stands, always go to the
// nearest remaining aisle next (nearest neighbour; for a handful of aisles it matches the optimum
// closely and is instant on a phone). Items on the same aisle are picked up in one stop.
export function planRoute(map, shelves, start = map.entrance) {
  const remaining = [...new Map(shelves.map((s) => [s.id, s])).values()];
  const legs = [];
  let at = start;
  while (remaining.length) {
    let best = null;
    for (const s of remaining) {
      const p = findPath(map, s, at);
      if (p && (!best || p.length < best.path.length)) best = { shelf: s, path: p };
    }
    if (!best) break; // the rest are unreachable on this map
    legs.push(best);
    remaining.splice(remaining.indexOf(best.shelf), 1);
    at = best.path[best.path.length - 1];
  }
  const path = legs.flatMap((l, i) => (i ? l.path.slice(1) : l.path));
  return { legs, path, meters: Math.max(0, path.length - 1), unreachable: remaining };
}

// The aisle-end spot a shopper stands on when scanning that aisle's QR sticker:
// the free cell next to the shelf that is closest to the entrance.
export function aisleSpot(map, shelf) {
  const p = findPath(map, shelf);
  return p ? p[p.length - 1] : null;
}

// Where the shelf is, as codes the caller translates: side left/right/center, depth near/mid/far.
export function describeLocation(map, shelf) {
  const cx = shelf.x + shelf.w / 2, cy = shelf.y + shelf.h / 2;
  const side = cx < map.cols / 3 ? 'left' : cx > (map.cols * 2) / 3 ? 'right' : 'center';
  const depth = Math.abs(cy - map.entrance.y) < map.rows / 3 ? 'near' : Math.abs(cy - map.entrance.y) > (map.rows * 2) / 3 ? 'far' : 'mid';
  return { side, depth };
}

// Draw the product's bounding box from its shelf photo onto a canvas.
const imageCache = new Map();
function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

export async function drawCrop(canvas, photoUrl, box, size = 240) {
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  // no photo yet (e.g. a product imported from the catalog): a soft tile with a shopping bag
  const placeholder = () => {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#2a3566'); g.addColorStop(1, '#1a2246');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    ctx.font = `${Math.round(size * 0.42)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🛍️', size / 2, size / 2 + size * 0.03);
  };
  if (!photoUrl) return placeholder();
  try {
    const img = await loadImage(photoUrl);
    const b = box || { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    const pad = 30;
    let sx = Math.max(0, b.x0 - pad) / 1000 * img.width;
    let sy = Math.max(0, b.y0 - pad) / 1000 * img.height;
    let sw = (Math.min(1000, b.x1 + pad) / 1000 * img.width) - sx;
    let sh = (Math.min(1000, b.y1 + pad) / 1000 * img.height) - sy;
    const scale = Math.min(size / sw, size / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);
  } catch { placeholder(); }
}

// Turn a walking path (grid cells) into spoken-style directions: go straight N m, turn right/left and
// go N m, and on which hand the shelf will be at the end. Screen coordinates: y grows downwards,
// so the cross product of two headings is positive for a right turn.
export function directions(map, path, shelf) {
  if (!path || path.length < 2) return { steps: [], side: 'front' };
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    const last = segs[segs.length - 1];
    if (last && last.dx === dx && last.dy === dy) last.n++;
    else segs.push({ dx, dy, n: 1 });
  }
  const steps = segs.map((s, i) => {
    const p = i ? segs[i - 1] : { dx: 0, dy: -1 }; // standing at the entrance, facing into the store
    const cross = p.dx * s.dy - p.dy * s.dx;
    return { turn: cross > 0 ? 'right' : cross < 0 ? 'left' : 'straight', meters: s.n };
  });
  // Which hand is the shelf on, facing the last direction of walking?
  const end = path[path.length - 1], h = segs[segs.length - 1];
  const cx = Math.max(shelf.x, Math.min(end.x, shelf.x + shelf.w - 1)) - end.x;
  const cy = Math.max(shelf.y, Math.min(end.y, shelf.y + shelf.h - 1)) - end.y;
  const cross = h.dx * cy - h.dy * cx;
  const side = cross > 0 ? 'right' : cross < 0 ? 'left' : 'front';
  return { steps, side };
}
