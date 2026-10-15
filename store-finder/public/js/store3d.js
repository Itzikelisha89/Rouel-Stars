// The store in 3D, built from the store map and the real shelf photos: walk the aisles like in the
// supermarket, tap a price tag, and the product flies into the cart. Three.js (loaded on demand).
// One map cell = 1 meter. World: x = map x, z = map y, y = up.

import { drawCrop } from '/js/map.js';

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let threeLoading = null;
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  threeLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = THREE_URL;
    s.onload = () => resolve(window.THREE);
    s.onerror = () => { threeLoading = null; reject(new Error('לא הצלחתי לטעון את התלת-ממד. בודקים את החיבור ומנסים שוב')); };
    document.head.appendChild(s);
  });
  return threeLoading;
}
export function webglOk() {
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch { return false; }
}

const EYE = 1.6;
const SPEED = 1.7; // m/s, a relaxed shopping pace

// a little seeded randomness, so every shelf without a photo looks the same each visit
function rng(seed) { let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }

function canvasTex(THREE, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
  return t;
}
// shelves full of colourful packs, for a shelf that has no photo yet
function packedShelfTex(THREE, seed, fridge) {
  const r = rng(seed);
  return canvasTex(THREE, 512, 384, (g, W, H) => {
    const back = g.createLinearGradient(0, 0, 0, H); back.addColorStop(0, fridge ? '#dcecf7' : '#4a3b2e'); back.addColorStop(1, fridge ? '#a9c6dc' : '#2a2119');
    g.fillStyle = back; g.fillRect(0, 0, W, H);
    const rows = 4, rh = H / rows;
    const palette = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#ffb703', '#8ecae6', '#e76f51', '#6a4c93', '#90be6d', '#f72585', '#4cc9f0', '#ffd166'];
    for (let i = 0; i < rows; i++) {
      let x = 6;
      while (x < W - 10) {
        const w = 22 + r() * 46, h = rh * (0.45 + r() * 0.42), col = palette[Math.floor(r() * palette.length)];
        g.fillStyle = col; g.fillRect(x, (i + 1) * rh - 12 - h, w - 4, h);
        g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x + 4, (i + 1) * rh - 12 - h * 0.7, (w - 12) * 0.8, h * 0.18);
        x += w;
      }
      g.fillStyle = '#f27018'; g.fillRect(0, (i + 1) * rh - 12, W, 12); // the store's orange price rail
      g.fillStyle = '#fff'; for (let p = 30; p < W; p += 110) { g.beginPath(); g.arc(p, (i + 1) * rh - 6, 4, 0, 7); g.arc(p + 7, (i + 1) * rh - 6, 4, 0, 7); g.fill(); }
    }
    if (fridge) { g.fillStyle = 'rgba(255,255,255,.25)'; for (let d = 0; d < W; d += W / 4) g.fillRect(d, 0, 6, H); }
  });
}
// every department its own colour, the way good stores guide the eye
const DEPT = ['#ff6a2a', '#2f80ed', '#27ae60', '#e84393', '#9b51e0', '#00a3a3', '#f2994a', '#eb5757', '#2d9cdb', '#6fcf97', '#c27c0e', '#5b5fc7'];
export function deptColor(name) {
  const n = Number(String(name).match(/מעבר\s*(\d+)/)?.[1]);
  return n ? DEPT[(n - 1) % DEPT.length] : '#ff6a2a';
}
// colours as designers pick them (sRGB), converted for the renderer: without this every dark tone comes out washed-out grey
let LIN = null;
function C(hex) { return new LIN.Color(hex).convertSRGBToLinear(); }
function shade(hex, k) { // k < 1 darker
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
function signTex(THREE, text, sub, color = '#ff6a2a') {
  return canvasTex(THREE, 1024, 220, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, color); grd.addColorStop(1, shade(color, 0.8));
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.direction = 'rtl';
    g.font = '800 92px Heebo, Arial, sans-serif'; g.fillText(text, W / 2, sub ? 105 : 140);
    if (sub) { g.font = '600 60px Heebo, Arial, sans-serif'; g.fillText(sub, W / 2, 185); }
  });
}
function softTex(THREE, inner, outer) {
  return canvasTex(THREE, 128, 128, (g, W) => {
    const r = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    r.addColorStop(0, inner); r.addColorStop(1, outer);
    g.fillStyle = r; g.fillRect(0, 0, W, W);
  });
}
// a deal poster for the end of a gondola: the product, the deal, the price
function posterTex(THREE, p, price, color) {
  const tex = canvasTex(THREE, 512, 720, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#ff3d6e'); grd.addColorStop(1, '#ff7a1a');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.direction = 'rtl';
    g.font = '900 78px Heebo, Arial, sans-serif'; g.fillText('🔥 מבצע', W / 2, 92);
    g.fillStyle = '#fff'; g.fillRect(36, 128, W - 72, 330);
    g.font = '800 40px Heebo, Arial, sans-serif'; g.fillStyle = '#fff';
    const name = p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name;
    g.fillText(name, W / 2, 516);
    g.font = '900 64px Heebo, Arial, sans-serif'; g.fillText(p.promo.slice(0, 16), W / 2, 596);
    if (price) { g.font = '700 40px Heebo, Arial, sans-serif'; g.fillText(price, W / 2, 660); }
    g.strokeStyle = color; g.lineWidth = 14; g.strokeRect(7, 7, W - 14, H - 14);
  });
  // the product picture, once it's loaded
  const crop = document.createElement('canvas');
  drawCrop(crop, p.image || p.photo, p.image ? null : p.box, 320).then(() => {
    const g = tex.image.getContext('2d');
    g.drawImage(crop, 36 + (tex.image.width - 72 - 330) / 2, 128, 330, 330);
    tex.needsUpdate = true;
  });
  return tex;
}
function thumbTex(THREE, p) {
  const c = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  drawCrop(c, p.image || p.photo, p.image ? null : p.box, 128).then(() => { tex.needsUpdate = true; });
  return tex;
}
function tagTex(THREE, price, color) {
  return canvasTex(THREE, 256, 256, (g) => {
    g.fillStyle = color; g.beginPath(); g.arc(128, 82, 58, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 82, 30, 0, 7); g.fill();
    if (price) {
      g.fillStyle = 'rgba(11,18,36,.92)';
      if (g.roundRect) { g.beginPath(); g.roundRect(28, 160, 200, 70, 34); g.fill(); } else g.fillRect(28, 160, 200, 70);
      g.fillStyle = '#fff'; g.font = '800 46px Heebo, Arial, sans-serif'; g.textAlign = 'center'; g.fillText(price, 128, 212);
    }
  });
}

