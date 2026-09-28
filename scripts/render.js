// Offline preview: skins the cat on the CPU and rasterises it to a PNG so the
// silhouette / poses can be inspected without a GPU.
//   node scripts/render.js [pose] [out.png] [yaw] [pitch]
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { Cat } from '../src/cat/cat.js';
import { sampleFaceDecal, FACE_BOX } from '../src/cat/facePaint.js';
import { COATS } from '../src/cat/fur.js';

const POSE = process.argv[2] || 'stand';
const OUT = process.argv[3] || `preview-${POSE}.png`;
const YAW = parseFloat(process.argv[4] ?? '0.9');
const PITCH = parseFloat(process.argv[5] ?? '0.22');
const W = 900, H = 620;

const cat = new Cat({ quality: { shells: 0, voxel: 0.0055, furDensity: 900 } });
const scene = new THREE.Scene();
scene.add(cat.group);
cat.pose = POSE;
if (POSE === 'walk' || POSE === 'trot' || POSE === 'run') {
  cat.speed = POSE === 'run' ? 2.4 : POSE === 'trot' ? 1.0 : 0.4;
  for (let i = 0; i < 200; i++) { cat.animator.update(1 / 60, { speed: cat.speed, turn: 0 }); }
} else {
  for (let i = 0; i < 260; i++) cat.update(1 / 60, {});
}
scene.updateMatrixWorld(true);

// ---- CPU skinning -----------------------------------------------------
const geo = cat.geometry;
const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
const skeleton = cat.skeleton;
const mats = skeleton.bones.map((b, i) =>
  new THREE.Matrix4().multiplyMatrices(b.matrixWorld, skeleton.boneInverses[i]));
const out = new Float32Array(pos.count * 3);
const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
const REST = !!process.env.REST;
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i);
  if (REST) { out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; continue; }
  acc.set(0, 0, 0);
  for (let j = 0; j < 4; j++) {
    const w = sw.getComponent(i, j);
    if (w <= 0) continue;
    tmp.copy(v).applyMatrix4(mats[si.getComponent(i, j)]);
    acc.addScaledVector(tmp, w);
  }
  out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
}

// gather extra (non skinned) props: eyes, ears, nose
const extras = [];
const HIDE = (process.env.HIDE || '').split(',');
const hidden = new Set();
if (HIDE.includes('lids')) for (const l of cat.features.lids) { hidden.add(l.upper); hidden.add(l.lower); }
if (HIDE.includes('eyes')) for (const e of cat.features.eyes) hidden.add(e);
cat.group.traverse((o) => {
  if (o.isMesh && !o.isSkinnedMesh && o.visible && !hidden.has(o)) extras.push(o);
});

// ---- camera -----------------------------------------------------------
// FOCUS=head frames a tight portrait, for checking the facial features.
const HEAD = process.env.FOCUS === 'head';
const headWorld = new THREE.Vector3();
cat.bones.head.getWorldPosition(headWorld);
if (REST) headWorld.copy(cat.rest.head);
const target = HEAD ? headWorld.clone().add(new THREE.Vector3(0, -0.01, 0.03)) : new THREE.Vector3(0, 0.16, 0.02);
const dist = HEAD ? 0.30 : 1.05;
const eye = new THREE.Vector3(
  target.x + Math.sin(YAW) * Math.cos(PITCH) * dist,
  target.y + Math.sin(PITCH) * dist,
  target.z + Math.cos(YAW) * Math.cos(PITCH) * dist,
);
const cam = new THREE.PerspectiveCamera(38, W / H, 0.05, 20);
cam.position.copy(eye);
cam.lookAt(target);
cam.updateMatrixWorld(true);
const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

const color = new Float32Array(W * H * 3);
const depth = new Float32Array(W * H).fill(Infinity);
for (let i = 0; i < W * H; i++) {
  const t = Math.floor(i / W) / H;
  color[i * 3] = 0.10 + t * 0.12; color[i * 3 + 1] = 0.11 + t * 0.13; color[i * 3 + 2] = 0.13 + t * 0.14;
}

const decal = process.env.NOFACE ? null : cat.materials.faceDecal;
const coatCol = COATS.tabby.top;

const KEY = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
const FILL = new THREE.Vector3(0.7, 0.2, -0.6).normalize();

function shade(n, base) {
  const k = Math.max(0, n.dot(KEY)) * 1.05;
  const f = Math.max(0, n.dot(FILL)) * 0.35;
  const amb = 0.20 + 0.14 * (n.y * 0.5 + 0.5);
  return base.map((c) => Math.min(1, c * (amb + k + f)));
}

