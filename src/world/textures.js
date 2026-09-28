// Tiny procedural texture bakery (canvas based) so the project ships with no assets.
import * as THREE from 'three';

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d') };
}
function finish(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(g, size, amount, alpha = 0.06) {
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

export function woodFloor(size = 1024) {
  const { c, g } = canvas(size);
  const planks = 6, ph = size / planks;
  for (let i = 0; i < planks; i++) {
    const base = 118 + Math.random() * 34;
    g.fillStyle = `rgb(${base}, ${base * 0.72}, ${base * 0.48})`;
    g.fillRect(0, i * ph, size, ph);
    for (let k = 0; k < 90; k++) { // grain
      const y = i * ph + Math.random() * ph;
      g.strokeStyle = `rgba(${base * 0.55},${base * 0.38},${base * 0.24},${0.05 + Math.random() * 0.12})`;
      g.lineWidth = 0.5 + Math.random() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + k) * 2.2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,26,16,0.55)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, i * ph); g.lineTo(size, i * ph); g.stroke();
    const seam = Math.random() * size;
    g.beginPath(); g.moveTo(seam, i * ph); g.lineTo(seam, (i + 1) * ph); g.stroke();
  }
  noise(g, size, 18);
  return finish(c, 3);
}

export function rugTexture(size = 512) {
  const { c, g } = canvas(size);
  g.fillStyle = '#7e8f86';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(240,238,228,0.30)';
  g.lineWidth = 10;
  for (let i = 0; i < 6; i++) {
    g.strokeRect(size * 0.06 * (i + 1), size * 0.06 * (i + 1),
      size - size * 0.12 * (i + 1), size - size * 0.12 * (i + 1));
  }
  noise(g, size, 26);
  return finish(c, 1);
}

export function fabric(hex, size = 256, rough = 22) {
  const { c, g } = canvas(size);
  g.fillStyle = hex;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 3) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`;
    g.fillRect(0, i, size, 1);
    g.fillRect(i, 0, 1, size);
  }
  noise(g, size, rough);
  return finish(c, 4);
}

export function wallTexture(size = 512) {
  const { c, g } = canvas(size);
  g.fillStyle = '#ded6c9';
  g.fillRect(0, 0, size, size);
  noise(g, size, 12);
  return finish(c, 2);
}