// a product card standing out from the shelf: the photo, the name, the price and "add to cart"
function popTex(THREE, p, price, inCart) {
  const W = 256, H = 360;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
  const crop = document.createElement('canvas');
  const paint = (img) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    rr(4, 4, W - 8, H - 8, 26); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 6; g.strokeStyle = p.promo ? '#ff3d6e' : inCart ? '#22c55e' : '#ff7a1a'; g.stroke();
    if (img) {
      const k = Math.min(224 / img.width, 190 / img.height), w = img.width * k, h = img.height * k;
      g.save(); rr(16, 16, W - 32, 194, 18); g.clip();
      g.fillStyle = '#f3f1ed'; g.fillRect(16, 16, W - 32, 194);
      g.drawImage(img, (W - w) / 2, 16 + (194 - h) / 2, w, h); g.restore();
    }
    if (p.promo) {
      g.fillStyle = '#ff3d6e'; rr(24, 22, 118, 34, 17); g.fill();
      g.fillStyle = '#fff'; g.font = '800 20px Heebo, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('🔥 מבצע', 83, 46);
    }
    g.direction = 'rtl'; g.textAlign = 'center'; g.fillStyle = '#1c2233';
    g.font = '700 21px Heebo, Arial, sans-serif';
    const words = p.name.split(/\s+/); let l1 = '', l2 = '';
    for (const w of words) { if (!l2 && g.measureText(`${l1} ${w}`).width < W - 36) l1 = l1 ? `${l1} ${w}` : w; else l2 = l2 ? `${l2} ${w}` : w; }
    if (g.measureText(l2).width > W - 36) { while (l2 && g.measureText(`${l2}…`).width > W - 36) l2 = l2.slice(0, -1); l2 += '…'; }
    g.fillText(l1, W / 2, 238); if (l2) g.fillText(l2, W / 2, 262);
    if (price) { g.fillStyle = '#ff5a1f'; g.font = '900 32px Heebo, Arial, sans-serif'; g.fillText(price, W / 2, 300); }
    const grd = g.createLinearGradient(0, 0, W, 0);
    if (inCart) { grd.addColorStop(0, '#22c55e'); grd.addColorStop(1, '#16a34a'); } else { grd.addColorStop(0, '#ff8a2a'); grd.addColorStop(1, '#ff5a36'); }
    rr(30, 312, W - 60, 36, 18); g.fillStyle = grd; g.fill();
    g.fillStyle = '#fff'; g.font = '800 20px Heebo, Arial, sans-serif'; g.fillText(inCart ? '✓ בעגלה' : '➕ לעגלה', W / 2, 337);
    tex.needsUpdate = true;
  };
  paint(null);
  drawCrop(crop, p.image || p.photo, p.image ? null : p.box, 300).then(() => paint(crop)).catch(() => {});
  tex.repaint = (on) => { inCart = on; paint(crop.width ? crop : null); };
  return tex;
}

export class Store3D {
  /**
   * @param el      container element
   * @param map     the store map
   * @param aisles  [{ shelfId, name, photos: [{ url, products: [{ id, name, price, promo, box }] }] }]
   * @param on      { pick(product), where(shelf|null), price(p) -> text, inCart(id) }
   */
  constructor(THREE, el, map, aisles, on) {
    Object.assign(this, { THREE, el, map, on });
    this.byShelf = new Map(aisles.map((a) => [a.shelfId, a]));
    this.hot = []; this.clickables = []; this.cartItems = []; this.anims = [];
    this.yaw = 0; this.pitch = -0.05; this.move = { f: 0, s: 0 }; this.path = null; this.whereId = '-';
    this.blocked = new Uint8Array(map.cols * map.rows);
    for (const s of map.shelves) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (x >= 0 && y >= 0 && x < map.cols && y < map.rows) this.blocked[y * map.cols + x] = 1;
    this.build();
  }