const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
const _rn = new THREE.Vector3(), _r1 = new THREE.Vector3(), _r2 = new THREE.Vector3();
/**
 * @param rest optional [v3,v3,v3] rest-pose positions; when given, the face
 *   decal is sampled per pixel so the painted eyes / nose / mouth show up in
 *   the offline preview exactly as the GPU shader will draw them.
 */
function tri(a, b, c, base, rest) {
  e1.subVectors(b, a); e2.subVectors(c, a);
  n.crossVectors(e1, e2).normalize();
  const col = shadeOverride || shade(n, base);
  let faceable = false;
  if (rest && decal) {
    _r1.subVectors(rest[1], rest[0]); _r2.subVectors(rest[2], rest[0]);
    _rn.crossVectors(_r1, _r2).normalize();
    const nz = Math.abs(_rn.z);   // winding is not guaranteed in the preview
    faceable = nz > 0.08 && rest[0].z > 0.33 && _rn.z !== 0
      && Math.max(rest[0].y, rest[1].y, rest[2].y) > FACE_BOX.y0
      && Math.min(rest[0].y, rest[1].y, rest[2].y) < FACE_BOX.y1;
  }
  const A = project(a), B = project(b), C = project(c);
  if (!A || !B || !C) return;
  const minx = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x)));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
  const miny = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y)));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
  const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
  if (Math.abs(area) < 1e-9) return;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((B.x - A.x) * (py - A.y) - (px - A.x) * (B.y - A.y)) / area;
      const w1 = ((px - A.x) * (C.y - A.y) - (C.x - A.x) * (py - A.y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = A.z * w2 + B.z * w1 + C.z * w0;
      const idx = y * W + x;
      if (z >= depth[idx]) continue;
      depth[idx] = z;
      let out0 = col[0], out1 = col[1], out2 = col[2];
      if (faceable) {
        const rx = rest[0].x * w2 + rest[1].x * w1 + rest[2].x * w0;
        const ry = rest[0].y * w2 + rest[1].y * w1 + rest[2].y * w0;
        const sm = sampleFaceDecal(decal, rx, ry);
        if (sm) {
          const lit = shade(n, [sm[0], sm[1], sm[2]]);
          out0 += (lit[0] - out0) * sm[3];
          out1 += (lit[1] - out1) * sm[3];
          out2 += (lit[2] - out2) * sm[3];
        }
      }
      color[idx * 3] = out0; color[idx * 3 + 1] = out1; color[idx * 3 + 2] = out2;
    }
  }
}
/** Same rasteriser, but the colour is used as-is (no lighting). */
function flatTri(a, b, c, col) {
  const prev = shadeOverride;
  shadeOverride = col;
  tri(a, b, c, col);
  shadeOverride = prev;
}
let shadeOverride = null;

const _pv = new THREE.Vector3();
function project(p) {
  _pv.copy(p).applyMatrix4(viewProj);
  if (_pv.z < -1 || _pv.z > 1) return null;
  return { x: (_pv.x * 0.5 + 0.5) * W, y: (1 - (_pv.y * 0.5 + 0.5)) * H, z: _pv.z };
}

// floor grid for scale
for (let gx = -8; gx <= 8; gx++) {
  for (let gz = -8; gz <= 8; gz++) {
    const s = 0.1;
    const a = new THREE.Vector3(gx * s, 0, gz * s);
    const b = new THREE.Vector3((gx + 1) * s, 0, gz * s);
    const c = new THREE.Vector3(gx * s, 0, (gz + 1) * s);
    const d = new THREE.Vector3((gx + 1) * s, 0, (gz + 1) * s);
    const shadeC = (gx + gz) % 2 ? [0.22, 0.21, 0.20] : [0.26, 0.25, 0.24];
    tri(a, b, c, shadeC); tri(b, d, c, shadeC);
  }
}

