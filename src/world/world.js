// World dynamics on top of the static room: bowl contents, the toy ball's
// physics, the laser dot and the drifting sun patch.
import * as THREE from 'three';
import { buildRoom } from './room.js';
import { attachSupplies } from './supplies.js';

export class World {
  constructor(scene, quality) {
    Object.assign(this, buildRoom(scene, quality));
    this.scene = scene;
    this.foodLevel = 0.0;
    this.setFood(0);
    attachSupplies(this, { waterMesh: this.water, clumps: this.clumps });

    // laser dot
    this.laserDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 20),
      new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.95 }),
    );
    this.laserDot.rotation.x = -Math.PI / 2;
    this.laserDot.visible = false;
    this.laserLight = new THREE.PointLight(0xff3020, 1.2, 0.9, 2);
    this.laserLight.visible = false;
    scene.add(this.laserDot, this.laserLight);
    this.laser = null;

    this.ballPrev = this.ball.position.clone();
    this.ballMoving = false;
  }

  setFood(v) {
    this.foodLevel = THREE.MathUtils.clamp(v, 0, 1);
    this.kibble.visible = this.foodLevel > 0.02;
    this.kibble.scale.set(1, Math.max(0.15, this.foodLevel), 1);
    this.kibble.position.y = 0.030 + 0.015 * this.foodLevel;
  }

  consumeFood(amount) { this.setFood(this.foodLevel - amount); }
  refillFood() { this.setFood(1); }

  get foodAvailable() { return this.foodLevel > 0.02; }

  setLaser(point) {
    this.laser = point ? point.clone() : null;
    this.laserDot.visible = !!point;
    this.laserLight.visible = !!point;
    if (point) {
      this.laserDot.position.copy(point).setY(point.y + 0.004);
      this.laserLight.position.copy(point).setY(point.y + 0.12);
    }
  }

  throwBall(target, from) {
    const b = this.ball;
    b.position.copy(from);
    const dir = new THREE.Vector3().subVectors(target, from);
    const flat = new THREE.Vector3(dir.x, 0, dir.z);
    const t = Math.max(0.35, flat.length() / 3.2);
    b.userData.vel.set(flat.x / t, (target.y - from.y) / t + 4.9 * t, flat.z / t);
  }

  update(dt) {
    // ---- ball physics (sphere vs floor + walls + table/sofa tops) ----
    const b = this.ball, v = b.userData.vel;
    const r = 0.035;
    if (v.lengthSq() > 1e-6 || b.position.y > r + 1e-3) {
      v.y -= 9.81 * dt;
      b.position.addScaledVector(v, dt);
      const bx = this.bounds.x + 0.25, bz = this.bounds.z + 0.25;
      if (b.position.x < -bx + r) { b.position.x = -bx + r; v.x *= -0.55; }
      if (b.position.x > bx - r) { b.position.x = bx - r; v.x *= -0.55; }
      if (b.position.z < -bz + r) { b.position.z = -bz + r; v.z *= -0.55; }
      if (b.position.z > bz - r) { b.position.z = bz - r; v.z *= -0.55; }
      if (b.position.y < r) {
        b.position.y = r;
        v.y = Math.abs(v.y) > 0.4 ? -v.y * 0.45 : 0;
        v.x *= 0.82; v.z *= 0.82;
        if (v.lengthSq() < 0.004) v.set(0, 0, 0);
      }
      b.rotation.x -= v.z * dt * 12;
      b.rotation.z += v.x * dt * 12;
    }
    this.ballMoving = v.lengthSq() > 0.05;

    // ---- the bowl slowly evaporates, so water is a chore and not a one-off ----
    this.evaporate(dt);

    // ---- gentle sun drift so the warm patch moves across the floor ----
    this.sunT = (this.sunT || 0) + dt * 0.01;
    this.sun.position.set(-1.2 + Math.sin(this.sunT) * 1.6, 3.0, -6.0);
    this.points.sunspot.pos.x = -0.15 + Math.sin(this.sunT) * 0.8;
    this.points.sunspot.stand.x = this.points.sunspot.pos.x;
  }
}
