import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fixed seed: every browser builds the exact same model variants, which multiplayer relies on
// (host and guest refer to a variant by index).
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20240607);
const rand = (a, b) => a + R() * (b - a);
const pick = (a) => a[(R() * a.length) | 0];

/* ---------- window texture for buildings ---------- */
function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // frame
  g.fillStyle = '#b9bec7';
  g.fillRect(22, 20, 84, 88);
  // glass
  const grad = g.createLinearGradient(0, 24, 0, 104);
  grad.addColorStop(0, '#6f9fd0');
  grad.addColorStop(1, '#2d4a72');
  g.fillStyle = grad;
  g.fillRect(27, 25, 74, 78);
  // reflection streak
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath();
  g.moveTo(27, 25); g.lineTo(60, 25); g.lineTo(27, 70); g.closePath();
  g.fill();
  // mullion
  g.fillStyle = '#b9bec7';
  g.fillRect(62, 25, 4, 78);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const MAT = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  bld: new THREE.MeshLambertMaterial({ vertexColors: true, map: makeWindowTexture() }),
};

/* ---------- geometry builder: merges many primitives into one vertex-coloured mesh ---------- */
class B {
  constructor() { this.parts = []; }

  push(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, plain = true) {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    const n = geo.attributes.position.count;
    const c = new THREE.Color(color);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (plain) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < n; i++) uv.setXY(i, 0.02, 0.02);
    }
    this.parts.push(geo);
    return this;
  }

  // y is the BOTTOM of the primitive
  box(w, h, d, col, x, y, z, ry = 0) { return this.push(new THREE.BoxGeometry(w, h, d), col, x, y + h / 2, z, 0, ry, 0); }
  cyl(rt, rb, h, col, x, y, z, seg = 10) { return this.push(new THREE.CylinderGeometry(rt, rb, h, seg), col, x, y + h / 2, z); }
  cone(r, h, col, x, y, z, seg = 8) { return this.cyl(0, r, h, col, x, y, z, seg); }
  // y is the CENTRE of the sphere
  sph(r, col, x, y, z, sy = 1) {
    const g = new THREE.SphereGeometry(r, 12, 8);
    if (sy !== 1) g.scale(1, sy, 1);
    return this.push(g, col, x, y, z);
  }
  wheel(r, w, x, y, z, col = '#1b1b1f') {
    return this.push(new THREE.CylinderGeometry(r, r, w, 12), col, x, y, z, 0, 0, Math.PI / 2);
  }
  // building facade with window texture; the tiling is rounded so windows line up on corners
  facade(w, h, d, col, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    const nu = Math.max(1, Math.round(w / 3.2));
    const nd = Math.max(1, Math.round(d / 3.2));
    const nv = Math.max(1, Math.round(h / 3.6));
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        const u = uv.getX(k), v = uv.getY(k);
        if (f === 0 || f === 1) uv.setXY(k, u * nd, v * nv);
        else if (f === 4 || f === 5) uv.setXY(k, u * nu, v * nv);
        else uv.setXY(k, 0.02, 0.02);
      }
    }
    return this.push(g, col, x, y + h / 2, z, 0, 0, 0, false);
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    return g;
  }
}

// box = [halfWidth, halfDepth] footprint: first-person runners can't walk through these
const out = (b, r, h, mat = 'vc', box = null) => ({ geo: b.build(), r, h, mat, box });

/* ---------- palettes ---------- */
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5cba7'];
const SHIRT = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a', '#9b5de5', '#f15bb5', '#00bbf9', '#ffffff', '#6a994e', '#ff7b00'];
const PANTS = ['#2b3a55', '#3d3d3d', '#5a4632', '#1f2a44', '#3b5b3b', '#7a7a7a'];
const HAIR = ['#2b1b0f', '#5a3a1a', '#d9b44a', '#111111', '#a33b20', '#cccccc'];
const CAR = ['#d62828', '#f77f00', '#fcbf49', '#2a9d8f', '#277da1', '#6c757d', '#f8f9fa', '#212529', '#7b2cbf', '#80b918', '#ff5d8f'];
const WALL = ['#f4e3c1', '#e9c8a0', '#c9d8e8', '#e8d5d5', '#d8e2c6', '#f2efe6', '#e6b8a2', '#bfd3c1'];
const ROOF = ['#a8432f', '#5b6c8f', '#6b4a3a', '#7a2f2f', '#3f4a54', '#8c5a2b'];
const GLASS_TINT = ['#c8d6e5', '#aebfd4', '#d7ccc8', '#b0bec5', '#9fb8c8', '#e0d6c3', '#a5b7a8'];

/* ---------- makers ---------- */
function person() {
  const b = new B();
  const skin = pick(SKIN), shirt = pick(SHIRT), pants = pick(PANTS), hair = pick(HAIR);
  b.box(0.2, 0.8, 0.24, pants, -0.11, 0, 0).box(0.2, 0.8, 0.24, pants, 0.11, 0, 0)
    .box(0.52, 0.72, 0.3, shirt, 0, 0.78, 0)
    .box(0.13, 0.66, 0.15, shirt, -0.34, 0.8, 0).box(0.13, 0.66, 0.15, shirt, 0.34, 0.8, 0)
    .sph(0.19, skin, 0, 1.68, 0)
    .sph(0.2, hair, 0, 1.74, -0.04, 0.7);
  return out(b, 0.4, 1.9);
}

function cone() {
  const b = new B();
  b.box(0.62, 0.06, 0.62, '#2a2a2a', 0, 0, 0)
    .cyl(0.05, 0.28, 0.7, '#ff6a1a', 0, 0.06, 0)
    .cyl(0.17, 0.2, 0.12, '#ffffff', 0, 0.3, 0);
  return out(b, 0.35, 0.8);
}

function trashcan() {
  const b = new B();
  const col = pick(['#4a6a4a', '#44546a', '#555555']);
  b.cyl(0.34, 0.3, 0.9, col, 0, 0, 0).cyl(0.37, 0.37, 0.08, '#2c2c2c', 0, 0.9, 0);
  return out(b, 0.4, 1);
}

function hydrant() {
  const b = new B();
  b.cyl(0.17, 0.2, 0.7, '#d9261c', 0, 0, 0)
    .sph(0.18, '#d9261c', 0, 0.74, 0)
    .box(0.55, 0.1, 0.1, '#c21f16', 0, 0.42, 0)
    .cyl(0.22, 0.22, 0.06, '#8a1510', 0, 0.62, 0);
  return out(b, 0.3, 0.95);
}

function bench() {
  const b = new B();
  b.box(1.8, 0.08, 0.5, '#8a5a2b', 0, 0.45, 0)
    .box(1.8, 0.45, 0.07, '#8a5a2b', 0, 0.6, -0.23)
    .box(0.08, 0.45, 0.45, '#333333', -0.8, 0, 0).box(0.08, 0.45, 0.45, '#333333', 0.8, 0, 0);
  return out(b, 1.0, 1.1);
}

function bush() {
  const b = new B();
  const g = pick(['#3f8f3a', '#4aa044', '#357a34', '#5aa84a']);
  b.sph(0.65, g, 0, 0.5, 0, 0.85).sph(0.5, g, 0.45, 0.42, 0.2).sph(0.45, g, -0.42, 0.4, -0.1);
  return out(b, 0.9, 1.1);
}

function treeRound() {
  const b = new B();
  const g = pick(['#3f9a3f', '#4cae4c', '#6bb34a', '#e0903a', '#e68aa8']);
  b.cyl(0.15, 0.24, 2, '#6b4a2b', 0, 0, 0)
    .sph(1.2, g, 0, 2.7, 0).sph(0.9, g, 0.7, 2.3, 0.3).sph(0.85, g, -0.6, 3.1, -0.3);
  return out(b, 1.3, 4.3);
}

