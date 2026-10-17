import * as THREE from 'three';
import { World, WORLD, MAX_HOLES } from './world.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';

/* ====================================================================== */
/*  Setup                                                                 */
/* ====================================================================== */
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROUND_TIME = 180;
const START_R = 1.5;
const MAX_R = 18;
const BOT_COUNT = 7;
const SNAP_INTERVAL = 0.05; // host -> guest state updates (20 Hz)
const INPUT_INTERVAL = 1 / 30; // guest -> host steering updates

const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
// iPads have huge, high-DPI screens: start at a lower render scale and let the adaptive loop tune it
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
let pixelRatio = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const SKY = 0x9fd3f5;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 140, 460);

const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 800);
scene.add(new THREE.HemisphereLight(0xdcefff, 0x7a8a55, 1.05));
const sun = new THREE.DirectionalLight(0xfff4de, 1.7);
const SUN_DIR = new THREE.Vector3(-0.55, 1, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

const world = new World(scene, renderer);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();
if (IS_TOUCH) document.body.classList.add('touch');

/* ====================================================================== */
/*  Audio (tiny synth, created on first interaction)                      */
/* ====================================================================== */
let audio = null, muted = false, lastBlip = 0;
function initAudio() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  }
  if (audio && audio.state === 'suspended') audio.resume();
}
function blip(freq, dur = 0.14, type = 'sine', vol = 0.07) {
  if (!audio || muted) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 1.7, t + dur * 0.6);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function eatSound(pts, r) {
  const now = performance.now();
  if (now - lastBlip < 45) return;
  lastBlip = now;
  if (pts >= 250) { blip(110, 0.35, 'triangle', 0.16); blip(165, 0.3, 'sine', 0.1); }
  else blip(Math.max(260, 640 - r * 22) + Math.random() * 40, 0.12, 'sine', 0.07);
}

/* ====================================================================== */
/*  Hole                                                                  */
/* ====================================================================== */
const pitGeo = new THREE.CylinderGeometry(1, 1, 70, 48, 1, false);
pitGeo.translate(0, -35, 0);
{
  const pos = pitGeo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(-pos.getY(i) / 70, 0, 1);
    const v = 0.012 * Math.pow(1 - t, 3) + 0.0008;
    col[i * 3] = v * 0.9; col[i * 3 + 1] = v * 0.95; col[i * 3 + 2] = v * 1.25;
  }
  pitGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const pitMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
const ringGeo = new THREE.RingGeometry(0.93, 1.07, 64).rotateX(-Math.PI / 2);
const glowGeo = new THREE.RingGeometry(1.07, 1.3, 64).rotateX(-Math.PI / 2);

class Hole {
  constructor(name, hex, human = false) {
    this.human = human; // steered by a person (not a bot)
    this.isLocal = false; // the hole this browser controls
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
    this.sx = 0; this.sz = 0; this.sr = START_R; // last authoritative state from the host (guest only)
    this.score = 0; this.r = START_R;
    this.alive = false;
    this.respawn = 0;
    this.keep = 0;
    this.pulse = 0;

    this.pit = new THREE.Mesh(pitGeo, pitMat);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.position.y = 0.05; this.glow.position.y = 0.045;
    this.ring.renderOrder = 2; this.glow.renderOrder = 1;
    scene.add(this.pit, this.ring, this.glow);

    this.tag = document.createElement('div');
    this.tag.className = 'tag';
    this.tag.innerHTML = '<span class="dot"></span><span class="nm"></span>';
    $('tags').appendChild(this.tag);

    this.setColor(hex);
    this.setName(name);
    this.setVisible(false);
  }
  setName(n) { this.name = n; this.tag.querySelector('.nm').textContent = n; }
  setColor(hex) {
    this.hex = hex;
    this.color = new THREE.Color(hex);
    this.cssColor = '#' + this.color.getHexString();
    this.glow.material.color.copy(this.color);
    this.tag.querySelector('.dot').style.background = this.cssColor;
    this.setLocal(this.isLocal);
  }
  setLocal(v) {
    this.isLocal = v;
    this.ring.material.color.set(v ? 0xffffff : this.color);
    this.tag.classList.toggle('me', v);
  }
  setVisible(v) {
    this.pit.visible = this.ring.visible = this.glow.visible = v;
    this.tag.style.display = v ? '' : 'none';
  }
  get targetR() { return Math.min(MAX_R, START_R + 0.1 * Math.pow(this.score, 0.55)); }

