// WebAudio synth: every sound in the game is generated here from oscillators and noise
// buffers, with no samples and no network. The context is created on the first gesture
// (browser autoplay policy); init() is called from the input handler and is safe to repeat.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;
  let noiseBuf = null;

  function makeNoise(context) {
    const len = Math.floor(context.sampleRate * 1.0);
    const buf = context.createBuffer(1, len, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = makeNoise(ctx);
    buildEngine();
    buildSiren();
  }

  // --- engine: a saw that tracks speed -------------------------------------
  function buildEngine() {
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    engineOsc.connect(lp);
    lp.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
  }

  /** speed01: 0..1 fraction of top speed; on: whether the engine is audible. */
  function setEngine(speed01, on) {
    if (!ctx || !engineOsc) return;
    const t = ctx.currentTime;
    const target = on ? 0.06 + speed01 * 0.1 : 0;
    engineGain.gain.setTargetAtTime(target, t, 0.08);
    engineOsc.frequency.setTargetAtTime(48 + speed01 * 150, t, 0.06);
  }

  // --- siren: wailing oscillator, gain by proximity ------------------------
  function buildSiren() {
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenGain.connect(master);
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 660;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 2;
    sirenOsc.connect(bp);
    bp.connect(sirenGain);
    // LFO wobbles the pitch up and down like a real wail.
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 0.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenOsc.start();
    sirenLfo.start();
  }

  /** prox: 0..1, how close the nearest siren is (0 silences it). */
  function setSiren(prox) {
    if (!ctx || !sirenGain) return;
    const t = ctx.currentTime;
    sirenGain.gain.setTargetAtTime(prox > 0.01 ? 0.09 * prox : 0, t, 0.12);
  }

  // --- one-shots -----------------------------------------------------------
  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterType, freq, q) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.value = freq || 1200;
    if (q) f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const api = {
    init,
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEngine,
    setSiren,
    /** Sharp crack + body: the gunshot. */
    shot() {
      noise(0.09, 0.5, 'highpass', 1400);
      tone(220, 0.08, 'square', 0.25, 70);
    },
    /** Tyre screech. */
    skid() {
      noise(0.35, 0.22, 'bandpass', 2600, 3);
    },
    /** Soft crunch for collisions. */
    crash() {
      noise(0.18, 0.4, 'lowpass', 700);
      tone(90, 0.16, 'sawtooth', 0.3, 40);
    },
    /** Explosion: low boom + noise burst. */
    boom() {
      tone(120, 0.5, 'sawtooth', 0.55, 30);
      noise(0.5, 0.6, 'lowpass', 900);
    },
    /** Bright two-note cash jingle. */
    cash() {
      tone(880, 0.09, 'sine', 0.3);
      setTimeout(() => tone(1320, 0.14, 'sine', 0.3), 70);
    },
    /** Rising mission-complete sting. */
    sting() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((n, i) => setTimeout(() => tone(n, 0.22, 'triangle', 0.32), i * 90));
    },
    /** Low fail sting for BUSTED / WASTED. */
    fail() {
      const notes = [392, 330, 262, 196];
      notes.forEach((n, i) => setTimeout(() => tone(n, 0.26, 'sawtooth', 0.3), i * 110));
    },
    /** Footstep tick while running. */
    step() {
      noise(0.03, 0.05, 'lowpass', 500);
    },
    /** UI blip for menus. */
    blip() {
      tone(660, 0.07, 'square', 0.18);
    },
  };

  return api;
}