  free(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.map.cols || cz >= this.map.rows) return false;
    return !this.blocked[cz * this.map.cols + cx];
  }
  build() {
    const T = this.THREE, map = this.map;
    LIN = T;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.el.appendChild(r.domElement);
    const scene = this.scene = new T.Scene();
    // a premium store: dark ceiling, warm wood, the light falls on the products
    scene.background = new T.Color(0x14110e);
    scene.fog = new T.Fog(C(0x14110e), 12, Math.max(34, map.cols * 0.9, map.rows * 0.9));
    scene.add(new T.HemisphereLight(C(0xffe2b8), C(0x3a2c20), 1.25));
    const sun = new T.DirectionalLight(C(0xfff1dc), 0.55); sun.position.set(6, 12, 4); scene.add(sun);
    this.camera = new T.PerspectiveCamera(64, 1, 0.05, 250);
    scene.add(this.camera);

    // floor: shiny light tiles; ceiling with light panels; walls around
    const floorTex = canvasTex(T, 512, 512, (g, W) => {
      const r = rng('oak');
      const planks = 8, ph = W / planks;
      for (let i = 0; i < planks; i++) {
        const off = r() * W;
        for (const x0 of [-off, W - off]) {
          const tone = 150 + Math.floor(r() * 40);
          g.fillStyle = `rgb(${tone + 40}, ${tone - 5}, ${tone - 55})`;
          g.fillRect(x0, i * ph, W, ph);
          // grain
          g.globalAlpha = 0.12;
          for (let k = 0; k < 14; k++) { g.fillStyle = r() < 0.5 ? '#5a3a1c' : '#f3d2a2'; g.fillRect(x0, i * ph + r() * ph, W, 1 + r() * 2); }
          g.globalAlpha = 1;
        }
        g.fillStyle = 'rgba(40,24,10,.55)'; g.fillRect(0, i * ph, W, 2); // the seam between planks
        g.fillRect((i * 97) % W, i * ph, 2, ph);
      }
    });
    floorTex.wrapS = floorTex.wrapT = T.RepeatWrapping; floorTex.repeat.set(map.cols / 3, map.rows / 3);
    const floor = new T.Mesh(new T.PlaneGeometry(map.cols, map.rows), new T.MeshLambertMaterial({ map: floorTex, color: C(0xa8927a) }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(map.cols / 2, 0, map.rows / 2);
    scene.add(floor); this.floor = floor;
    const ceil = new T.Mesh(new T.PlaneGeometry(map.cols, map.rows), new T.MeshBasicMaterial({ color: C(0x16130f) }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(map.cols / 2, 3.6, map.rows / 2); scene.add(ceil);
    const beamMat = new T.MeshLambertMaterial({ color: C(0x2a2219) });
    for (let x = 2; x < map.cols; x += 4) { const b = new T.Mesh(new T.BoxGeometry(0.18, 0.25, map.rows), beamMat); b.position.set(x, 3.45, map.rows / 2); scene.add(b); }
    // pendant lamps: a warm glowing shade on a cord
    const shadeGeo = new T.CylinderGeometry(0.16, 0.34, 0.26, 20, 1, true), shadeMat = new T.MeshBasicMaterial({ color: C(0x0f0d0b), side: T.DoubleSide });
    const bulbGeo = new T.CircleGeometry(0.31, 20), bulbMat = new T.MeshBasicMaterial({ color: 0xffe6b8, toneMapped: false });
    const cordGeo = new T.CylinderGeometry(0.008, 0.008, 0.7, 4), cordMat = new T.MeshBasicMaterial({ color: 0x111111 });
    const panelGeo = new T.PlaneGeometry(1.6, 0.35), panelMat = new T.MeshBasicMaterial({ color: 0xffffff });
    // under every light a warm pool on the floor: the glow that makes a store feel alive
    const poolMat = new T.MeshBasicMaterial({ map: softTex(T, 'rgba(255,200,130,0.42)', 'rgba(255,200,130,0)'), transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
    const poolGeo = new T.PlaneGeometry(2.6, 2.6);
    for (let z = 2; z < map.rows; z += 3) for (let x = 1.5; x < map.cols; x += 4) {
      if (!this.free(x, z)) continue; // lamps hang over the walkways, not inside the shelves
      const shade = new T.Mesh(shadeGeo, shadeMat); shade.position.set(x, 2.95, z); scene.add(shade);
      const bulb = new T.Mesh(bulbGeo, bulbMat); bulb.rotation.x = Math.PI / 2; bulb.position.set(x, 2.83, z); scene.add(bulb);
      const cord = new T.Mesh(cordGeo, cordMat); cord.position.set(x, 3.42, z); scene.add(cord);
      const pool = new T.Mesh(poolGeo, poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.006, z); scene.add(pool);
    }
    this.shadowMat = new T.MeshBasicMaterial({ map: softTex(T, 'rgba(20,24,36,0.55)', 'rgba(20,24,36,0)'), transparent: true, depthWrite: false });
    const wallMat = new T.MeshLambertMaterial({ color: C(0x221c16) }), bandMat = new T.MeshBasicMaterial({ color: 0xff6a2a, toneMapped: false });
    const slatTex = canvasTex(T, 256, 256, (g, W) => {
      g.fillStyle = '#9a6b3f'; g.fillRect(0, 0, W, W);
      for (let x = 0; x < W; x += 32) { g.fillStyle = x % 64 ? '#a87648' : '#8f6038'; g.fillRect(x, 0, 28, W); g.fillStyle = '#3a2614'; g.fillRect(x + 28, 0, 4, W); }
    });
    slatTex.wrapS = T.RepeatWrapping;
    for (const [w, d, x, z] of [[map.cols, 0.2, map.cols / 2, -0.1], [map.cols, 0.2, map.cols / 2, map.rows + 0.1], [0.2, map.rows, -0.1, map.rows / 2], [0.2, map.rows, map.cols + 0.1, map.rows / 2]]) {
      const m = new T.Mesh(new T.BoxGeometry(w, 3.6, d), wallMat); m.position.set(x, 1.8, z); scene.add(m);
      // warm wood slats up to 2.2 m, and the chain's glowing orange band above them
      const long = Math.max(w, d), t = slatTex.clone(); t.needsUpdate = true; t.repeat.set(long / 2, 1);
      const slats = new T.Mesh(new T.BoxGeometry(w + (d < 1 ? 0 : 0.04), 2.2, d + (d < 1 ? 0.04 : 0)), new T.MeshLambertMaterial({ map: t, color: C(0xd9c3a5) }));
      slats.position.set(x, 1.1, z); scene.add(slats);
      const band = new T.Mesh(new T.BoxGeometry(w + (d < 1 ? 0 : 0.05), 0.12, d + (d < 1 ? 0.05 : 0)), bandMat); band.position.set(x, 2.32, z); scene.add(band);
    }
    // entrance mat and sign
    const e = map.entrance;
    const mat = new T.Mesh(new T.PlaneGeometry(2.2, 1.4), new T.MeshLambertMaterial({ color: C(0x1f6b45) }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(e.x + 0.5, 0.01, e.y + 0.5); scene.add(mat);

    // gondolas in dark walnut and charcoal: the products are what's lit, the furniture steps back
    const bodyMat = new T.MeshLambertMaterial({ color: C(0x3a2e24) }), baseMat = new T.MeshLambertMaterial({ color: C(0x141210) });
    const counterMat = new T.MeshLambertMaterial({ color: C(0x2a2420) });
    for (const s of map.shelves) this.buildShelf(s, { bodyMat, baseMat, counterMat });

    // the cart, in front of you at the bottom of the view
    const cart = this.cart = new T.Group();
    // a chrome wire basket made of real bars: a grid on every side, a solid rim
    const W = 0.56, Hc = 0.28, D = 0.38;
    const wire = new T.MeshLambertMaterial({ color: C(0x9aa3ae) });
    const bar = (len, axis, x, y, z, th = 0.01) => {
      const g = axis === 'x' ? new T.BoxGeometry(len, th, th) : axis === 'y' ? new T.BoxGeometry(th, len, th) : new T.BoxGeometry(th, th, len);
      const m = new T.Mesh(g, wire); m.position.set(x, y, z); cart.add(m);
    };
    for (let i = 0; i <= 7; i++) { const x = -W / 2 + (W * i) / 7; bar(Hc, 'y', x, 0, -D / 2); bar(Hc, 'y', x, 0, D / 2); bar(D, 'z', x, -Hc / 2, 0); }
    for (let i = 0; i <= 4; i++) { const z = -D / 2 + (D * i) / 4; bar(Hc, 'y', -W / 2, 0, z); bar(Hc, 'y', W / 2, 0, z); }
    for (let i = 0; i <= 2; i++) { const y = -Hc / 2 + (Hc * i) / 2; bar(W, 'x', 0, y, -D / 2); bar(W, 'x', 0, y, D / 2); bar(D, 'z', -W / 2, y, 0); bar(D, 'z', W / 2, y, 0); }
    for (const [len, ax, x, z] of [[W, 'x', 0, -D / 2], [W, 'x', 0, D / 2], [D, 'z', -W / 2, 0], [D, 'z', W / 2, 0]]) bar(len, ax, x, Hc / 2, z, 0.022);
    const handle = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, W + 0.06, 10), new T.MeshLambertMaterial({ color: C(0xff5a1f) }));
    handle.rotation.z = Math.PI / 2; handle.position.set(0, Hc / 2 + 0.1, D / 2 + 0.1); cart.add(handle);
    const plate = new T.Mesh(new T.PlaneGeometry(0.22, 0.06), new T.MeshBasicMaterial({ map: signTex(T, this.on.storeName?.() || '🛒'), toneMapped: false }));
    plate.position.set(0, Hc / 2 + 0.03, D / 2 + 0.012); cart.add(plate);
    cart.position.set(0, -0.62, -1.0); cart.rotation.x = 0.5; cart.scale.setScalar(0.82);
    this.camera.add(cart);

    // start at the door, facing into the store
    this.pos = new T.Vector3(e.x + 0.5, EYE, e.y + 0.5);
    this.yaw = this.faceInto(e);
    // a step back from anything right in front, so the first view takes in the store
    // straight along the aisles (a diagonal first look sees the ends of units, not the shelves)
    const base = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
    let best = -1;
    for (let k = -2; k <= 2; k += 2) {
      const a = base + (k * Math.PI) / 4;
      let d = 0;
      while (d < 25 && this.free(this.pos.x - Math.sin(a) * d, this.pos.z - Math.cos(a) * d)) d += 0.25;
      // how many gondolas this view takes in, and room to see them (not a unit right in your face)
      let seen = 0;
      for (const sh of this.map.shelves) {
        if (/^(c\d+|w-)/.test(sh.id)) continue;
        const dx = sh.x + sh.w / 2 - this.pos.x, dz = sh.y + sh.h / 2 - this.pos.z;
        const off = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - a), Math.cos(Math.atan2(-dx, -dz) - a));
        if (Math.abs(off) < 0.6 && Math.hypot(dx, dz) < 26) seen++;
      }
      const score = seen * 2 + Math.min(d, 5) - Math.abs(k) * 0.5;
      if (score > best) { best = score; this.yaw = a; }
    }
    // and stand at the mouth of an aisle, so the first view is a corridor of full shelves, not the end of a unit
    {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), px = -fz, pz = fx;
      const run = (x, z) => { let d = 0; while (d < 14 && this.free(x + fx * d, z + fz * d)) d += 0.25; return d; };
      let bestRun = run(this.pos.x, this.pos.z), bestO = 0;
      for (let o = -5; o <= 5; o += 0.5) {
        const x = this.pos.x + px * o, z = this.pos.z + pz * o;
        if (!this.free(x, z)) continue;
        const d = run(x, z) - Math.abs(o) * 0.2;
        if (d > bestRun + 2) { bestRun = d; bestO = o; }
      }
      // the centre of that corridor
      let x = this.pos.x + px * bestO, z = this.pos.z + pz * bestO;
      for (let ahead = 1; ahead < 12; ahead += 0.5) {
        let l = 0, rr = 0;
        while (l < 4 && this.free(x + fx * ahead - px * (l + 0.25), z + fz * ahead - pz * (l + 0.25))) l += 0.25;
        while (rr < 4 && this.free(x + fx * ahead + px * (rr + 0.25), z + fz * ahead + pz * (rr + 0.25))) rr += 0.25;
        if (l < 4 && rr < 4) { x += px * (rr - l) / 2; z += pz * (rr - l) / 2; break; }
      }
      if (this.free(x, z)) { this.pos.x = x; this.pos.z = z; }
      this.buildWelcome(); // the welcome arch frames where you start
    }
    this.ray = new T.Raycaster();
    this.clock = new T.Clock();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }
  // from the door, look towards the middle of the shelves (the way you walk in)
  faceInto(e) {
    const sh = this.map.shelves.filter((s) => !/^c\d+$/.test(s.id));
    if (!sh.length) return 0;
    const mx = sh.reduce((t, s) => t + s.x + s.w / 2, 0) / sh.length, mz = sh.reduce((t, s) => t + s.y + s.h / 2, 0) / sh.length;
    const exact = Math.atan2(-(mx - e.x - 0.5), -(mz - e.y - 0.5));
    return Math.round(exact / (Math.PI / 4)) * (Math.PI / 4); // a tidy angle, roughly at the shelves
  }

  // the lamps light the top of the shelf more than the bottom, which is what makes it look real
  washMat() {
    const T = this.THREE;
    return this._wash ||= new T.MeshBasicMaterial({
      map: canvasTex(T, 4, 256, (g, W, H) => {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, 'rgba(255,214,150,0.22)'); gr.addColorStop(0.45, 'rgba(255,214,150,0)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,6,2,0.38)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }),
      transparent: true, depthWrite: false, toneMapped: false,
    });
  }
  buildShelf(s, { bodyMat, baseMat, counterMat }) {
    const T = this.THREE;
    const checkout = /^c\d+$/.test(s.id), wall = /^w-/.test(s.id);
    const H = checkout ? 0.95 : wall ? 2.3 : 1.9;
    const cx = s.x + s.w / 2, cz = s.y + s.h / 2;
    const body = new T.Mesh(new T.BoxGeometry(s.w - 0.04, H, s.h - 0.04), checkout ? counterMat : bodyMat);
    body.position.set(cx, H / 2, cz); this.scene.add(body);
    if (checkout) {
      const sign = new T.Mesh(new T.PlaneGeometry(1.1, 0.24), new T.MeshBasicMaterial({ map: signTex(T, s.name), side: T.DoubleSide }));
      sign.position.set(cx, 2.1, cz); this.scene.add(sign);
      return;
    }
    const base = new T.Mesh(new T.BoxGeometry(s.w + 0.02, 0.14, s.h + 0.02), baseMat);
    base.position.set(cx, 0.07, cz); this.scene.add(base);
    // a soft shadow on the floor around the unit: it stands on the floor instead of floating
    const sh = new T.Mesh(new T.PlaneGeometry(s.w + 1.1, s.h + 1.1), this.shadowMat);
    sh.rotation.x = -Math.PI / 2; sh.position.set(cx, 0.004, cz); this.scene.add(sh);
    const color = deptColor(s.name);
    // end caps in the department's colour, the way supermarket gondolas end
    if (!wall) {
      const capMat = this._capMat ||= new T.MeshLambertMaterial({ color: C(0x6b4c34) });
      const stripeMat = new T.MeshBasicMaterial({ color: C(color), toneMapped: false });
      const alongZc = s.h >= s.w;
      for (const end of [-1, 1]) {
        const cap = new T.Mesh(alongZc ? new T.BoxGeometry(s.w + 0.04, H + 0.02, 0.06) : new T.BoxGeometry(0.06, H + 0.02, s.h + 0.04), capMat);
        if (alongZc) cap.position.set(cx, H / 2, cz + end * (s.h / 2)); else cap.position.set(cx + end * (s.w / 2), H / 2, cz);
        this.scene.add(cap);
        // a thin glowing stripe of the department's colour along the top and the sides of the end
        for (const [gw, gh, gy, off] of [[1, 0.05, H - 0.03, 0], [0.04, H - 0.2, H / 2, -1], [0.04, H - 0.2, H / 2, 1]]) {
          const wdt = (alongZc ? s.w : s.h) + 0.06;
          const st = new T.Mesh(alongZc ? new T.BoxGeometry(gw === 1 ? wdt : gw, gh, 0.07) : new T.BoxGeometry(0.07, gh, gw === 1 ? wdt : gw), stripeMat);
          const lat = off * (wdt / 2 - 0.02);
          if (alongZc) st.position.set(cx + lat, gy, cz + end * (s.h / 2 + 0.005)); else st.position.set(cx + end * (s.w / 2 + 0.005), gy, cz + lat);
          this.scene.add(st);
        }
      }
    }

    // the two long sides show the shelf: the real photos when there are some, packed shelves otherwise
    const alongZ = s.h >= s.w, len = Math.max(s.w, s.h);
    const faceH = H - 0.2, y0 = 0.14 + faceH / 2;
    const aisle = this.byShelf.get(s.id);
    const photos = aisle?.photos || [];
    const sides = alongZ
      ? [{ nx: -1, nz: 0, x: s.x - 0.005, z: cz, rot: -Math.PI / 2 }, { nx: 1, nz: 0, x: s.x + s.w + 0.005, z: cz, rot: Math.PI / 2 }]
      : [{ nx: 0, nz: 1, x: cx, z: s.y + s.h + 0.005, rot: 0 }, { nx: 0, nz: -1, x: cx, z: s.y - 0.005, rot: Math.PI }];
    const loader = new T.TextureLoader();
    // a side against the wall (no floor in front of it) gets no products: nobody can reach them there
    const open = sides.filter((sd) => this.free(sd.x + sd.nx * 0.6, sd.z + sd.nz * 0.6));
    open.forEach((side, si) => {
      const wash = new T.Mesh(new T.PlaneGeometry(len, faceH), this.washMat());
      wash.position.set(side.x + side.nx * 0.02, y0, side.z + side.nz * 0.02); wash.rotation.y = side.rot; wash.renderOrder = 2; this.scene.add(wash);
      if (!photos.length) {
        const tex = packedShelfTex(T, s.id + si, /מקרר/.test(s.name));
        tex.wrapS = T.RepeatWrapping; tex.repeat.set(Math.max(1, Math.round(len / 2.2)), 1);
        const p = new T.Mesh(new T.PlaneGeometry(len, faceH), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        p.position.set(side.x, y0, side.z); p.rotation.y = side.rot; this.scene.add(p);
        return;
      }
      // photos side by side at their natural shape, repeating along the shelf
      const tileW = faceH * 1.33, n = Math.max(1, Math.round(len / tileW)), w = len / n;
      const placed = new Set();
      for (let k = 0; k < n; k++) {
        const ph = photos[k % photos.length];
        const tex = loader.load(ph.url); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
        const plane = new T.Mesh(new T.PlaneGeometry(w, faceH), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        // tile k from the start of this side, measured along the shelf as seen from the aisle
        const along = -len / 2 + w * (k + 0.5);
        const ox = alongZ ? 0 : along * (side.nz === 1 ? 1 : -1), oz = alongZ ? along * (side.nx === 1 ? -1 : 1) : 0;
        plane.position.set(side.x + ox, y0, side.z + oz); plane.rotation.y = side.rot;
        this.scene.add(plane);
        if (placed.has(ph.url)) continue;
        placed.add(ph.url);
        for (const p of ph.products) this.addTag(p, plane, w, faceH, side, s);
      }
    });
    this.buildPopouts(s, open, len, alongZ);
    if (!wall) this.buildStand(s, alongZ, cx, cz);
    // aisle signs hanging at both ends of the shelf
    const short = s.name.split('·').slice(0, 2).join('·').trim();
    const [num, ...rest] = short.split('·');
    const signMat = new T.MeshBasicMaterial({ map: signTex(T, num.trim(), rest.join('·').trim(), color), side: T.DoubleSide, toneMapped: false });
    for (const end of [-1, 1]) {
      const sign = new T.Mesh(new T.PlaneGeometry(1.5, 0.32), signMat);
      if (alongZ) { sign.position.set(cx, 2.35, cz + end * (s.h / 2 + 0.02)); } else { sign.position.set(cx + end * (s.w / 2 + 0.02), 2.35, cz); sign.rotation.y = Math.PI / 2; }
      this.scene.add(sign);
    }
    // the department's name along the top of the unit, both sides
    if (!wall && rest.length) {
      const board = new T.MeshBasicMaterial({ map: signTex(T, rest.join('·').trim(), '', color), toneMapped: false });
      for (const side of sides) {
        const b = new T.Mesh(new T.PlaneGeometry(Math.min(len, 3.2), 0.36), board);
        b.position.set(side.x + side.nx * 0.01, H + 0.22, side.z + side.nz * 0.01); b.rotation.y = side.rot; this.scene.add(b);
      }
      const rail = new T.Mesh(alongZ ? new T.BoxGeometry(s.w, 0.04, Math.min(len, 3.2)) : new T.BoxGeometry(Math.min(len, 3.2), 0.04, s.h), new T.MeshLambertMaterial({ color: C(0x141210) }));
      rail.position.set(cx, H + 0.03, cz); this.scene.add(rail);
    }
    // deal posters on the ends of the unit: the store's best offers, where everyone walks past
    const deals = (aisle?.products || []).filter((p) => p.promo);
    // no deal here: the end of the unit is a display of packs, the way real gondola ends are stocked
    if (!wall && !deals.length) {
      const endW = (alongZ ? s.w : s.h) - 0.1;
      if (endW > 0.4) [-1, 1].forEach((end, k) => {
        const tex = packedShelfTex(T, `${s.id}-end${k}`, /מקרר/.test(s.name));
        const pl = new T.Mesh(new T.PlaneGeometry(endW, H - 0.3), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        if (alongZ) { pl.position.set(cx, 0.14 + (H - 0.3) / 2, cz + end * (s.h / 2 + 0.035)); pl.rotation.y = end > 0 ? 0 : Math.PI; } else { pl.position.set(cx + end * (s.w / 2 + 0.035), 0.14 + (H - 0.3) / 2, cz); pl.rotation.y = end > 0 ? Math.PI / 2 : -Math.PI / 2; }
        this.scene.add(pl);
      });
    }
    if (!wall && deals.length) {
      [-1, 1].forEach((end, k) => {
        const p = deals[k % deals.length];
        const wP = Math.min(alongZ ? s.w : s.h, 1.1) * 0.86;
        const poster = new T.Mesh(new T.PlaneGeometry(wP, wP * 1.4), new T.MeshBasicMaterial({ map: posterTex(T, p, this.on.price(p), color), toneMapped: false }));
        if (alongZ) { poster.position.set(cx, 1.05, cz + end * (s.h / 2 + 0.04)); poster.rotation.y = end > 0 ? 0 : Math.PI; } else { poster.position.set(cx + end * (s.w / 2 + 0.04), 1.05, cz); poster.rotation.y = end > 0 ? Math.PI / 2 : -Math.PI / 2; }
        poster.userData = { product: p, shelf: s };
        this.scene.add(poster);
        this.clickables.push(poster);
      });
    }
  }
  // the welcome arch at the door, and two plants
  buildWelcome() {
    const T = this.THREE;
    const yaw = this.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), px = Math.cos(yaw), pz = -Math.sin(yaw);
    const ox = this.pos.x + fx * 1.2, oz = this.pos.z + fz * 1.2;
    const pillarMat = new T.MeshLambertMaterial({ color: C(0x2b221a) });
    for (const k of [-1, 1]) {
      const x = ox + px * 1.5 * k, z = oz + pz * 1.5 * k;
      const pil = new T.Mesh(new T.BoxGeometry(0.22, 2.7, 0.22), pillarMat); pil.position.set(x, 1.35, z); this.scene.add(pil);
      // a plant in a pot beside each pillar
      const px2 = x - fx * 0.5, pz2 = z - fz * 0.5;
      const pot = new T.Mesh(new T.CylinderGeometry(0.22, 0.17, 0.45, 16), new T.MeshLambertMaterial({ color: C(0x1b1714) })); pot.position.set(px2, 0.22, pz2); this.scene.add(pot);
      const leaves = new T.Mesh(new T.SphereGeometry(0.38, 14, 10), new T.MeshLambertMaterial({ color: C(0x2f7a43) })); leaves.position.set(px2, 0.78, pz2); leaves.scale.y = 1.25; this.scene.add(leaves);
    }
    const sign = new T.Mesh(new T.PlaneGeometry(3.3, 0.6), new T.MeshBasicMaterial({ map: signTex(T, 'ברוכים הבאים', this.on.storeName?.() || ''), side: T.DoubleSide, toneMapped: false }));
    sign.position.set(ox, 2.85, oz); sign.rotation.y = yaw; this.scene.add(sign);
  }
  addTag(p, plane, w, h, side, shelf) {
    if (!p.box) return;
    const T = this.THREE;
    const u = (p.box.x0 + p.box.x1) / 2000 - 0.5, v = 0.5 - (p.box.y0 + p.box.y1) / 2000;
    const local = new T.Vector3(u * w, v * h, 0.06);
    plane.updateMatrixWorld(true);
    const world = local.applyMatrix4(plane.matrixWorld);
    const color = this.on.inCart(p.id) ? '#22c55e' : p.promo ? '#ff3d6e' : '#ff7a1a';
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tagTex(T, this.on.price(p), color), depthTest: true, toneMapped: false }));
    sprite.position.copy(world);
    sprite.visible = false; // the product cards in front of the shelf show it; the tag keeps its spot
    sprite.scale.set(0.3, 0.3, 1);
    sprite.userData = { product: p, shelf, side, base: 0.3 };
    this.scene.add(sprite);
    this.hot.push(sprite);
  }
  // the aisle's products out in front of its shelves: a full row along every side you can walk,
  // deals first, repeating like facings on a stocked shelf (two rows when there's a lot)
  buildPopouts(s, sides, len, alongZ) {
    const items = (this.byShelf.get(s.id)?.products || []).filter((p) => p.photo || p.image);
    if (!items.length || !sides.length) return;
    const slots = Math.max(1, Math.min(12, Math.floor((len - 1.0) / 1.2)));
    const rows = 1;
    sides.forEach((side, si) => {
      for (let r = 0; r < rows; r++) for (let k = 0; k < slots; k++) {
        const p = items[(k + si * slots) % items.length];
        const along = -len / 2 + 0.5 + (len - 1.0) * (k + 0.5) / slots;
        const ox = alongZ ? 0 : along * (side.nz === 1 ? 1 : -1), oz = alongZ ? along * (side.nx === 1 ? -1 : 1) : 0;
        this.addPopout(p, new this.THREE.Vector3(side.x + ox, 1.36, side.z + oz), side, s);
      }
    });
  }
  // a promotion stand on the floor at the far end of the aisle: the aisle's best offer, big, on a pedestal
  buildStand(s, alongZ, cx, cz) {
    const T = this.THREE;
    const items = (this.byShelf.get(s.id)?.products || []).filter((p) => p.photo || p.image);
    const p = items.find((x) => x.promo) || items[0];
    if (!p) return;
    const e = this.map.entrance;
    const far = alongZ ? (Math.abs(s.y - e.y) > Math.abs(s.y + s.h - e.y) ? -1 : 1) : (Math.abs(s.x - e.x) > Math.abs(s.x + s.w - e.x) ? -1 : 1);
    const dist = 1.5;
    const x = alongZ ? cx : far < 0 ? s.x - dist : s.x + s.w + dist, z = alongZ ? (far < 0 ? s.y - dist : s.y + s.h + dist) : cz;
    if (!this.free(x, z)) return;
    const rot = alongZ ? (far < 0 ? Math.PI : 0) : (far < 0 ? -Math.PI / 2 : Math.PI / 2);
    // pedestal: warm wood with the store's orange band
    this.pedMat ||= new T.MeshLambertMaterial({ color: C(0x6b4c34) });
    this.pedBand ||= new T.MeshBasicMaterial({ color: C(0xf27018), toneMapped: false });
    const ped = new T.Mesh(new T.BoxGeometry(0.9, 0.62, 0.9), this.pedMat); ped.position.set(x, 0.31, z); this.scene.add(ped);
    const band = new T.Mesh(new T.BoxGeometry(0.92, 0.1, 0.92), this.pedBand); band.position.set(x, 0.5, z); this.scene.add(band);
    // a stack of the product's packs on top
    this.stackMats ||= new Map();
    if (!this.stackMats.has(p.id)) { const t = thumbTex(T, p); this.stackMats.set(p.id, new T.MeshLambertMaterial({ map: t })); }
    for (const [ox, oz, oy] of [[-0.2, -0.15, 0], [0.2, -0.15, 0], [0, 0.15, 0], [0, -0.05, 0.3]]) {
      const b = new T.Mesh(new T.BoxGeometry(0.34, 0.3, 0.26), this.stackMats.get(p.id));
      b.position.set(x + ox, 0.62 + 0.15 + oy, z + oz); b.rotation.y = rot; this.scene.add(b);
    }
    const side = { nx: Math.sin(rot), nz: Math.cos(rot), rot };
    this.addPopout(p, Object.assign(new T.Vector3(x, 1.85, z), { out: 0, scale: 1.35, noStand: true }), side, s);
  }
  // the product's card closest to where it sits on the shelf
  cardFor(sprite) {
    let best = null, bd = 1e9;
    for (const c of this.popouts || []) {
      if (c.userData.product.id !== sprite.userData.product.id) continue;
      const d = c.position.distanceTo(sprite.position);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // the product, out in front of the shelf on an arm, turned toward the shopper coming down the aisle
  addPopout(p, at, side, shelf) {
    const T = this.THREE;
    this.popouts ||= [];
    const alongZ = side.nx !== 0;
    // keep the cards apart along the shelf
    const a = alongZ ? at.z : at.x;
    const e = this.map.entrance, toEntrance = alongZ ? Math.sign(e.y + 0.5 - a) || 1 : Math.sign(e.x + 0.5 - a) || 1;
    const out = at.out ?? 0.85, y = at.y; // out in the walkway, where the cart passes
    const x = alongZ ? at.x + side.nx * out : a, z = alongZ ? a : at.z + side.nz * out;
    this.popTexs ||= new Map();
    if (!this.popTexs.has(p.id)) this.popTexs.set(p.id, popTex(T, p, this.on.price(p), this.on.inCart(p.id)));
    const tex = this.popTexs.get(p.id);
    this.popMats ||= new Map();
    if (!this.popMats.has(p.id)) this.popMats.set(p.id, new T.MeshBasicMaterial({ map: tex, transparent: true, side: T.DoubleSide, toneMapped: false }));
    this.popGeo ||= new T.PlaneGeometry(0.64, 0.9);
    const card = new T.Mesh(this.popGeo, this.popMats.get(p.id));
    if (at.scale) card.scale.setScalar(at.scale);
    // turn the card ~35° from the shelf toward the entrance end of the aisle
    let best = side.rot;
    for (const d of [0.72, -0.72]) {
      const r = side.rot + d, nx = Math.sin(r), nz = Math.cos(r);
      if ((alongZ ? nz : nx) * toEntrance > 0) best = r;
    }
    card.rotation.y = best;
    card.position.set(x, y, z);
    card.userData = { product: p, shelf, side, along: a, y, phase: Math.random() * 6, tex, rest: best, s0: at.scale || 1 };
    this.scene.add(card);
    this.clickables.push(card);
    this.popouts.push(card);
    if (at.noStand) return;
    // a display stand on the floor holds it up, out in the aisle
    this.armMat ||= new T.MeshLambertMaterial({ color: C(0x2a2622) });
    this.poleGeo ||= new T.CylinderGeometry(0.018, 0.018, 1, 8);
    this.footGeo ||= new T.CylinderGeometry(0.16, 0.19, 0.04, 20);
    const h = y - 0.44;
    const pole = new T.Mesh(this.poleGeo, this.armMat); pole.scale.y = h; pole.position.set(x, h / 2, z); this.scene.add(pole);
    const foot = new T.Mesh(this.footGeo, this.armMat); foot.position.set(x, 0.02, z); this.scene.add(foot);
  }
  refreshTag(id) {
    this.popTexs?.get(id)?.repaint(this.on.inCart(id));
    for (const s of this.hot) if (s.userData.product.id === id) {
      const p = s.userData.product;
      s.material.map = tagTex(this.THREE, this.on.price(p), this.on.inCart(p.id) ? '#22c55e' : p.promo ? '#ff3d6e' : '#ff7a1a');
      s.material.needsUpdate = true;
    }
  }

  resize() {
    const w = this.el.clientWidth || window.innerWidth, h = this.el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  start() {
    this.running = true;
    const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    loop();
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  playIntro(done) {
    const T = this.THREE, m = this.map;
    const to = new T.Vector3(this.pos.x, EYE, this.pos.z);
    // start high over the middle of the store, a little behind the door, and glide down
    const from = new T.Vector3(m.cols / 2 + Math.sin(this.yaw) * m.rows * 0.15, Math.max(11, Math.max(m.cols, m.rows) * 0.55), m.rows / 2 + Math.cos(this.yaw) * m.rows * 0.15);
    this.intro = { from, to, t: 0, start: performance.now(), dur: 3.6, pitch0: -1.25, done };
  }
  skipIntro() { if (this.intro) this.intro.start = -1e9; }
  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- moving ----------
  tryMove(dx, dz) {
    const R = 0.28, p = this.pos;
    const ok = (x, z) => this.free(x - R, z - R) && this.free(x + R, z - R) && this.free(x - R, z + R) && this.free(x + R, z + R);
    if (ok(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return true; }
    if (ok(p.x + dx, p.z)) { p.x += dx; return true; }
    if (ok(p.x, p.z + dz)) { p.z += dz; return true; }
    return false;
  }
  // breadth-first over the grid from where you stand to any of the target cells
  route(targets) {
    const { cols, rows } = this.map;
    const start = Math.floor(this.pos.z) * cols + Math.floor(this.pos.x);
    const goal = new Set(targets.map(([x, y]) => y * cols + x));
    const prev = new Int32Array(cols * rows).fill(-1);
    prev[start] = start;
    const q = [start];
    while (q.length) {
      const c = q.shift();
      if (goal.has(c)) {
        const cells = []; for (let k = c; k !== start; k = prev[k]) cells.unshift(k);
        return cells.map((k) => new this.THREE.Vector3((k % cols) + 0.5, EYE, Math.floor(k / cols) + 0.5));
      }
      const x = c % cols, y = Math.floor(c / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, n = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || this.blocked[n] || prev[n] !== -1) continue;
        prev[n] = c; q.push(n);
      }
    }
    return null;
  }
  walkTo(points, then) {
    this.path = points?.length ? { points, then } : null;
    if (!points?.length) then?.();
  }
  walkToPoint(x, z) {
    const p = this.route([[Math.floor(x), Math.floor(z)]]);
    if (p) this.walkTo(p);
  }
  // to a product: the aisle side it's on, then turn to the shelf and light its tag
  walkToProduct(productId, done) {
    const tag = this.hot.find((s) => s.userData.product.id === productId);
    if (!tag) return false;
    const { side } = tag.userData;
    const at = (d) => [Math.floor(tag.position.x + side.nx * d), Math.floor(tag.position.z + side.nz * d)];
    const cand = [at(2.6), at(2.2), at(1.6), at(1.0)].filter(([x, z]) => this.free(x + 0.5, z + 0.5)).slice(0, 1);
    const p = this.route(cand);
    if (!p) return false;
    this.walkTo(p, () => {
      this.turnTo = Math.atan2(-(tag.position.x - this.pos.x), -(tag.position.z - this.pos.z));
      this.pitch = Math.max(-0.5, Math.min(0.3, Math.atan2(tag.position.y - EYE, Math.hypot(tag.position.x - this.pos.x, tag.position.z - this.pos.z))));
      this.flash = { sprite: tag, t: 0 };
      done?.(tag.userData.product);
    });
    return true;
  }
  walkToShelf(shelf, done) {
    const cells = [];
    for (let x = shelf.x - 1; x <= shelf.x + shelf.w; x++) for (let y = shelf.y - 1; y <= shelf.y + shelf.h; y++) {
      const inside = x >= shelf.x && x < shelf.x + shelf.w && y >= shelf.y && y < shelf.y + shelf.h;
      if (!inside && this.free(x + 0.5, y + 0.5)) cells.push([x, y]);
    }
    // the middle of the shelf's long side, not its corner
    const mid = cells.sort((a, b) => Math.hypot(a[0] + 0.5 - (shelf.x + shelf.w / 2), a[1] + 0.5 - (shelf.y + shelf.h / 2)) - Math.hypot(b[0] + 0.5 - (shelf.x + shelf.w / 2), b[1] + 0.5 - (shelf.y + shelf.h / 2))).slice(0, 2);
    const p = this.route(mid);
    if (!p) return done?.();
    this.walkTo(p, () => {
      this.turnTo = Math.atan2(-(shelf.x + shelf.w / 2 - this.pos.x), -(shelf.y + shelf.h / 2 - this.pos.z));
      done?.();
    });
  }

  frame() {
    const T = this.THREE, dt = Math.min(0.1, this.clock.getDelta()); // a slow phone still walks at the right pace
    const now = performance.now() / 1000;
    if (this.driveTo) { // "take me there": the navigation screen moves the camera along the route
      const d = this.driveTo;
      this.pos.x += (d.x - this.pos.x) * Math.min(1, dt * 8); this.pos.z += (d.z - this.pos.z) * Math.min(1, dt * 8);
      const diff = ((d.yaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += diff * Math.min(1, dt * 3);
      this.pitch += ((d.pitch ?? -0.08) - this.pitch) * Math.min(1, dt * 3);
      this.animateRoute(now);
    } else if (this.path) {
      const target = this.path.points[0];
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
      const want = Math.atan2(-dx, -dz);
      let diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += diff * Math.min(1, dt * 5);
      const stepLen = SPEED * dt;
      if (d <= stepLen) {
        this.pos.x = target.x; this.pos.z = target.z;
        this.path.points.shift();
        if (!this.path.points.length) { const then = this.path.then; this.path = null; then?.(); }
      } else if (Math.abs(diff) < 1.2) this.tryMove((dx / d) * stepLen, (dz / d) * stepLen);
    } else if (this.move.f || this.move.s) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
      const k = SPEED * dt;
      this.tryMove((fx * this.move.f + sx * this.move.s) * k, (fz * this.move.f + sz * this.move.s) * k);
    }
    if (this.turnTo !== undefined) {
      const diff = ((this.turnTo - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += diff * Math.min(1, dt * 4);
      if (Math.abs(diff) < 0.01) this.turnTo = undefined;
    }
    // the opening: from above the store, down to the door
    if (this.intro) {
      const it = this.intro;
      it.t = (performance.now() - it.start) / (it.dur * 1000); // wall clock: the same length on any phone
      const k = Math.min(1, it.t), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(it.from, it.to, e);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw); this.camera.rotateX(it.pitch0 + (this.pitch - it.pitch0) * e);
      this.cart.visible = k > 0.85;
      if (k >= 1) { this.intro = null; this.cart.visible = true; it.done?.(); }
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // a gentle walking bob
    const moving = this.path || this.move.f || this.move.s || this.driveTo?.moving;
    this.bob = (this.bob || 0) + (moving ? dt * 9 : 0);
    this.camera.position.set(this.pos.x, EYE + (moving ? Math.sin(this.bob) * 0.025 : 0), this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw); this.camera.rotateX(this.pitch);
    // the product cards float a little, like a display that wants to be touched
    for (const c of this.popouts || []) {
      const u = c.userData;
      c.position.y = u.y + Math.sin(now * 1.6 + u.phase) * 0.018;
      // close by, the card turns to face the shopper (never turning its back on the aisle)
      const dx = this.pos.x - c.position.x, dz = this.pos.z - c.position.z, d = dx * dx + dz * dz;
      c.visible = d > 1.1; // right in front of your nose it steps aside, so you can see the shelf
      let want = u.rest;
      if (d < 64 && d > 0.2) {
        const face = Math.atan2(dx, dz), off = ((face - u.side.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        want = u.side.rot + Math.max(-1.35, Math.min(1.35, off));
      }
      const diff = ((want - c.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.rotation.y += diff * Math.min(1, dt * 3);
    }
    // price tags breathe; the one we walked to pulses bigger
    for (const s of this.hot) { const b = s.userData.base * (1 + Math.sin(now * 3 + s.position.x) * 0.06); s.scale.set(b, b, 1); }
    if (this.flash) {
      this.flash.t += dt;
      const k = 1 + Math.abs(Math.sin(this.flash.t * 6)) * 0.8;
      this.flash.sprite.scale.set(0.3 * k, 0.3 * k, 1);
      const card = this.flash.card ||= this.cardFor(this.flash.sprite);
      if (card) card.scale.setScalar(1 + Math.abs(Math.sin(this.flash.t * 4)) * 0.18);
      if (this.flash.t > 3) { this.flash.card?.scale.setScalar(1); this.flash = null; }
    }
    // products flying into the cart
    for (const a of this.anims) {
      a.t += dt / 0.6;
      const k = Math.min(1, a.t), e = 1 - (1 - k) ** 3;
      const to = new T.Vector3(); this.cart.getWorldPosition(to);
      a.mesh.position.lerpVectors(a.from, to, e);
      a.mesh.position.y += Math.sin(k * Math.PI) * 0.4;
      a.mesh.scale.setScalar(1 - e * 0.6);
      if (k >= 1) { this.scene.remove(a.mesh); this.addCartItem(a.color, a.product); }
    }
    this.anims = this.anims.filter((a) => a.t < 1);
    if (this.cartBounce !== undefined) { // the basket nods when something lands in it
      this.cartBounce += dt * 6;
      this.cart.position.y = -0.62 - Math.sin(Math.min(Math.PI, this.cartBounce)) * 0.04;
      if (this.cartBounce >= Math.PI) this.cartBounce = undefined;
    }
    this.renderer.render(this.scene, this.camera);
    this.reportWhere();
  }
  reportWhere() {
    const t = performance.now();
    if (t - (this.lastWhere || 0) < 400) return;
    this.lastWhere = t;
    let best = null, bd = 1.8;
    for (const s of this.map.shelves) {
      if (!/^a/.test(s.id)) continue;
      const dx = Math.max(s.x - this.pos.x, 0, this.pos.x - (s.x + s.w)), dz = Math.max(s.y - this.pos.z, 0, this.pos.z - (s.y + s.h));
      // between two units, the one you're looking at is where you are
      const nx = Math.max(s.x, Math.min(this.pos.x, s.x + s.w)) - this.pos.x, nz = Math.max(s.y, Math.min(this.pos.z, s.y + s.h)) - this.pos.z;
      const facing = (-Math.sin(this.yaw) * nx - Math.cos(this.yaw) * nz) / (Math.hypot(nx, nz) || 1);
      const raw = Math.hypot(dx, dz), d = facing > 0.7 && raw < 2.5 ? raw - 3 : raw;
      if (d < bd) { bd = d; best = s; }
    }
    if (best?.id !== this.whereId) { this.whereId = best?.id; this.on.where(best); }
  }

  // ---------- "take me there" in 3D: arrows on the floor, a column of light over the goal ----------
  navMode() {
    this.cart.visible = false;
    if (this.intro) this.intro = null;
  }
  setRoute(cells, { productId = null, shelf = null, deal = null, dealShelf = null } = {}) {
    const T = this.THREE;
    if (this.routeGroup) this.scene.remove(this.routeGroup);
    const g = this.routeGroup = new T.Group();
    this.scene.add(g);
    this.chevTex ||= canvasTex(T, 128, 128, (c, W) => {
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(W / 2, 14); c.lineTo(W - 16, W / 2 + 10); c.lineTo(W - 36, W / 2 + 30); c.lineTo(W / 2, 54); c.lineTo(36, W / 2 + 30); c.lineTo(16, W / 2 + 10); c.closePath(); c.fill();
    });
    const chevGeo = new T.PlaneGeometry(0.55, 0.55);
    this.chevrons = [];
    for (let i = 0; i < cells.length - 1; i++) {
      const a = cells[i], b = cells[i + 1];
      const yaw = Math.atan2(-(b.x - a.x), -(b.y - a.y));
      for (const f of [0.25, 0.75]) {
        const m = new T.Mesh(chevGeo, new T.MeshBasicMaterial({ map: this.chevTex, color: 0xff7a1a, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
        m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -Math.PI / 2;
        m.position.set(a.x + 0.5 + (b.x - a.x) * f, 0.03, a.y + 0.5 + (b.y - a.y) * f);
        m.userData.at = i + f;
        g.add(m); this.chevrons.push(m);
      }
    }
    const tagOf = (id) => id && this.hot.find((h) => h.userData.product.id === id);
    const beacon = (pos, color) => {
      const tex = this.beamTex ||= canvasTex(T, 4, 256, (c, W, H) => {
        const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,.95)');
        c.fillStyle = gr; c.fillRect(0, 0, W, H);
      });
      const beam = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 3.2, 24, 1, true), new T.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, toneMapped: false }));
      beam.position.set(pos.x, 1.6, pos.z); g.add(beam);
      const ring = new T.Mesh(new T.RingGeometry(0.34, 0.5, 32), new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.035, pos.z); g.add(ring);
      return { beam, ring };
    };
    // the light stands on the floor in front of the product, at the end of the route
    const end = cells[cells.length - 1];
    this.goalTag = tagOf(productId);
    this.goalBeacon = beacon({ x: end.x + 0.5, z: end.y + 0.5 }, 0xff8a2a);
    this.goalShelf = shelf;
    this.dealBeacon = null; this.dealTag = tagOf(deal?.id); this.dealShelf = dealShelf; this.dealId = deal?.id;
    if (dealShelf) {
      const t = this.dealTag;
      const cx = t ? t.position.x + t.userData.side.nx * 0.9 : dealShelf.x + dealShelf.w / 2, cz = t ? t.position.z + t.userData.side.nz * 0.9 : dealShelf.y + dealShelf.h + 0.5;
      this.dealBeacon = beacon({ x: cx, z: cz }, 0xff3d6e);
    }
    this.routeAt = 0;
  }
  animateRoute(now) {
    for (const m of this.chevrons || []) {
      const ahead = m.userData.at - this.routeAt;
      const wave = 0.55 + 0.45 * Math.sin(now * 5 - m.userData.at * 0.9); // a pulse running forward along the route
      m.material.opacity = ahead < -0.2 ? 0 : wave * Math.min(1, 0.35 + ahead / 6);
    }
    for (const b of [this.goalBeacon, this.dealBeacon]) if (b) {
      b.ring.scale.setScalar(1 + 0.25 * Math.sin(now * 3)); b.beam.material.opacity = 0.75 + 0.25 * Math.sin(now * 2);
    }
  }
  // where the shopper is along the route (in cells walked) and where to look
  drive(x, z, yaw, { at = 0, moving = true, pitch = -0.08 } = {}) {
    this.routeAt = at;
    this.driveTo = { x, z, yaw, moving, pitch };
  }
  // stand back from a target so it's framed in the view, not pressed against the lens
  frameTarget(obj, fallback) {
    const T = this.THREE;
    let tx, tz, ty = 1.1, nx = 0, nz = 0;
    if (obj) {
      tx = obj.position.x; tz = obj.position.z; ty = obj.position.y;
      if (obj.userData.side) { nx = obj.userData.side.nx; nz = obj.userData.side.nz; } else { const d = obj.getWorldDirection(new T.Vector3()); nx = d.x; nz = d.z; }
    } else if (fallback) { tx = fallback.x + fallback.w / 2; tz = fallback.y + fallback.h / 2; } else return;
    let x = this.driveTo.x, z = this.driveTo.z;
    if (nx || nz) for (const k of [2.4, 2.0, 1.6, 1.2]) {
      const cx = tx + nx * k, cz = tz + nz * k;
      if (this.free(cx, cz)) { x = cx; z = cz; break; }
    }
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    const pitch = Math.max(-0.45, Math.min(0.2, Math.atan2(ty - EYE, Math.hypot(tx - x, tz - z))));
    this.driveTo = { ...this.driveTo, x, z, yaw, pitch, moving: false };
  }
  // the end of the route: turn to the product and make its price tag pulse
  lookAtGoal() {
    this.frameTarget(this.goalTag, this.goalShelf);
    if (this.goalTag) this.flash = { sprite: this.goalTag, t: -1e9 };
  }
  lookAtDeal() {
    if (!this.dealShelf || !this.driveTo) return;
    const poster = this.dealId && this.clickables.find((c) => c.userData.product?.id === this.dealId && c.userData.shelf?.id === this.dealShelf.id);
    this.frameTarget(poster || this.dealTag, this.dealShelf);
    if (this.dealTag) this.flash = { sprite: this.dealTag, t: 0 };
  }

  // ---------- the cart ----------
  // a pack with the product's own picture on it, settling into the basket
  addCartItem(color, product) {
    const T = this.THREE;
    const n = this.cartItems.length;
    if (n >= 18) return;
    const side = new T.MeshLambertMaterial({ color });
    const face = product ? new T.MeshBasicMaterial({ map: thumbTex(T, product), toneMapped: false }) : side;
    const m = new T.Mesh(new T.BoxGeometry(0.13, 0.13, 0.05), [side, side, side, side, face, side]);
    m.position.set(-0.2 + (n % 4) * 0.13, -0.06 + Math.floor(n / 4) * 0.06, 0.1 - ((n * 7) % 3) * 0.09);
    m.rotation.set(-0.5, ((n * 0.9) % 1) - 0.5, 0);
    this.cart.add(m);
    this.cartItems.push(m);
    this.cartBounce = 0;
  }
  flyToCart(product) {
    const T = this.THREE;
    const productId = product.id;
    const tag = this.hot.find((s) => s.userData.product.id === productId) || this.clickables.find((c) => c.userData.product.id === productId);
    const color = new T.Color().setHSL((productId * 0.137) % 1, 0.7, 0.55);
    if (!tag) return this.addCartItem(color, product);
    // the product's picture flies off the shelf in an arc into the basket
    const mesh = new T.Mesh(new T.PlaneGeometry(0.3, 0.3), new T.MeshBasicMaterial({ map: thumbTex(T, product), toneMapped: false, side: T.DoubleSide }));
    mesh.position.copy(tag.position);
    mesh.lookAt(this.camera.position);
    this.scene.add(mesh);
    this.anims.push({ mesh, from: tag.position.clone(), t: 0, color, product });
    this.refreshTag(productId);
  }
  fillCart(items) { items.forEach((p, i) => this.addCartItem(new this.THREE.Color().setHSL((i * 0.23) % 1, 0.65, 0.55), p)); }

  // ---------- touch: drag to look, tap a tag to buy, tap the floor to walk there ----------
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new this.THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const tag = this.ray.intersectObjects([...this.hot, ...this.clickables])[0];
    if (tag && tag.distance < 9) return { product: tag.object.userData.product };
    const hit = this.ray.intersectObject(this.floor)[0];
    return hit ? { floor: hit.point } : null;
  }
  minimap(canvas) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, map = this.map;
    const s = Math.min(W / map.cols, H / map.rows), ox = (W - map.cols * s) / 2, oy = (H - map.rows * s) / 2;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,16,12,.82)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,214,150,.08)'; g.fillRect(ox, oy, map.cols * s, map.rows * s);
    for (const sh of map.shelves) { g.fillStyle = /^c\d+$/.test(sh.id) ? '#7a6a5a' : deptColor(sh.name); g.fillRect(ox + sh.x * s, oy + sh.y * s, sh.w * s, sh.h * s); }
    const px = ox + this.pos.x * s, py = oy + this.pos.z * s;
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(px - Math.sin(this.yaw) * 9, py - Math.cos(this.yaw) * 9);
    g.lineTo(px + Math.cos(this.yaw) * 5, py - Math.sin(this.yaw) * 5);
    g.lineTo(px - Math.cos(this.yaw) * 5, py + Math.sin(this.yaw) * 5);
    g.fill();
  }
}