  spawnAt(x, z, score) {
    this.x = this.sx = x; this.z = this.sz = z; this.vx = this.vz = 0;
    this.score = score;
    this.r = this.sr = this.targetR;
    this.alive = true;
    this.pulse = 0;
    this.setVisible(true);
    this.syncVisual();
  }

  kill() { this.alive = false; this.setVisible(false); }

  move(dx, dz, dt) {
    const m = Math.hypot(dx, dz);
    if (m > 1) { dx /= m; dz /= m; }
    const sp = (8.8 + this.r * 0.5) * (this.human ? 1 : 0.82);
    const k = Math.min(1, dt * 7);
    this.vx += (dx * sp - this.vx) * k;
    this.vz += (dz * sp - this.vz) * k;
    this.x = clamp(this.x + this.vx * dt, -WORLD + 1, WORLD - 1);
    this.z = clamp(this.z + this.vz * dt, -WORLD + 1, WORLD - 1);
  }

  syncVisual() {
    const s = this.r * (1 + this.pulse * 0.07);
    this.pit.position.set(this.x, 0, this.z); this.pit.scale.set(this.r, 1, this.r);
    this.ring.position.x = this.glow.position.x = this.x;
    this.ring.position.z = this.glow.position.z = this.z;
    this.ring.scale.setScalar(s); this.glow.scale.setScalar(s);
  }
}

/* ====================================================================== */
/*  Entities                                                              */
/* ====================================================================== */
const BOT_NAMES = ['Blobzilla', 'Voidy', 'Sinky', 'DeepDive', 'Pitfall', 'Gulper', 'Abyss', 'Maw', 'Chomp', 'DarkMatter', 'Nom', 'Crater'];
const BOT_COLORS = [0xff5964, 0xffa630, 0xf7e04c, 0x6ede6e, 0x35c9e8, 0x7f7bff, 0xd36bff, 0x3ee6b0, 0xff8a5c, 0xb8f23d];

// Slots: 0 = host / solo player, 1 = remote friend (empty unless someone joined), 2.. = bots.
const human0 = new Hole('You', 0x22d3ee, true);
const human1 = new Hole('Friend', 0xff4fd8, true);
const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const b = new Hole(BOT_NAMES[i], BOT_COLORS[i]);
  b.think = rand(0, 0.5);
  b.target = null;
  b.wander = rand(0, 6.28);
  bots.push(b);
}
const holes = [human0, human1, ...bots];
if (holes.length > MAX_HOLES) throw new Error('raise MAX_HOLES');

function shuffleBots() {
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const cols = BOT_COLORS.slice().sort(() => Math.random() - 0.5);
  bots.forEach((b, i) => { b.setName(names[i]); b.setColor(cols[i]); });
}

/* ====================================================================== */
/*  Game state                                                            */
/* ====================================================================== */
let state = 'menu'; // menu | playing | over
let role = 'solo'; // solo | host | guest
let me = human0; // the hole this browser steers
let link = null; // PeerJS connection wrapper (host or guest)
let timeLeft = ROUND_TIME;
let playerName = 'You';
let camSubject = bots[0];
const cam = { r: START_R, x: 0, z: 0 };

// host -> guest event streams (flushed with each snapshot) + full log for late joiners
const evOut = [], spOut = [], killOut = [];
const roundLog = { eaten: [], spawned: [] };
let snapTimer = 0;
const guestInput = { x: 0, z: 0, t: 0 };
let inputTimer = 0;

world.onSpawn = (o) => {
  if (role !== 'host') return;
  const e = [o.id, o.type, o.vi, Math.round(o.x * 10), Math.round(o.z * 10)];
  spOut.push(e); roundLog.spawned.push(e);
};

function randomSpawn() {
  for (let tries = 0; tries < 30; tries++) {
    // spawn on a street so nobody starts hidden under a skyscraper
    const L = [-72, -24, 24, 72][(Math.random() * 4) | 0], t = rand(-100, 100);
    const [x, z] = Math.random() < 0.5 ? [L, t] : [t, L];
    if (holes.every((h) => !h.alive || Math.hypot(h.x - x, h.z - z) > 35)) return [x, z];
  }
  return [rand(-100, 100), rand(-100, 100)];
}

function setLocal(h) {
  me = h;
  for (const o of holes) o.setLocal(o === h);
}

