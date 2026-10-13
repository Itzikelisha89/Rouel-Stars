// Store map: SVG rendering, shortest walking path (BFS on the grid), product photo crops.
const CELL = 20;
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function renderMap(svg, map, { targetShelfId = null, path = null, onShelfClick = null, here = null } = {}) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${map.cols * CELL} ${map.rows * CELL}`);
  const grid = el('g', { class: 'map-grid' }, svg);
  for (let x = 0; x <= map.cols; x++) el('line', { x1: x * CELL, y1: 0, x2: x * CELL, y2: map.rows * CELL }, grid);
  for (let y = 0; y <= map.rows; y++) el('line', { x1: 0, y1: y * CELL, x2: map.cols * CELL, y2: y * CELL }, grid);

  for (const s of map.shelves) {
    const g = el('g', { class: `map-shelf${s.id === targetShelfId ? ' target' : ''}${onShelfClick ? ' selectable' : ''}`, 'data-id': s.id }, svg);
    el('rect', { x: s.x * CELL + 1, y: s.y * CELL + 1, width: s.w * CELL - 2, height: s.h * CELL - 2 }, g);
    const t = el('text', { x: (s.x + s.w / 2) * CELL, y: (s.y + s.h / 2) * CELL + 4, 'text-anchor': 'middle' }, g);
    t.textContent = s.name;
    if (s.h > s.w * 2 && s.h >= 3) t.setAttribute('transform', `rotate(-90 ${(s.x + s.w / 2) * CELL} ${(s.y + s.h / 2) * CELL})`);
    if (onShelfClick) g.addEventListener('click', (e) => { e.stopPropagation(); onShelfClick(s); });
  }

  if (path && path.length > 1) {
    el('polyline', { class: 'map-path', points: path.map((p) => `${p.x * CELL + CELL / 2},${p.y * CELL + CELL / 2}`).join(' ') }, svg);
  }

  if (here) {
    const h = el('g', { class: 'map-here' }, svg);
    el('circle', { cx: here.x * CELL + CELL / 2, cy: here.y * CELL + CELL / 2, r: CELL * 0.7 }, h);
  }

  const e = map.entrance;
  const g = el('g', { class: 'map-entrance' }, svg);
  el('circle', { cx: e.x * CELL + CELL / 2, cy: e.y * CELL + CELL / 2, r: CELL * 1.1 }, g);
  const t = el('text', { x: e.x * CELL + CELL / 2, y: e.y * CELL + CELL / 2 + 4, 'text-anchor': 'middle' }, g);
  t.textContent = 'כניסה';
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

// Shortest walk from the entrance to a free cell touching the shelf.
export function findPath(map, shelf, start = map.entrance) {
  const blocked = new Uint8Array(map.cols * map.rows);
  for (const s of map.shelves) {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) blocked[y * map.cols + x] = 1;
  }
  const goal = (x, y) => x >= shelf.x - 1 && x <= shelf.x + shelf.w && y >= shelf.y - 1 && y <= shelf.y + shelf.h &&
    !((x === shelf.x - 1 || x === shelf.x + shelf.w) && (y === shelf.y - 1 || y === shelf.y + shelf.h)); // no diagonal corners
  const prev = new Int32Array(map.cols * map.rows).fill(-1);
  const startIdx = start.y * map.cols + start.x;
  prev[startIdx] = startIdx;
  const queue = [startIdx];
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % map.cols, y = Math.floor(idx / map.cols);
    if (goal(x, y) && !blocked[idx]) {
      const path = [];
      for (let i = idx; ; i = prev[i]) { path.push({ x: i % map.cols, y: Math.floor(i / map.cols) }); if (i === startIdx) break; }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
      const n = ny * map.cols + nx;
      if (prev[n] !== -1 || blocked[n]) continue;
      prev[n] = idx;
      queue.push(n);
    }
  }
  return null;
}

// The aisle-end spot a shopper stands on when scanning that aisle's QR sticker:
// the free cell next to the shelf that is closest to the entrance.
export function aisleSpot(map, shelf) {
  const p = findPath(map, shelf);
  return p ? p[p.length - 1] : null;
}

export function describeLocation(map, shelf, path, fromHere = false) {
  const cx = shelf.x + shelf.w / 2, cy = shelf.y + shelf.h / 2;
  const side = cx < map.cols / 3 ? 'בצד שמאל של החנות' : cx > (map.cols * 2) / 3 ? 'בצד ימין של החנות' : 'במרכז החנות';
  const depth = Math.abs(cy - map.entrance.y) < map.rows / 3 ? 'קרוב לכניסה' : Math.abs(cy - map.entrance.y) > (map.rows * 2) / 3 ? 'בחלק הרחוק מהכניסה' : 'באמצע הדרך';
  const meters = path ? `כ-${path.length - 1} מטר הליכה ${fromHere ? 'מהמקום שלך' : 'מהכניסה'}` : '';
  return { side, depth, meters };
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
  if (!photoUrl) return;
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
  } catch { /* leave blank */ }
}