function treeOak() {
  const b = new B();
  const g = pick(['#2f8a3a', '#3c9a46', '#4aa24e']);
  b.cyl(0.3, 0.5, 3.4, '#5e4026', 0, 0, 0)
    .sph(2.3, g, 0, 4.8, 0).sph(1.7, g, 1.4, 4.0, 0.7).sph(1.6, g, -1.3, 4.3, -0.8).sph(1.4, g, 0.2, 6.2, 0.2);
  return out(b, 2.4, 7.4);
}

function treePine() {
  const b = new B();
  b.cyl(0.18, 0.26, 1.6, '#5b3d22', 0, 0, 0)
    .cone(1.75, 2.4, '#2d6a3a', 0, 1.2, 0, 9)
    .cone(1.35, 2.1, '#347a42', 0, 2.8, 0, 9)
    .cone(0.95, 1.9, '#3b8a4a', 0, 4.2, 0, 9);
  return out(b, 1.75, 6.1);
}

function lamp() {
  const b = new B();
  b.cyl(0.13, 0.18, 6, '#3d4046', 0, 0, 0)
    .box(1.2, 0.1, 0.12, '#3d4046', 0.55, 5.85, 0)
    .box(0.55, 0.14, 0.32, '#ffe9a0', 1.05, 5.7, 0)
    .cyl(0.28, 0.28, 0.25, '#3d4046', 0, 0, 0);
  return out(b, 0.35, 6.1);
}

function car() {
  const b = new B();
  const col = pick(CAR);
  b.box(1.9, 0.62, 4.2, col, 0, 0.36, 0)
    .box(1.78, 0.46, 2.3, '#27323f', 0, 0.98, -0.2)
    .box(1.82, 0.1, 2.2, col, 0, 1.44, -0.2)
    .box(0.4, 0.17, 0.1, '#fff6c0', -0.6, 0.62, 2.1).box(0.4, 0.17, 0.1, '#fff6c0', 0.6, 0.62, 2.1)
    .box(0.4, 0.17, 0.1, '#c1121f', -0.6, 0.62, -2.1).box(0.4, 0.17, 0.1, '#c1121f', 0.6, 0.62, -2.1)
    .box(1.92, 0.16, 4.22, '#2a2a2a', 0, 0.3, 0)
    .wheel(0.38, 0.3, -0.95, 0.38, 1.35).wheel(0.38, 0.3, 0.95, 0.38, 1.35)
    .wheel(0.38, 0.3, -0.95, 0.38, -1.35).wheel(0.38, 0.3, 0.95, 0.38, -1.35);
  return out(b, 2.1, 1.6);
}

function van() {
  const b = new B();
  const col = pick(['#f8f9fa', '#e9c46a', '#457b9d', '#e76f51']);
  b.box(2.1, 1.7, 4.6, col, 0, 0.4, 0)
    .box(2.14, 0.5, 1.2, '#27323f', 0, 1.35, 1.5)
    .box(0.4, 0.17, 0.1, '#fff6c0', -0.7, 0.7, 2.3).box(0.4, 0.17, 0.1, '#fff6c0', 0.7, 0.7, 2.3)
    .box(2.14, 0.2, 4.64, '#2a2a2a', 0, 0.32, 0)
    .wheel(0.4, 0.3, -1.05, 0.4, 1.5).wheel(0.4, 0.3, 1.05, 0.4, 1.5)
    .wheel(0.4, 0.3, -1.05, 0.4, -1.5).wheel(0.4, 0.3, 1.05, 0.4, -1.5);
  return out(b, 2.4, 2.1);
}

function bus() {
  const b = new B();
  const col = pick(['#f2b705', '#d62828', '#277da1', '#2a9d8f']);
  b.box(2.6, 2.5, 10.6, col, 0, 0.5, 0)
    .box(2.64, 0.85, 9.8, '#27323f', 0, 1.65, -0.1)
    .box(2.2, 1.1, 0.1, '#27323f', 0, 1.6, 5.32)
    .box(2.64, 0.28, 10.62, '#ffffff', 0, 1.1, 0)
    .box(2.5, 0.12, 10.4, '#dddddd', 0, 3.0, 0)
    .box(0.5, 0.2, 0.1, '#fff6c0', -0.9, 0.8, 5.32).box(0.5, 0.2, 0.1, '#fff6c0', 0.9, 0.8, 5.32)
    .box(2.64, 0.2, 10.64, '#2a2a2a', 0, 0.4, 0);
  for (const z of [-3.4, 3.4]) b.wheel(0.55, 0.45, -1.2, 0.55, z).wheel(0.55, 0.45, 1.2, 0.55, z);
  return out(b, 5.5, 3.1);
}

function house() {
  const b = new B();
  const w = rand(7, 9), d = rand(7, 9);
  const stories = R() < 0.4 ? 2 : 1;
  const hgt = 3.1 * stories;
  const wall = pick(WALL), roof = pick(ROOF);
  b.box(w, hgt, d, wall, 0, 0, 0);
  // pyramid roof (square base rotated to line up with walls)
  const rg = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  rg.rotateY(Math.PI / 4);
  rg.scale((w / 2 + 0.7) / 0.7071, 2.4, (d / 2 + 0.7) / 0.7071);
  b.push(rg, roof, 0, hgt + 1.2, 0);
  // door + step
  b.box(1.1, 2.1, 0.12, pick(['#6b3e26', '#2a4d69', '#8c2f39', '#2f5d3a']), rand(-1.5, 1.5), 0, d / 2 + 0.03)
    .box(1.8, 0.18, 0.8, '#aaaaaa', 0, 0, d / 2 + 0.4);
  // windows
  const win = '#9ccdf0';
  for (let s = 0; s < stories; s++) {
    const y = 1.3 + s * 3.1;
    if (s > 0) b.box(1.1, 1.2, 0.1, win, 0, y, d / 2 + 0.03);
    b.box(1.1, 1.2, 0.1, win, -w / 2 + 1.3, y, d / 2 + 0.03).box(1.1, 1.2, 0.1, win, w / 2 - 1.3, y, d / 2 + 0.03);
    b.box(0.1, 1.2, 1.1, win, w / 2 + 0.03, y, 0).box(0.1, 1.2, 1.1, win, -w / 2 - 0.03, y, 0);
    b.box(1.1, 1.2, 0.1, win, 0, y, -d / 2 - 0.03);
  }
  // chimney
  b.box(0.8, 2.2, 0.8, '#8a4b3a', w * 0.25, hgt + 0.6, -d * 0.2);
  return out(b, Math.hypot(w, d) / 2, hgt + 2.6, 'vc', [w / 2, d / 2]);
}

function shop() {
  const b = new B();
  const w = rand(11, 13), d = rand(10, 12), h = rand(7, 9);
  const tint = pick(['#f1d9b5', '#e8b4a0', '#c8d6e5', '#d9e4c8', '#f2e8cf']);
  b.facade(w, h, d, tint, 0, 0, 0);
  // ground-floor storefront
  b.box(w + 0.06, 2.4, d + 0.06, '#3b4a5a', 0, 0.01, 0)
    .box(w * 0.8, 0.12, 0.1, '#ffffff', 0, 2.6, d / 2 + 0.05);
  // striped awning
  const stripes = pick([['#d62828', '#ffffff'], ['#2a9d8f', '#ffffff'], ['#f77f00', '#fff3d6']]);
  const n = 8, sw = (w * 0.9) / n;
  for (let i = 0; i < n; i++) b.box(sw, 0.2, 2, stripes[i % 2], -w * 0.45 + sw * (i + 0.5), 3.2, d / 2 + 1);
  // sign + rooftop gear
  b.box(w * 0.5, 1.1, 0.25, pick(['#e63946', '#1d3557', '#2a9d8f', '#ffb703']), 0, h - 1.3, d / 2 + 0.12)
    .box(2.2, 1, 1.6, '#9aa0a6', -w * 0.25, h, -d * 0.2).box(1.6, 0.9, 1.2, '#9aa0a6', w * 0.2, h, d * 0.15)
    .box(w + 0.4, 0.3, d + 0.4, '#6b7280', 0, h, 0);
  return out(b, Math.hypot(w, d) / 2, h + 1.2, 'bld', [w / 2, d / 2]);
}