// Host / solo: generate a fresh city and spawn everybody.
function startRound(withPlayer) {
  world.generate();
  evOut.length = spOut.length = killOut.length = 0;
  roundLog.eaten.length = roundLog.spawned.length = 0;
  timeLeft = ROUND_TIME;
  for (const h of holes) { h.kill(); h.respawn = 0; h.keep = 0; }
  shuffleBots();
  setLocal(human0);
  human0.setName(playerName);
  if (withPlayer) {
    const [x, z] = randomSpawn();
    human0.spawnAt(x, z, 0);
    cam.x = x; cam.z = z; cam.r = human0.r;
  }
  if (role === 'host' && link && link.connected) {
    const [x, z] = randomSpawn();
    human1.spawnAt(x, z, 0);
  }
  for (const b of bots) { const [x, z] = randomSpawn(); b.spawnAt(x, z, 0); b.target = null; }
  if (role === 'host' && link && link.connected) sendStart();
}

function showPlaying() {
  state = 'playing';
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('banner').classList.add('hidden');
  updateRoomChip();
}

function readName(fallback = 'You') {
  playerName = ($('name').value || '').trim().slice(0, 14) || fallback;
  try { localStorage.setItem('sinkhole-name', playerName); } catch (e) {}
}

function startSolo() {
  initAudio();
  readName();
  leaveRoom();
  startRound(true);
  showPlaying();
}

function endGame() {
  if (state === 'over') return;
  state = 'over';
  const ranked = holes.filter((h) => h.human ? (h === human0 || h === human1 && (role !== 'solo' && link)) : true).sort((a, b) => b.score - a.score);
  const rank = ranked.indexOf(me) + 1;
  $('over-title').textContent = rank === 1 ? 'You win!' : rank <= 3 ? 'Podium finish!' : "Time's up!";
  $('over-sub').textContent = `You placed #${rank} of ${ranked.length} with ${Math.floor(me.score).toLocaleString()} points`;
  $('over-board').innerHTML = ranked
    .map((h, i) => `<li class="${h === me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="dot" style="background:${h.cssColor}"></span><span class="nm">${escapeHtml(h.name)}</span><span class="sc">${Math.floor(h.score).toLocaleString()}</span></li>`)
    .join('');
  const guest = role === 'guest';
  $('again').classList.toggle('hidden', guest);
  $('over-wait').classList.toggle('hidden', !guest);
  $('over').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('banner').classList.add('hidden');
  for (const h of holes) if (h.human) h.kill();
  updateRoomChip();
  if (role === 'host') link.send({ t: 'end', s: holes.map((h) => Math.floor(h.score)) });
}

/* ====================================================================== */
/*  Multiplayer (host-authoritative over a PeerJS data channel)           */
/* ====================================================================== */
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function setNetStatus(msg, bad = false) {
  const el = $('net-status');
  el.textContent = msg || '';
  el.classList.toggle('bad', bad);
}

