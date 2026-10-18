// Tiny generative soundtrack: a four-bar loop (Am - F - C - G) with drums, bass, a plucky arpeggio and a soft pad,
// synthesised live with the Web Audio API - no audio files to download or license.

const BPM = 122;
const STEP = 60 / BPM / 4; // one 16th note
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// root MIDI note (bass octave) + chord intervals, one entry per bar
const BARS = [
  { root: 45, tones: [0, 3, 7, 12] }, // Am
  { root: 41, tones: [0, 4, 7, 12] }, // F
  { root: 48, tones: [0, 4, 7, 12] }, // C
  { root: 43, tones: [0, 4, 7, 12] }, // G
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 3, 2, 1, 2];
const BASS = { 0: 0, 3: 0, 6: 7, 8: 0, 10: 0, 12: 0, 14: 7 }; // step -> semitone above the root

export function createMusic() {
  let ctx = null, bus = null, noise = null, timer = 0, step = 0, nextTime = 0, running = false;

  function makeNoise() {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(type, freq, t, peak, attack, decay, cutoff, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass'; f.frequency.value = cutoff;
    env(g, t, peak, attack, decay);
    o.connect(f).connect(g).connect(dest || bus);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + 0.3);
  }

  function hit(t, hp, peak, dur) { // noise burst: hats and claps
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  function schedule(s, t) {
    const bar = BARS[(s >> 4) % 4], i = s & 15;
    if (i % 4 === 0) kick(t);
    if (i === 4 || i === 12) hit(t, 1500, 0.35, 0.16); // clap
    if (i % 2 === 0) hit(t, 7000, i % 4 === 2 ? 0.22 : 0.1, 0.05); // hats, louder on the off-beat
    else if (i % 4 === 3) hit(t, 8000, 0.06, 0.03);
    if (BASS[i] !== undefined) tone('sawtooth', midi(bar.root + BASS[i]), t, 0.34, 0.01, STEP * 1.8, 520);
    const n = bar.root + 24 + bar.tones[ARP[i]];
    tone('square', midi(n), t, 0.07, 0.004, STEP * 1.4, 2600);
    if (i === 0) { // pad swell on every bar
      for (const iv of bar.tones.slice(0, 3)) {
        tone('triangle', midi(bar.root + 12 + iv), t, 0.07, 0.25, STEP * 13, 1400);
        tone('triangle', midi(bar.root + 12 + iv) * 1.004, t, 0.05, 0.3, STEP * 13, 1400);
      }
    }
  }

  function tick() {
    while (nextTime < ctx.currentTime + 0.15) {
      schedule(step, nextTime);
      nextTime += STEP;
      step++;
    }
  }

  return {
    get running() { return running; },
    start(audioCtx) {
      if (running || !audioCtx) return;
      if (ctx !== audioCtx) { ctx = audioCtx; bus = null; noise = null; }
      if (!bus) {
        bus = ctx.createGain();
        bus.gain.value = 0.0001;
        bus.connect(ctx.destination);
      }
      if (!noise) noise = makeNoise();
      running = true;
      step = 0;
      nextTime = ctx.currentTime + 0.1;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ctx.currentTime);
      bus.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 1.2);
      timer = setInterval(tick, 30);
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), t);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    },
  };
}