function office() {
  const b = new B();
  const w = rand(11, 13), d = rand(11, 13), h = rand(16, 24);
  const tint = pick(GLASS_TINT);
  b.facade(w, h, d, tint, 0, 0, 0)
    .box(w + 0.4, 0.4, d + 0.4, '#6b7280', 0, h, 0)
    .facade(w * 0.55, 3, d * 0.55, tint, 0, h + 0.4, 0)
    .box(2, 1.2, 2, '#9aa0a6', w * 0.3, h + 0.4, d * 0.3)
    .cyl(0.08, 0.1, 4, '#cc3333', -w * 0.15, h + 3.4, 0);
  return out(b, Math.hypot(w, d) / 2, h + 7, 'bld', [w / 2, d / 2]);
}

function skyscraper() {
  const b = new B();
  const tint = pick(['#9cc3e0', '#a9bcd0', '#b7c9c2', '#c2b8a8', '#8fb0cf']);
  const w = 14, d = 14;
  b.facade(w, 15, d, tint, 0, 0, 0)
    .box(w + 0.5, 0.5, d + 0.5, '#5f6672', 0, 15, 0)
    .facade(w * 0.78, 14, d * 0.78, tint, 0, 15.5, 0)
    .box(w * 0.78 + 0.5, 0.5, d * 0.78 + 0.5, '#5f6672', 0, 29.5, 0)
    .facade(w * 0.5, 10, d * 0.5, tint, 0, 30, 0)
    .box(w * 0.5 + 0.4, 0.4, d * 0.5 + 0.4, '#5f6672', 0, 40, 0)
    .cyl(0.12, 0.25, 9, '#d8d8d8', 0, 40.4, 0)
    .sph(0.3, '#ff3b30', 0, 49.6, 0);
  return out(b, Math.hypot(w, d) / 2, 50, 'bld', [w / 2, d / 2]);
}

function fountain() {
  const b = new B();
  b.cyl(3, 3.1, 0.8, '#b7b7b0', 0, 0, 0, 20)
    .cyl(2.6, 2.6, 0.7, '#5cc8f0', 0, 0.2, 0, 20)
    .cyl(0.6, 0.8, 1.6, '#c9c9c2', 0, 0.5, 0, 12)
    .cyl(1.4, 0.5, 0.35, '#c9c9c2', 0, 2.0, 0, 14)
    .sph(0.6, '#9be2ff', 0, 2.7, 0, 1.3);
  return out(b, 3.1, 3.4, 'vc', [3, 3]);
}

