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
  t.anisotropy = 4;
  return t;
}
// shelves full of colourful packs, for a shelf that has no photo yet
function packedShelfTex(THREE, seed, fridge) {
  const r = rng(seed);
  return canvasTex(THREE, 512, 384, (g, W, H) => {
    g.fillStyle = fridge ? '#cfe3f2' : '#f4f1ea'; g.fillRect(0, 0, W, H);
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
      g.fillStyle = '#9aa3b1'; g.fillRect(0, (i + 1) * rh - 12, W, 12);
      g.fillStyle = '#ffd400'; for (let p = 20; p < W; p += 90) g.fillRect(p, (i + 1) * rh - 11, 34, 9); // price strips
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
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.el.appendChild(r.domElement);
    const scene = this.scene = new T.Scene();
    scene.background = new T.Color(0xdfe3ea);
    scene.fog = new T.Fog(0xdfe3ea, 16, Math.max(45, map.cols * 1.1, map.rows * 1.1));
    scene.add(new T.HemisphereLight(0xfff4e2, 0x7d869a, 0.9));
    const sun = new T.DirectionalLight(0xffffff, 0.45); sun.position.set(6, 12, 4); scene.add(sun);
    this.camera = new T.PerspectiveCamera(74, 1, 0.05, 250);
    scene.add(this.camera);

    // floor: shiny light tiles; ceiling with light panels; walls around
    const floorTex = canvasTex(T, 256, 256, (g, W) => {
      g.fillStyle = '#c9c1b4'; g.fillRect(0, 0, W, W);
      g.fillStyle = '#d3ccc0'; g.fillRect(0, 0, W / 2, W / 2); g.fillRect(W / 2, W / 2, W / 2, W / 2);
      g.strokeStyle = '#a99f90'; g.lineWidth = 3; g.strokeRect(1, 1, W / 2 - 2, W / 2 - 2); g.strokeRect(W / 2 + 1, W / 2 + 1, W / 2 - 2, W / 2 - 2);
      g.strokeRect(W / 2 + 1, 1, W / 2 - 2, W / 2 - 2); g.strokeRect(1, W / 2 + 1, W / 2 - 2, W / 2 - 2);
    });
    floorTex.wrapS = floorTex.wrapT = T.RepeatWrapping; floorTex.repeat.set(map.cols / 1.2, map.rows / 1.2);
    const floor = new T.Mesh(new T.PlaneGeometry(map.cols, map.rows), new T.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(map.cols / 2, 0, map.rows / 2);
    scene.add(floor); this.floor = floor;
    const ceil = new T.Mesh(new T.PlaneGeometry(map.cols, map.rows), new T.MeshBasicMaterial({ color: 0xdfe4ec }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(map.cols / 2, 3.3, map.rows / 2); scene.add(ceil);
    const panelGeo = new T.PlaneGeometry(1.6, 0.35), panelMat = new T.MeshBasicMaterial({ color: 0xffffff });
    // under every light a warm pool on the floor: the glow that makes a store feel alive
    const poolMat = new T.MeshBasicMaterial({ map: softTex(T, 'rgba(255,226,180,0.2)', 'rgba(255,226,180,0)'), transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
    const poolGeo = new T.PlaneGeometry(2.6, 2.6);
    for (let z = 2; z < map.rows; z += 3) for (let x = 1.5; x < map.cols; x += 4) {
      const p = new T.Mesh(panelGeo, panelMat); p.rotation.x = Math.PI / 2; p.position.set(x, 3.28, z); scene.add(p);
      if (this.free(x, z)) { const pool = new T.Mesh(poolGeo, poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.006, z); scene.add(pool); }
    }
    this.shadowMat = new T.MeshBasicMaterial({ map: softTex(T, 'rgba(20,24,36,0.55)', 'rgba(20,24,36,0)'), transparent: true, depthWrite: false });
    const wallMat = new T.MeshLambertMaterial({ color: 0xe9e2d6 }), bandMat = new T.MeshLambertMaterial({ color: 0xff6a2a });
    for (const [w, d, x, z] of [[map.cols, 0.2, map.cols / 2, -0.1], [map.cols, 0.2, map.cols / 2, map.rows + 0.1], [0.2, map.rows, -0.1, map.rows / 2], [0.2, map.rows, map.cols + 0.1, map.rows / 2]]) {
      const m = new T.Mesh(new T.BoxGeometry(w, 3.3, d), wallMat); m.position.set(x, 1.65, z); scene.add(m);
      // the chain's orange band around the store, like the real signage
      const band = new T.Mesh(new T.BoxGeometry(w + (d < 1 ? 0 : 0.02), 0.45, d + (d < 1 ? 0.02 : 0)), bandMat); band.position.set(x, 2.75, z); scene.add(band);
    }
    // entrance mat and sign
    const e = map.entrance;
    const mat = new T.Mesh(new T.PlaneGeometry(2.2, 1.4), new T.MeshLambertMaterial({ color: 0x22a35a }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(e.x + 0.5, 0.01, e.y + 0.5); scene.add(mat);
    this.buildWelcome(e);

    const bodyMat = new T.MeshLambertMaterial({ color: 0xe9edf3 }), baseMat = new T.MeshLambertMaterial({ color: 0x3a4254 });
    const counterMat = new T.MeshLambertMaterial({ color: 0x2b3242 });
    for (const s of map.shelves) this.buildShelf(s, { bodyMat, baseMat, counterMat });

    // the cart, in front of you at the bottom of the view
    const cart = this.cart = new T.Group();
    // a chrome wire basket: rails and a grid on every side, a red handle with the chain's plate
    const W = 0.56, Hc = 0.28, D = 0.38;
    const pts = [];
    const line = (a, b) => pts.push(new T.Vector3(...a), new T.Vector3(...b));
    for (let i = 0; i <= 8; i++) { const x = -W / 2 + (W * i) / 8; line([x, -Hc / 2, -D / 2], [x, Hc / 2, -D / 2]); line([x, -Hc / 2, D / 2], [x, Hc / 2, D / 2]); line([x, -Hc / 2, -D / 2], [x, -Hc / 2, D / 2]); }
    for (let i = 0; i <= 5; i++) { const z = -D / 2 + (D * i) / 5; line([-W / 2, -Hc / 2, z], [-W / 2, Hc / 2, z]); line([W / 2, -Hc / 2, z], [W / 2, Hc / 2, z]); }
    for (let i = 0; i <= 3; i++) { const y = -Hc / 2 + (Hc * i) / 3; line([-W / 2, y, -D / 2], [W / 2, y, -D / 2]); line([-W / 2, y, D / 2], [W / 2, y, D / 2]); line([-W / 2, y, -D / 2], [-W / 2, y, D / 2]); line([W / 2, y, -D / 2], [W / 2, y, D / 2]); }
    cart.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xc9d1dc })));
    const rim = new T.Mesh(new T.BoxGeometry(W + 0.02, 0.02, D + 0.02), new T.MeshLambertMaterial({ color: 0xdfe5ee }));
    rim.position.y = Hc / 2; cart.add(rim);
    const handle = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, W + 0.06, 10), new T.MeshLambertMaterial({ color: 0xff3d2e }));
    handle.rotation.z = Math.PI / 2; handle.position.set(0, Hc / 2 + 0.1, D / 2 + 0.1); cart.add(handle);
    const plate = new T.Mesh(new T.PlaneGeometry(0.22, 0.06), new T.MeshBasicMaterial({ map: signTex(T, this.on.storeName?.() || '🛒'), toneMapped: false }));
    plate.position.set(0, Hc / 2 + 0.03, D / 2 + 0.012); cart.add(plate);
    cart.position.set(0, -0.68, -1.0); cart.rotation.x = 0.42; cart.scale.setScalar(0.82);
    this.camera.add(cart);

    // start at the door, facing into the store
    this.pos = new T.Vector3(e.x + 0.5, EYE, e.y + 0.5);
    this.yaw = this.faceInto(e);
    // a step back from anything right in front, so the first view takes in the store
    for (let i = 0; i < 3 && !this.free(this.pos.x - Math.sin(this.yaw) * 1.2, this.pos.z - Math.cos(this.yaw) * 1.2); i++) this.yaw += Math.PI / 4;
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
      const capMat = new T.MeshLambertMaterial({ color: new T.Color(color) });
      const alongZc = s.h >= s.w;
      for (const end of [-1, 1]) {
        const cap = new T.Mesh(alongZc ? new T.BoxGeometry(s.w + 0.04, H + 0.02, 0.06) : new T.BoxGeometry(0.06, H + 0.02, s.h + 0.04), capMat);
        if (alongZc) cap.position.set(cx, H / 2, cz + end * (s.h / 2)); else cap.position.set(cx + end * (s.w / 2), H / 2, cz);
        this.scene.add(cap);
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
    sides.forEach((side, si) => {
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
      const rail = new T.Mesh(alongZ ? new T.BoxGeometry(s.w, 0.04, Math.min(len, 3.2)) : new T.BoxGeometry(Math.min(len, 3.2), 0.04, s.h), new T.MeshLambertMaterial({ color: 0x3a4254 }));
      rail.position.set(cx, H + 0.03, cz); this.scene.add(rail);
    }
    // deal posters on the ends of the unit: the store's best offers, where everyone walks past
    const deals = (aisle?.products || []).filter((p) => p.promo);
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
  buildWelcome(e) {
    const T = this.THREE;
    const yaw = Math.round(this.faceInto(e) / (Math.PI / 2)) * (Math.PI / 2);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), px = Math.cos(yaw), pz = -Math.sin(yaw);
    const ox = e.x + 0.5 + fx * 1.2, oz = e.y + 0.5 + fz * 1.2;
    const pillarMat = new T.MeshLambertMaterial({ color: 0xff6a2a });
    for (const k of [-1, 1]) {
      const x = ox + px * 1.5 * k, z = oz + pz * 1.5 * k;
      const pil = new T.Mesh(new T.BoxGeometry(0.22, 2.7, 0.22), pillarMat); pil.position.set(x, 1.35, z); this.scene.add(pil);
      // a plant in a pot beside each pillar
      const px2 = x - fx * 0.5, pz2 = z - fz * 0.5;
      const pot = new T.Mesh(new T.CylinderGeometry(0.22, 0.17, 0.45, 16), new T.MeshLambertMaterial({ color: 0x2b3242 })); pot.position.set(px2, 0.22, pz2); this.scene.add(pot);
      const leaves = new T.Mesh(new T.SphereGeometry(0.38, 14, 10), new T.MeshLambertMaterial({ color: 0x3f9b54 })); leaves.position.set(px2, 0.78, pz2); leaves.scale.y = 1.25; this.scene.add(leaves);
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
    sprite.scale.set(0.3, 0.3, 1);
    sprite.userData = { product: p, shelf, side, base: 0.3 };
    this.scene.add(sprite);
    this.hot.push(sprite);
  }
  refreshTag(id) {
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
    const cand = [at(2.2), at(1.6), at(1.0)].filter(([x, z]) => this.free(x + 0.5, z + 0.5)).slice(0, 1);
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
    const T = this.THREE, dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now() / 1000;
    if (this.path) {
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
    const moving = this.path || this.move.f || this.move.s;
    this.bob = (this.bob || 0) + (moving ? dt * 9 : 0);
    this.camera.position.set(this.pos.x, EYE + (moving ? Math.sin(this.bob) * 0.025 : 0), this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw); this.camera.rotateX(this.pitch);
    // price tags breathe; the one we walked to pulses bigger
    for (const s of this.hot) { const b = s.userData.base * (1 + Math.sin(now * 3 + s.position.x) * 0.06); s.scale.set(b, b, 1); }
    if (this.flash) {
      this.flash.t += dt;
      const k = 1 + Math.abs(Math.sin(this.flash.t * 6)) * 0.8;
      this.flash.sprite.scale.set(0.3 * k, 0.3 * k, 1);
      if (this.flash.t > 3) this.flash = null;
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
      this.cart.position.y = -0.68 - Math.sin(Math.min(Math.PI, this.cartBounce)) * 0.04;
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
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = s; }
    }
    if (best?.id !== this.whereId) { this.whereId = best?.id; this.on.where(best); }
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
    g.fillStyle = 'rgba(11,18,36,.72)'; g.fillRect(ox, oy, map.cols * s, map.rows * s);
    g.fillStyle = '#5b6b9c';
    for (const sh of map.shelves) g.fillRect(ox + sh.x * s, oy + sh.y * s, sh.w * s, sh.h * s);
    const px = ox + this.pos.x * s, py = oy + this.pos.z * s;
    g.fillStyle = '#ff7a1a'; g.beginPath();
    g.moveTo(px - Math.sin(this.yaw) * 9, py - Math.cos(this.yaw) * 9);
    g.lineTo(px + Math.cos(this.yaw) * 5, py - Math.sin(this.yaw) * 5);
    g.lineTo(px - Math.cos(this.yaw) * 5, py + Math.sin(this.yaw) * 5);
    g.fill();
  }
}
