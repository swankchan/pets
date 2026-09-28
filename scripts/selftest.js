// Headless sanity check of the simulation layer (no WebGL needed).
// Run with:  npm run selftest
import * as THREE from 'three';
import { Cat } from '../src/cat/cat.js';
import { Brain } from '../src/ai/brain.js';
import { POSES } from '../src/cat/poses.js';

const quality = { shells: 2, voxel: 0.012, furDensity: 500, shadowMap: 512, texSize: 256, extraShadows: false };
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); if (!ok) failures++; };

console.log('building cat…');
const t0 = Date.now();
const cat = new Cat({ quality });
console.log(`  built in ${Date.now() - t0} ms`);

const pos = cat.geometry.attributes.position;
check(pos.count > 2000, `body has ${pos.count} vertices`);
check(cat.geometry.index.count / 3 > 3000, `${cat.geometry.index.count / 3} triangles`);
let nan = 0;
for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nan++;
check(nan === 0, 'no NaN vertices');
const sw = cat.geometry.attributes.skinWeight.array;
let badW = 0;
for (let i = 0; i < sw.length; i += 4) {
  const s = sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3];
  if (Math.abs(s - 1) > 1e-3) badW++;
}
check(badW === 0, 'skin weights normalised');

// symmetry of the sculpt
const bb = new THREE.Box3().setFromBufferAttribute(pos);
check(Math.abs(bb.min.x + bb.max.x) < 0.01, `symmetric in X (${bb.min.x.toFixed(3)}..${bb.max.x.toFixed(3)})`);
check(bb.max.z - bb.min.z > 0.6, `length ${(bb.max.z - bb.min.z).toFixed(2)} m nose-to-tail`);
check(bb.max.y > 0.30 && bb.max.y < 0.38, `height ${bb.max.y.toFixed(2)} m at the ears`);

const scene = new THREE.Scene();
scene.add(cat.group);

// every pose must animate without producing NaNs, with feet near their targets
const world = {
  points: {}, obstacles: [], bounds: { x: 2.5, z: 2.0 },
  ball: { position: new THREE.Vector3(1, 0.035, 1), userData: { vel: new THREE.Vector3() } },
  consumeFood() {},
};
for (const name of ['sunspot', 'food', 'water', 'bed', 'post', 'litter', 'sofa', 'sill', 'shelf', 'table']) {
  world.points[name] = {
    pos: new THREE.Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1),
    stand: new THREE.Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1),
  };
}

for (const pose of Object.keys(POSES)) {
  cat.pose = pose;
  cat.speed = 0;
  for (let i = 0; i < 90; i++) cat.update(1 / 60, {});
  scene.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let bad = 0, maxErr = 0;
  for (const leg of ['pawFL', 'pawFR', 'pawHL', 'pawHR']) {
    p.setFromMatrixPosition(cat.bones[leg].matrixWorld);
    if (!Number.isFinite(p.x + p.y + p.z)) bad++;
    const id = { pawFL: 'FL', pawFR: 'FR', pawHL: 'HL', pawHR: 'HR' }[leg];
    const want = POSES[pose].feet[id];
    maxErr = Math.max(maxErr, p.distanceTo(new THREE.Vector3(...want)));
  }
  const tail = new THREE.Vector3().setFromMatrixPosition(cat.bones.tail7.matrixWorld);
  check(bad === 0 && Number.isFinite(tail.y),
    `pose "${pose}" stable — IK foot error ${(maxErr * 1000).toFixed(0)} mm`);
}

// walk cycle: cat should actually travel and keep its feet on the floor
cat.pose = 'stand';
cat.moveTo(new THREE.Vector3(0, 0, 3), 'trot');
let minPawY = 9, maxPawY = -9;
for (let i = 0; i < 240; i++) {
  cat.update(1 / 60, {});
  cat.group.updateMatrixWorld(true);
  for (const leg of ['pawFL', 'pawHR']) {
    const y = new THREE.Vector3().setFromMatrixPosition(cat.bones[leg].matrixWorld).y;
    minPawY = Math.min(minPawY, y); maxPawY = Math.max(maxPawY, y);
  }
}
check(cat.group.position.z > 1.0, `trotted ${cat.group.position.z.toFixed(2)} m forward`);
check(minPawY > -0.02 && minPawY < 0.03, `stance foot stays on the floor (min ${minPawY.toFixed(3)})`);
check(maxPawY > 0.03, `swing foot lifts (max ${maxPawY.toFixed(3)})`);

// brain: long soak, needs must stay in range and actions must keep changing
const brain = new Brain(cat, world);
const seen = new Set();
let err = null;
try {
  for (let i = 0; i < 20000; i++) {
    brain.timeScale = 4;
    brain.update(1 / 60, {
      handPoint: new THREE.Vector3(0.5, 0, 0.5), petting: i % 3000 < 60,
      calling: false, laser: i % 5000 < 120 ? new THREE.Vector3(1, 0, 1) : null,
      foodAvailable: i % 1200 < 600, ballMoving: false,
    });
    cat.update(1 / 60, {});
    seen.add(brain.action.id);
  }
} catch (e) { err = e; }
check(!err, `brain soak 20k ticks${err ? ': ' + err.message : ''}`);
check([...Object.values(brain.needs)].every((v) => v >= 0 && v <= 1), 'needs stay in [0,1]');
check(seen.size >= 6, `exercised ${seen.size} behaviours: ${[...seen].join(', ')}`);
check(Number.isFinite(cat.group.position.x), 'cat position finite after soak');

console.log(failures ? `\n${failures} FAILURES` : '\nall good ✓');
process.exit(failures ? 1 : 0);
