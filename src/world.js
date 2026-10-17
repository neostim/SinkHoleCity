import * as THREE from 'three';
import { MODELS, TYPES, MAT, SIGN } from './models.js';

/* The city is a 10 x 10 grid of 48-unit cells (480 x 480 units). Roads run along the cell borders. */
export const WORLD = 240; // playable half-size
export const MAX_HOLES = 14;
const HALF = 260; // ground mesh half-size (a little grass margin around the city)
const CELL = 12; // spatial-grid cell size
const N = Math.ceil((HALF * 2) / CELL);
const CELLS = 10;
export const ROADS = Array.from({ length: CELLS - 1 }, (_, i) => (i - 4) * 48); // -192 .. 192
const CENTERS = Array.from({ length: CELLS }, (_, i) => (i - 4.5) * 48); // -216 .. 216
const BLOCK_INDEX = { residential: 0, park: 1, downtown: 2, commercial: 3, shops: 4 };

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

/* Procedural ground: roads, crosswalks, sidewalks, lawns... all computed per pixel from world position,
   so it stays razor sharp at any zoom and costs no texture memory. Only a 10x10 "block type" texture is uploaded. */
const GROUND_GLSL = `
uniform sampler2D uBlocks;
vec3 hx(int c) { return pow(vec3(float((c >> 16) & 255), float((c >> 8) & 255), float(c & 255)) / 255.0, vec3(2.2)); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float band(float x, float a, float b, float px) {
  float w = px * 0.75 + 1e-4;
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}
vec3 groundColor(vec2 p, float px) {
  const float HW = 240.0;
  if (abs(p.x) > HW || abs(p.y) > HW) return hx(0x74b455);
  vec2 ci = clamp(floor((p + HW) / 48.0), 0.0, 9.0);
  vec2 l = p - ((ci + 0.5) * 48.0 - HW);
  vec2 a = abs(l);
  vec2 sg = sign(l);
  bool nbU = ci.x + sg.x >= 0.0 && ci.x + sg.x <= 9.0;
  bool nbV = ci.y + sg.y >= 0.0 && ci.y + sg.y <= 9.0;
  bool roadU = a.x > 19.0 && nbU;
  bool roadV = a.y > 19.0 && nbV;
  vec3 sidewalk = hx(0xcfcac0);

  if (roadU || roadV) {
    vec3 c = hx(0x3a3d44);
    vec3 curbC = hx(0x9d9a92);
    vec3 yellow = hx(0xe8c43a);
    vec3 white = hx(0xececec);
    if (roadU && !roadV) { // road running along z
      c = mix(c, curbC, band(a.x, 19.0, 19.25, px));
      float lat = 24.0 - a.x;
      c = mix(c, yellow, band(lat, -1.0, 0.13, px) * step(mod(p.y, 4.0), 2.0));
      if (nbV && a.y > 16.0 && a.y < 18.4) {
        float ls = l.x - sg.x * 24.0;
        float k = floor(ls / 1.2);
        float st = 1.0 - smoothstep(0.3 - px, 0.3 + px, abs(ls - (k + 0.5) * 1.2));
        c = mix(c, white, st * step(abs(ls), 4.8));
      }
    } else if (roadV && !roadU) { // road running along x
      c = mix(c, curbC, band(a.y, 19.0, 19.25, px));
      float lat = 24.0 - a.y;
      c = mix(c, yellow, band(lat, -1.0, 0.13, px) * step(mod(p.x, 4.0), 2.0));
      if (nbU && a.x > 16.0 && a.x < 18.4) {
        float ls = l.y - sg.y * 24.0;
        float k = floor(ls / 1.2);
        float st = 1.0 - smoothstep(0.3 - px, 0.3 + px, abs(ls - (k + 0.5) * 1.2));
        c = mix(c, white, st * step(abs(ls), 4.8));
      }
    }
    return c;
  }
  if (a.x > 19.0 || a.y > 19.0) return sidewalk; // paved margin at the edge of the map

  if (max(a.x, a.y) > 16.0) { // sidewalk band with expansion joints
    float j = a.x > a.y ? band(mod(p.y, 2.5), 0.0, 0.1, px) : band(mod(p.x, 2.5), 0.0, 0.1, px);
    return mix(sidewalk, hx(0xb5b0a5), j);
  }

  float t = floor(texture2D(uBlocks, (ci + 0.5) / 10.0).r * 255.0 + 0.5);
  float h = hash21(floor(p / 0.6));
  vec3 c;
  if (t < 0.5) { // residential lawn + driveways
    c = mix(hx(0x6aaf4d), hx(0x86cb68), step(0.5, h));
    c = mix(c, hx(0xc9b99a), step(abs(a.x - 8.5), 0.8) * step(13.0, a.y));
  } else if (t < 1.5) { // park: lawn, gravel paths, round plaza
    c = mix(hx(0x62ab48), hx(0x7bc65c), step(0.5, h));
    c = mix(c, hx(0xdcc99b), 1.0 - smoothstep(1.3 - px, 1.3 + px, min(a.x, a.y)));
    c = mix(c, hx(0xcfc9bb), 1.0 - smoothstep(5.6 - px, 5.6 + px, length(l)));
  } else { // downtown / commercial / shops: paving
    c = t < 2.5 ? hx(0x9a9ea6) : (t < 3.5 ? hx(0xaaa8a0) : hx(0xb3aea3));
    float g = max(band(mod(l.x + 16.0, 4.0), 0.0, 0.1, px), band(mod(l.y + 16.0, 4.0), 0.0, 0.1, px));
    c *= 1.0 - 0.08 * g;
  }
  return c;
}
`;

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

    // 10x10 map of block types, read by the ground shader
    this.blockData = new Uint8Array(CELLS * CELLS);
    this.blockTex = new THREE.DataTexture(this.blockData, CELLS, CELLS, THREE.RedFormat, THREE.UnsignedByteType);
    this.blockTex.magFilter = this.blockTex.minFilter = THREE.NearestFilter;
    this.blockTex.generateMipmaps = false;
    this.blockTex.unpackAlignment = 1;
    this.blockTex.needsUpdate = true;

    // lit planes that discard fragments inside any hole
    const cutHoles = (mat, ground) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uHoles = { value: this.uHoles };
        if (ground) shader.uniforms.uBlocks = { value: this.blockTex };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vWP;\nuniform vec3 uHoles[' + MAX_HOLES + '];' + (ground ? GROUND_GLSL : ''))
          .replace(
            'void main() {',
            'void main() {\n  for (int i = 0; i < ' + MAX_HOLES + '; i++) { if (uHoles[i].z > 0.0 && distance(vWP, uHoles[i].xy) < uHoles[i].z) discard; }'
          );
        if (ground) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            'float gpx = max(fwidth(vWP.x), fwidth(vWP.y));\n  diffuseColor.rgb = groundColor(vWP, gpx);'
          );
        }
      };
      return mat;
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), cutHoles(new THREE.MeshLambertMaterial({ color: 0xffffff }), true));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // endless grass beyond the city
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      cutHoles(new THREE.MeshLambertMaterial({ color: 0x6fae52 }), false)
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
    if (m.sign) { // billboard child (the RX Gym sign) rides along with the building
      const s = new THREE.Mesh(SIGN.geo, SIGN.mat);
      s.position.set(m.sign[0], m.sign[1], m.sign[2]);
      mesh.add(s);
    }
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    const id = opts.id !== undefined ? opts.id : this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const o = {
      id, vi, type, mesh, x, z, rotY, r: m.r, h: m.h, pts: T.pts, need: m.r * T.needF,
      state: 0, cell: 0, kind: 'static', vy: 0, hole: null, workout: false,
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
    o.workout = !!(opts && opts.workout); // athletes stay put and exercise until a hole scares them off
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
      if (o.tx === undefined) {
        if (o.workout) o.mesh.position.y = Math.abs(Math.sin(t * 3.2 + o.phase)) * 0.3; // athletes animate before any update arrives
        continue;
      }
      if (Math.abs(o.tx - o.x) > 15 || Math.abs(o.tz - o.z) > 15) { o.x = o.tx; o.z = o.tz; } // wrapped around the map
      const dx = (o.tx - o.x) * k, dz = (o.tz - o.z) * k;
      o.x += dx; o.z += dz;
      const m = o.mesh, sp = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      if (o.kind === 'person') {
        const moving = sp > 0.4;
        if (moving) {
          m.position.set(o.x, Math.abs(Math.sin(t * (sp > 3 ? 16 : 8) + o.phase)) * 0.12, o.z);
          m.rotation.y = Math.atan2(dx, dz); m.rotation.z = Math.sin(t * (sp > 3 ? 16 : 8) + o.phase) * 0.09;
        } else {
          m.position.set(o.x, o.workout ? Math.abs(Math.sin(t * 3.2 + o.phase)) * 0.3 : 0, o.z);
          m.rotation.z = 0;
        }
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
    const spin = (o.kind === 'person' ? 4 : 1.6) / (1 + o.r * 0.35);
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
          o.workout = false; // scared off - the workout is over
        } else if (!o.workout) {
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
        if (o.workout) m.position.set(o.x, Math.abs(Math.sin(t * 3.2 + o.phase)) * 0.3, o.z); // burpees / jumping jacks
        else m.position.set(o.x, moving ? Math.abs(Math.sin(t * sp + o.phase)) * 0.12 : 0, o.z);
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
    this.rt = 0.25;
    let people = 0;
    for (const o of this.movers) if (o.kind === 'person' && o.type === 'person') people++;
    if (people >= 520) return;
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
    for (let i = 0; i < CELLS; i++) {
      for (let j = 0; j < CELLS; j++) {
        const d = Math.max(Math.abs(i - 4.5), Math.abs(j - 4.5)); // 0.5 (centre) .. 4.5 (edge)
        let type;
        const q = R();
        if (d < 1) type = 'downtown';
        else if (d < 2) type = 'commercial';
        else if (d < 3) type = q < 0.4 ? 'commercial' : q < 0.7 ? 'shops' : q < 0.85 ? 'park' : 'residential';
        else type = q < 0.5 ? 'residential' : q < 0.78 ? 'park' : 'shops';
        blocks.push({ cx: CENTERS[i], cz: CENTERS[j], type });
        this.blockData[i + j * CELLS] = BLOCK_INDEX[type];
      }
    }
    this.blockTex.needsUpdate = true;
    for (const b of blocks) this.populateBlock(b);
    this.populateRoads();
    this.populateSidewalkRiders();
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
    if (R() < 0.55) { const [x, z, r] = edgePt(16.9); S('bikeParked', x, z, r + Math.PI / 2); }
    if (R() < 0.3) { const [x, z, r] = edgePt(17.2); S('motorcycleParked', x, z, r + Math.PI / 2); }
    // street trees
    for (const t of [-12, -4, 4, 12]) {
      for (const [lx, lz] of [[t, -17.6], [t, 17.6], [-17.6, t], [17.6, t]]) {
        if (R() < (type === 'downtown' ? 0.25 : 0.5)) S(pick(['treeRound', 'treeRound', 'treePine']), lx + rand(-1, 1) * 0.3, lz + rand(-1, 1) * 0.3);
      }
    }

    const people = (n) => {
      for (let i = 0; i < n; i++) { const [x, z] = edgePt(); P('person', x, z, rand(0, 6.28)); }
    };
    const dogWalkers = (n) => {
      for (let i = 0; i < n; i++) { const [x, z] = edgePt(17.3); P('dogWalker', x, z, rand(0, 6.28)); }
    };

    // an RX Gym lot: the building sits at the back, equipment + athletes fill the yard out front
    const gymLot = (sx, sz) => {
      const gx = sx * 8.5;
      S('gym', gx, sz * 4.5, facing(sx, sz));
      S('pullupRig', gx - 3.4, sz * 11.2, 0);
      S('squatRack', gx + 3.6, sz * 11.6, 0);
      S('tire', gx - 3.4, sz * 14.6); S('tire', gx - 0.8, sz * 14.2);
      S('rower', gx + 3.6, sz * 14.6, Math.PI / 2);
      S('plyoBox', gx + 0.3, sz * 9.6, rand(0, 6)); S('plyoBox', gx + 1.5, sz * 9.7, rand(0, 6));
      for (let i = 0; i < 4; i++) S('kettlebell', gx - 4.8 + i * 0.7, sz * 9.7);
      for (let i = 0; i < 6; i++) {
        const o = this.spawnMover('athlete', cx + gx + rand(-5.5, 5.5), cz + sz * rand(9.6, 15.2), rand(0, 6.28), 'person', { workout: true });
        o.wt = 0;
      }
    };

    if (type === 'downtown') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) S('skyscraper', sx * 8.5, sz * 8.5, facing(sx, sz));
      people(8); dogWalkers(1);
    } else if (type === 'commercial' || type === 'shops') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (R() < 0.14) { gymLot(sx, sz); continue; }
          const t = type === 'shops' ? 'shop' : R() < 0.55 ? 'office' : 'shop';
          S(t, sx * 8.5, sz * 8.5, facing(sx, sz));
        }
      }
      people(type === 'shops' ? 9 : 8); dogWalkers(R() < 0.7 ? 2 : 1);
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
      people(5); dogWalkers(R() < 0.8 ? 2 : 1);
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
      people(4); dogWalkers(3);
      for (let i = 0; i < 7; i++) P('person', rand(-14, 14), rand(-14, 14), rand(0, 6.28));
    }
  }

  populateRoads() {
    // parked cars / vans / motorcycles along the kerbs
    const parkedType = () => { const q = R(); return q < 0.7 ? 'car' : q < 0.88 ? 'van' : 'motorcycleParked'; };
    for (const L of ROADS) {
      for (let t = -WORLD + 8; t < WORLD - 6; t += 9.5) {
        if (ROADS.some((Rd) => Math.abs(t - Rd) < 8.5)) continue;
        for (const s of [-1, 1]) {
          if (R() > 0.14) continue;
          this.spawn(parkedType(), L + s * 3.5, t, s > 0 ? 0 : Math.PI); // road running along z
        }
        for (const s of [-1, 1]) {
          if (R() > 0.14) continue;
          this.spawn(parkedType(), t, L + s * 3.5, s > 0 ? Math.PI / 2 : -Math.PI / 2); // road running along x
        }
      }
    }
    // moving traffic
    for (const L of ROADS) {
      for (const axis of ['z', 'x']) {
        for (let i = 0; i < 4; i++) {
          const dir = i % 2 === 0 ? 1 : -1;
          const q = R();
          const type = q < 0.16 ? 'bus' : q < 0.3 ? 'van' : q < 0.5 ? 'motorcycle' : 'car';
          const t = rand(-WORLD + 5, WORLD - 5), sp = type === 'motorcycle' ? rand(8, 12) : rand(5, 9);
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

  // bicycles and kick-scooters cruising along the sidewalks (right at the kerb side of each block edge)
  populateSidewalkRiders() {
    for (const axis of ['z', 'x']) {
      for (const c of CENTERS) {
        for (const side of [-1, 1]) {
          const line = c + side * 18.6;
          const n = R() < 0.35 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            if (R() < 0.15) continue;
            const type = R() < 0.5 ? 'bicycle' : 'scooter';
            const dir = R() < 0.5 ? 1 : -1;
            const sp = type === 'bicycle' ? rand(4.5, 6.5) : rand(3, 4.5);
            const t = rand(-WORLD + 5, WORLD - 5);
            let o;
            if (axis === 'z') {
              o = this.spawnMover(type, line, t, dir > 0 ? 0 : Math.PI, 'vehicle');
              o.vz = sp * dir;
            } else {
              o = this.spawnMover(type, t, line, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 'vehicle');
              o.vx = sp * dir;
            }
          }
        }
      }
    }
  }
}
