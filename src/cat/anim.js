// Procedural animation: pose blending, IK legs with a real gait cycle,
// verlet tail, breathing, blinking, ear/head attention.
import * as THREE from 'three';
import { LEGS, TAIL, BONES } from './rig.js';
import { POSES, BASE } from './poses.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _low = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// dedicated temporaries — callers routinely pass in the shared _a/_b/_c vectors
const _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3(), _pq = new THREE.Quaternion();
/** Rotate `bone` so its child axis points along `worldDir`. */
function aimBone(bone, childLocalDir, worldDir) {
  if (worldDir.lengthSq() < 1e-12) return;
  _n2.copy(worldDir).normalize();
  bone.parent.updateWorldMatrix(true, false);
  _m.copy(bone.parent.matrixWorld);
  _pq.setFromRotationMatrix(_m);                      // parent world quaternion
  _n1.copy(childLocalDir).applyQuaternion(_pq).normalize();
  _q2.setFromUnitVectors(_n1, _n2);                   // world-space delta
  bone.quaternion.copy(_pq).invert().multiply(_q2).multiply(_pq);
  bone.updateMatrixWorld(true);
}

const _dir = new THREE.Vector3(), _axis = new THREE.Vector3(), _mid = new THREE.Vector3();
/** Analytic two-bone IK; `poleDir` is the world direction the joint bends toward. */
function twoBoneIK(upper, mid, low, target, poleDir) {
  const l1 = mid.position.length();
  const l2 = low.position.length();
  upper.parent.updateWorldMatrix(true, false);
  upper.updateMatrixWorld(true);
  const root = _c.setFromMatrixPosition(upper.matrixWorld).clone();
  _dir.subVectors(target, root);
  let dist = _dir.length();
  const maxd = (l1 + l2) * 0.999, mind = Math.abs(l1 - l2) + 1e-4;
  dist = Math.min(Math.max(dist, mind), maxd);
  _dir.normalize();
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const angle = Math.acos(cosA);
  _axis.crossVectors(_dir, poleDir);
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0); else _axis.normalize();
  const upperDir = _dir.clone().applyAxisAngle(_axis, angle);
  aimBone(upper, mid.position, upperDir);
  _mid.copy(root).addScaledVector(upperDir, l1);
  aimBone(mid, low.position, _a.subVectors(target, _mid));
}

const GAITS = {
  walk: { offsets: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.66, stride: 0.19, lift: 0.030, bob: 0.004 },
  trot: { offsets: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, duty: 0.52, stride: 0.26, lift: 0.045, bob: 0.008 },
  run: { offsets: { FL: 0.06, FR: 0, HL: 0.52, HR: 0.46 }, duty: 0.36, stride: 0.40, lift: 0.075, bob: 0.020 },
};

function lerp(a, b, t) { return a + (b - a) * t; }

export class Animator {
  constructor(cat) {
    this.cat = cat;
    this.bones = cat.bones;
    this.rest = cat.rest;
    this.features = cat.features;

    this.cur = structuredClone(BASE);
    this.target = 'stand';
    this.time = 0;
    this.gaitPhase = 0;
    this.blink = 0;
    this.nextBlink = 2 + Math.random() * 4;
    this.earTwitch = 0;
    this.nextTwitch = 3 + Math.random() * 5;
    this.pawPhase = { FL: 0, FR: 0, HL: 0, HR: 0 };

    // child offsets for aiming
    this.childDir = {};
    for (const def of BONES) {
      const kid = BONES.find((b) => b.parent === def.name);
      if (kid) this.childDir[def.name] = new THREE.Vector3(...kid.pos).sub(new THREE.Vector3(...def.pos));
    }

    // tail verlet state (world space)
    this.tailPts = TAIL.map((n) => this.rest[n].clone());
    this.tailPrev = this.tailPts.map((p) => p.clone());
    this.tailLen = [];
    for (let i = 1; i < TAIL.length; i++) this.tailLen.push(this.rest[TAIL[i]].distanceTo(this.rest[TAIL[i - 1]]));
    this.tailInit = false;
  }

