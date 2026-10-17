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

const out = (b, r, h, mat = 'vc') => ({ geo: b.build(), r, h, mat });

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
  return out(b, Math.hypot(w, d) / 2, hgt + 2.6);
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
  return out(b, Math.hypot(w, d) / 2, h + 1.2, 'bld');
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
  return out(b, Math.hypot(w, d) / 2, h + 7, 'bld');
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
  return out(b, Math.hypot(w, d) / 2, 50, 'bld');
}

function fountain() {
  const b = new B();
  b.cyl(3, 3.1, 0.8, '#b7b7b0', 0, 0, 0, 20)
    .cyl(2.6, 2.6, 0.7, '#5cc8f0', 0, 0.2, 0, 20)
    .cyl(0.6, 0.8, 1.6, '#c9c9c2', 0, 0.5, 0, 12)
    .cyl(1.4, 0.5, 0.35, '#c9c9c2', 0, 2.0, 0, 14)
    .sph(0.6, '#9be2ff', 0, 2.7, 0, 1.3);
  return out(b, 3.1, 3.4);
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
};

export const MODELS = {};
for (const [name, t] of Object.entries(TYPES)) {
  MODELS[name] = [];
  for (let i = 0; i < t.n; i++) MODELS[name].push(t.make());
}