function waterTower() {
  const b = new B();
  for (const [sx, sz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) b.cyl(0.18, 0.22, 7, '#5a5f66', sx, 0, sz, 6);
  b.box(3.4, 0.2, 0.15, '#5a5f66', 0, 2.5, 1.4).box(3.4, 0.2, 0.15, '#5a5f66', 0, 2.5, -1.4)
    .cyl(2.2, 2.2, 3.6, '#c7794a', 0, 7, 0, 16)
    .cone(2.4, 1.6, '#6b7280', 0, 10.6, 0, 16)
    .box(2.6, 0.5, 0.1, '#ffffff', 0, 8.6, 2.2);
  return out(b, 2.9, 12.2);
}


/* ---------- people helper (standing figure at an x/z offset) ---------- */
function figure(b, ox, oz, o = {}) {
  const skin = o.skin || pick(SKIN), shirt = o.shirt || pick(SHIRT), pants = o.pants || pick(PANTS), hair = o.hair || pick(HAIR);
  b.box(0.2, 0.8, 0.24, pants, ox - 0.11, 0, oz).box(0.2, 0.8, 0.24, pants, ox + 0.11, 0, oz)
    .box(0.52, 0.72, 0.3, shirt, ox, 0.78, oz)
    .sph(0.19, skin, ox, 1.68, oz)
    .sph(0.2, hair, ox, 1.74, oz - 0.04, 0.7)
    .box(0.13, 0.66, 0.15, shirt, ox - 0.34, 0.8, oz).box(0.13, 0.66, 0.15, shirt, ox + 0.34, 0.8, oz);
}

/* ---------- wheeled things ---------- */
function motorcycle(withRider) {
  const b = new B();
  const col = pick(['#d62828', '#277da1', '#212529', '#f77f00', '#80b918', '#7b2cbf']);
  b.wheel(0.36, 0.14, 0, 0.36, 0.78).wheel(0.36, 0.14, 0, 0.36, -0.78)
    .box(0.4, 0.36, 0.55, '#3a3a3f', 0, 0.28, 0)
    .box(0.32, 0.34, 0.9, col, 0, 0.58, 0.1)
    .box(0.26, 0.12, 0.62, '#1c1c1c', 0, 0.84, -0.3)
    .box(0.08, 0.72, 0.08, '#9aa0a6', 0, 0.3, 0.8)
    .box(0.74, 0.07, 0.07, '#2a2a2a', 0, 1.02, 0.6)
    .box(0.22, 0.2, 0.12, '#fff6c0', 0, 0.82, 0.95)
    .box(0.12, 0.12, 0.5, '#8d8d94', 0.26, 0.2, -0.45);
  if (withRider) {
    const jacket = pick(['#1d1d1f', '#c1121f', '#2a6fdb', '#f4a261']);
    b.box(0.16, 0.5, 0.2, '#2b3a55', -0.24, 0.5, -0.15).box(0.16, 0.5, 0.2, '#2b3a55', 0.24, 0.5, -0.15)
      .box(0.42, 0.62, 0.28, jacket, 0, 0.86, -0.3)
      .box(0.12, 0.12, 0.62, jacket, -0.28, 1.15, 0.12).box(0.12, 0.12, 0.62, jacket, 0.28, 1.15, 0.12)
      .sph(0.22, pick(['#ffffff', '#d62828', '#111111', '#ffd23f']), 0, 1.65, -0.22);
  }
  return out(b, 1.25, 1.9);
}

function bicycle(withRider) {
  const b = new B();
  const col = pick(['#e63946', '#2a9d8f', '#457b9d', '#f4a261', '#9b5de5', '#2b2d42']);
  for (const z of [-0.55, 0.55]) b.push(new THREE.TorusGeometry(0.34, 0.035, 6, 16), '#1a1a1a', 0, 0.37, z, 0, Math.PI / 2, 0);
  b.box(0.05, 0.05, 0.9, col, 0, 0.66, 0)
    .box(0.05, 0.46, 0.05, col, 0, 0.42, -0.3)
    .box(0.05, 0.56, 0.05, col, 0, 0.38, 0.52)
    .box(0.05, 0.32, 0.05, '#222222', 0, 0.7, 0.5)
    .box(0.5, 0.04, 0.04, '#222222', 0, 1.0, 0.5)
    .box(0.13, 0.05, 0.26, '#222222', 0, 0.9, -0.3);
  if (withRider) {
    const shirt = pick(SHIRT);
    b.box(0.14, 0.6, 0.16, pick(PANTS), -0.14, 0.4, -0.2).box(0.14, 0.6, 0.16, pick(PANTS), 0.14, 0.4, -0.2)
      .box(0.38, 0.55, 0.25, shirt, 0, 0.98, -0.12)
      .box(0.1, 0.1, 0.5, shirt, -0.22, 1.1, 0.16).box(0.1, 0.1, 0.5, shirt, 0.22, 1.1, 0.16)
      .sph(0.17, pick(SKIN), 0, 1.68, -0.02)
      .sph(0.19, pick(['#d62828', '#ffd23f', '#2a9d8f', '#ffffff']), 0, 1.74, -0.04, 0.7);
  }
  return out(b, 1.0, 1.9);
}

function scooter() {
  const b = new B();
  const col = pick(['#e63946', '#2a9d8f', '#ffbe0b', '#3a86ff', '#8338ec']);
  const shirt = pick(SHIRT);
  b.box(0.3, 0.06, 0.95, col, 0, 0.14, 0)
    .wheel(0.11, 0.06, 0, 0.11, 0.55).wheel(0.11, 0.06, 0, 0.11, -0.55)
    .box(0.05, 1.0, 0.05, '#9aa0a6', 0, 0.15, 0.52)
    .box(0.5, 0.04, 0.04, '#222222', 0, 1.14, 0.52)
    .box(0.14, 0.8, 0.16, pick(PANTS), -0.11, 0.18, -0.1).box(0.14, 0.8, 0.16, pick(PANTS), 0.11, 0.18, -0.1)
    .box(0.4, 0.62, 0.25, shirt, 0, 0.98, -0.1)
    .box(0.1, 0.1, 0.55, shirt, -0.23, 1.28, 0.2).box(0.1, 0.1, 0.55, shirt, 0.23, 1.28, 0.2)
    .sph(0.18, pick(SKIN), 0, 1.8, -0.08)
    .sph(0.19, pick(HAIR), 0, 1.86, -0.12, 0.7);
  return out(b, 0.65, 2.0);
}

function dogWalker() {
  const b = new B();
  const dog = pick(['#8b5a2b', '#222222', '#f2efe6', '#c9a15a', '#6b6b6b']);
  const dark = '#2a2a2a';
  figure(b, 0, -0.55);
  // the dog trots about a metre ahead of its owner, on a red leash
  b.box(0.3, 0.3, 0.62, dog, 0, 0.32, 0.8)
    .box(0.22, 0.22, 0.26, dog, 0, 0.5, 1.2)
    .box(0.1, 0.1, 0.12, dark, 0, 0.46, 1.36)
    .box(0.05, 0.12, 0.08, dark, -0.09, 0.66, 1.16).box(0.05, 0.12, 0.08, dark, 0.09, 0.66, 1.16)
    .box(0.06, 0.06, 0.3, dog, 0, 0.5, 0.42)
    .box(0.07, 0.24, 0.07, dog, -0.1, 0, 0.98).box(0.07, 0.24, 0.07, dog, 0.1, 0, 0.98)
    .box(0.07, 0.24, 0.07, dog, -0.1, 0, 0.62).box(0.07, 0.24, 0.07, dog, 0.1, 0, 0.62)
    .box(0.03, 0.03, 1.3, '#d33333', 0.2, 0.72, 0.28);
  return out(b, 1.05, 1.9);
}

/* ---------- RX Gym (crossfit box) + equipment + athletes ---------- */
export const SIGN = (() => {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#101114'; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#e11d2e'; g.lineWidth = 12; g.strokeRect(10, 10, 1004, 236);
  g.fillStyle = '#e11d2e'; g.fillRect(40, 40, 290, 176);
  g.fillStyle = '#ffffff';
  g.font = '900 150px "Arial Black", Impact, Arial, sans-serif';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText('RX', 185, 136);
  g.textAlign = 'left';
  g.fillText('GYM', 365, 128);
  g.font = '700 34px Arial, sans-serif';
  g.fillStyle = '#c9ccd1';
  g.fillText('CROSSFIT  •  STRENGTH  •  CONDITIONING', 366, 218);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return {
    geo: new THREE.PlaneGeometry(7.4, 1.85),
    mat: new THREE.MeshBasicMaterial({ map: tex }),
  };
})();

function gym() {
  const b = new B();
  const w = 12, d = 8, h = 6.4;
  b.facade(w, h, d, '#7d828c', 0, 0, 0)
    .box(w + 0.5, 0.35, d + 0.5, '#23262c', 0, h, 0)
    .box(w + 0.08, 0.9, d + 0.08, '#d62828', 0, h - 1.45, 0)
    // roll-up garage door with ribs + entrance door
    .box(6, 3.4, 0.14, '#cfd2d8', -1.6, 0, d / 2 + 0.07)
    .box(1.7, 2.6, 0.14, '#1c1c1f', 3.9, 0, d / 2 + 0.07);
  for (let i = 1; i < 7; i++) b.box(6, 0.05, 0.16, '#8b8f97', -1.6, i * 0.48, d / 2 + 0.08);
  b.box(2.6, 0.9, 1.4, '#9aa0a6', -3, h + 0.35, 0).box(1.6, 0.7, 1.2, '#9aa0a6', 2.5, h + 0.35, 1);
  const o = out(b, Math.hypot(w, d) / 2, h + 1.4, 'bld', [w / 2, d / 2]);
  o.sign = [0, h - 1.0, d / 2 + 0.12];
  return o;
}

function pullupRig() {
  const b = new B();
  const fr = '#2b2b30';
  b.box(0.16, 3.3, 0.16, fr, -2, 0, 0).box(0.16, 3.3, 0.16, fr, 2, 0, 0)
    .box(0.14, 0.1, 1.5, fr, -2, 0, 0).box(0.14, 0.1, 1.5, fr, 2, 0, 0)
    .box(4.2, 0.1, 0.1, '#b9bec7', 0, 3.1, 0).box(4.2, 0.08, 0.08, '#b9bec7', 0, 2.45, 0)
    .box(4.16, 0.06, 0.06, fr, 0, 3.28, 0)
    .box(0.1, 0.1, 1.2, '#d62828', -2, 1.6, 0).box(0.1, 0.1, 1.2, '#d62828', 2, 1.6, 0);
  return out(b, 2.25, 3.4);
}

function squatRack() {
  const b = new B();
  const fr = '#2b2b30';
  b.box(0.14, 2.3, 0.14, fr, -0.85, 0, -0.35).box(0.14, 2.3, 0.14, fr, 0.85, 0, -0.35)
    .box(0.14, 2.3, 0.14, fr, -0.85, 0, 0.35).box(0.14, 2.3, 0.14, fr, 0.85, 0, 0.35)
    .box(1.8, 0.1, 0.1, fr, 0, 2.2, -0.35).box(1.8, 0.1, 0.1, fr, 0, 2.2, 0.35)
    .box(0.1, 0.1, 0.8, fr, -0.85, 0.05, 0).box(0.1, 0.1, 0.8, fr, 0.85, 0.05, 0)
    .push(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8), '#b9bec7', 0, 1.55, -0.35, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) {
    b.wheel(0.3, 0.09, sx * 1.0, 1.55, -0.35, '#d62828').wheel(0.26, 0.09, sx * 1.12, 1.55, -0.35, '#1c1c1f');
  }
  return out(b, 1.6, 2.4);
}

function kettlebell() {
  const b = new B();
  const col = pick(['#1c1c1f', '#d62828', '#2a6fdb', '#2a9d8f']);
  b.sph(0.2, col, 0, 0.22, 0)
    .box(0.05, 0.22, 0.05, col, -0.1, 0.36, 0).box(0.05, 0.22, 0.05, col, 0.1, 0.36, 0)
    .box(0.25, 0.05, 0.05, col, 0, 0.55, 0);
  return out(b, 0.3, 0.6);
}

function tire() {
  const b = new B();
  b.push(new THREE.TorusGeometry(0.62, 0.3, 8, 18), '#202024', 0, 0.3, 0, Math.PI / 2, 0, 0);
  return out(b, 0.95, 0.62);
}