function updateRoomChip() {
  const chip = $('room');
  if (role !== 'host' || !link || state !== 'playing') { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  $('room-code').textContent = link.code || '…';
  $('room-state').textContent = link.connected ? `${human1.name} is playing` : link.code ? 'waiting for a friend…' : 'creating room…';
  $('room-copy').disabled = !link.code;
}

function leaveRoom() {
  if (link) { try { link.close(); } catch (e) {} }
  link = null;
  role = 'solo';
  human1.kill(); human1.respawn = 0;
  setLocal(human0);
  updateRoomChip();
}

function inviteUrl() {
  return `${location.origin}${location.pathname}?room=${link.code}`;
}

async function copyInvite() {
  if (!link || !link.code) return;
  const url = inviteUrl();
  try { await navigator.clipboard.writeText(url); toast('Invite link copied - send it to your friend'); }
  catch (e) { window.prompt('Copy this invite link:', url); }
}

/* ---- host ---- */
function startHosting() {
  initAudio();
  readName('Host');
  leaveRoom();
  role = 'host';
  setNetStatus('');
  link = hostRoom({
    onOpen: () => { updateRoomChip(); toast(`Room ${link.code} is open - share the link`); },
    onGuest: () => updateRoomChip(),
    onData: onHostData,
    onGuestLeft: () => {
      toast(`${human1.name} left the game`);
      human1.kill(); human1.respawn = 0;
      updateRoomChip();
    },
    onError: (e) => {
      toast('Could not open a room - check your internet connection and try again', 5000);
      console.warn('host error', e);
      leaveRoom();
    },
  });
  startRound(true);
  showPlaying();
  updateRoomChip();
}

function onHostData(m) {
  if (!m) return;
  if (m.t === 'hello') {
    human1.setName(String(m.name || 'Friend').slice(0, 14));
    if (state === 'playing') {
      const [x, z] = randomSpawn();
      human1.spawnAt(x, z, 0);
      sendStart();
    } else {
      // between rounds: the guest just waits for the next start
      link.send({ t: 'wait' });
    }
    toast(`${human1.name} joined!`);
    updateRoomChip();
  } else if (m.t === 'in') {
    guestInput.x = clamp(+m.x || 0, -1, 1); guestInput.z = clamp(+m.z || 0, -1, 1);
    guestInput.t = performance.now();
  }
}

function sendStart() {
  link.send({
    t: 'start',
    seed: world.seed,
    time: timeLeft,
    holes: holes.map((h) => [h.name, h.hex, h.alive ? 1 : 0, h.x, h.z, h.score]),
    eaten: roundLog.eaten,
    spawned: roundLog.spawned,
  });
}

function sendSnapshot() {
  const ref = human1;
  const movers = [];
  for (const o of world.movers) {
    const dx = o.x - ref.x, dz = o.z - ref.z;
    if (dx * dx + dz * dz < 130 * 130) movers.push(o.id, Math.round(o.x * 10), Math.round(o.z * 10));
  }
  link.send({
    t: 's',
    tm: timeLeft,
    h: holes.map((h) => [h.alive ? 1 : 0, Math.round(h.x * 10), Math.round(h.z * 10), Math.round(h.r * 100), Math.floor(h.score)]),
    m: movers,
    e: evOut.slice(), sp: spOut.slice(), k: killOut.slice(),
  });
  evOut.length = spOut.length = killOut.length = 0;
}

/* ---- guest ---- */
function startJoining(rawCode) {
  initAudio();
  readName('Guest');
  const code = normalizeCode(rawCode);
  if (code.length !== 5) { setNetStatus('Enter the 5-character room code', true); return; }
  leaveRoom();
  setNetStatus('Connecting…');
  $('join').disabled = $('host').disabled = $('play').disabled = true;
  const unlock = () => { $('join').disabled = $('host').disabled = $('play').disabled = false; };
  link = joinRoom(code, {
    onOpen: () => { link.send({ t: 'hello', name: playerName }); setNetStatus('Connected - waiting for the host…'); },
    onData: onGuestData,
    onClose: () => {
      unlock();
      toast('The host left the game', 4500);
      backToMenu();
    },
    onError: (e) => {
      unlock();
      setNetStatus(e && e.type === 'peer-unavailable' ? `No room "${code}" found - check the code` : e && e.type === 'timeout' ? 'Timed out connecting - try again' : 'Could not connect - check your internet connection', true);
      link = null; role = 'solo';
    },
  });
}

function onGuestData(m) {
  if (!m) return;
  if (m.t === 'start') applyStart(m);
  else if (m.t === 's') { if (state === 'playing') applySnapshot(m); }
  else if (m.t === 'end') {
    m.s.forEach((s, i) => { holes[i].score = s; });
    endGame();
  } else if (m.t === 'wait') {
    setNetStatus('Connected - the host is between rounds, hang tight…');
  } else if (m.t === 'full') {
    $('join').disabled = $('host').disabled = $('play').disabled = false;
    setNetStatus('That room is already full (2 players max)', true);
    link.close(); link = null; role = 'solo';
  }
}

function applyStart(m) {
  role = 'guest';
  $('join').disabled = $('host').disabled = $('play').disabled = false;
  setNetStatus('');
  world.generate(m.seed);
  for (const [id, type, vi, x, z] of m.spawned) world.spawnMover(type, x / 10, z / 10, rand(0, 6.28), 'person', { id, vi });
  for (const id of m.eaten) world.removeInstant(id);
  timeLeft = m.time;
  m.holes.forEach(([name, hex, alive, x, z, score], i) => {
    const h = holes[i];
    h.setName(name); h.setColor(hex);
    if (alive) h.spawnAt(x, z, score); else { h.kill(); h.score = score; }
  });
  setLocal(human1);
  cam.x = human1.x; cam.z = human1.z; cam.r = human1.r;
  evOut.length = 0;
  showPlaying();
}

function applySnapshot(m) {
  timeLeft = m.tm;
  m.h.forEach((a, i) => {
    const h = holes[i], alive = !!a[0];
    if (alive && !h.alive) h.spawnAt(a[1] / 10, a[2] / 10, a[4]);
    else if (!alive && h.alive) h.kill();
    h.sx = a[1] / 10; h.sz = a[2] / 10; h.sr = a[3] / 100; h.score = a[4];
  });
  if (!me.alive) { /* waiting to respawn */ } else $('banner').classList.add('hidden');
  world.applyMovers(m.m);
  for (const [id, type, vi, x, z] of m.sp) world.spawnMover(type, x / 10, z / 10, rand(0, 6.28), 'person', { id, vi });
  for (const [id, idx] of m.e) {
    const o = world.byId.get(id), h = holes[idx];
    if (!o || o.state !== 0 || !h) continue;
    world.startFall(o, h);
    h.pulse = 1;
    if (h === me) onLocalEat(o);
  }
  for (const [victim, eater] of m.k) onHoleEaten(holes[eater], holes[victim]);
}

function guestSend(ix, iz, dt) {
  inputTimer -= dt;
  if (inputTimer > 0) return;
  inputTimer = INPUT_INTERVAL;
  link.send({ t: 'in', x: +ix.toFixed(2), z: +iz.toFixed(2) });
}

function backToMenu() {
  leaveRoom();
  state = 'menu';
  for (const h of holes) if (h.human) h.kill();
  $('over').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('banner').classList.add('hidden');
  $('menu').classList.remove('hidden');
  camSubject = bots[0];
  // go back to an offline attract-mode city behind the menu
  startRound(false);
}

/* ====================================================================== */
/*  Input                                                                 */
/* ====================================================================== */
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') { if (e.target.id === 'code') startJoining($('code').value); else startSolo(); }
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyM') { muted = !muted; }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// Touch (iPad/phone): a floating joystick appears under the first finger; extra fingers are ignored.
// Mouse: hold the button and the hole heads toward the cursor.
const pointer = { down: false, id: -1, x: 0, y: 0, ox: 0, oy: 0, touch: false };
const canvasEl = $('game');
canvasEl.addEventListener('pointerdown', (e) => {
  if (pointer.down) return;
  initAudio();
  try { canvasEl.setPointerCapture(e.pointerId); } catch (err) {}
  pointer.down = true; pointer.id = e.pointerId; pointer.touch = e.pointerType !== 'mouse';
  pointer.x = pointer.ox = e.clientX; pointer.y = pointer.oy = e.clientY;
  if (pointer.touch) {
    const j = $('joy');
    j.style.left = e.clientX + 'px'; j.style.top = e.clientY + 'px';
    j.classList.remove('hidden');
  }
});
canvasEl.addEventListener('pointermove', (e) => {
  if (!pointer.down || e.pointerId !== pointer.id) return;
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (pointer.touch) {
    const dx = clamp(e.clientX - pointer.ox, -50, 50), dy = clamp(e.clientY - pointer.oy, -50, 50);
    $('joy-knob').style.transform = `translate(${dx}px, ${dy}px)`;
  }
});
const release = (e) => {
  if (e && e.pointerId !== pointer.id) return;
  pointer.down = false; pointer.id = -1;
  $('joy').classList.add('hidden'); $('joy-knob').style.transform = '';
};
canvasEl.addEventListener('pointerup', release);
canvasEl.addEventListener('pointercancel', release);
canvasEl.addEventListener('lostpointercapture', release);

// stop Safari's pinch-zoom, double-tap zoom, rubber-band scrolling and long-press menus while playing
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.target === canvasEl) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const n = Date.now();
  if (n - lastTouchEnd < 350 && e.target === canvasEl) e.preventDefault();
  lastTouchEnd = n;
}, { passive: false });