  setPose(name) { if (POSES[name]) this.target = name; }

  update(dt, ctx) {
    this.time += dt;
    const tgt = POSES[this.target] || POSES.stand;
    const k = 1 - Math.exp(-tgt.blend * dt);
    const cur = this.cur;

    for (const key of ['hipX', 'hipY', 'hipZ', 'pitch', 'roll', 'spineCurl', 'spineTwist', 'spineSide',
      'neckPitch', 'neckYaw', 'headPitch', 'headRoll', 'earPitch', 'earSpread', 'eyeOpen',
      'pupil', 'breathe', 'fluff', 'lookWeight']) {
      cur[key] = lerp(cur[key], tgt[key], k);
    }
    for (const id of ['FL', 'FR', 'HL', 'HR']) {
      for (let i = 0; i < 3; i++) cur.feet[id][i] = lerp(cur.feet[id][i], tgt.feet[id][i], k);
    }
    for (const key of ['wristVec', 'hockVec']) {
      for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], tgt[key][i], k);
    }
    for (const key of ['lift', 'curl', 'side', 'stiff', 'wag']) {
      cur.tail[key] = lerp(cur.tail[key], tgt.tail[key], k);
    }

    this.resetBones();
    this.applyBody(dt, ctx);
    this.applyLegs(dt, ctx);
    this.applyTail(dt, ctx);
    this.applyFace(dt, ctx);
  }

  resetBones() {
    for (const def of BONES) {
      const bone = this.bones[def.name];
      bone.quaternion.identity();
      bone.scale.setScalar(1);
    }
  }

  applyBody(dt, ctx) {
    const cur = this.cur, b = this.bones;
    const speed = ctx.speed || 0;
    const gait = speed > 1.7 ? GAITS.run : speed > 0.55 ? GAITS.trot : GAITS.walk;
    this.gait = gait;
    if (speed > 0.02) this.gaitPhase = (this.gaitPhase + (speed / gait.stride) * dt) % 1;
    const gp = this.gaitPhase * Math.PI * 2;
    const moving = speed > 0.02 ? 1 : 0;

    // breathing + purring micro-motion
    const breath = Math.sin(this.time * (ctx.sleeping ? 1.1 : 2.0)) * 0.5 + 0.5;
    const purr = ctx.purr ? Math.sin(this.time * 150) * 0.0009 * ctx.purr : 0;

    const pelvis = b.pelvis;
    pelvis.position.set(
      this.rest.pelvis.x + cur.hipX,
      cur.hipY + moving * Math.sin(gp * 2) * gait.bob + purr,
      this.rest.pelvis.z + cur.hipZ + moving * Math.sin(gp * 2 + 1.0) * gait.bob * 0.4,
    );
    const runFlex = speed > 1.7 ? Math.sin(gp) * 0.22 : 0;
    pelvis.rotation.set(
      cur.pitch + moving * Math.sin(gp * 2 + 0.8) * 0.02 + runFlex * 0.4,
      0,
      cur.roll + moving * Math.sin(gp) * 0.035,
    );
    pelvis.rotation.order = 'ZYX';

    // spine distribution
    const chain = ['spine1', 'spine2', 'chest'];
    const curl = cur.spineCurl + runFlex;
    chain.forEach((n, i) => {
      const w = [0.36, 0.34, 0.30][i];
      b[n].rotation.set(
        curl * w + ctx.turn * 0.0 + moving * Math.sin(gp + i) * 0.012,
        cur.spineSide * w + (ctx.turn || 0) * 0.30 * w,
        cur.spineTwist * w + (ctx.turn || 0) * 0.22 * w,
      );
    });
    b.chest.scale.set(1 + breath * 0.022 * cur.breathe, 1 + breath * 0.026 * cur.breathe, 1);
    b.neck.rotation.set(cur.neckPitch, cur.neckYaw + (ctx.turn || 0) * 0.25, 0);
    b.head.rotation.set(cur.headPitch, 0, cur.headRoll);

    // head look-at (clamped to a believable cone)
    if (ctx.lookTarget && cur.lookWeight > 0.02) {
      b.neck.updateMatrixWorld(true);
      b.head.updateMatrixWorld(true);
      const hp = _a.setFromMatrixPosition(b.head.matrixWorld).clone();
      const dir = _b.subVectors(ctx.lookTarget, hp).normalize();
      const fwd = _c.copy(this.childDir.head).applyQuaternion(
        _q.setFromRotationMatrix(b.head.parent.matrixWorld),
      ).normalize();
      const dot = fwd.dot(dir);
      if (dot > -0.25) {
        const maxAng = 1.15;
        const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
        const t = Math.min(1, maxAng / Math.max(ang, 1e-3)) * cur.lookWeight;
        const want = fwd.clone().lerp(dir, t).normalize();
        aimBone(b.head, this.childDir.head, want);
      }
    }
  }

  applyLegs(dt, ctx) {
    const cur = this.cur;
    const speed = ctx.speed || 0;
    const gait = this.gait;
    const root = this.cat.group;
    root.updateMatrixWorld(true);

    for (const leg of LEGS) {
      const base = cur.feet[leg.id];
      let fx = base[0], fy = base[1], fz = base[2];

      if (speed > 0.02 && cur.hipY > 0.16) {
        const ph = (this.gaitPhase + gait.offsets[leg.id]) % 1;
        const stanceEnd = gait.duty;
        const half = gait.stride * 0.5;
        if (ph < stanceEnd) {
          const t = ph / stanceEnd;
          fz += half - gait.stride * t;
        } else {
          const t = (ph - stanceEnd) / (1 - stanceEnd);
          fz += -half + gait.stride * t;
          fy += Math.sin(Math.PI * t) * gait.lift * (leg.front ? 1 : 1.15);
          fz += Math.sin(Math.PI * t) * 0.012;
        }
        // turning: outer legs take longer steps
        fx += (ctx.turn || 0) * leg.side * -0.012;
      } else if (cur.hipY > 0.16) {
        fy += Math.max(0, Math.sin(this.time * 0.7 + leg.side) - 0.96) * 0.06; // idle weight shift
      }

      const pawWorld = _a.set(fx, fy, fz).applyMatrix4(root.matrixWorld).clone();
      const bones = this.bones;
      const upper = bones[leg.upper], mid = bones[leg.mid], low = bones[leg.low], paw = bones[leg.paw];

      // the last segment (metacarpus / metatarsus): upright by default,
      // laid flat on the floor for sitting poses
      const lowRest = this.childDir[leg.low];
      const lowToPaw = _low.fromArray(leg.front ? cur.wristVec : cur.hockVec)
        .normalize().multiplyScalar(lowRest.length());
      const lowTargetLocal = _b.set(fx, fy, fz).sub(lowToPaw);
      const lowTarget = lowTargetLocal.applyMatrix4(root.matrixWorld).clone();

      const pole = _c.set(0, 0, leg.front ? -1 : 1).applyMatrix4(root.matrixWorld)
        .sub(_dir.setFromMatrixPosition(root.matrixWorld)).normalize().clone();

      twoBoneIK(upper, mid, low, lowTarget, pole);
      aimBone(low, lowRest, _a.subVectors(pawWorld, _b.setFromMatrixPosition(low.matrixWorld)));
      paw.updateMatrixWorld(true);
    }
  }

  applyTail(dt, ctx) {
    const cur = this.cur, root = this.cat.group;
    const b = this.bones;
    b.pelvis.updateMatrixWorld(true);
    const n = TAIL.length;

    // desired shape in body space -> world
    const targets = [];
    const p = new THREE.Vector3().copy(this.rest.tail0);
    const wag = Math.sin(this.time * 6.2) * cur.tail.wag * 0.5 + Math.sin(this.time * 2.3) * 0.12;
    let pitch = cur.tail.lift * 1.25;
    let yaw = (cur.tail.side + wag) * 0.45;
    targets.push(p.clone());
    for (let i = 1; i < n; i++) {
      pitch -= cur.tail.curl * 0.42;
      yaw += (cur.tail.side * 0.22 + wag * 0.10);
      const len = this.tailLen[i - 1];
      p.add(new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch) * len,
        Math.sin(pitch) * len,
        -Math.cos(yaw) * Math.cos(pitch) * len,
      ));
      targets.push(p.clone());
    }
    for (const t of targets) t.applyMatrix4(root.matrixWorld);

    const anchor = _a.setFromMatrixPosition(b.tail0.matrixWorld).clone();
    if (!this.tailInit) {
      this.tailPts = targets.map((t) => t.clone());
      this.tailPrev = targets.map((t) => t.clone());
      this.tailInit = true;
    }
    this.tailPts[0].copy(anchor);
    this.tailPrev[0].copy(anchor);

    const stiff = 1 - Math.exp(-(2 + cur.tail.stiff * 16) * dt);
    const damp = 0.86;
    for (let i = 1; i < n; i++) {
      const cp = this.tailPts[i], pp = this.tailPrev[i];
      const vx = (cp.x - pp.x) * damp, vy = (cp.y - pp.y) * damp, vz = (cp.z - pp.z) * damp;
      pp.copy(cp);
      cp.x += vx; cp.y += vy - 1.4 * dt * dt; cp.z += vz;
      cp.lerp(targets[i], stiff);
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) {
        const a = this.tailPts[i - 1], c = this.tailPts[i];
        const d = _b.subVectors(c, a);
        const l = d.length() || 1e-6;
        c.copy(a).addScaledVector(d, this.tailLen[i - 1] / l);
        if (c.y < 0.022) c.y = 0.022;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const bone = b[TAIL[i]];
      aimBone(bone, this.childDir[TAIL[i]], _c.subVectors(this.tailPts[i + 1], this.tailPts[i]));
    }
  }

  applyFace(dt, ctx) {
    const cur = this.cur, f = this.features;

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = 2.5 + Math.random() * 6; }
    this.blink = Math.max(0, this.blink - dt * 6.5);
    const blinkAmt = Math.sin(Math.min(1, this.blink) * Math.PI);
    const open = Math.max(0, cur.eyeOpen * (1 - blinkAmt));

    f.lids.forEach(({ upper, lower }) => {
      upper.rotation.x = lerp(0.62, -0.92, open);
      lower.rotation.x = Math.PI + lerp(0.52, 1.20, open);
    });
    const pupil = Math.min(1, Math.max(0.05, cur.pupil * (ctx.lightAdapt ?? 1)));
    for (const eye of f.eyes) {
      const u = eye.material.userData.uniforms;
      if (u) u.uPupil.value += (pupil - u.uPupil.value) * Math.min(1, dt * 6);
    }

    // ears: pose + attention + random twitch
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) { this.earTwitch = 1; this.nextTwitch = 2 + Math.random() * 7; }
    this.earTwitch = Math.max(0, this.earTwitch - dt * 4);
    const tw = Math.sin(this.earTwitch * Math.PI * 3) * this.earTwitch * 0.35;
    f.ears.forEach((ear, i) => {
      const s = i === 0 ? 1 : -1;
      ear.rotation.x = -0.22 + cur.earPitch * 1.4 + (i === 0 ? tw : tw * 0.3);
      ear.rotation.z = s * (0.30 + cur.earSpread * 0.7);
      ear.rotation.y = s * cur.earPitch * -0.5;
    });

    if (f.tongue) {
      const lick = ctx.licking ? Math.max(0, Math.sin(this.time * 7.5)) : 0;
      f.tongue.visible = lick > 0.05;
      f.tongue.scale.set(0.7, 0.28, 0.9 + lick * 1.6);
      f.tongue.position.z = f.tongue.userData.z ?? (f.tongue.userData.z = f.tongue.position.z);
      f.tongue.position.z = f.tongue.userData.z + lick * 0.012;
    }

    if (this.cat.coatUniforms) {
      this.cat.coatUniforms.uTime.value = this.time;
      this.cat.coatUniforms.uFluff.value = cur.fluff;
    }
  }
}
