// Sound effects synthesised with the WebAudio API — no audio files, nothing downloaded.
// Everything is created lazily on the first user gesture (browsers block autoplay before
// that). Every call is guarded so a browser without WebAudio, or with it suspended, simply
// plays nothing instead of throwing.

export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;
  // Engine hum nodes, rebuilt when (dis)playing changes.
  let engineOsc = null;
  let engineGain = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      enabled = false;
      ctx = null;
    }
    return ctx;
  }

  /** Call from a user gesture to unlock audio. */
  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone(freq, duration, type, gain, slideTo) {
    if (!enabled || !ensure()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function noise(duration, gain, hp) {
    if (!enabled || !ensure()) return;
    const now = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain || 0.3;
    let node = src;
    if (hp) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = hp;
      src.connect(filter);
      node = filter;
    }
    node.connect(g);
    g.connect(master);
    src.start(now);
  }

  return {
    resume,
    setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.35 : 0; },
    shoot() { tone(880, 0.08, 'square', 0.25, 220); noise(0.05, 0.15, 1200); },
    hit() { noise(0.09, 0.28, 400); },
    crash() { noise(0.22, 0.4, 120); tone(120, 0.2, 'sawtooth', 0.25, 60); },
    pickup() { tone(660, 0.1, 'square', 0.25); tone(990, 0.12, 'square', 0.25); },
    siren() { tone(720, 0.18, 'sine', 0.18, 980); },
    star() { tone(1200, 0.09, 'square', 0.22, 1600); },
    mission() { tone(523, 0.12, 'triangle', 0.28); setTimeout(() => tone(659, 0.12, 'triangle', 0.28), 90); setTimeout(() => tone(784, 0.2, 'triangle', 0.3), 180); },
    busted() { tone(300, 0.5, 'sawtooth', 0.3, 80); },
    engine(on) {
      if (!enabled || !ensure()) { if (engineGain) engineGain.gain.value = 0; return; }
      if (on && !engineOsc) {
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 60;
        engineGain.gain.value = 0.06;
        engineOsc.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
      } else if (!on && engineOsc) {
        try { engineOsc.stop(); } catch { /* already stopped */ }
        engineOsc = null;
        engineGain = null;
      }
    },
    engineSpeed(ratio) {
      if (engineOsc) engineOsc.frequency.value = 55 + ratio * 120;
    },
  };
}