function playerInput() {
  let dx = 0, dz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
  if (dx || dz) return [dx, dz];
  if (pointer.down) {
    let vx, vy, full;
    if (pointer.touch) { vx = pointer.x - pointer.ox; vy = pointer.y - pointer.oy; full = 50; }
    else { vx = pointer.x - window.innerWidth / 2; vy = pointer.y - window.innerHeight / 2; full = Math.min(window.innerWidth, window.innerHeight) * 0.22; }
    const m = Math.hypot(vx, vy);
    if (m > 10) { const s = Math.min(1, (m - 10) / full); return [(vx / m) * s, (vy / m) * s]; }
  }
  return [0, 0];
}

/* ====================================================================== */
/*  Bot AI (runs on the host / solo only)                                 */
/* ====================================================================== */
function botThink(b) {
  // pick the juiciest eatable thing nearby
  let best = null, bestScore = -1;
  world.query(b.x, b.z, 42, (o) => {
    if (o.state !== 0 || b.r < o.need) return;
    const d = Math.hypot(o.x - b.x, o.z - b.z);
    const s = (o.pts + 8) / (d + 6) * rand(0.8, 1.25) * (o.kind === 'person' ? 0.7 : 1);
    if (s > bestScore) { bestScore = s; best = o; }
  });
  b.target = best;
}

