// "Where am I?" without GPS or AI: compare the shopper's photo of the shelf in front of them with the
// store's own shelf photos, right on the phone. Colours and their rough layout are enough to tell a
// towel aisle from a pots aisle; the shopper confirms the guess with one tap.
const W = 48, H = 36, GX = 6, GY = 4;

function toImage(src) {
  if (src instanceof Blob) return createImageBitmap(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// colour histogram (12 hues x 2 brightness + 4 greys) and a 6x4 grid of mean colours
function describe(img, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const hist = new Float32Array(28);
  const grid = new Float32Array(GX * GY * 3);
  let bright = 0;
  for (let i = 0; i < W * H; i++) bright += px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
  const gain = (W * H * 3 * 128) / Math.max(1, bright); // evens out a darker or brighter photo
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const r = Math.min(255, px[o] * gain) / 255, g = Math.min(255, px[o + 1] * gain) / 255, b = Math.min(255, px[o + 2] * gain) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max, s = max ? (max - min) / max : 0;
    if (s < 0.18 || v < 0.15) hist[24 + Math.min(3, Math.floor(v * 4))]++;
    else {
      let h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
      h = ((h * 60) + 360) % 360;
      hist[Math.floor(h / 30) * 2 + (v > 0.6 ? 1 : 0)]++;
    }
    const cell = (Math.floor(y / (H / GY)) * GX + Math.floor(x / (W / GX))) * 3;
    grid[cell] += r; grid[cell + 1] += g; grid[cell + 2] += b;
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= W * H;
  for (let i = 0; i < grid.length; i++) grid[i] /= (W / GX) * (H / GY);
  return { hist, grid };
}

// the whole photo and a few parts of it, since the shopper usually catches only part of the shelf
function views(img) {
  const w = img.width, h = img.height;
  return [[0, 0, w, h], [0, 0, w * 0.6, h], [w * 0.4, 0, w * 0.6, h], [w * 0.2, h * 0.15, w * 0.6, h * 0.7]]
    .map(([x, y, cw, ch]) => describe(img, x, y, cw, ch));
}

function similarity(a, b) {
  let inter = 0;
  for (let i = 0; i < a.hist.length; i++) inter += Math.min(a.hist[i], b.hist[i]);
  let d = 0;
  for (let i = 0; i < a.grid.length; i++) d += (a.grid[i] - b.grid[i]) ** 2;
  const layout = 1 - Math.min(1, Math.sqrt(d / a.grid.length) * 2.5);
  return inter * 0.7 + layout * 0.3;
}

const cache = new Map(); // shelf photo url -> features
export async function rankShelves(photo, shelfPhotos) {
  const img = await toImage(photo);
  const mine = describe(img, 0, 0, img.width, img.height);
  const scores = [];
  for (const { shelfId, urls } of shelfPhotos) {
    let best = 0;
    for (const url of urls) {
      if (!cache.has(url)) cache.set(url, await toImage(url).then(views).catch(() => []));
      for (const f of cache.get(url)) best = Math.max(best, similarity(mine, f));
    }
    scores.push({ shelfId, score: best, photo: urls[0] });
  }
  return scores.sort((a, b) => b.score - a.score);
}
