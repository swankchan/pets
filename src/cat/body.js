// Sculpts the cat body as an SDF of blended capsules, polygonises it and
// binds the result to the skeleton with automatic distance-based skin weights.
import * as THREE from 'three';
import { sdCapsule, smin } from '../lib/sdf.js';
import { polygonise } from '../lib/marchingCubes.js';
import { BONES } from './rig.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

/** Capsule list describing the body volume in rest pose. */
function bodyPrimitives(rest) {
  const P = [];
  const cap = (a, b, ra, rb, k = 0.05, squashX = 1) => P.push({ a, b, ra, rb, k, squashX });

  // torso: deeper than wide (squashX compresses the capsule sideways)
  cap(rest.pelvis.clone().add(v(0, 0.008, -0.026)), rest.spine1.clone().add(v(0, 0.005, 0)), 0.050, 0.054, 0.05, 1.26);
  cap(rest.spine1.clone().add(v(0, 0.005, 0)), rest.spine2.clone().add(v(0, 0.002, 0)), 0.054, 0.056, 0.05, 1.28);
  cap(rest.spine2.clone().add(v(0, 0.002, 0)), rest.chest, 0.056, 0.062, 0.05, 1.22);
  cap(rest.chest, rest.chest.clone().add(v(0, -0.014, 0.042)), 0.062, 0.046, 0.045, 1.18);
  // haunches + shoulder blades give the silhouette its cat-ness
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    cap(rest['hip' + L].clone().add(v(0, 0.020, -0.020)), rest['hip' + L].clone().add(v(-s * 0.004, -0.010, 0.012)),
      0.046, 0.032, 0.045, 1.12);
    cap(rest['shoulder' + L].clone().add(v(-s * 0.004, 0.028, -0.014)), rest['shoulder' + L].clone().add(v(0, 0.006, 0.012)),
      0.031, 0.028, 0.04, 1.12);
  }
  // neck & head
  cap(rest.chest.clone().add(v(0, 0.014, 0.028)), rest.neck, 0.042, 0.032, 0.036, 1.10);
  cap(rest.neck, rest.head.clone().add(v(0, -0.008, -0.018)), 0.033, 0.040, 0.028);
  cap(rest.head.clone().add(v(0, 0.006, -0.014)), rest.head.clone().add(v(0, -0.004, 0.020)), 0.046, 0.042, 0.022, 1.06);
  // muzzle + chin
  cap(rest.head.clone().add(v(0, -0.014, 0.012)), rest.muzzle.clone().add(v(0, 0.004, -0.008)), 0.028, 0.019, 0.015);
  cap(rest.head.clone().add(v(0, -0.026, 0.010)), rest.muzzle.clone().add(v(0, -0.012, -0.020)), 0.020, 0.013, 0.014);
  for (const s of [1, -1]) {   // cheeks
    cap(rest.head.clone().add(v(s * 0.026, -0.010, 0.004)), rest.head.clone().add(v(s * 0.020, -0.016, 0.026)),
      0.020, 0.014, 0.018);
  }

  // tail
  const tail = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6', 'tail7'];
  for (let i = 0; i < tail.length - 1; i++) {
    const t = i / (tail.length - 1);
    cap(rest[tail[i]], rest[tail[i + 1]], 0.019 - 0.011 * t, 0.019 - 0.011 * (t + 1 / 7), 0.026);
  }
  cap(rest.pelvis.clone().add(v(0, -0.004, -0.030)), rest.tail0, 0.044, 0.020, 0.040);

  // legs
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    cap(rest['shoulder' + L].clone().add(v(0, 0.018, -0.004)), rest['elbow' + L], 0.033, 0.022, 0.040);
    cap(rest['elbow' + L], rest['wrist' + L], 0.021, 0.0135, 0.024);
    cap(rest['wrist' + L], rest['pawF' + L].clone().add(v(0, 0.002, -0.004)), 0.0135, 0.015, 0.018);
    cap(rest['pawF' + L].clone().add(v(0, 0.002, -0.010)), rest['pawF' + L].clone().add(v(0, 0.001, 0.016)), 0.017, 0.014, 0.016);
    cap(rest['hip' + L].clone().add(v(0, 0.008, -0.006)), rest['knee' + L], 0.046, 0.025, 0.045);
    cap(rest['knee' + L], rest['hock' + L], 0.023, 0.0125, 0.026);
    cap(rest['hock' + L], rest['pawH' + L].clone().add(v(0, 0.002, -0.004)), 0.0125, 0.015, 0.018);
    cap(rest['pawH' + L].clone().add(v(0, 0.002, -0.012)), rest['pawH' + L].clone().add(v(0, 0.001, 0.014)), 0.017, 0.014, 0.016);
  }
  return P;
}