function plyoBox() {
  const b = new B();
  const col = pick(['#c8913a', '#d9a65a', '#b07a2c']);
  b.box(0.9, 0.85, 0.7, col, 0, 0, 0).box(0.92, 0.06, 0.72, '#8a5a1f', 0, 0.8, 0).box(0.3, 0.2, 0.02, '#6b4410', 0, 0.35, 0.36);
  return out(b, 0.65, 0.95);
}

function rower() {
  const b = new B();
  b.box(0.22, 0.12, 2.3, '#26262b', 0, 0.3, 0)
    .box(0.3, 0.06, 0.34, '#4b4b52', 0, 0.42, 0.35)
    .wheel(0.34, 0.14, 0, 0.62, -1.0, '#3a3a40')
    .box(0.1, 0.4, 0.1, '#26262b', 0, 0.12, -0.95)
    .box(0.1, 0.4, 0.1, '#26262b', 0, 0.12, 1.0)
    .box(0.6, 0.05, 0.05, '#d62828', 0, 0.9, -0.85)
    .box(0.4, 0.06, 0.2, '#26262b', 0, 0.36, 0.9);
  return out(b, 1.35, 1.0);
}

function athlete() {
  const b = new B();
  const skin = pick(SKIN);
  const top = pick(['#e11d2e', '#111111', '#ffffff', '#00bbf9', '#ffd23f', '#9b5de5', '#ff7b00']);
  const shorts = pick(['#111111', '#2b3a55', '#e11d2e', '#444444']);
  // tank top + shorts: bare arms and lower legs
  b.box(0.2, 0.4, 0.24, skin, -0.11, 0, 0).box(0.2, 0.4, 0.24, skin, 0.11, 0, 0)
    .box(0.21, 0.42, 0.25, shorts, -0.11, 0.4, 0).box(0.21, 0.42, 0.25, shorts, 0.11, 0.4, 0)
    .box(0.52, 0.7, 0.3, top, 0, 0.8, 0)
    .sph(0.19, skin, 0, 1.68, 0)
    .sph(0.2, pick(HAIR), 0, 1.74, -0.04, 0.7);
  const pose = pick(['squat', 'press', 'squat', 'normal']);
  if (pose === 'squat') b.box(0.12, 0.12, 0.6, skin, -0.34, 1.25, 0.3).box(0.12, 0.12, 0.6, skin, 0.34, 1.25, 0.3);
  else if (pose === 'press') b.box(0.12, 0.62, 0.12, skin, -0.34, 1.35, 0).box(0.12, 0.62, 0.12, skin, 0.34, 1.35, 0);
  else b.box(0.13, 0.66, 0.15, skin, -0.34, 0.8, 0).box(0.13, 0.66, 0.15, skin, 0.34, 0.8, 0);
  return out(b, 0.4, 1.95);
}


/* ---------- electric vehicles ---------- */
let teslaCount = 0;
function tesla() {
  const b = new B();
  const suv = (teslaCount++ % 8) >= 5; // 5 sedans (Model S/3 style) then 3 crossovers (Model Y style)
  const col = pick(['#f5f5f5', '#c8102e', '#1d1d1f', '#2a4fd6', '#aeb3ba', '#7a7f87']);
  const glass = '#151c26';
  const bodyH = suv ? 0.62 : 0.52;
  b.box(1.92, bodyH, 4.6, col, 0, 0.34, 0)
    // gently sloped hood and trunk
    .push(new THREE.BoxGeometry(1.86, 0.12, 1.5), col, 0, 0.34 + bodyH, 1.6, 0.1)
    .push(new THREE.BoxGeometry(1.86, 0.12, 1.0), col, 0, 0.34 + bodyH, -1.9, -0.08)
    .box(1.94, 0.12, 4.62, '#25272c', 0, 0.28, 0);
  // panoramic glass roof: a flattened dome
  const dome = new THREE.SphereGeometry(1, 18, 10);
  dome.scale(0.9, suv ? 0.56 : 0.42, suv ? 1.7 : 1.55);
  b.push(dome, glass, 0, 0.34 + bodyH - 0.02, suv ? -0.35 : -0.1);
  // slim light bars (no grille on a Tesla)
  b.box(0.55, 0.07, 0.06, '#e8f6ff', -0.62, 0.34 + bodyH * 0.55, 2.31).box(0.55, 0.07, 0.06, '#e8f6ff', 0.62, 0.34 + bodyH * 0.55, 2.31)
    .box(1.75, 0.07, 0.05, '#ff2a2a', 0, 0.34 + bodyH * 0.8, -2.31);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.wheel(0.38, 0.28, sx * 0.95, 0.38, sz * 1.45, '#16161a').wheel(0.26, 0.3, sx * 0.95, 0.38, sz * 1.45, '#cfd3d9');
  }
  return out(b, 2.35, suv ? 1.7 : 1.5);
}

// Cybertruck: a stainless-steel wedge. The body is a box whose top edge is bent into the famous slanted profile.
function cybertruck() {
  const b = new B();
  const steel = pick(['#b9bec6', '#b9bec6', '#2b2d31', '#e9ecef']);
  const W = 2.2, L = 5.6, base = 0.45;
  const Zs = [-2.8, -1.2, -0.2, 1.1, 2.8];
  const Ys = [1.3, 1.95, 1.95, 1.15, 0.8];
  const g = new THREE.BoxGeometry(W, 1, L, 1, 1, 4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round((pos.getZ(i) + L / 2) / (L / 4));
    const top = pos.getY(i) > 0;
    pos.setZ(i, Zs[k]);
    pos.setY(i, top ? Ys[k] : base);
    if (top) pos.setX(i, pos.getX(i) * 0.84); // narrower roof
  }
  g.computeVertexNormals();
  b.push(g, steel, 0, 0, 0);
  const glass = '#12161d';
  // slanted windshield, side windows, light bars
  b.push(new THREE.BoxGeometry(1.7, 0.04, 1.55), glass, 0, 1.58, 0.45, Math.atan2(1.95 - 1.15, 1.3));
  b.box(2.0, 0.34, 1.7, glass, 0, 1.08, -0.45)
    .box(1.9, 0.06, 0.06, '#f4fbff', 0, 0.62, 2.78)
    .box(1.9, 0.07, 0.05, '#ff2a2a', 0, 1.12, -2.8)
    .box(2.24, 0.12, 5.2, '#1c1d20', 0, 0.38, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.wheel(0.5, 0.34, sx * 1.06, 0.5, sz * 1.8, '#16161a').wheel(0.3, 0.36, sx * 1.06, 0.5, sz * 1.8, '#9aa0a8');
  }
  return out(b, 3.0, 2.1);
}


/* ---------- Halloween ---------- */
function pumpkin(big) {
  const b = new B();
  const s = big ? 1.5 : 1;
  const col = pick(['#ff7a1a', '#f26a0f', '#ff8c2b']);
  const glow = '#ffe45c';
  const angry = R() < 0.5;
  b.sph(0.5 * s, col, 0, 0.42 * s, 0, 0.82)
    .sph(0.4 * s, '#e8630d', -0.24 * s, 0.42 * s, 0, 0.82).sph(0.4 * s, '#e8630d', 0.24 * s, 0.42 * s, 0, 0.82)
    .box(0.12 * s, 0.22 * s, 0.12 * s, '#3f6b2a', 0, 0.74 * s, 0);
  // carved, glowing face on the +z side (big features so it reads from the high camera)
  for (const sx of [-1, 1]) {
    b.push(new THREE.BoxGeometry(0.2 * s, 0.14 * s, 0.08 * s), glow, sx * 0.2 * s, 0.56 * s, 0.5 * s, 0, 0, angry ? -sx * 0.5 : 0);
  }
  b.box(0.11 * s, 0.11 * s, 0.08 * s, glow, 0, 0.44 * s, 0.52 * s)
    .box(0.5 * s, 0.1 * s, 0.08 * s, glow, 0, 0.27 * s, 0.5 * s)
    .box(0.09 * s, 0.13 * s, 0.08 * s, glow, -0.17 * s, 0.2 * s, 0.5 * s)
    .box(0.09 * s, 0.13 * s, 0.08 * s, glow, 0.17 * s, 0.2 * s, 0.5 * s);
  return out(b, 0.52 * s, 0.95 * s);
}

