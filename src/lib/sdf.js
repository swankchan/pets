// Small signed-distance-field toolkit used to sculpt the cat's body.
import * as THREE from 'three';

const _pa = new THREE.Vector3();
const _ba = new THREE.Vector3();

/** Distance from point p to a capsule (segment a-b with radius lerping ra->rb). */
export function sdCapsule(p, a, b, ra, rb) {
  _pa.subVectors(p, a);
  _ba.subVectors(b, a);
  const baba = _ba.dot(_ba) || 1e-8;
  let h = _pa.dot(_ba) / baba;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = _pa.x - _ba.x * h;
  const dy = _pa.y - _ba.y * h;
  const dz = _pa.z - _ba.z * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}

/** Distance to an axis-scaled sphere (ellipsoid, approximate but stable). */
export function sdEllipsoid(p, c, r) {
  const x = (p.x - c.x) / r.x;
  const y = (p.y - c.y) / r.y;
  const z = (p.z - c.z) / r.z;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / r.x) ** 2 + (y / r.y) ** 2 + (z / r.z) ** 2);
  if (k0 === 0) return -Math.min(r.x, r.y, r.z);
  return (k0 * (k0 - 1.0)) / (k1 || 1e-8);
}

/** Polynomial smooth minimum — gives organic blends between limbs and torso. */
export function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}
