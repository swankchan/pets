// Indexed marching-cubes polygoniser over an arbitrary axis-aligned box.
// Produces welded vertices + analytic (gradient) normals, which is what makes
// the procedurally sculpted cat read as one smooth organic body.
import * as THREE from 'three';
import { edgeTable, triTable } from './mcTables.js';

// corner index -> unit offset
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
// edge index -> [cornerA, cornerB, originCornerOffset, axis]
const EDGE = [
  [0, 1, [0, 0, 0], 0], [1, 2, [1, 0, 0], 1], [3, 2, [0, 1, 0], 0], [0, 3, [0, 0, 0], 1],
  [4, 5, [0, 0, 1], 0], [5, 6, [1, 0, 1], 1], [7, 6, [0, 1, 1], 0], [4, 7, [0, 0, 1], 1],
  [0, 4, [0, 0, 0], 2], [1, 5, [1, 0, 0], 2], [2, 6, [1, 1, 0], 2], [3, 7, [0, 1, 0], 2],
];

/**
 * @param {(x:number,y:number,z:number)=>number} field  signed distance (negative = inside)
 * @param {{min:THREE.Vector3, max:THREE.Vector3, voxel:number}} opts
 */
export function polygonise(field, { min, max, voxel }) {
  const nx = Math.ceil((max.x - min.x) / voxel);
  const ny = Math.ceil((max.y - min.y) / voxel);
  const nz = Math.ceil((max.z - min.z) / voxel);
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;

  // sample the scalar field on the corner lattice
  const vals = new Float32Array(sx * sy * sz);
  const at = (i, j, k) => i + sx * (j + sy * k);
  for (let k = 0; k < sz; k++) {
    const z = min.z + k * voxel;
    for (let j = 0; j < sy; j++) {
      const y = min.y + j * voxel;
      for (let i = 0; i < sx; i++) {
        vals[at(i, j, k)] = field(min.x + i * voxel, y, z);
      }
    }
  }

  const positions = [];
  const indices = [];
  const cache = new Map(); // edge key -> vertex index
  const cornerVal = new Float32Array(8);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c];
          const v = vals[at(i + o[0], j + o[1], k + o[2])];
          cornerVal[c] = v;
          if (v < 0) cubeIndex |= 1 << c;
        }
        const edges = edgeTable[cubeIndex];
        if (edges === 0) continue;

        const vertOnEdge = [];
        for (let e = 0; e < 12; e++) {
          if (!(edges & (1 << e))) continue;
          const [ca, cb, off, axis] = EDGE[e];
          const ei = i + off[0], ej = j + off[1], ek = k + off[2];
          const key = (ei + sx * (ej + sy * ek)) * 3 + axis;
          let idx = cache.get(key);
          if (idx === undefined) {
            const va = cornerVal[ca], vb = cornerVal[cb];
            let t = Math.abs(vb - va) < 1e-9 ? 0.5 : va / (va - vb);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = min.x + (ei + (axis === 0 ? t : 0)) * voxel;
            const py = min.y + (ej + (axis === 1 ? t : 0)) * voxel;
            const pz = min.z + (ek + (axis === 2 ? t : 0)) * voxel;
            idx = positions.length / 3;
            positions.push(px, py, pz);
            cache.set(key, idx);
          }
          vertOnEdge[e] = idx;
        }

        for (let t = 0; triTable[cubeIndex * 16 + t] !== -1 && t < 15; t += 3) {
          const a = vertOnEdge[triTable[cubeIndex * 16 + t]];
          const b = vertOnEdge[triTable[cubeIndex * 16 + t + 1]];
          const c = vertOnEdge[triTable[cubeIndex * 16 + t + 2]];
          if (a === undefined || b === undefined || c === undefined) continue;
          indices.push(a, b, c);
        }
      }
    }
  }

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(pos.length);
  const h = voxel * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    let gx = field(x + h, y, z) - field(x - h, y, z);
    let gy = field(x, y + h, z) - field(x, y - h, z);
    let gz = field(x, y, z + h) - field(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[v] = gx / l; nrm[v + 1] = gy / l; nrm[v + 2] = gz / l;
  }

  // Make winding agree with the analytic normals (flip whole mesh if needed).
  let agree = 0;
  for (let t = 0; t < indices.length && t < 300; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    agree += cx * nrm[a] + cy * nrm[a + 1] + cz * nrm[a + 2] > 0 ? 1 : -1;
  }
  if (agree < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(indices.length > 65535
    ? new THREE.BufferAttribute(new Uint32Array(indices), 1)
    : new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geo.computeBoundingSphere();
  return geo;
}
