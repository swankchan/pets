// Skeleton definition for a domestic shorthair, in metres, rest pose = standing.
// Convention: +Z is forward (nose), +Y up, +X is the cat's left.
import * as THREE from 'three';

export const BONES = [
  { name: 'pelvis', parent: null, pos: [0, 0.185, -0.05] },
  { name: 'spine1', parent: 'pelvis', pos: [0, 0.190, 0.04] },
  { name: 'spine2', parent: 'spine1', pos: [0, 0.193, 0.13] },
  { name: 'chest', parent: 'spine2', pos: [0, 0.192, 0.215] },
  { name: 'neck', parent: 'chest', pos: [0, 0.225, 0.280] },
  { name: 'head', parent: 'neck', pos: [0, 0.272, 0.340] },
  { name: 'muzzle', parent: 'head', pos: [0, 0.254, 0.396] },

  { name: 'earL', parent: 'head', pos: [0.030, 0.306, 0.334] },
  { name: 'earLTip', parent: 'earL', pos: [0.039, 0.352, 0.318] },
  { name: 'earR', parent: 'head', pos: [-0.030, 0.306, 0.334] },
  { name: 'earRTip', parent: 'earR', pos: [-0.039, 0.352, 0.318] },

  { name: 'tail0', parent: 'pelvis', pos: [0, 0.183, -0.098] },
  { name: 'tail1', parent: 'tail0', pos: [0, 0.181, -0.140] },
  { name: 'tail2', parent: 'tail1', pos: [0, 0.177, -0.182] },
  { name: 'tail3', parent: 'tail2', pos: [0, 0.171, -0.224] },
  { name: 'tail4', parent: 'tail3', pos: [0, 0.165, -0.266] },
  { name: 'tail5', parent: 'tail4', pos: [0, 0.159, -0.308] },
  { name: 'tail6', parent: 'tail5', pos: [0, 0.153, -0.348] },
  { name: 'tail7', parent: 'tail6', pos: [0, 0.147, -0.386] },

  // front legs (scapula -> humerus -> radius -> metacarpus -> paw)
  { name: 'shoulderL', parent: 'chest', pos: [0.046, 0.172, 0.208] },
  { name: 'elbowL', parent: 'shoulderL', pos: [0.050, 0.112, 0.186] },
  { name: 'wristL', parent: 'elbowL', pos: [0.053, 0.053, 0.208] },
  { name: 'pawFL', parent: 'wristL', pos: [0.053, 0.017, 0.230] },
  { name: 'shoulderR', parent: 'chest', pos: [-0.046, 0.172, 0.208] },
  { name: 'elbowR', parent: 'shoulderR', pos: [-0.050, 0.112, 0.186] },
  { name: 'wristR', parent: 'elbowR', pos: [-0.053, 0.053, 0.208] },
  { name: 'pawFR', parent: 'wristR', pos: [-0.053, 0.017, 0.230] },

  // hind legs (femur -> tibia -> metatarsus -> paw)
  { name: 'hipL', parent: 'pelvis', pos: [0.053, 0.170, -0.048] },
  { name: 'kneeL', parent: 'hipL', pos: [0.056, 0.115, -0.018] },
  { name: 'hockL', parent: 'kneeL', pos: [0.058, 0.062, -0.062] },
  { name: 'pawHL', parent: 'hockL', pos: [0.058, 0.017, -0.030] },
  { name: 'hipR', parent: 'pelvis', pos: [-0.053, 0.170, -0.048] },
  { name: 'kneeR', parent: 'hipR', pos: [-0.056, 0.115, -0.018] },
  { name: 'hockR', parent: 'kneeR', pos: [-0.058, 0.062, -0.062] },
  { name: 'pawHR', parent: 'hockR', pos: [-0.058, 0.017, -0.030] },
];

export const LEGS = [
  { id: 'FL', front: true, side: 1, upper: 'shoulderL', mid: 'elbowL', low: 'wristL', paw: 'pawFL' },
  { id: 'FR', front: true, side: -1, upper: 'shoulderR', mid: 'elbowR', low: 'wristR', paw: 'pawFR' },
  { id: 'HL', front: false, side: 1, upper: 'hipL', mid: 'kneeL', low: 'hockL', paw: 'pawHL' },
  { id: 'HR', front: false, side: -1, upper: 'hipR', mid: 'kneeR', low: 'hockR', paw: 'pawHR' },
];

export const TAIL = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6', 'tail7'];
export const SPINE = ['pelvis', 'spine1', 'spine2', 'chest', 'neck', 'head'];

/** Builds the THREE.Bone hierarchy plus lookup tables of rest-pose world data. */
export function buildSkeleton() {
  const bones = {};
  const rest = {};       // name -> THREE.Vector3 rest world position
  const order = [];
  let root = null;

  for (const def of BONES) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    const world = new THREE.Vector3(...def.pos);
    rest[def.name] = world;
    if (def.parent) {
      const p = bones[def.parent];
      bone.position.copy(world).sub(rest[def.parent]);
      p.add(bone);
    } else {
      bone.position.copy(world);
      root = bone;
    }
    bones[def.name] = bone;
    order.push(bone);
  }

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order);
  return { root, bones, rest, skeleton, order };
}
