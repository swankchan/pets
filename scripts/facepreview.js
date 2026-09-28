// Renders the face decal to a PNG so the make-up can be checked directly.
//   node scripts/facepreview.js [coat] [out.png]
import fs from 'node:fs';
import { buildFaceDecal } from '../src/cat/facePaint.js';
import { COATS } from '../src/cat/fur.js';
import { encodePNG } from './png.js';

const coatKey = process.argv[2] || 'tabby';
const out = process.argv[3] || 'face.png';
const coat = COATS[coatKey];
const decal = buildFaceDecal(coat, 512);
const S = decal.size;
const base = coat.top;

const png = encodePNG(S, S, (py) => {
  const row = S - 1 - py;                      // flip: texture row 0 is the bottom
  return (px) => {
    const i = (row * S + px) * 4;
    const a = decal.data[i + 3] / 255;
    const c = [decal.data[i] / 255, decal.data[i + 1] / 255, decal.data[i + 2] / 255];
    return [
      base.r * (1 - a) + c[0] * a,
      base.g * (1 - a) + c[1] * a,
      base.b * (1 - a) + c[2] * a,
    ];
  };
});
fs.writeFileSync(out, png);
console.log('wrote', out);
