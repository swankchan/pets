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
  cap(rest.head.clone().add(v(0, 0.006, -0.016)), rest.head.clone().add(v(0, -0.004, 0.018)), 0.045, 0.040, 0.022, 1.18);
  // muzzle + chin
  // the muzzle is a short blunt wedge that clearly steps out of the skull
  cap(rest.head.clone().add(v(0, -0.014, 0.010)), rest.muzzle.clone().add(v(0, 0.0035, 0.0010)), 0.027, 0.0155, 0.013, 1.05);
  cap(rest.head.clone().add(v(0, -0.028, 0.006)), rest.muzzle.clone().add(v(0, -0.0135, -0.014)), 0.0175, 0.0115, 0.012, 1.14);
  // puffy whisker pads and a brow ridge: without them the face is a smooth
  // blob and the painted features have nothing to sit on.
  for (const s of [1, -1]) {
    cap(v(s * 0.010, 0.2468, 0.3800), v(s * 0.015, 0.2462, 0.3930), 0.0125, 0.0105, 0.012);
    cap(v(s * 0.014, 0.2900, 0.3760), v(s * 0.030, 0.2890, 0.3620), 0.0090, 0.0080, 0.016);
  }
  for (const s of [1, -1]) {   // cheeks
    cap(rest.head.clone().add(v(s * 0.024, -0.010, 0.002)), rest.head.clone().add(v(s * 0.017, -0.017, 0.024)),
      0.019, 0.013, 0.018, 1.10);
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

/**
 * The rest-pose body SDF: negative inside, roughly metres outside.
 * Exported so the eyes / nose can be planted exactly on the skull surface
 * instead of being guessed at and ending up buried under it.
 */
export function makeBodyField(rest) {
  return makeField(bodyPrimitives(rest));
}

/**
 * Walk a ray from `from` along `dir` until the field crosses zero, then refine
 * by bisection. Returns the distance travelled, or null if nothing was hit.
 */
export function raycastField(field, from, dir, maxDist = 0.25, step = 0.0015) {
  let prevT = 0;
  let prev = field(from.x, from.y, from.z);
  for (let t = step; t <= maxDist; t += step) {
    const d = field(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    if ((prev <= 0) !== (d <= 0)) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) * 0.5;
        const dm = field(from.x + dir.x * mid, from.y + dir.y * mid, from.z + dir.z * mid);
        if ((prev <= 0) === (dm <= 0)) lo = mid; else hi = mid;
      }
      return (lo + hi) * 0.5;
    }
    prevT = t; prev = d;
  }
  return null;
}

/** Central-difference gradient of the field, normalised — the surface normal. */
export function fieldNormal(field, x, y, z, h = 0.0008) {
  const n = new THREE.Vector3(
    field(x + h, y, z) - field(x - h, y, z),
    field(x, y + h, z) - field(x, y - h, z),
    field(x, y, z + h) - field(x, y, z - h),
  );
  return n.lengthSq() > 1e-18 ? n.normalize() : new THREE.Vector3(0, 0, 1);
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
