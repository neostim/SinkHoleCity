import * as THREE from 'three';
import { MODELS, TYPES, MAT } from './models.js';

export const WORLD = 120; // playable half-size
export const MAX_HOLES = 10;
const HALF = 140; // ground mesh half-size
const CELL = 12;
const N = Math.ceil((HALF * 2) / CELL);
const ROADS = [-72, -24, 24, 72];
const CENTERS = [-96, -48, 0, 48, 96];


// Swappable RNG: generate(seed) swaps in a seeded generator so host and guest build the identical city.
let R = Math.random;
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (a, b) => a + R() * (b - a);
const pick = (a) => a[(R() * a.length) | 0];

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.grid = Array.from({ length: N * N }, () => []);
    this.all = new Set();
    this.movers = [];
    this.falling = [];
    this.byId = new Map();
    this.nextId = 0;
    this.onSpawn = null; // host hook: called for pedestrians that wander in after generation
    this.uHoles = Array.from({ length: MAX_HOLES }, () => new THREE.Vector3(0, 0, 0));

    // ground (a lit plane that discards fragments inside any hole)
    this.canvas = document.createElement('canvas');
    this.texSize = Math.min(4096, renderer.capabilities.maxTextureSize);
    this.canvas.width = this.canvas.height = this.texSize;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const cutHoles = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uHoles = { value: this.uHoles };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWP;\nuniform vec3 uHoles[' + MAX_HOLES + '];')
          .replace(
            'void main() {',
            'void main() {\n  for (int i = 0; i < ' + MAX_HOLES + '; i++) { if (uHoles[i].z > 0.0 && distance(vWP, uHoles[i].xy) < uHoles[i].z) discard; }'
          );
      };
      return mat;
    };
    const gm = cutHoles(new THREE.MeshLambertMaterial({ map: this.tex }));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), gm);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // endless grass beyond the city
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      cutHoles(new THREE.MeshLambertMaterial({ color: 0x6fae52 }))
    );
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.06;
    scene.add(far);
  }

  /* ---------------- spatial grid ---------------- */
  cellOf(x, z) {
    const cx = Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / CELL)));
    const cz = Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / CELL)));
    return cx + cz * N;
  }

  gridAdd(o) { o.cell = this.cellOf(o.x, o.z); this.grid[o.cell].push(o); }
  gridRemove(o) {
    const a = this.grid[o.cell];
    const i = a.indexOf(o);
    if (i >= 0) a.splice(i, 1);
  }
  relocate(o) {
    const c = this.cellOf(o.x, o.z);
    if (c !== o.cell) { this.gridRemove(o); o.cell = c; this.grid[c].push(o); }
  }

  // calls fn(o) for every idle object whose cell touches the circle (iterates backwards: fn may remove o)
  query(x, z, r, fn) {
    const x0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), x1 = Math.min(N - 1, Math.floor((x + r + HALF) / CELL));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), z1 = Math.min(N - 1, Math.floor((z + r + HALF) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const a = this.grid[cx + cz * N];
        for (let i = a.length - 1; i >= 0; i--) fn(a[i]);
      }
    }
  }

  /* ---------------- objects ---------------- */
  spawn(type, x, z, rotY = 0, opts = {}) {
    const variants = MODELS[type];
    const vi = opts.vi !== undefined ? opts.vi : (R() * variants.length) | 0;
    const m = variants[vi];
    const T = TYPES[type];
    const mesh = new THREE.Mesh(m.geo, m.mat === 'bld' ? MAT.bld : MAT.vc);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    const id = opts.id !== undefined ? opts.id : this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const o = {
      id, vi, type, mesh, x, z, rotY, r: m.r, h: m.h, pts: T.pts, need: m.r * T.needF,
      state: 0, cell: 0, kind: 'static', vy: 0, hole: null,
    };
    this.scene.add(mesh);
    this.gridAdd(o);
    this.all.add(o);
    this.byId.set(id, o);
    return o;
  }

  spawnMover(type, x, z, rotY, kind, opts) {
    const o = this.spawn(type, x, z, rotY, opts);
    o.kind = kind;
    o.mesh.matrixAutoUpdate = true;
    o.vx = 0; o.vz = 0; o.wt = rand(0, 3); o.phase = rand(0, 6.28);
    this.movers.push(o);
    return o;
  }

  // guest side: drop an object that the host says is already gone (no animation)
  removeInstant(id) {
    const o = this.byId.get(id);
    if (!o || o.state !== 0) return;
    this.gridRemove(o);
    const mi = this.movers.indexOf(o);
    if (mi >= 0) this.movers.splice(mi, 1);
    this.scene.remove(o.mesh);
    this.all.delete(o);
    this.byId.delete(id);
  }

  // guest side: ease pedestrians/vehicles toward the positions the host last sent
  applyMovers(flat) {
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const o = this.byId.get(flat[i]);
      if (o && o.state === 0) { o.tx = flat[i + 1] / 10; o.tz = flat[i + 2] / 10; }
    }
  }

  updateRemote(dt, t) {
    const k = Math.min(1, dt * 10);
    for (const o of this.movers) {
      if (o.tx === undefined) continue;
      if (Math.abs(o.tx - o.x) > 15 || Math.abs(o.tz - o.z) > 15) { o.x = o.tx; o.z = o.tz; } // wrapped around the map
      const dx = (o.tx - o.x) * k, dz = (o.tz - o.z) * k;
      o.x += dx; o.z += dz;
      const m = o.mesh, sp = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      if (o.kind === 'person') {
        const moving = sp > 0.4;
        m.position.set(o.x, moving ? Math.abs(Math.sin(t * (sp > 3 ? 16 : 8) + o.phase)) * 0.12 : 0, o.z);
        if (moving) { m.rotation.y = Math.atan2(dx, dz); m.rotation.z = Math.sin(t * (sp > 3 ? 16 : 8) + o.phase) * 0.09; }
        else m.rotation.z = 0;
      } else m.position.set(o.x, 0, o.z);
    }
  }

  startFall(o, hole) {
    o.state = 1;
    o.hole = hole;
    o.tx = hole.x; o.tz = hole.z;
    this.gridRemove(o);
    const mi = this.movers.indexOf(o);
    if (mi >= 0) this.movers.splice(mi, 1);
    o.mesh.matrixAutoUpdate = true;
    o.mesh.position.set(o.x, o.mesh.position.y, o.z);
    o.vy = -1.5;
    const spin = (o.type === 'person' ? 4 : 1.6) / (1 + o.r * 0.35);
    o.sx = rand(-spin, spin); o.sz = rand(-spin, spin);
    this.falling.push(o);
  }

  updateFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const o = this.falling[i], m = o.mesh, h = o.hole;
      if (h.alive) { o.tx = h.x; o.tz = h.z; }
      o.vy -= 34 * dt;
      m.position.y += o.vy * dt;
      const k = Math.min(1, dt * 5);
      m.position.x += (o.tx - m.position.x) * k;
      m.position.z += (o.tz - m.position.z) * k;
      m.rotation.x += o.sx * dt;
      m.rotation.z += o.sz * dt;
      const depth = -m.position.y;
      const s = Math.max(0.45, 1 - 0.55 * Math.min(1, depth / (o.h + 2)));
      m.scale.setScalar(s);
      if (m.position.y < -(o.h * s) - 1.5) {
        this.scene.remove(m);
        this.all.delete(o);
        this.byId.delete(o.id);
        this.falling.splice(i, 1);
      }
    }
  }

  updateMovers(dt, t, holes) {
    const lim = WORLD - 1.5;
    for (const o of this.movers) {
      if (o.kind === 'person') {
        let fx = 0, fz = 0, flee = false;
        for (const h of holes) {
          if (!h.alive) continue;
          const dx = o.x - h.x, dz = o.z - h.z, d2 = dx * dx + dz * dz, l = h.r + 11;
          if (d2 < l * l) {
            const d = Math.sqrt(d2) || 0.01;
            fx += dx / d; fz += dz / d; flee = true;
          }
        }
        if (flee) {
          const d = Math.hypot(fx, fz) || 1;
          o.vx = (fx / d) * 5.4; o.vz = (fz / d) * 5.4;
          o.wt = 0.4;
        } else {
          o.wt -= dt;
          if (o.wt <= 0) {
            o.wt = rand(1.5, 4);
            if (R() < 0.35) { o.vx = 0; o.vz = 0; }
            else { const a = rand(0, 6.283), s = rand(1.1, 1.7); o.vx = Math.sin(a) * s; o.vz = Math.cos(a) * s; }
          }
        }
        o.x += o.vx * dt; o.z += o.vz * dt;
        if (o.x > lim) { o.x = lim; o.vx = -Math.abs(o.vx); } else if (o.x < -lim) { o.x = -lim; o.vx = Math.abs(o.vx); }
        if (o.z > lim) { o.z = lim; o.vz = -Math.abs(o.vz); } else if (o.z < -lim) { o.z = -lim; o.vz = Math.abs(o.vz); }
        const m = o.mesh;
        const moving = o.vx * o.vx + o.vz * o.vz > 0.01;
        const sp = flee ? 16 : 8;
        m.position.set(o.x, moving ? Math.abs(Math.sin(t * sp + o.phase)) * 0.12 : 0, o.z);
        if (moving) {
          m.rotation.y = Math.atan2(o.vx, o.vz);
          m.rotation.z = Math.sin(t * sp + o.phase) * 0.09;
        } else m.rotation.z = 0;
        this.relocate(o);
      } else {
        o.x += o.vx * dt; o.z += o.vz * dt;
        if (o.x > lim) o.x = -lim; else if (o.x < -lim) o.x = lim;
        if (o.z > lim) o.z = -lim; else if (o.z < -lim) o.z = lim;
        o.mesh.position.set(o.x, 0, o.z);
        this.relocate(o);
      }
    }
  }

  // keeps the streets populated: new pedestrians wander in (out of sight of any hole) as others get eaten
  replenish(dt, holes) {
    this.rt = (this.rt || 0) - dt;
    if (this.rt > 0) return;
    this.rt = 0.5;
    let people = 0;
    for (const o of this.movers) if (o.kind === 'person') people++;
    if (people >= 140) return;
    for (let tries = 0; tries < 12; tries++) {
      const cx = pick(CENTERS), cz = pick(CENTERS);
      const side = (R() * 4) | 0, t = rand(-15, 15), off = 17.5 + rand(-0.8, 0.8);
      const x = cx + (side < 2 ? t : side === 2 ? -off : off), z = cz + (side === 0 ? -off : side === 1 ? off : t);
      if (holes.some((h) => h.alive && Math.hypot(h.x - x, h.z - z) < h.r + 16)) continue;
      const o = this.spawnMover('person', x, z, rand(0, 6.28), 'person');
      if (this.onSpawn) this.onSpawn(o);
      return;
    }
  }

  clear() {
    for (const o of this.all) this.scene.remove(o.mesh);
    this.all.clear();
    this.movers.length = 0;
    this.falling.length = 0;
    this.byId.clear();
    this.nextId = 0;
    for (const a of this.grid) a.length = 0;
  }

  /* ---------------- city generation ---------------- */
  generate(seed = (Math.random() * 2147483647) | 0) {
    this.clear();
    this.seed = seed;
    R = mulberry32(seed);
    try {
      this.build();
    } finally {
      R = Math.random;
    }
  }

  build() {
    const blocks = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const d = Math.max(Math.abs(i - 2), Math.abs(j - 2));
        let type;
        if (d === 0) type = 'downtown';
        else if (d === 1) type = 'commercial';
        else { const q = R(); type = q < 0.5 ? 'residential' : q < 0.78 ? 'park' : 'shops'; }
        blocks.push({ cx: CENTERS[i], cz: CENTERS[j], type });
      }
    }
    // guarantee at least one park near the edge so small food is plentiful at spawn
    if (!blocks.some((b) => b.type === 'park')) blocks.find((b) => b.type === 'residential').type = 'park';
    this.drawGround(blocks);
    for (const b of blocks) this.populateBlock(b);
    this.populateRoads();
  }

  drawGround(blocks) {
    const ctx = this.canvas.getContext('2d');
    const S = this.texSize / (HALF * 2);
    const px = (v) => (v + HALF) * S;
    const rect = (x0, z0, x1, z1, col) => { ctx.fillStyle = col; ctx.fillRect(px(x0), px(z0), (x1 - x0) * S, (z1 - z0) * S); };

    rect(-HALF, -HALF, HALF, HALF, '#74b455');
    rect(-WORLD, -WORLD, WORLD, WORLD, '#cfcac0');

    // roads
    for (const L of ROADS) {
      rect(L - 5, -WORLD, L + 5, WORLD, '#3a3d44');
      rect(-WORLD, L - 5, WORLD, L + 5, '#3a3d44');
    }
    // curbs
    for (const L of ROADS) {
      for (const s of [-5, 4.75]) {
        rect(L + s, -WORLD, L + s + 0.25, WORLD, '#9d9a92');
        rect(-WORLD, L + s, WORLD, L + s + 0.25, '#9d9a92');
      }
    }
    // dashed centre lines (skipping intersections)
    for (const L of ROADS) {
      for (let t = -WORLD + 1; t < WORLD - 2; t += 4) {
        if (ROADS.some((R) => Math.abs(t + 1 - R) < 7)) continue;
        rect(L - 0.13, t, L + 0.13, t + 2, '#e8c43a');
        rect(t, L - 0.13, t + 2, L + 0.13, '#e8c43a');
      }
    }
    // crosswalks
    for (const Lx of ROADS) {
      for (const Lz of ROADS) {
        for (let n = -4.2; n <= 4.3; n += 1.2) {
          for (const s of [-1, 1]) {
            const a = s * 5.6, b = s * 8;
            rect(Lx + n - 0.3, Lz + Math.min(a, b), Lx + n + 0.3, Lz + Math.max(a, b), '#ececec');
            rect(Lx + Math.min(a, b), Lz + n - 0.3, Lx + Math.max(a, b), Lz + n + 0.3, '#ececec');
          }
        }
      }
    }
    // blocks
    for (const b of blocks) {
      const { cx, cz, type } = b;
      // sidewalk joints
      for (let t = -18; t <= 18; t += 2.5) {
        rect(cx + t, cz - 19, cx + t + 0.1, cz - 16, '#b5b0a5'); rect(cx + t, cz + 16, cx + t + 0.1, cz + 19, '#b5b0a5');
        rect(cx - 19, cz + t, cx - 16, cz + t + 0.1, '#b5b0a5'); rect(cx + 16, cz + t, cx + 19, cz + t + 0.1, '#b5b0a5');
      }
      const lot = { residential: '#7cc060', park: '#6fba52', downtown: '#9a9ea6', commercial: '#aaa8a0', shops: '#b3aea3' }[type];
      rect(cx - 16, cz - 16, cx + 16, cz + 16, lot);
      if (type === 'residential' || type === 'park') {
        for (let i = 0; i < 700; i++) {
          const x = cx + rand(-16, 15.6), z = cz + rand(-16, 15.6);
          rect(x, z, x + rand(0.3, 0.9), z + rand(0.3, 0.9), R() < 0.5 ? '#6aaf4d' : '#86cb68');
        }
      }
      if (type === 'park') {
        rect(cx - 1.3, cz - 16, cx + 1.3, cz + 16, '#dcc99b');
        rect(cx - 16, cz - 1.3, cx + 16, cz + 1.3, '#dcc99b');
        ctx.fillStyle = '#cfc9bb';
        ctx.beginPath(); ctx.arc(px(cx), px(cz), 5.6 * S, 0, 6.283); ctx.fill();
      }
      if (type === 'residential') {
        // driveways / front walks
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) rect(cx + sx * 8.5 - 0.8, cz + sz * 13, cx + sx * 8.5 + 0.8, cz + sz * 16, '#c9b99a');
      }
      if (type === 'downtown' || type === 'commercial' || type === 'shops') {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let t = -16; t < 16; t += 4) {
          ctx.fillRect(px(cx + t), px(cz - 16), 0.1 * S, 32 * S);
          ctx.fillRect(px(cx - 16), px(cz + t), 32 * S, 0.1 * S);
        }
      }
    }
    this.tex.needsUpdate = true;
  }

  populateBlock(b) {
    const { cx, cz, type } = b;
    const S = (t, lx, lz, ry = 0) => this.spawn(t, cx + lx, cz + lz, ry);
    const P = (t, lx, lz, ry = 0) => this.spawnMover(t, cx + lx, cz + lz, ry, 'person');
    const facing = (lx, lz) => (Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? Math.PI / 2 : -Math.PI / 2) : lz > 0 ? 0 : Math.PI);

    // random point on the sidewalk ring (plus the rotation that runs along the kerb)
    const edgePt = (off = 17.5) => {
      const s = (R() * 4) | 0, t = rand(-15, 15), o = off + rand(-0.8, 0.8);
      return s === 0 ? [t, -o, 0] : s === 1 ? [t, o, 0] : s === 2 ? [-o, t, Math.PI / 2] : [o, t, Math.PI / 2];
    };

    // street furniture on every block
    for (const [lx, lz] of [[-17.8, -17.8], [17.8, -17.8], [-17.8, 17.8], [17.8, 17.8]]) S('lamp', lx, lz);
    for (let i = 0; i < 2; i++) { const [x, z] = edgePt(); S('hydrant', x, z); }
    for (let i = 0; i < 2; i++) { const [x, z] = edgePt(); S('trashcan', x, z); }
    for (let i = 0; i < 2; i++) { const [x, z, r] = edgePt(17); if (R() < 0.7) S('bench', x, z, r); }
    for (let i = 0; i < 3; i++) { const [x, z] = edgePt(18.2); if (R() < 0.6) S('cone', x, z); }
    // street trees
    for (const t of [-12, -4, 4, 12]) {
      for (const [lx, lz] of [[t, -17.6], [t, 17.6], [-17.6, t], [17.6, t]]) {
        if (R() < (type === 'downtown' ? 0.25 : 0.5)) S(pick(['treeRound', 'treeRound', 'treePine']), lx + rand(-1, 1) * 0.3, lz + rand(-1, 1) * 0.3);
      }
    }

    const people = (n) => {
      for (let i = 0; i < n; i++) { const [x, z] = edgePt(); P('person', x, z, rand(0, 6.28)); }
    };

    if (type === 'downtown') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) S('skyscraper', sx * 8.5, sz * 8.5, facing(sx, sz));
      people(8);
    } else if (type === 'commercial' || type === 'shops') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const t = type === 'shops' ? 'shop' : R() < 0.55 ? 'office' : 'shop';
          S(t, sx * 8.5, sz * 8.5, facing(sx, sz));
        }
      }
      people(type === 'shops' ? 9 : 8);
    } else if (type === 'residential') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const hx = sx * 8.5, hz = sz * 8.5;
          S('house', hx, hz, facing(sx, sz));
          for (const [ox, oz] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]]) if (R() < 0.55) S('bush', hx + ox, hz + oz);
          if (R() < 0.5) S(pick(['car', 'car', 'van']), hx, sz * 14.6, Math.PI / 2);
        }
      }
      for (const [lx, lz] of [[0, 0], [0, -8.5], [0, 8.5], [-8.5, 0], [8.5, 0]]) if (R() < 0.8) S(pick(['treeOak', 'treeRound', 'treePine']), lx, lz);
      people(5);
      for (let i = 0; i < 2; i++) P('person', rand(-1.5, 1.5), rand(-12, 12), rand(0, 6.28));
    } else if (type === 'park') {
      if (R() < 0.75) S('fountain', 0, 0); else S('treeOak', 0, 0);
      for (const [lx, lz, r] of [[6.5, 0, Math.PI / 2], [-6.5, 0, Math.PI / 2], [0, 6.5, 0], [0, -6.5, 0]]) S('bench', lx, lz, r);
      for (let i = 0; i < 14; i++) {
        let x, z;
        do { x = rand(-14, 14); z = rand(-14, 14); } while (Math.hypot(x, z) < 8 || Math.abs(x) < 2 || Math.abs(z) < 2);
        S(pick(['treeOak', 'treeRound', 'treeRound', 'treePine', 'treePine']), x, z);
      }
      for (let i = 0; i < 7; i++) {
        let x, z;
        do { x = rand(-14, 14); z = rand(-14, 14); } while (Math.hypot(x, z) < 6.5 || Math.abs(x) < 2 || Math.abs(z) < 2);
        S('bush', x, z);
      }
      if (R() < 0.3) S('waterTower', pick([-1, 1]) * 11.5, pick([-1, 1]) * 11.5);
      people(4);
      for (let i = 0; i < 7; i++) P('person', rand(-14, 14), rand(-14, 14), rand(0, 6.28));
    }
  }

  populateRoads() {
    // parked cars along the kerbs
    for (const L of ROADS) {
      for (let t = -WORLD + 8; t < WORLD - 6; t += 9.5) {
        if (ROADS.some((R) => Math.abs(t - R) < 8.5)) continue;
        for (const s of [-1, 1]) {
          if (R() > 0.3) continue;
          const type = pick(['car', 'car', 'car', 'van']);
          this.spawn(type, L + s * 3.5, t, s > 0 ? 0 : Math.PI); // vertical road
        }
        for (const s of [-1, 1]) {
          if (R() > 0.3) continue;
          this.spawn(pick(['car', 'car', 'car', 'van']), t, L + s * 3.5, s > 0 ? Math.PI / 2 : -Math.PI / 2); // horizontal road
        }
      }
    }
    // moving traffic
    for (const L of ROADS) {
      for (const axis of ['z', 'x']) {
        for (let i = 0; i < 2; i++) {
          const dir = i === 0 ? 1 : -1;
          const type = R() < 0.22 ? 'bus' : R() < 0.2 ? 'van' : 'car';
          const t = rand(-WORLD + 5, WORLD - 5), sp = rand(5, 9);
          let o;
          if (axis === 'z') {
            o = this.spawnMover(type, L + dir * 1.35, t, dir > 0 ? 0 : Math.PI, 'vehicle');
            o.vz = sp * dir;
          } else {
            o = this.spawnMover(type, t, L + dir * 1.35, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 'vehicle');
            o.vx = sp * dir;
          }
        }
      }
    }
  }
}
