// Procedural cat vocalisations + purr, synthesised with the Web Audio API.
export class CatAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.purrGain = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.initPurr();
    return this.ctx;
  }

  initPurr() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.86 + (Math.random() * 2 - 1) * 0.14;  // brown-ish noise
      d[i] = last;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 3;
    const trem = ctx.createOscillator();
    trem.frequency.value = 26;                              // purr flutter ~26 Hz
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.8;
    this.purrGain = ctx.createGain();
    this.purrGain.gain.value = 0;
    trem.connect(tremGain).connect(this.purrGain.gain);
    src.connect(lp).connect(this.purrGain).connect(this.master);
    src.start(); trem.start();
  }

  setPurr(level) {
    if (!this.ctx || !this.purrGain) return;
    const g = this.enabled ? level * 0.55 : 0;
    this.purrGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.25);
  }

  vocalise(kind) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    if (kind === 'hiss') {
      const len = ctx.sampleRate * 0.5;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0.35;
      src.connect(bp).connect(g).connect(this.master);
      src.start(); src.stop(t + 0.5);
      return;
    }
    const dur = kind === 'chirp' ? 0.16 : 0.75;
    const f0 = kind === 'chirp' ? 780 : 480;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'sawtooth'; osc2.type = 'triangle';
    const gain = ctx.createGain();
    const form = ctx.createBiquadFilter();
    form.type = 'bandpass'; form.frequency.value = kind === 'chirp' ? 2200 : 1150; form.Q.value = 2.5;

    const jitter = 1 + (Math.random() - 0.5) * 0.18;
    osc.frequency.setValueAtTime(f0 * 0.8 * jitter, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.25 * jitter, t + dur * 0.28);
    osc.frequency.linearRampToValueAtTime(f0 * 0.72 * jitter, t + dur);
    osc2.frequency.setValueAtTime(f0 * 1.6 * jitter, t);
    osc2.frequency.linearRampToValueAtTime(f0 * 1.1 * jitter, t + dur);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === 'chirp' ? 0.20 : 0.28, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(form); osc2.connect(form);
    form.connect(gain).connect(this.master);
    osc.start(t); osc2.start(t); osc.stop(t + dur + 0.02); osc2.stop(t + dur + 0.02);
  }
}
