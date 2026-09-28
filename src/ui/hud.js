// Thin DOM layer: needs bars, mood, and the control dock.
import { NEED_KEYS } from '../ai/brain.js';

const NICE = {
  hunger: 'fullness', thirst: 'water', energy: 'energy', hygiene: 'clean',
  social: 'company', play: 'play', litter: 'bladder',
};

export class Hud {
  constructor() {
    this.el = {
      mood: document.getElementById('mood'),
      trust: document.getElementById('trust'),
      thought: document.getElementById('thought'),
      needs: document.getElementById('needs'),
      fps: document.getElementById('fps'),
      tris: document.getElementById('tris'),
      name: document.getElementById('catname'),
    };
    this.bars = {};
    for (const k of NEED_KEYS) {
      const row = document.createElement('div');
      row.className = 'need';
      row.innerHTML = `<span>${NICE[k]}</span><div class="bar"><i></i></div>`;
      this.el.needs.appendChild(row);
      this.bars[k] = row.querySelector('i');
    }
    this.acc = 0; this.frames = 0;
  }

  update(dt, brain, renderer) {
    this.acc += dt; this.frames++;
    for (const k of NEED_KEYS) {
      const v = brain.needs[k];
      const bar = this.bars[k];
      bar.style.width = (v * 100).toFixed(0) + '%';
      bar.style.background = v > 0.55 ? '#6fbf73' : v > 0.28 ? '#e0b64a' : '#e06a52';
    }
    this.el.mood.textContent = brain.mood;
    this.el.trust.textContent = Math.round(brain.trust * 100) + '%';
    this.el.thought.textContent = brain.thought;
    if (this.acc > 0.5) {
      this.el.fps.textContent = (this.frames / this.acc).toFixed(0);
      this.el.tris.textContent = (renderer.info.render.triangles / 1000).toFixed(0) + 'k tris';
      this.acc = 0; this.frames = 0;
    }
  }
}