function botUpdate(b, dt) {
  b.think -= dt;
  if (b.think <= 0 || (b.target && b.target.state !== 0)) { b.think = rand(0.3, 0.6); botThink(b); }

  let dx = 0, dz = 0, danger = false;
  for (const o of holes) {
    if (o === b || !o.alive) continue;
    const ox = o.x - b.x, oz = o.z - b.z, d = Math.hypot(ox, oz);
    if (o.r > b.r * 1.15 && d < o.r + 16 + b.r) { // run away
      dx -= (ox / d) * (1 + 14 / (d + 1)); dz -= (oz / d) * (1 + 14 / (d + 1)); danger = true;
    }
  }
  if (!danger) {
    // hunt a smaller hole if one is close
    let prey = null, pd = 28;
    for (const o of holes) {
      if (o === b || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (b.r > o.r * 1.3 && d < pd) { prey = o; pd = d; }
    }
    if (prey) { dx = prey.x - b.x; dz = prey.z - b.z; }
    else if (b.target) { dx = b.target.x - b.x; dz = b.target.z - b.z; }
    else {
      b.wander += rand(-1, 1) * dt;
      dx = Math.cos(b.wander); dz = Math.sin(b.wander);
    }
  }
  // steer away from the world edge
  const e = WORLD - 8;
  if (b.x > e) dx -= 1; else if (b.x < -e) dx += 1;
  if (b.z > e) dz -= 1; else if (b.z < -e) dz += 1;
  const m = Math.hypot(dx, dz) || 1;
  b.move(dx / m, dz / m, dt);
}

/* ====================================================================== */
/*  Eating                                                                */
/* ====================================================================== */
let popupCount = 0;
const tmpV = new THREE.Vector3();
function popup(text, x, y, z, cls = '') {
  if (popupCount > 14) return;
  tmpV.set(x, y, z).project(camera);
  if (tmpV.z > 1) return;
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  el.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  $('pops').appendChild(el);
  popupCount++;
  el.addEventListener('animationend', () => { el.remove(); popupCount--; });
}

function onLocalEat(o) {
  eatSound(o.pts, me.r);
  popup('+' + o.pts, o.x, Math.min(o.h, 6) * 0.6 + 1, o.z, o.pts >= 250 ? 'big' : '');
}

function swallow(h) {
  world.query(h.x, h.z, h.r, (o) => {
    if (o.state !== 0 || h.r < o.need) return;
    const d = Math.hypot(o.x - h.x, o.z - h.z);
    if (d < Math.max(0.15, h.r * 0.9 - o.r * 0.35)) {
      world.startFall(o, h);
      h.score += h.human ? o.pts : o.pts * 0.5; // bots are deliberately slower growers
      h.pulse = 1;
      if (role === 'host') { const e = [o.id, holes.indexOf(h)]; evOut.push(e); roundLog.eaten.push(o.id); }
      if (h === me) onLocalEat(o);
    }
  });
}

// shared by the host (after deciding) and the guest (told by the host)
function onHoleEaten(eater, victim) {
  if (victim === me) {
    $('banner-text').textContent = `Eaten by ${eater.name}!`;
    $('banner').classList.remove('hidden');
    blip(90, 0.5, 'sawtooth', 0.12);
  } else if (eater === me) {
    popup(`Ate ${victim.name}!`, victim.x, 2, victim.z, 'big');
    blip(140, 0.4, 'triangle', 0.16);
  }
}

function holeVsHole() {
  for (const a of holes) {
    if (!a.alive) continue;
    for (const b of holes) {
      if (a === b || !b.alive) continue;
      if (a.r > b.r * 1.15 && Math.hypot(a.x - b.x, a.z - b.z) < a.r * 0.85 - b.r * 0.25) {
        a.score += 50 + b.score * 0.5;
        a.pulse = 1;
        b.keep = b.score * 0.3;
        b.kill();
        b.respawn = 3;
        if (role === 'host') killOut.push([holes.indexOf(b), holes.indexOf(a)]);
        onHoleEaten(a, b);
      }
    }
  }
}

/* ====================================================================== */
/*  HUD                                                                   */
/* ====================================================================== */
const mm = $('minimap'), mmc = mm.getContext('2d');
let hudTimer = 0;

// only holes that are actually in this match (the second human slot is empty in solo games)
const inMatch = (h) => h !== human1 || (role !== 'solo' && (role === 'guest' || (link && link.connected)) && (h.alive || h.score > 0 || h.respawn > 0));

function updateHud() {
  $('score').textContent = Math.floor(me.score).toLocaleString();
  $('size').textContent = me.r.toFixed(1) + ' m';
  const t = Math.max(0, Math.ceil(timeLeft));
  $('timer').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  $('timer').classList.toggle('low', t <= 20);
  const ranked = holes.filter(inMatch).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 6);
  const myRank = ranked.indexOf(me);
  let html = top.map((h, i) => row(h, i)).join('');
  if (myRank >= 6) html += row(me, myRank);
  $('board').innerHTML = html;
  if (role === 'host') updateRoomChip();
}
function row(h, i) {
  return `<li class="${h === me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="dot" style="background:${h.cssColor}"></span><span class="nm">${escapeHtml(h.name)}</span><span class="sc">${Math.floor(h.score).toLocaleString()}</span></li>`;
}