function makeField(prims) {
  const q = new THREE.Vector3();
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      q.set(p.squashX === 1 ? x : x * p.squashX, y, z);
      const a = p.squashX === 1 ? p.a : _sq(p.a, p.squashX, 0), b = p.squashX === 1 ? p.b : _sq(p.b, p.squashX, 1);
      const di = sdCapsule(q, a, b, p.ra, p.rb) / p.squashX;  // renormalise so blends stay smooth
      d = i === 0 ? di : smin(d, di, p.k);
    }
    return d;
  };
}
const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3();
function _sq(vec, s, which) {
  const t = which ? _tmpB : _tmpA;
  return t.set(vec.x * s, vec.y, vec.z);
}

const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
function distToSeg(p, a, b) {
  _ab.subVectors(b, a); _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  let t = len2 > 1e-9 ? _ap.dot(_ab) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(_ap.x - _ab.x * t, _ap.y - _ab.y * t, _ap.z - _ab.z * t);
}

/**
 * Skin weights: smooth Gaussian falloff to the nearest point on each bone
 * segment, followed by two Laplacian smoothing passes over the mesh edges.
 * (A hard "nearest 4 bones" rule makes neighbouring vertices bind to different
 * bones, which tears the surface open as soon as the tail or a leg moves.)
 */
function skinGeometry(geo, rest) {
  const segs = [];
  for (const def of BONES) {
    if (def.name === 'muzzle' || def.name.endsWith('Tip')) continue;
    const kids = BONES.filter((b) => b.parent === def.name);
    const a = rest[def.name];
    if (kids.length) for (const k of kids) segs.push({ bone: def.name, a, b: rest[k.name] });
    else segs.push({ bone: def.name, a, b: a });
  }
  const boneIndex = {};
  BONES.forEach((b, i) => (boneIndex[b.name] = i));
  const nBones = BONES.length;

  const pos = geo.attributes.position;
  const n = pos.count;
  const W = new Float32Array(n * nBones);
  const p = new THREE.Vector3();
  // limbs bind tightly so that swinging a leg does not drag the ribcage with it
  const sigmaFor = (name) => (/^(shoulder|hip)/.test(name) ? 0.032
    : /^(elbow|knee|wrist|hock|paw)/.test(name) ? 0.026
    : /^tail[1-7]$/.test(name) ? 0.030 : 0.045);
  for (const s of segs) s.sigma2 = 2 * sigmaFor(s.bone) ** 2;

  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let sum = 0;
    for (const s of segs) {
      const d = distToSeg(p, s.a, s.b);
      const w = Math.exp(-(d * d) / s.sigma2);
      const bi = i * nBones + boneIndex[s.bone];
      if (w > W[bi]) { sum += w - W[bi]; W[bi] = w; }
    }
    if (sum <= 0) W[i * nBones + boneIndex.pelvis] = 1;
    else for (let b = 0; b < nBones; b++) W[i * nBones + b] /= sum;
  }

  // neighbour smoothing over the triangle edges
  const idx = geo.index.array;
  const nbr = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b);
  }
  let src = W;
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(src.length);
    for (let i = 0; i < n; i++) {
      const list = nbr[i];
      const wSelf = 0.45, wN = (1 - wSelf) / Math.max(1, list.length);
      for (let b = 0; b < nBones; b++) dst[i * nBones + b] = src[i * nBones + b] * wSelf;
      for (const j of list) {
        for (let b = 0; b < nBones; b++) dst[i * nBones + b] += src[j * nBones + b] * wN;
      }
    }
    src = dst;
  }

  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const top = [];
  for (let i = 0; i < n; i++) {
    top.length = 0;
    for (let b = 0; b < nBones; b++) {
      const w = src[i * nBones + b];
      if (w > 1e-4) top.push([b, w]);
    }
    top.sort((x, y) => y[1] - x[1]);
    const used = top.slice(0, 4);
    const sum = used.reduce((t, e) => t + e[1], 0) || 1;
    for (let j = 0; j < used.length; j++) {
      skinIndex[i * 4 + j] = used[j][0];
      skinWeight[i * 4 + j] = used[j][1] / sum;
    }
    if (!used.length) skinWeight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return geo;
}

/** @returns {THREE.BufferGeometry} skinned, ready for SkinnedMesh */
export function buildBodyGeometry(rest, voxel = 0.0065) {
  const prims = bodyPrimitives(rest);
  const field = makeField(prims);
  const geo = polygonise(field, {
    min: new THREE.Vector3(-0.125, -0.012, -0.43),
    max: new THREE.Vector3(0.125, 0.37, 0.48),
    voxel,
  });
  return skinGeometry(geo, rest);
}
