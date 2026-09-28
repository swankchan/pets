// The cat: body assembly, locomotion/steering and the glue to the animator.
import * as THREE from 'three';
import { buildSkeleton } from './rig.js';
import { buildBodyGeometry } from './body.js';
import { createCoatMaterials, COATS } from './fur.js';
import { buildFeatures } from './features.js';
import { Animator } from './anim.js';

const LOCOMOTION = { walk: 0.42, trot: 1.0, run: 2.6 };

export class Cat {
  constructor({ coat = 'tabby', quality, name = 'Mochi' } = {}) {
    this.name = name;
    this.coatKey = coat;
    this.coat = COATS[coat];
    this.quality = quality;
    this.group = new THREE.Group();

    const { root, bones, rest, skeleton } = buildSkeleton();
    this.bones = bones; this.rest = rest; this.skeleton = skeleton;
    this.group.add(root);

    this.geometry = buildBodyGeometry(rest, quality.voxel);
    this.materials = createCoatMaterials(this.coat, {
      shells: quality.shells, furLength: 0.011, density: quality.furDensity,
    });
    this.coatUniforms = this.materials.shared;

    this.meshes = [];
    this.materials.forEach((mat, i) => {
      const mesh = new THREE.SkinnedMesh(this.geometry, mat);
      mesh.bind(skeleton);
      mesh.castShadow = i === 0;
      mesh.receiveShadow = i === 0;
      mesh.frustumCulled = false;
      if (i > 0) mesh.renderOrder = i;
      this.group.add(mesh);
      this.meshes.push(mesh);
    });
    this.hitMesh = this.meshes[0];

    this.features = buildFeatures(bones, rest, this.coat);
    this.animator = new Animator(this);

    // --- locomotion state ---
    this.heading = 0;
    this.speed = 0;
    this.turn = 0;
    this.moveTarget = null;
    this.arriveRadius = 0.12;
    this.desiredGait = 'walk';
    this.pose = 'stand';
    this.lookTarget = null;
    this.purr = 0;
    this.jump = null;
    this.y = 0;

    this.group.position.set(0, 0, 0);
  }

  get position() { return this.group.position; }

  /** Head / nose position in world space — handy for "is the bowl reached" tests. */
  headPosition(out = new THREE.Vector3()) {
    this.bones.head.updateMatrixWorld(true);
    return out.setFromMatrixPosition(this.bones.head.matrixWorld);
  }

  moveTo(point, gait = 'walk') {
    this.moveTarget = point.clone();
    this.desiredGait = gait;
  }

  stop() { this.moveTarget = null; }

  faceTowards(point, dt, rate = 4) {
    const dx = point.x - this.group.position.x;
    const dz = point.z - this.group.position.z;
    const want = Math.atan2(dx, dz);
    return this.turnTo(want, dt, rate);
  }