function drawMinimap() {
  const W = mm.width, s = W / (WORLD * 2);
  mmc.clearRect(0, 0, W, W);
  mmc.fillStyle = 'rgba(20,28,40,0.55)';
  mmc.fillRect(0, 0, W, W);
  mmc.fillStyle = 'rgba(255,255,255,0.14)';
  for (const L of [-72, -24, 24, 72]) { mmc.fillRect((L + WORLD - 3) * s, 0, 6 * s, W); mmc.fillRect(0, (L + WORLD - 3) * s, W, 6 * s); }
  for (const h of holes) {
    if (!h.alive) continue;
    const x = (h.x + WORLD) * s, y = (h.z + WORLD) * s, r = Math.max(3, h.r * s);
    mmc.beginPath(); mmc.arc(x, y, r, 0, 6.283);
    mmc.fillStyle = h.cssColor; mmc.fill();
    if (h === me) { mmc.lineWidth = 2; mmc.strokeStyle = '#fff'; mmc.stroke(); }
  }
}

function updateTags() {
  for (const h of holes) {
    if (!h.alive) continue;
    tmpV.set(h.x, 1.2, h.z - h.r * 0.3).project(camera);
    const on = tmpV.z < 1 && Math.abs(tmpV.x) < 1.2 && Math.abs(tmpV.y) < 1.2;
    h.tag.style.visibility = on ? 'visible' : 'hidden';
    if (on) h.tag.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * window.innerWidth}px, ${(-tmpV.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -50%)`;
  }
}

/* ====================================================================== */
/*  Main loop                                                             */
/* ====================================================================== */
const clock = new THREE.Clock();
let t = 0;
let lastShadowSize = 0;
let perfTime = -3, perfFrames = 0; // negative start = grace period while assets/shaders warm up

function hostFrame(dt) {
  if (state === 'playing') {
    if (human0.alive) { const [ix, iz] = playerInput(); human0.move(ix, iz, dt); }
    if (role === 'host' && human1.alive) {
      const stale = performance.now() - guestInput.t > 1000;
      human1.move(stale ? 0 : guestInput.x, stale ? 0 : guestInput.z, dt);
    }
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endGame(); }
  }
  for (const b of bots) if (b.alive) botUpdate(b, dt);

  for (const h of holes) {
    if (!h.alive) continue;
    swallow(h);
    h.r += (h.targetR - h.r) * Math.min(1, dt * 4);
    h.pulse = Math.max(0, h.pulse - dt * 4);
  }
  holeVsHole();

  // respawns
  for (const h of holes) {
    if (!h.alive && h.respawn > 0 && (state === 'playing' || !h.human)) {
      h.respawn -= dt;
      if (h.respawn <= 0) {
        const [x, z] = randomSpawn();
        h.spawnAt(x, z, h.keep || 0);
        if (h === me) $('banner').classList.add('hidden');
      }
    }
  }

  world.replenish(dt, holes);
  world.updateMovers(dt, t, holes);
  world.updateFalling(dt);

  if (role === 'host' && link && link.connected && state === 'playing') {
    snapTimer -= dt;
    if (snapTimer <= 0) { snapTimer = SNAP_INTERVAL; sendSnapshot(); }
  }
}

function guestFrame(dt) {
  if (state !== 'playing') return;
  timeLeft = Math.max(0, timeLeft - dt);
  let ix = 0, iz = 0;
  if (me.alive) { [ix, iz] = playerInput(); me.move(ix, iz, dt); }
  guestSend(ix, iz, dt);

  for (const h of holes) {
    if (!h.alive) continue;
    if (h === me) {
      // client-side prediction: we steer locally and let the host's position gently pull us back in line
      const ex = h.sx - h.x, ez = h.sz - h.z;
      if (Math.hypot(ex, ez) > 8) { h.x = h.sx; h.z = h.sz; }
      else { const k = Math.min(1, dt * 3); h.x += ex * k; h.z += ez * k; }
    } else {
      const k = Math.min(1, dt * 14);
      h.x += (h.sx - h.x) * k; h.z += (h.sz - h.z) * k;
    }
    h.r += (h.sr - h.r) * Math.min(1, dt * 8);
    h.pulse = Math.max(0, h.pulse - dt * 4);
  }
  world.updateRemote(dt, t);
  world.updateFalling(dt);
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  t += dt;

  // adaptive resolution: if the last ~2 s averaged under 40 fps, render fewer pixels
  perfTime += rawDt; perfFrames++;
  if (perfTime < 0) perfFrames = 0;
  else if (perfTime > 2) {
    const fps = perfFrames / perfTime;
    if (fps < 40 && pixelRatio > 0.75 && !document.hidden) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    perfTime = 0; perfFrames = 0;
  }

  if (role === 'guest') guestFrame(dt); else hostFrame(dt);

  // --- visuals ---
  for (let i = 0; i < MAX_HOLES; i++) {
    const h = holes[i];
    if (h && h.alive) { world.uHoles[i].set(h.x, h.z, h.r); h.syncVisual(); }
    else world.uHoles[i].set(0, 0, 0);
  }

  // camera follows the local player (or the current leader while in menu / game over)
  if (state === 'playing') camSubject = me; // stays put while respawning
  else if (!camSubject.alive || camSubject.human) {
    camSubject = bots.filter((b) => b.alive).sort((a, b) => b.score - a.score)[0] || bots[0];
  }
  const sub = camSubject;
  if (sub) {
    const k = Math.min(1, dt * 5);
    cam.x += (sub.x - cam.x) * k; cam.z += (sub.z - cam.z) * k;
    cam.r += (sub.r - cam.r) * Math.min(1, dt * 2.5);
  }
  const H = 12 + cam.r * 4.3, Bk = H * 0.42;
  camera.position.set(cam.x, H, cam.z + Bk);
  camera.lookAt(cam.x, 0, cam.z - cam.r * 0.15);

  const ss = Math.round((H * 1.25 + 14) / 4) * 4;
  sun.position.set(cam.x + SUN_DIR.x * 120, SUN_DIR.y * 120, cam.z + SUN_DIR.z * 120);
  sun.target.position.set(cam.x, 0, cam.z);
  if (ss !== lastShadowSize) {
    lastShadowSize = ss;
    const c = sun.shadow.camera;
    c.left = -ss; c.right = ss; c.top = ss; c.bottom = -ss; c.near = 10; c.far = 320;
    c.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
  updateTags();

  hudTimer -= dt;
  if (hudTimer <= 0 && state === 'playing') { hudTimer = 0.12; updateHud(); }
  if (state === 'playing') drawMinimap();
}

/* ====================================================================== */
/*  UI wiring                                                             */
/* ====================================================================== */
$('play').addEventListener('click', startSolo);
$('host').addEventListener('click', startHosting);
$('join').addEventListener('click', () => startJoining($('code').value));
$('room-copy').addEventListener('click', copyInvite);
$('again').addEventListener('click', () => {
  initAudio();
  if (role === 'guest') return;
  startRound(true);
  showPlaying();
});
$('menu-btn').addEventListener('click', backToMenu);
$('code').addEventListener('input', () => { $('code').value = normalizeCode($('code').value); });
try { $('name').value = localStorage.getItem('sinkhole-name') || ''; } catch (e) {}

// invite links look like  .../index.html?room=ABCDE
{
  const q = new URLSearchParams(location.search).get('room');
  if (q) {
    $('code').value = normalizeCode(q);
    setNetStatus(`You've been invited to room ${normalizeCode(q)} - enter your name and press Join`);
  }
}

// start in attract mode: bots play while the menu is shown
startRound(false);
camSubject = bots[0];
requestAnimationFrame(() => document.body.classList.add('ready'));
frame();

// handy for debugging / automated checks
window.__game = {
  world, holes, bots, human0, human1, camera, scene, renderer, endGame, startSolo, startHosting, startJoining,
  get me() { return me; }, get role() { return role; }, get state() { return state; }, get link() { return link; },
  get timeLeft() { return timeLeft; },
};