const idx = geo.index.array;
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
const RA = new THREE.Vector3(), RB = new THREE.Vector3(), RC = new THREE.Vector3();
for (let i = 0; i < idx.length; i += 3) {
  A.set(out[idx[i] * 3], out[idx[i] * 3 + 1], out[idx[i] * 3 + 2]);
  B.set(out[idx[i + 1] * 3], out[idx[i + 1] * 3 + 1], out[idx[i + 1] * 3 + 2]);
  C.set(out[idx[i + 2] * 3], out[idx[i + 2] * 3 + 1], out[idx[i + 2] * 3 + 2]);
  RA.fromBufferAttribute(pos, idx[i]);
  RB.fromBufferAttribute(pos, idx[i + 1]);
  RC.fromBufferAttribute(pos, idx[i + 2]);
  tri(A, B, C, [coatCol.r, coatCol.g, coatCol.b], [RA, RB, RC]);
}
for (const m of extras) {
  const g = m.geometry;
  const gp = g.attributes.position;
  const gi = g.index ? g.index.array : null;
  const count = gi ? gi.length : gp.count;
  const base = m.material.color ? [m.material.color.r, m.material.color.g, m.material.color.b] : [0.5, 0.5, 0.5];
  const isEye = m.material.userData && m.material.userData.uniforms && m.material.userData.uniforms.uPupil;
  for (let i = 0; i < count; i += 3) {
    const ia = gi ? gi[i] : i, ib = gi ? gi[i + 1] : i + 1, ic = gi ? gi[i + 2] : i + 2;
    p0.fromBufferAttribute(gp, ia).applyMatrix4(m.matrixWorld);
    p1.fromBufferAttribute(gp, ib).applyMatrix4(m.matrixWorld);
    p2.fromBufferAttribute(gp, ic).applyMatrix4(m.matrixWorld);
    // Eyes are drawn unlit in the preview: the real material is a full iris
    // shader, and flat directional shading here just reads as a dark blob.
    if (isEye) { flatTri(p0, p1, p2, [0.26, 0.46, 0.14]); continue; }
    tri(p0, p1, p2, base);
  }
}

// ---- PNG encode -------------------------------------------------------
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) raw[o++] = Math.round(Math.pow(Math.min(1, Math.max(0, rgb[i + c])), 1 / 2.2) * 255);
    }
  }
  const crcTable = [];
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[i] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.env.DEBUG_EYE) {
  // objective registration check: screen bbox of the eyeball silhouette vs the
  // screen bbox of the painted eyelid aperture
  const bbox = (name, pts) => {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const q of pts) { const s2 = project(q); if (!s2) continue; x0 = Math.min(x0, s2.x); x1 = Math.max(x1, s2.x); y0 = Math.min(y0, s2.y); y1 = Math.max(y1, s2.y); }
    console.log(name, 'x', x0.toFixed(1), x1.toFixed(1), 'cx', ((x0 + x1) / 2).toFixed(1),
      'y', y0.toFixed(1), y1.toFixed(1), 'cy', ((y0 + y1) / 2).toFixed(1));
  };
  const eyeMesh = cat.features.eyes[0];
  const ep = eyeMesh.geometry.attributes.position, epts = [];
  for (let i = 0; i < ep.count; i++) epts.push(new THREE.Vector3().fromBufferAttribute(ep, i).applyMatrix4(eyeMesh.matrixWorld));
  bbox('EYEBALL', epts);
  // deformed positions of skin vertices whose rest pos lies on the painted rim
  const apts = [], rp2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    rp2.fromBufferAttribute(pos, i);
    if (rp2.z < 0.35) continue;
    const sm = sampleFaceDecal(decal, Math.abs(rp2.x) * Math.sign(1), rp2.y);
    const inside = Math.hypot((Math.abs(rp2.x) - 0.0220) / 0.0124, (rp2.y - 0.2812) / 0.0102) < 1.05;
    if (inside && rp2.x > 0 === (eyeMesh.getWorldPosition(new THREE.Vector3()).x > 0)) {
      apts.push(new THREE.Vector3(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
    }
    void sm;
  }
  bbox('APERTURE', apts);
  const w = new THREE.Vector3();
  cat.features.eyes[0].getWorldPosition(w);
  console.log('eye world', w.toArray().map((q) => q.toFixed(4)).join(','), '->', project(w));
  // world position of the skin vertex nearest the painted eye landmark
  let best = -1, bd = 1e9;
  const rp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    rp.fromBufferAttribute(pos, i);
    const d = Math.hypot(rp.x - 0.0220, rp.y - 0.2806) + (rp.z < 0.36 ? 1 : 0);
    if (d < bd) { bd = d; best = i; }
  }
  rp.fromBufferAttribute(pos, best);
  const dw = new THREE.Vector3(out[best * 3], out[best * 3 + 1], out[best * 3 + 2]);
  console.log('paint rest', rp.toArray().map((q) => q.toFixed(4)).join(','),
    'world', dw.toArray().map((q) => q.toFixed(4)).join(','), '->', project(dw));
}
fs.writeFileSync(OUT, png(W, H, color));
console.log('wrote', OUT, `pose=${POSE}`, `${geo.index.count / 3} tris`);