  turnTo(want, dt, rate) {
    let diff = ((want - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const step = Math.max(-1, Math.min(1, diff * 2)) * rate * dt;
    const applied = Math.abs(step) > Math.abs(diff) ? diff : step;
    this.heading += applied;
    this.turn = THREE.MathUtils.clamp(applied / Math.max(dt, 1e-3) / 3, -1, 1);
    return Math.abs(diff);
  }

  /** Blend the straight line to the goal with a push away from furniture. */
  steer(target, dist) {
    if (!this.obstacles || !this.obstacles.length) return target;
    const p = this.group.position;
    const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z);
    if (dir.lengthSq() < 1e-6) return target;
    dir.normalize();
    const push = new THREE.Vector3();
    for (const o of this.obstacles) {
      // ignore whatever the cat is actually heading for
      if (Math.hypot(o.x - target.x, o.z - target.z) < o.r + 0.15) continue;
      const ox = p.x - o.x, oz = p.z - o.z;
      const d = Math.hypot(ox, oz);
      const range = o.r + 0.45;
      if (d > range || d < 1e-4) continue;
      const ahead = (-ox * dir.x - oz * dir.z) / d;     // is the obstacle in front?
      if (ahead < -0.1) continue;
      push.x += (ox / d) * (1 - d / range) * (0.6 + ahead);
      push.z += (oz / d) * (1 - d / range) * (0.6 + ahead);
    }
    if (push.lengthSq() < 1e-6) return target;
    dir.addScaledVector(push, 1.6).normalize();
    return new THREE.Vector3(p.x + dir.x, target.y ?? 0, p.z + dir.z);
  }

  startJump(to, height = 0.32, dur = 0.55) {
    this.jump = { from: this.group.position.clone(), to: to.clone(), t: 0, dur, height };
    this.moveTarget = null;
  }

  update(dt, ctx = {}) {
    const g = this.group;

    if (this.jump) {
      const j = this.jump;
      j.t += dt;
      const t = Math.min(1, j.t / j.dur);
      g.position.lerpVectors(j.from, j.to, t);
      g.position.y += Math.sin(Math.PI * t) * j.height;
      this.faceTowards(j.to, dt, 8);
      this.pose = t < 0.75 ? 'pounce' : 'stand';
      this.speed = 0;
      if (t >= 1) { this.jump = null; this.y = j.to.y; }
    } else if (this.moveTarget) {
      const dx = this.moveTarget.x - g.position.x;
      const dz = this.moveTarget.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      const dy = (this.moveTarget.y ?? 0) - g.position.y;
      if (dy < -0.08 && this.y > 0.06) {
        // hop down off the furniture first, landing a little way towards the goal
        const n = Math.max(dist, 1e-3);
        const land = new THREE.Vector3(
          g.position.x + (dx / n) * Math.min(0.55, dist),
          this.moveTarget.y ?? 0,
          g.position.z + (dz / n) * Math.min(0.55, dist),
        );
        this.y = land.y;
        this.startJump(land, 0.12, 0.42);
      } else if (Math.abs(dy) > 0.10 && dist < 0.75) {
        this.startJump(this.moveTarget, 0.25 + Math.max(0, dy) * 0.9, 0.45 + Math.abs(dy) * 0.3);
      } else if (dist < this.arriveRadius) {
        this.moveTarget = null;
        this.speed *= 0.2;
      } else {
        const misalign = this.faceTowards(this.steer(this.moveTarget, dist), dt, 3.2 + LOCOMOTION[this.desiredGait]);
        const want = LOCOMOTION[this.desiredGait] * Math.max(0.15, 1 - misalign * 0.7)
          * Math.min(1, dist / 0.35 + 0.25);
        this.speed += (want - this.speed) * Math.min(1, dt * 3.5);
        g.position.x += Math.sin(this.heading) * this.speed * dt;
        g.position.z += Math.cos(this.heading) * this.speed * dt;
      }
    } else {
      this.speed *= Math.exp(-dt * 6);
      if (this.speed < 0.02) this.speed = 0;
      this.turn *= Math.exp(-dt * 4);
    }

    if (!this.jump) {
      g.position.y += (this.y - g.position.y) * Math.min(1, dt * 8);
    }
    g.rotation.y = this.heading;

    // pose selection: locomotion overrides the resting pose while moving
    let pose = this.pose;
    if (this.speed > 0.05 && !this.jump) {
      pose = this.speed > 1.7 ? 'run' : this.speed > 0.55 ? 'trot' : 'walk';
      if (ctx.stalking) pose = 'crouch';
    }
    this.animator.setPose(pose);
    this.animator.update(dt, {
      speed: this.speed,
      turn: this.turn,
      lookTarget: this.lookTarget,
      purr: this.purr,
      sleeping: pose === 'sleep',
      licking: ctx.licking,
      lightAdapt: ctx.lightAdapt ?? 1,
    });
  }

  dispose() {
    this.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
    this.group.removeFromParent();
  }
}
