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
const BLOCK_INDEX = { residential: 0, park: 1, downtown: 2, commercial: 3, shops: 4, airport: 5 };
const CENTERS_CITY = CENTERS.slice(1); // everything except the airport row along the north edge

// Airport layout (all along the north edge, z < -197): runway, grass strip, apron with two taxi lanes
const RUNWAY_Z = -229, TAXI_IN = -215, TAXI_OUT = -209;
const EXIT_X = -26, ENTRY_X = -228; // taxiway connectors between runway and apron
const STANDS = [40, 78, 116, 154, 192]; // parking spots (x) along the inbound taxi lane

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
vec3 airportColor(vec2 p, float px) {
  vec3 grass = hx(0x5f9e48);
  vec3 asphalt = hx(0x2e3136);
  vec3 concrete = hx(0xaeb0ae);
  vec3 white = hx(0xf2f2f2);
  vec3 yellow = hx(0xe8c43a);
  vec3 c = grass * (0.94 + 0.1 * hash21(floor(p / 0.8)));
  float apron = band(p.y, -219.0, -197.0, px);
  c = mix(c, concrete, apron);
  float joints = max(band(mod(p.x, 10.0), 0.0, 0.12, px), band(mod(p.y, 9.0), 0.0, 0.12, px)) * apron;
  c *= 1.0 - 0.1 * joints;
  float conn = max(band(p.x, -30.0, -22.0, px), band(p.x, -232.0, -224.0, px)) * band(p.y, -222.5, -218.0, px);
  c = mix(c, concrete, conn);
  c = mix(c, yellow, max(band(p.y, -215.25, -214.75, px), band(p.y, -209.25, -208.75, px)) * apron);
  float rw = band(p.y, -236.0, -222.0, px);
  c = mix(c, asphalt, rw);
  c = mix(c, white, (band(p.y, -235.6, -235.2, px) + band(p.y, -222.8, -222.4, px)) * rw);
  c = mix(c, white, band(p.y, -229.2, -228.8, px) * step(mod(p.x, 14.0), 8.0) * rw);
  float th = step(abs(abs(p.x) - 226.0), 6.0);
  c = mix(c, white, th * step(0.5, fract(p.y / 1.6)) * band(p.y, -235.0, -223.0, px));
  return c;
}