function tombstone() {
  const b = new B();
  const col = pick(['#8d939c', '#7b818a', '#a1a6ad']);
  if (R() < 0.35) { // cross
    b.box(0.2, 1.1, 0.2, col, 0, 0, 0).box(0.7, 0.2, 0.2, col, 0, 0.7, 0).box(0.9, 0.12, 0.6, '#6f747c', 0, 0, 0);
  } else { // rounded headstone
    b.box(0.85, 0.85, 0.2, col, 0, 0, 0)
      .push(new THREE.CylinderGeometry(0.425, 0.425, 0.2, 14), col, 0, 0.85, 0, Math.PI / 2)
      .box(0.5, 0.06, 0.04, '#5d626a', 0, 0.7, 0.11).box(0.4, 0.06, 0.04, '#5d626a', 0, 0.55, 0.11)
      .box(1.0, 0.12, 0.5, '#6f747c', 0, 0, 0.05);
  }
  return out(b, 0.65, 1.4);
}

// Trick-or-treaters: kids in costume carrying a candy bucket. Eight costumes cycle through the variants.
let kidCount = 0;
function trickOrTreater() {
  const b = new B();
  const c = kidCount++ % 8;
  const skin = pick(SKIN);
  const bagCol = pick(['#ff7a00', '#ff7a00', '#7b2cbf', '#2b2b30']);
  const bucket = (x, y, z) => { // candy bucket with handle and a few sweets
    b.cyl(0.21, 0.16, 0.28, bagCol, x, y, z, 10).box(0.3, 0.03, 0.03, '#4a4a4a', x, y + 0.36, z)
      .sph(0.07, '#ff4d6d', x - 0.06, y + 0.3, z).sph(0.07, '#ffe14d', x + 0.06, y + 0.3, z + 0.03).sph(0.06, '#4dd0ff', x, y + 0.32, z - 0.05);
  };
  const legs = (col, h = 0.8) => b.box(0.2, h, 0.24, col, -0.11, 0.8 - h, 0).box(0.2, h, 0.24, col, 0.11, 0.8 - h, 0);
  const torso = (col) => b.box(0.52, 0.72, 0.3, col, 0, 0.78, 0);
  const armsDown = (col) => b.box(0.13, 0.66, 0.15, col, -0.34, 0.8, 0).box(0.13, 0.66, 0.15, col, 0.34, 0.8, 0);
  const armsOut = (col) => b.box(0.12, 0.12, 0.65, col, -0.3, 1.25, 0.4).box(0.12, 0.12, 0.65, col, 0.3, 1.25, 0.4);
  const head = (col, y = 1.68) => b.sph(0.19, col, 0, y, 0);
  const eyes = (col, y = 1.7) => b.box(0.05, 0.05, 0.04, col, -0.07, y, 0.18).box(0.05, 0.05, 0.04, col, 0.07, y, 0.18);

  if (c === 0) { // ghost in a bedsheet
    b.cyl(0.34, 0.56, 1.55, '#f4f4f8', 0, 0, 0, 14).sph(0.36, '#f4f4f8', 0, 1.56, 0, 0.95)
      .box(0.1, 0.2, 0.06, '#111111', -0.13, 1.5, 0.35).box(0.1, 0.2, 0.06, '#111111', 0.13, 1.5, 0.35)
      .box(0.11, 0.13, 0.06, '#111111', 0, 1.22, 0.36)
      .box(0.1, 0.1, 0.45, '#f4f4f8', 0.4, 0.9, 0.18);
    bucket(0.45, 0.6, 0.42);
  } else if (c === 1) { // zombie
    const z = '#8fbf7a';
    legs('#3d3d46', 0.6); b.box(0.2, 0.2, 0.24, z, -0.11, 0, 0).box(0.2, 0.2, 0.24, z, 0.11, 0, 0);
    torso('#5b4a3a'); b.box(0.2, 0.2, 0.02, z, 0.1, 1.0, 0.16);
    armsOut(z); head(z);
    b.sph(0.2, '#2b2018', 0, 1.76, -0.05, 0.5);
    eyes('#c1121f'); b.box(0.1, 0.03, 0.04, '#331111', 0, 1.6, 0.18);
    bucket(0.3, 0.9, 0.72);
  } else if (c === 2) { // witch
    b.cyl(0.16, 0.46, 1.0, '#2a2230', 0, 0, 0, 12);
    b.box(0.44, 0.5, 0.28, '#6b2fa0', 0, 0.95, 0);
    armsDown('#6b2fa0'); head('#7bbf6a');
    b.box(0.05, 0.08, 0.05, '#6aa85a', 0, 1.65, 0.2)
      .cyl(0.46, 0.46, 0.04, '#1b1520', 0, 1.74, 0, 16).cyl(0, 0.3, 0.65, '#1b1520', 0, 1.78, 0, 12)
      .box(0.34, 0.06, 0.34, '#ff7a00', 0, 1.8, 0);
    eyes('#111111');
    b.box(0.1, 0.1, 0.4, '#6b2fa0', 0.34, 0.9, 0.15);
    bucket(0.4, 0.62, 0.38);
  } else if (c === 3) { // vampire
    const pale = '#e8e0ea';
    b.box(0.72, 1.15, 0.1, '#16161b', 0, 0.55, -0.22).box(0.64, 1.05, 0.04, '#a30f1f', 0, 0.58, -0.16);
    legs('#111114'); torso('#111114'); b.box(0.14, 0.5, 0.02, '#f2f2f2', 0, 0.92, 0.16);
    armsDown('#111114'); head(pale);
    b.sph(0.2, '#0f0f12', 0, 1.74, -0.05, 0.7);
    b.box(0.03, 0.05, 0.03, '#ffffff', -0.04, 1.6, 0.18).box(0.03, 0.05, 0.03, '#ffffff', 0.04, 1.6, 0.18);
    eyes('#c1121f', 1.71);
    bucket(0.42, 0.55, 0.12);
  } else if (c === 4) { // skeleton
    const k = '#15151a', w = '#f4f4f4';
    legs(k); torso(k); armsDown(k);
    for (const sx of [-1, 1]) b.box(0.06, 0.7, 0.02, w, sx * 0.11, 0.05, 0.13).box(0.05, 0.55, 0.02, w, sx * 0.34, 0.85, 0.09);
    for (const y of [0.95, 1.1, 1.25]) b.box(0.4, 0.04, 0.02, w, 0, y, 0.16);
    b.box(0.05, 0.6, 0.02, w, 0, 0.85, 0.16);
    head(w); b.box(0.07, 0.08, 0.03, '#000000', -0.07, 1.7, 0.19).box(0.07, 0.08, 0.03, '#000000', 0.07, 1.7, 0.19)
      .box(0.04, 0.05, 0.03, '#000000', 0, 1.63, 0.19).box(0.18, 0.06, 0.1, w, 0, 1.52, 0.08);
    bucket(0.42, 0.55, 0.1);
  } else if (c === 5) { // mummy
    const m = '#e6dcc3', d = '#c9bd9f';
    legs(m); torso(m); armsOut(m); head(m);
    for (const y of [0.85, 1.0, 1.15, 1.3]) b.box(0.54, 0.04, 0.32, d, 0, y, 0);
    for (const y of [0.15, 0.4, 0.62]) b.box(0.5, 0.04, 0.26, d, 0, y, 0);
    b.box(0.12, 0.05, 0.03, '#222222', -0.07, 1.7, 0.19).box(0.12, 0.05, 0.03, '#222222', 0.07, 1.7, 0.19);
    bucket(0.3, 0.9, 0.72);
  } else if (c === 6) { // little devil
    const r = '#c1121f';
    legs(r); torso(r); armsDown(r); head('#d62828');
    b.cone(0.06, 0.24, '#1a1a1a', -0.1, 1.82, 0, 6).cone(0.06, 0.24, '#1a1a1a', 0.1, 1.82, 0, 6)
      .box(0.04, 0.04, 0.6, r, 0, 0.5, -0.35).cone(0.07, 0.14, '#1a1a1a', 0, 0.44, -0.72, 4);
    eyes('#ffd23f');
    bucket(0.42, 0.55, 0.1);
  } else { // kid in a pumpkin costume
    b.box(0.18, 0.5, 0.2, '#222222', -0.12, 0, 0).box(0.18, 0.5, 0.2, '#222222', 0.12, 0, 0)
      .sph(0.52, '#ff7a1a', 0, 0.85, 0, 1.0)
      .sph(0.4, '#e8630d', -0.26, 0.85, 0, 1.0).sph(0.4, '#e8630d', 0.26, 0.85, 0, 1.0);
    head(skin, 1.58);
    b.box(0.12, 0.2, 0.12, '#3f6b2a', 0, 1.74, 0).box(0.24, 0.05, 0.1, '#4f8a35', 0.12, 1.82, 0);
    for (const sx of [-1, 1]) b.push(new THREE.BoxGeometry(0.14, 0.1, 0.07), '#ffd54a', sx * 0.18, 0.98, 0.48, 0, 0, -sx * 0.5);
    b.box(0.3, 0.07, 0.07, '#ffd54a', 0, 0.68, 0.5)
      .box(0.1, 0.1, 0.4, '#ff7a1a', 0.52, 0.8, 0.15);
    eyes('#111111', 1.6);
    bucket(0.6, 0.55, 0.3);
  }
  const o = out(b, 0.4, 1.95);
  o.geo.scale(0.8, 0.8, 0.8); // kids are smaller than adults
  o.geo.computeBoundingSphere();
  o.r = 0.34; o.h = 1.6;
  return o;
}