vec3 groundColor(vec2 p, float px) {
  const float HW = 240.0;
  if (abs(p.x) > HW || abs(p.y) > HW) return hx(0x74b455);
  if (p.y < -197.0) return airportColor(p, px);
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

/* Glowing pedestrians: a pulsing light beam + ground halo. Swallowing one swaps the eater into a first-person runner. */
const GLOW = {
  beam: new THREE.CylinderGeometry(0.5, 0.65, 34, 14, 1, true).translate(0, 17, 0),
  ring: new THREE.RingGeometry(0.8, 2.1, 32).rotateX(-Math.PI / 2),
  beamMat: new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  ringMat: new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
};

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.grid = Array.from({ length: N * N }, () => []);
    this.all = new Set();
    this.movers = [];
    this.falling = [];
    this.byId = new Map();
    this.planes = [];
    this.glowSet = new Set();
    this.onGlow = null; // host hook: (object, on) -> stream to the guest
    this.glowT = 0;
    this.planeRespawn = [];
    this.stands = STANDS.map(() => null);
    this.runway = null; // plane currently holding the runway
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
      state: 0, cell: 0, kind: 'static', vy: 0, hole: null, workout: false, box: m.box || null, glow: false, controlled: false,
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
    for (const o of this.planes) {
      const g = o.tgt;
      if (!g || o.state !== 0) continue;
      const wasVisible = o.mesh.visible;
      this.setPlaneVisible(o, g.vis);
      if (!wasVisible || Math.abs(g.x - o.px) > 60 || Math.abs(g.z - o.pz) > 60) { o.px = g.x; o.py = g.y; o.pz = g.z; o.hd = g.hd; o.pitch = g.pt; }
      const kk = Math.min(1, dt * 8);
      o.px += (g.x - o.px) * kk; o.py += (g.y - o.py) * kk; o.pz += (g.z - o.pz) * kk;
      let dh = g.hd - o.hd; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      o.hd += dh * kk; o.pitch += (g.pt - o.pitch) * kk;
      this.syncPlane(o);
    }
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
    if (o.kind === 'plane') this.planeGone(o);
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
      if (o.controlled) continue; // a player is steering this person (runner mode)
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
        const zmin = o.zmin !== undefined ? o.zmin : -lim; // vehicles on the avenues turn around south of the airport
        if (o.z > lim) o.z = zmin; else if (o.z < zmin) o.z = lim;
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
      const cx = pick(CENTERS), cz = pick(CENTERS_CITY);
      const side = (R() * 4) | 0, t = rand(-15, 15), off = 17.5 + rand(-0.8, 0.8);
      const x = cx + (side < 2 ? t : side === 2 ? -off : off), z = cz + (side === 0 ? -off : side === 1 ? off : t);
      if (holes.some((h) => h.alive && Math.hypot(h.x - x, h.z - z) < h.r + 16)) continue;
      const o = this.spawnMover('person', x, z, rand(0, 6.28), 'person');
      if (this.onSpawn) this.onSpawn(o);
      return;
    }
  }

  /* ---------------- glowing people ---------------- */
  setGlow(o, on) {
    if (!o || on === o.glow) return;
    o.glow = on;
    if (on) {
      const b = new THREE.Mesh(GLOW.beam, GLOW.beamMat), r = new THREE.Mesh(GLOW.ring, GLOW.ringMat);
      r.position.y = 0.06; b.renderOrder = 4; r.renderOrder = 4;
      b.frustumCulled = false;
      o.glowMeshes = [b, r];
      o.mesh.add(b, r);
      this.glowSet.add(o);
    } else {
      if (o.glowMeshes) for (const m of o.glowMeshes) o.mesh.remove(m);
      o.glowMeshes = null;
      this.glowSet.delete(o);
    }
    if (this.onGlow) this.onGlow(o, on);
  }

  // guest: make the set of glowing people exactly `ids` (used when joining mid-round)
  setGlowSet(ids) {
    const want = new Set(ids);
    for (const o of [...this.glowSet]) if (!want.has(o.id)) this.setGlow(o, false);
    for (const id of want) this.setGlow(this.byId.get(id), true);
  }

  updateGlow(t) {
    GLOW.beamMat.opacity = 0.26 + 0.12 * Math.sin(t * 3.6);
    GLOW.ringMat.opacity = 0.55 + 0.25 * Math.sin(t * 5.2);
  }

  // host: keep ~14 pedestrians glowing across the city
  maintainGlow(dt) {
    this.glowT -= dt;
    if (this.glowT > 0) return;
    this.glowT = 1.5;
    if (this.glowSet.size >= 14 || !this.movers.length) return;
    for (let i = 0; i < 20; i++) {
      const o = this.movers[(Math.random() * this.movers.length) | 0];
      if (o.type !== 'person' || o.state !== 0 || o.glow || o.controlled || o.workout || o.mesh.rotation.z > 0.5) continue;
      this.setGlow(o, true);
      return;
    }
  }

  // push a walking point out of nearby building footprints; returns the corrected [x, z]
  collide(x, z, rad) {
    let px = x, pz = z;
    this.query(x, z, 16, (o) => {
      if (!o.box || o.state !== 0) return;
      const c = Math.cos(o.rotY), s = Math.sin(o.rotY);
      const dx = px - o.x, dz = pz - o.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // into the building's own frame
      const [hx, hz] = o.box;
      const cx = Math.max(-hx, Math.min(hx, lx)), cz = Math.max(-hz, Math.min(hz, lz));
      let ox = lx - cx, oz = lz - cz, d = Math.hypot(ox, oz), nx, nz, push;
      if (d > 1e-4) { if (d >= rad) return; nx = ox / d; nz = oz / d; push = rad - d; }
      else { // centre is inside the box: leave through the nearest side
        const ex = hx - Math.abs(lx), ez = hz - Math.abs(lz);
        if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; push = ex + rad; } else { nx = 0; nz = Math.sign(lz) || 1; push = ez + rad; }
      }
      const wx = nx * push, wz = nz * push;
      px += c * wx + s * wz; pz += -s * wx + c * wz;
    });
    return [px, pz];
  }

  /* ---------------- airport traffic ---------------- */
  spawnPlane(type, opts = {}) {
    const o = this.spawn(type, -340, RUNWAY_Z, 0, opts);
    o.kind = 'plane';
    o.mesh.matrixAutoUpdate = true;
    o.mesh.rotation.order = 'YXZ';
    o.px = -340; o.py = 0; o.pz = RUNWAY_Z; o.hd = Math.PI / 2; o.pitch = 0; o.v = 0;
    o.inGrid = true;
    o.fl = { state: 'hold', timer: opts.timer !== undefined ? opts.timer : rand(3, 10), stand: -1, phase: '' };
    this.planes.push(o);
    this.setPlaneVisible(o, false);
    return o;
  }

  setPlaneVisible(o, v) {
    o.mesh.visible = v;
    if (v && !o.inGrid) { this.gridAdd(o); o.inGrid = true; }
    else if (!v && o.inGrid) { this.gridRemove(o); o.inGrid = false; }
  }

  syncPlane(o) {
    o.x = o.px; o.z = o.pz;
    o.mesh.position.set(o.px, o.py, o.pz);
    o.mesh.rotation.set(o.pitch, o.hd, 0);
    if (o.inGrid) this.relocate(o);
  }

  parkPlane(o, stand) {
    o.fl.state = 'park'; o.fl.stand = stand; o.fl.timer = rand(12, 26);
    this.stands[stand] = o;
    o.px = STANDS[stand]; o.py = 0; o.pz = TAXI_IN; o.hd = Math.PI / 2; o.pitch = 0; o.v = 0;
    this.setPlaneVisible(o, true);
    this.syncPlane(o);
  }

  planeGone(o) { // eaten: free its stand / the runway, and send a replacement later (host only acts on the timers)
    const i = this.planes.indexOf(o);
    if (i >= 0) this.planes.splice(i, 1);
    for (let k = 0; k < this.stands.length; k++) if (this.stands[k] === o) this.stands[k] = null;
    if (this.runway === o) this.runway = null;
    this.planeRespawn.push(rand(18, 30));
    o.inGrid = false;
  }

  setPath(o, path, phase) { o.path = path; o.pi = 0; o.fl.phase = phase; this.startSeg(o); }

  startSeg(o) {
    const [x1, y1, z1, v1, flag] = o.path[o.pi];
    if (flag === 'rel' && this.runway === o) this.runway = null;
    const dx = x1 - o.px, dy = y1 - o.py, dz = z1 - o.pz, L = Math.hypot(dx, dz) || 0.01, v0 = o.v;
    const vs = Math.max((v0 + v1) / 2, 0.5);
    o.seg = { x0: o.px, y0: o.py, z0: o.pz, dx, dy, dz, L, v0, v1, dur: L / vs, t: 0, hd: Math.atan2(dx, dz) };
  }

  followPath(o, dt) {
    const s = o.seg;
    s.t += dt;
    const tt = Math.min(s.t, s.dur), a = (s.v1 - s.v0) / s.dur;
    const u = Math.min(1, (s.v0 * tt + 0.5 * a * tt * tt) / s.L);
    o.px = s.x0 + s.dx * u; o.pz = s.z0 + s.dz * u; o.py = s.y0 + s.dy * u; o.v = s.v0 + a * tt;
    let dh = s.hd - o.hd; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    o.hd += dh * Math.min(1, dt * 3);
    const tp = s.dy !== 0 ? Math.atan2(-s.dy, s.L) : 0; // nose down when descending, up when climbing
    o.pitch += (tp - o.pitch) * Math.min(1, dt * 2.5);
    if (s.t >= s.dur) {
      o.px = s.x0 + s.dx; o.py = s.y0 + s.dy; o.pz = s.z0 + s.dz; o.v = s.v1;
      o.pi++;
      if (o.pi < o.path.length) this.startSeg(o); else this.pathDone(o);
    }
  }

  pathDone(o) {
    const f = o.fl;
    if (f.phase === 'land') { f.state = 'park'; f.timer = rand(12, 26); o.v = 0; o.pitch = 0; }
    else if (f.phase === 'out') { f.state = 'wait'; o.v = 0; }
    else { // took off and climbed away: hide until the next landing slot
      f.state = 'hold'; f.timer = rand(14, 32);
      if (this.runway === o) this.runway = null;
      this.setPlaneVisible(o, false);
    }
  }

  // host only: planes land, park at the stands, taxi out and take off. One aircraft on the runway at a time.
  updatePlanes(dt) {
    for (let i = this.planeRespawn.length - 1; i >= 0; i--) {
      this.planeRespawn[i] -= dt;
      if (this.planeRespawn[i] <= 0) { this.planeRespawn.splice(i, 1); this.spawnPlane(pick(['jet', 'prop']), { timer: rand(2, 6) }); }
    }
    for (const o of this.planes) {
      if (o.state !== 0) continue;
      const f = o.fl;
      if (f.state === 'hold') {
        f.timer -= dt;
        if (f.timer > 0 || this.runway) continue;
        // arrivals always park west of every occupied stand so they never have to taxi through a parked plane
        let minOcc = this.stands.length;
        this.stands.forEach((v, k) => { if (v && k < minOcc) minOcc = k; });
        const st = minOcc - 1;
        if (st < 0) continue;
        f.stand = st; this.stands[st] = o; this.runway = o;
        o.px = -340; o.py = 36; o.pz = RUNWAY_Z; o.hd = Math.PI / 2; o.pitch = 0; o.v = 44;
        this.setPlaneVisible(o, true);
        this.setPath(o, [[-205, 0, RUNWAY_Z, 44], [-40, 0, RUNWAY_Z, 14], [EXIT_X, 0, -224, 12], [EXIT_X, 0, TAXI_IN, 8, 'rel'], [STANDS[st], 0, TAXI_IN, 0]], 'land');
        f.state = 'fly';
      } else if (f.state === 'park') {
        f.timer -= dt;
        if (f.timer > 0) continue;
        this.stands[f.stand] = null;
        this.setPath(o, [[STANDS[f.stand], 0, TAXI_OUT, 6], [ENTRY_X, 0, TAXI_OUT, 14], [ENTRY_X, 0, -221, 5]], 'out');
        f.state = 'fly';
      } else if (f.state === 'wait') {
        if (this.runway) continue;
        this.runway = o;
        this.setPath(o, [[ENTRY_X, 0, RUNWAY_Z, 6], [-200, 0, RUNWAY_Z, 22], [60, 0, RUNWAY_Z, 50], [340, 40, RUNWAY_Z, 56, 'rel']], 'takeoff');
        f.state = 'fly';
      } else if (f.state === 'fly') this.followPath(o, dt);
      if (o.mesh.visible) this.syncPlane(o);
    }
  }

  planeSnapshot() {
    return this.planes.map((o) => [o.id, o.type, o.vi, Math.round(o.px * 10), Math.round(o.py * 10), Math.round(o.pz * 10), Math.round(o.hd * 100), Math.round(o.pitch * 100), o.mesh.visible ? 1 : 0]);
  }

  // guest: aim planes at the host's latest positions (creating any plane we have not seen yet)
  applyPlanes(list) {
    for (const [id, type, vi, x, y, z, hd, pt, vis] of list) {
      let o = this.byId.get(id);
      if (!o) o = this.spawnPlane(type, { id, vi });
      if (o.state !== 0) continue;
      o.tgt = { x: x / 10, y: y / 10, z: z / 10, hd: hd / 100, pt: pt / 100, vis: !!vis };
    }
  }

  clear() {
    for (const o of this.all) this.scene.remove(o.mesh);
    this.all.clear();
    this.movers.length = 0;
    this.falling.length = 0;
    this.planes.length = 0;
    this.glowSet.clear();
    this.planeRespawn.length = 0;
    this.stands = STANDS.map(() => null);
    this.runway = null;
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
        if (j === 0) type = 'airport'; // the whole north row is the airport
        blocks.push({ cx: CENTERS[i], cz: CENTERS[j], type });
        this.blockData[i + j * CELLS] = BLOCK_INDEX[type];
      }
    }
    this.blockTex.needsUpdate = true;
    for (const b of blocks) if (b.type !== 'airport') this.populateBlock(b);
    this.populateRoads();
    this.populateIntersections();
    this.populateSidewalkRiders();
    this.populateAirport();
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
    // street lights along the middle of each block edge, arms reaching over the road
    for (const [mx, mz, ry] of [[0, -18.4, Math.PI / 2], [0, 18.4, -Math.PI / 2], [-18.4, 0, Math.PI], [18.4, 0, 0]]) {
      if (R() < 0.75) S('lamp', mx + (mx === 0 ? rand(-4, 4) : 0), mz + (mz === 0 ? rand(-4, 4) : 0), ry);
    }
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

    // Halloween: a cluster of carved pumpkins in front of a building, plus costumed trick-or-treaters on the sidewalks
    const pumpkinsAt = (x, z, sz, spread, chance = 0.7) => {
      if (R() > chance) return;
      const n = 1 + ((R() * 3) | 0);
      for (let i = 0; i < n; i++) {
        S(R() < 0.25 ? 'pumpkinBig' : 'pumpkin', x + rand(-spread, spread), z + sz * rand(0, 0.9), (sz > 0 ? 0 : Math.PI) + rand(-0.5, 0.5));
      }
    };
    const kids = (n) => {
      for (let i = 0; i < n; i++) { const [x, z] = edgePt(17.3); P('trickOrTreater', x, z, rand(0, 6.28)); }
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
      pumpkinsAt(gx + 4.3, sz * 9.1, sz, 0.9, 1);
      for (let i = 0; i < 6; i++) {
        const o = this.spawnMover('athlete', cx + gx + rand(-5.5, 5.5), cz + sz * rand(9.6, 15.2), rand(0, 6.28), 'person', { workout: true });
        o.wt = 0;
      }
    };

    if (type === 'downtown') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) { S('skyscraper', sx * 8.5, sz * 8.5, facing(sx, sz)); pumpkinsAt(sx * 8.5, sz * 16.1, sz, 5, 0.6); }
      }
      people(8); dogWalkers(1); kids(1);
    } else if (type === 'commercial' || type === 'shops') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (R() < 0.14) { gymLot(sx, sz); continue; }
          const t = type === 'shops' ? 'shop' : R() < 0.55 ? 'office' : 'shop';
          S(t, sx * 8.5, sz * 8.5, facing(sx, sz));
          pumpkinsAt(sx * 8.5, sz * 15.2, sz, 4, 0.7);
        }
      }
      people(type === 'shops' ? 9 : 8); dogWalkers(R() < 0.7 ? 2 : 1); kids(R() < 0.6 ? 1 : 0);
    } else if (type === 'residential') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const hx = sx * 8.5, hz = sz * 8.5;
          S('house', hx, hz, facing(sx, sz));
          pumpkinsAt(hx + (R() < 0.5 ? -3.4 : 3.4), sz * 13.9, sz, 0.8, 0.85);
          for (const [ox, oz] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]]) if (R() < 0.55) S('bush', hx + ox, hz + oz);
          if (R() < 0.5) S(pick(['car', 'car', 'van', 'tesla', 'cybertruck']), hx, sz * 14.6, Math.PI / 2);
        }
      }
      for (const [lx, lz] of [[0, 0], [0, -8.5], [0, 8.5], [-8.5, 0], [8.5, 0]]) if (R() < 0.8) S(pick(['treeOak', 'treeRound', 'treePine']), lx, lz);
      people(5); dogWalkers(R() < 0.8 ? 2 : 1); kids(3 + (R() < 0.5 ? 1 : 0));
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
      people(4); dogWalkers(3); kids(2);
      for (let i = 0; i < 5; i++) {
        S(R() < 0.3 ? 'pumpkinBig' : 'pumpkin', pick([-1, 1]) * rand(2.1, 3.3), rand(-13, 13), rand(0, 6.28));
      }
      const gx = pick([-1, 1]) * 9.5, gz = pick([-1, 1]) * 9.5;
      for (let i = 0; i < 6; i++) S('tombstone', gx + rand(-3.5, 3.5), gz + rand(-3.5, 3.5), (R() < 0.5 ? 0 : Math.PI) + rand(-0.2, 0.2));
      for (let i = 0; i < 7; i++) P('person', rand(-14, 14), rand(-14, 14), rand(0, 6.28));
    }
  }

  populateRoads() {
    // parked cars / vans / motorcycles along the kerbs
    const parkedType = () => { const q = R(); return q < 0.5 ? 'car' : q < 0.62 ? 'van' : q < 0.74 ? 'motorcycleParked' : q < 0.9 ? 'tesla' : 'cybertruck'; };
    for (const L of ROADS) {
      for (let t = -WORLD + 8; t < WORLD - 6; t += 9.5) {
        if (ROADS.some((Rd) => Math.abs(t - Rd) < 8.5)) continue;
        for (const s of [-1, 1]) {
          if (R() > 0.14 || t < -186) continue;
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
          const type = q < 0.12 ? 'bus' : q < 0.22 ? 'van' : q < 0.36 ? 'motorcycle' : q < 0.5 ? 'tesla' : q < 0.58 ? 'cybertruck' : 'car';
          const t = axis === 'z' ? rand(-180, WORLD - 5) : rand(-WORLD + 5, WORLD - 5), sp = type === 'motorcycle' ? rand(8, 12) : rand(5, 9);
          let o;
          if (axis === 'z') {
            o = this.spawnMover(type, L + dir * 1.35, t, dir > 0 ? 0 : Math.PI, 'vehicle');
            o.vz = sp * dir; o.zmin = -186;
          } else {
            o = this.spawnMover(type, t, L + dir * 1.35, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 'vehicle');
            o.vx = sp * dir;
          }
        }
      }
    }
  }

  // traffic lights at half the intersections, stop signs on all four approaches at the others
  populateIntersections() {
    for (const Lx of ROADS) {
      for (const Lz of ROADS) {
        const put = (type, x, z, ry) => { if (z > -196) this.spawn(type, x, z, ry); }; // nothing on the airport apron
        if (R() < 0.5) {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) put('trafficLight', Lx + sx * 5.7, Lz + sz * 5.7, Math.atan2(-sx, -sz));
        } else {
          put('stopSign', Lx + 5.6, Lz - 9.2, Math.PI);
          put('stopSign', Lx - 5.6, Lz + 9.2, 0);
          put('stopSign', Lx - 9.2, Lz + 5.6, -Math.PI / 2);
          put('stopSign', Lx + 9.2, Lz - 5.6, Math.PI / 2);
        }
      }
    }
  }

  populateAirport() {
    for (const x of [-150, -128, -106]) this.spawn('terminal', x, -201, 0);
    this.spawn('tower', -70, -201, 0);
    for (const x of [120, 142, 164, 186, 208]) this.spawn('hangar', x, -202, 0);
    // three aircraft already parked, three more circling until the runway frees up
    const kinds = ['jet', 'prop', 'jet', 'prop', 'jet', 'jet'];
    kinds.forEach((t, i) => {
      const o = this.spawnPlane(t, { timer: i < 3 ? 0 : 5 + (i - 3) * 11 });
      if (i < 3) this.parkPlane(o, [4, 3, 2][i]);
    });
  }

  // bicycles and kick-scooters cruising along the sidewalks (right at the kerb side of each block edge)
  populateSidewalkRiders() {
    for (const axis of ['z', 'x']) {
      for (const c of CENTERS) {
        if (axis === 'x' && c === CENTERS[0]) continue; // no sidewalk rides across the runway
        for (const side of [-1, 1]) {
          const line = c + side * 18.6;
          const n = R() < 0.35 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            if (R() < 0.15) continue;
            const type = R() < 0.5 ? 'bicycle' : 'scooter';
            const dir = R() < 0.5 ? 1 : -1;
            const sp = type === 'bicycle' ? rand(4.5, 6.5) : rand(3, 4.5);
            const t = axis === 'z' ? rand(-180, WORLD - 5) : rand(-WORLD + 5, WORLD - 5);
            let o;
            if (axis === 'z') {
              o = this.spawnMover(type, line, t, dir > 0 ? 0 : Math.PI, 'vehicle');
              o.vz = sp * dir; o.zmin = -186;
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