/* ---------- street signals ---------- */
let signalCount = 0;
function trafficLight() {
  const b = new B();
  const active = signalCount++ % 3; // which lamp is lit: red, yellow or green
  const bright = ['#ff3b30', '#ffd60a', '#34c759'], dim = ['#4a1512', '#4a4210', '#12401f'];
  b.cyl(0.11, 0.14, 4.7, '#3d4046', 0, 0, 0).box(0.14, 0.14, 2.1, '#3d4046', 0, 4.35, 1.0)
    .box(0.44, 1.25, 0.36, '#1c1c1f', 0, 3.5, 2.0);
  [0, 1, 2].forEach((i) => {
    const col = i === active ? bright[i] : dim[i];
    const y = 4.4 - i * 0.37;
    b.sph(0.13, col, 0, y, 2.2, 1).sph(0.13, col, 0, y, 1.8, 1);
  });
  return out(b, 0.4, 4.9);
}

function stopSign() {
  const b = new B();
  const oct = (r, h) => { const g = new THREE.CylinderGeometry(r, r, h, 8); g.rotateY(Math.PI / 8); return g; };
  b.cyl(0.045, 0.055, 2.5, '#9aa0a8', 0, 0, 0)
    .push(oct(0.5, 0.04), '#ffffff', 0, 2.3, 0, Math.PI / 2)
    .push(oct(0.45, 0.05), '#c1121f', 0, 2.3, 0.03, Math.PI / 2);
  for (const x of [-0.2, -0.07, 0.07, 0.2]) b.box(0.08, 0.15, 0.03, '#ffffff', x, 2.23, 0.07);
  return out(b, 0.3, 2.9);
}

/* ---------- airport ---------- */
function jet() {
  const b = new B();
  const livery = pick(['#d62828', '#1d4ed8', '#15803d', '#ea580c']);
  const body = '#f4f6f8', glass = '#27323f', Y = 1.6;
  b.push(new THREE.CylinderGeometry(0.95, 0.95, 15, 14), body, 0, Y, 0, Math.PI / 2)
    .push(new THREE.CylinderGeometry(0.28, 0.95, 2.6, 14), body, 0, Y, 8.8, Math.PI / 2)
    .push(new THREE.CylinderGeometry(0.95, 0.3, 3.2, 14), body, 0, Y, -9.1, Math.PI / 2)
    .box(1.92, 0.3, 10, livery, 0, Y - 0.1, -0.5)
    .box(1.96, 0.22, 9, glass, 0, Y + 0.4, 0.8)
    .box(1.3, 0.3, 0.8, glass, 0, Y + 0.55, 7.2)
    .push(new THREE.BoxGeometry(6.8, 0.16, 2.6), body, -3.6, Y - 0.4, 0.3, 0, -0.3)
    .push(new THREE.BoxGeometry(6.8, 0.16, 2.6), body, 3.6, Y - 0.4, 0.3, 0, 0.3)
    .box(0.1, 0.8, 0.8, livery, -6.85, Y - 0.2, -0.7).box(0.1, 0.8, 0.8, livery, 6.85, Y - 0.2, -0.7)
    .push(new THREE.CylinderGeometry(0.5, 0.45, 2.4, 10), '#9aa0a8', -2.9, Y - 0.95, 1.2, Math.PI / 2)
    .push(new THREE.CylinderGeometry(0.5, 0.45, 2.4, 10), '#9aa0a8', 2.9, Y - 0.95, 1.2, Math.PI / 2)
    .push(new THREE.BoxGeometry(0.22, 3.0, 2.4), livery, 0, Y + 2.2, -8.0, -0.4)
    .box(5.2, 0.14, 1.5, body, 0, Y + 0.9, -8.7)
    .box(0.12, 0.9, 0.12, '#555555', 0, 0.3, 5.2).wheel(0.3, 0.2, 0, 0.3, 5.2)
    .box(0.12, 0.9, 0.12, '#555555', -1.3, 0.3, -0.5).box(0.12, 0.9, 0.12, '#555555', 1.3, 0.3, -0.5)
    .wheel(0.38, 0.26, -1.3, 0.38, -0.5).wheel(0.38, 0.26, 1.3, 0.38, -0.5);
  const o = out(b, 10, 6);
  o.geo.scale(0.66, 0.66, 0.66); // regional-jet size so it fits the city's scale
  o.geo.computeBoundingSphere();
  o.r = 6.4; o.h = 4.4;
  return o;
}

function prop() {
  const b = new B();
  const col = pick(['#d62828', '#1d4ed8', '#f59e0b', '#15803d']);
  const body = '#f6f6f2', Y = 1.2;
  b.push(new THREE.CylinderGeometry(0.5, 0.5, 5.4, 12), body, 0, Y, 0, Math.PI / 2)
    .push(new THREE.CylinderGeometry(0.4, 0.5, 1.2, 12), '#d9d9d4', 0, Y, 3.2, Math.PI / 2)
    .push(new THREE.CylinderGeometry(0.5, 0.18, 2.6, 12), body, 0, Y + 0.05, -3.9, Math.PI / 2)
    .box(1.04, 0.22, 4.2, col, 0, Y - 0.1, -0.3)
    .box(0.95, 0.28, 1.1, '#27323f', 0, Y + 0.38, 0.7)
    .box(9, 0.12, 1.5, body, 0, Y + 0.62, 0.5).box(9, 0.14, 0.3, col, 0, Y + 0.62, -0.2)
    .box(0.1, 0.8, 0.14, '#cfcfca', -1.8, Y + 0.1, 0.5).box(0.1, 0.8, 0.14, '#cfcfca', 1.8, Y + 0.1, 0.5)
    .push(new THREE.BoxGeometry(0.12, 1.4, 1.1), col, 0, Y + 0.95, -4.4, -0.3)
    .box(2.8, 0.1, 0.8, body, 0, Y + 0.45, -4.5)
    .box(2.3, 0.12, 0.08, '#222222', 0, Y, 3.85).box(0.12, 2.3, 0.08, '#222222', 0, Y, 3.85)
    .wheel(0.26, 0.14, -0.95, 0.26, 0.5).wheel(0.26, 0.14, 0.95, 0.26, 0.5).wheel(0.2, 0.12, 0, 0.2, 2.5)
    .box(0.07, 0.7, 0.07, '#555555', -0.95, 0.25, 0.5).box(0.07, 0.7, 0.07, '#555555', 0.95, 0.25, 0.5);
  return out(b, 4.4, 3.3);
}

function terminal() {
  const b = new B();
  const w = 22, d = 7, h = 7;
  b.facade(w, h, d, '#9db6c6', 0, 0, 0)
    .box(w + 0.8, 0.4, d + 0.8, '#5f6672', 0, h, 0)
    .box(w - 1, 1.4, d - 1, '#cfd6dc', 0, h + 0.4, 0)
    .box(w * 0.8, 0.5, 2.6, '#27323f', 0, 3.2, -d / 2 - 1.3) // canopy over the doors (planes side)
    .box(0.3, 3.2, 0.3, '#9aa0a8', -w * 0.4, 0, -d / 2 - 2.4).box(0.3, 3.2, 0.3, '#9aa0a8', w * 0.4, 0, -d / 2 - 2.4);
  return out(b, Math.hypot(w, d) / 2, h + 1.8, 'bld', [w / 2, d / 2]);
}

function hangar() {
  const b = new B();
  const w = 18, d = 10, h = 6;
  b.box(w, h, d, '#aab2bd', 0, 0, 0)
    .box(w * 0.7, h * 0.85, 0.3, '#4b5563', 0, 0, -d / 2 - 0.1)
    .box(w * 0.7, 0.18, 0.34, '#d62828', 0, h * 0.6, -d / 2 - 0.12)
    .box(w * 0.7, 0.18, 0.34, '#d62828', 0, h * 0.3, -d / 2 - 0.12);
  const rg = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  rg.rotateY(Math.PI / 4);
  rg.scale((w / 2 + 0.5) / 0.7071, 2.6, (d / 2 + 0.5) / 0.7071);
  b.push(rg, '#6b7684', 0, h + 1.3, 0);
  return out(b, Math.hypot(w, d) / 2, h + 2.6, 'vc', [w / 2, d / 2]);
}

function tower() {
  const b = new B();
  b.cyl(2.4, 2.8, 8, '#d8d8d8', 0, 0, 0, 14).cyl(1.5, 1.8, 14, '#c9ccd1', 0, 8, 0, 14)
    .cyl(3.4, 2.2, 1.2, '#d8d8d8', 0, 22, 0, 14).cyl(3.5, 3.5, 2.4, '#27414f', 0, 23.2, 0, 14)
    .cyl(3.8, 3.8, 0.4, '#d8d8d8', 0, 25.6, 0, 14).cone(3.6, 1.4, '#c1121f', 0, 26, 0, 14)
    .cyl(0.08, 0.1, 5, '#cc3333', 0, 27.4, 0, 6);
  return out(b, 3.8, 32, 'vc', [2.6, 2.6]);
}

/* ---------- registry ---------- */
// pts = score; needF = fraction of footprint radius the hole must reach to swallow it
export const TYPES = {
  person: { make: person, n: 10, pts: 10, needF: 0.85 },
  cone: { make: cone, n: 2, pts: 4, needF: 0.85 },
  trashcan: { make: trashcan, n: 3, pts: 5, needF: 0.85 },
  hydrant: { make: hydrant, n: 1, pts: 6, needF: 0.85 },
  bench: { make: bench, n: 1, pts: 12, needF: 0.85 },
  bush: { make: bush, n: 4, pts: 6, needF: 0.85 },
  treeRound: { make: treeRound, n: 6, pts: 20, needF: 0.85 },
  treePine: { make: treePine, n: 2, pts: 24, needF: 0.85 },
  treeOak: { make: treeOak, n: 3, pts: 40, needF: 0.85 },
  lamp: { make: lamp, n: 1, pts: 15, needF: 0.85 },
  car: { make: car, n: 12, pts: 40, needF: 0.85 },
  van: { make: van, n: 4, pts: 55, needF: 0.85 },
  bus: { make: bus, n: 4, pts: 150, needF: 0.85 },
  house: { make: house, n: 8, pts: 250, needF: 0.85 },
  shop: { make: shop, n: 6, pts: 450, needF: 0.85 },
  office: { make: office, n: 5, pts: 650, needF: 0.85 },
  skyscraper: { make: skyscraper, n: 3, pts: 1300, needF: 0.85 },
  fountain: { make: fountain, n: 1, pts: 100, needF: 0.85 },
  waterTower: { make: waterTower, n: 1, pts: 300, needF: 0.85 },
  motorcycle: { make: () => motorcycle(true), n: 5, pts: 35, needF: 0.85 },
  motorcycleParked: { make: () => motorcycle(false), n: 3, pts: 25, needF: 0.85 },
  bicycle: { make: () => bicycle(true), n: 6, pts: 25, needF: 0.85 },
  bikeParked: { make: () => bicycle(false), n: 3, pts: 10, needF: 0.85 },
  scooter: { make: scooter, n: 6, pts: 22, needF: 0.85 },
  dogWalker: { make: dogWalker, n: 8, pts: 30, needF: 0.85 },
  gym: { make: gym, n: 1, pts: 400, needF: 0.85 },
  pullupRig: { make: pullupRig, n: 1, pts: 60, needF: 0.85 },
  squatRack: { make: squatRack, n: 1, pts: 50, needF: 0.85 },
  kettlebell: { make: kettlebell, n: 3, pts: 6, needF: 0.85 },
  tire: { make: tire, n: 1, pts: 12, needF: 0.85 },
  plyoBox: { make: plyoBox, n: 3, pts: 8, needF: 0.85 },
  rower: { make: rower, n: 1, pts: 25, needF: 0.85 },
  athlete: { make: athlete, n: 12, pts: 15, needF: 0.85 },
  tesla: { make: tesla, n: 8, pts: 70, needF: 0.85 },
  cybertruck: { make: cybertruck, n: 4, pts: 100, needF: 0.85 },
  pumpkin: { make: () => pumpkin(false), n: 6, pts: 8, needF: 0.85 },
  pumpkinBig: { make: () => pumpkin(true), n: 3, pts: 20, needF: 0.85 },
  tombstone: { make: tombstone, n: 5, pts: 10, needF: 0.85 },
  trickOrTreater: { make: trickOrTreater, n: 16, pts: 20, needF: 0.85 },
  trafficLight: { make: trafficLight, n: 3, pts: 30, needF: 0.85 },
  stopSign: { make: stopSign, n: 1, pts: 14, needF: 0.85 },
  jet: { make: jet, n: 4, pts: 600, needF: 0.85 },
  prop: { make: prop, n: 4, pts: 250, needF: 0.85 },
  terminal: { make: terminal, n: 1, pts: 900, needF: 0.85 },
  hangar: { make: hangar, n: 1, pts: 500, needF: 0.85 },
  tower: { make: tower, n: 1, pts: 450, needF: 0.85 },
};

export const MODELS = {};
for (const [name, t] of Object.entries(TYPES)) {
  MODELS[name] = [];
  for (let i = 0; i < t.n; i++) MODELS[name].push(t.make());
}
