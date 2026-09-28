// Utility-driven cat brain: physiological needs decay over time, every
// behaviour scores itself against those needs + personality, the best one wins
// (with hysteresis so the cat doesn't dither), then runs as a small state machine.
import * as THREE from 'three';

export const NEED_KEYS = ['hunger', 'thirst', 'energy', 'hygiene', 'social', 'play', 'litter'];

const DECAY = {          // units per second of simulated time
  hunger: 1 / 260, thirst: 1 / 420, energy: 1 / 380, hygiene: 1 / 300,
  social: 1 / 230, play: 1 / 170, litter: 1 / 520,
};

const LABEL = {
  idle: 'pottering about', wander: 'exploring', eat: 'eating', drink: 'drinking',
  sleep: 'sleeping', nap: 'dozing off', groom: 'grooming', play: 'playing with the ball',
  laser: 'chasing the laser!', affection: 'coming for cuddles', pet: 'being petted',
  litter: 'using the litter box', scratch: 'scratching the post', perch: 'watching the window',
  zoomies: 'ZOOMIES', beg: 'begging at the empty bowl', startled: 'startled!',
  sit: 'sitting and thinking', loaf: 'loafing',
};

const rnd = (a, b) => a + Math.random() * (b - a);

export class Brain {
  constructor(cat, world, opts = {}) {
    this.cat = cat;
    this.world = world;
    this.needs = { hunger: 0.75, thirst: 0.8, energy: 0.7, hygiene: 0.8, social: 0.5, play: 0.45, litter: 0.85 };
    this.personality = {
      playful: rnd(0.5, 1.0), affection: rnd(0.4, 1.0), bold: rnd(0.3, 1.0), lazy: rnd(0.2, 0.8),
      ...(opts.personality || {}),
    };
    this.trust = 0.45;           // grows with feeding / petting / play
    this.action = { id: 'idle', phase: 'do', t: 0, dur: 2, target: null, score: 0 };
    this.thought = 'idle';
    this.mood = 'content';
    this.startle = 0;
    this.meowCooldown = 0;
    this.lookAt = null;
    this.stalking = false;
    this.licking = false;
    this.events = new THREE.EventDispatcher();
    this.timeScale = 1;
    this.lastMeow = 0;
    this._tmp = new THREE.Vector3();
  }

  emit(type, extra = {}) { this.events.dispatchEvent({ type, ...extra }); }

  say(kind) {
    if (this.meowCooldown > 0) return;
    this.meowCooldown = kind === 'purr' ? 0 : rnd(1.5, 4);
    this.emit('vocalise', { kind });
  }

  /** Something scary happened (loud noise, sudden grab). */
  spook(strength = 1) {
    this.startle = Math.max(this.startle, strength);
    this.trust = Math.max(0, this.trust - 0.05 * strength);
    this.setAction('startled', null, 1.2 + strength);
    this.say('hiss');
  }

  setAction(id, target, dur) {
    this.action = { id, phase: target ? 'go' : 'do', t: 0, dur, target, score: 0 };
  }

  // ---------------------------------------------------------------- scoring
  scores(ctx) {
    const n = this.needs, p = this.personality;
    const want = (v) => (1 - v) * (1 - v);
    const s = {
      eat: ctx.foodAvailable ? want(n.hunger) * 1.35 : 0,
      beg: !ctx.foodAvailable && n.hunger < 0.35 ? want(n.hunger) * 1.1 : 0,
      drink: want(n.thirst) * 0.85,
      sleep: want(n.energy) * (1.25 + p.lazy * 0.5),
      groom: want(n.hygiene) * 0.8,
      play: want(n.play) * (0.9 + p.playful * 0.7) * (n.energy > 0.25 ? 1 : 0.15),
      affection: want(n.social) * (0.7 + p.affection * 0.9) * (0.35 + this.trust),
      litter: want(n.litter) * 1.6,
      scratch: 0.18 + want(n.play) * 0.25,
      perch: 0.22 + p.bold * 0.18 + want(n.play) * 0.15,
      wander: 0.16 + Math.random() * 0.1,
      zoomies: n.energy > 0.8 && n.play < 0.45 ? 0.5 * p.playful : 0,
      idle: 0.20 + p.lazy * 0.15,
    };
    // reactive behaviours trump everything
    if (ctx.laser) s.laser = 1.6 + p.playful * 0.8;
    if (ctx.petting) s.pet = 2.4;
    if (ctx.calling) s.affection = Math.max(s.affection, 0.8 + this.trust * 1.2);
    if (ctx.ballMoving) s.play = Math.max(s.play, 1.1 + p.playful * 0.5);
    return s;
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    const cat = this.cat, world = this.world;
    const sdt = dt * this.timeScale;
    this.meowCooldown = Math.max(0, this.meowCooldown - dt);
    this.startle = Math.max(0, this.startle - dt * 0.8);

    // needs decay (sleeping restores energy, running burns it)
    for (const k of NEED_KEYS) this.needs[k] = Math.max(0, this.needs[k] - DECAY[k] * sdt);
    if (this.action.id === 'sleep' && this.action.phase === 'do') {
      this.needs.energy = Math.min(1, this.needs.energy + sdt / 55);
    }
    this.needs.energy = Math.max(0, this.needs.energy - cat.speed * sdt * 0.004);

    const a = this.action;
    a.t += dt;

    // pick a new action when the current one is done (or clearly outscored)
    const sc = this.scores(ctx);
    const best = Object.entries(sc).sort((x, y) => y[1] - x[1])[0];
    const finished = a.t > a.dur;
    const interruptible = !['litter', 'startled', 'pounce'].includes(a.id);
    if ((finished || (interruptible && best[1] > (sc[a.id] || 0) + 0.55)) && a.id !== 'startled') {
      if (best[0] !== a.id || finished) this.begin(best[0], ctx);
    }

    this.run(dt, sdt, ctx);
    this.updateMood();

    cat.lookTarget = this.lookAt;
    cat.purr = THREE.MathUtils.lerp(cat.purr, this.purrTarget || 0, dt * 2);
    this.thought = LABEL[this.action.id] || this.action.id;
  }

  begin(id, ctx) {
    const P = this.world.points;
    const cat = this.cat;
    switch (id) {
      case 'eat': this.setAction('eat', P.food.stand, 14); this.actionYaw = -Math.PI / 2; break;
      case 'drink': this.setAction('drink', P.water.stand, 9); this.actionYaw = -Math.PI / 2; break;
      case 'beg': this.setAction('beg', P.food.stand, 10); this.actionYaw = -Math.PI / 2; break;
      case 'sleep': {
        const spots = [P.bed, P.sunspot, P.sofa, P.sill];
        const spot = spots[Math.floor(Math.random() * (this.needs.energy < 0.2 ? 2 : spots.length))];
        this.setAction('sleep', spot.jump ? spot.pos : spot.stand, 60);
        this.sleepSpot = spot;
        break;
      }
      case 'groom': this.setAction('groom', null, rnd(8, 16)); break;
      case 'play': this.setAction('play', null, rnd(12, 22)); this.playPhase = 'approach'; break;
      case 'laser': this.setAction('laser', null, 6); break;
      case 'pet': this.setAction('pet', null, 4); break;
      case 'affection': this.setAction('affection', null, rnd(8, 14)); break;
      case 'litter': this.setAction('litter', P.litter.pos, 12); break;
      case 'scratch': this.setAction('scratch', P.post.stand, rnd(6, 10)); this.actionYaw = -Math.PI / 2; break;
      case 'perch': {
        const spot = Math.random() < 0.6 ? P.sill : (Math.random() < 0.5 ? P.shelf : P.table);
        this.setAction('perch', spot.pos, rnd(18, 35));
        this.perchSpot = spot;
        break;
      }
      case 'stretchWake': this.setAction('stretchWake', null, 4); break;
      case 'zoomies': this.setAction('zoomies', this.randomFloorPoint(), rnd(5, 9)); break;
      case 'wander': this.setAction('wander', this.randomFloorPoint(), rnd(6, 12)); break;
      default: this.setAction('idle', null, rnd(4, 9));
    }
    if (['sleep', 'perch'].includes(id) && this.action.target) this.action.phase = 'go';
    this.playTimer = 0;
  }

  randomFloorPoint() {
    const b = this.world.bounds;
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Vector3(rnd(-b.x, b.x), 0, rnd(-b.z, b.z));
      if (!this.world.obstacles.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + 0.25)) return p;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  arrive(target, gait = 'walk') {
    const cat = this.cat;
    const d = Math.hypot(target.x - cat.position.x, target.z - cat.position.z);
    const dy = (target.y || 0) - cat.position.y;
    if (d < 0.14 && Math.abs(dy) < 0.06) { cat.stop(); return true; }
    cat.moveTo(target, gait);
    return false;
  }

  run(dt, sdt, ctx) {
    const cat = this.cat, a = this.action, P = this.world.points;
    this.purrTarget = 0;
    this.licking = false;
    this.stalking = false;
    const n = this.needs;

    switch (a.id) {
      case 'startled':
        cat.stop();
        cat.pose = 'startled';
        this.lookAt = ctx.handPoint;
        if (a.t > a.dur) this.begin('wander', ctx);
        break;

      case 'eat':
      case 'drink': {
        const bowl = a.id === 'eat' ? P.food : P.water;
        if (a.phase === 'go') {
          if (this.arrive(a.target, n[a.id === 'eat' ? 'hunger' : 'thirst'] < 0.25 ? 'trot' : 'walk')) a.phase = 'do';
          this.lookAt = bowl.pos;
        } else {
          cat.turnTo(Math.atan2(bowl.pos.x - cat.position.x, bowl.pos.z - cat.position.z), dt, 3);
          cat.pose = 'eat';
          this.licking = true;
          this.lookAt = null;
          if (a.id === 'eat') {
            if (!ctx.foodAvailable) { this.begin('groom', ctx); break; }
            n.hunger = Math.min(1, n.hunger + sdt / 9);
            n.hygiene = Math.max(0, n.hygiene - sdt / 90);
            this.world.consumeFood(sdt / 9);
          } else {
            n.thirst = Math.min(1, n.thirst + sdt / 7);
          }
          this.purrTarget = 0.3;
        }
        break;
      }

      case 'beg':
        if (a.phase === 'go') {
          if (this.arrive(a.target, 'trot')) a.phase = 'do';
        } else {
          cat.turnTo(Math.atan2(P.food.pos.x - cat.position.x, P.food.pos.z - cat.position.z), dt, 3);
          cat.pose = 'sit';
          this.lookAt = ctx.handPoint;
          if (Math.random() < dt * 0.6) this.say('meow');
        }
        break;

      case 'sleep': {
        if (a.phase === 'go') {
          const spot = this.sleepSpot;
          if (spot?.jump && Math.hypot(spot.stand.x - cat.position.x, spot.stand.z - cat.position.z) > 0.2
              && cat.position.y < 0.05) {
            this.arrive(spot.stand, 'walk');
          } else if (this.arrive(a.target, 'walk')) {
            a.phase = 'settle'; a.t = 0;
          }
          this.lookAt = a.target;
        } else if (a.phase === 'settle') {
          cat.stop();
          cat.pose = a.t < 2.5 ? 'loaf' : 'sleep';
          this.purrTarget = 0.35;
          if (a.t > 4) a.phase = 'do';
        } else {
          cat.pose = n.energy > 0.97 ? 'loaf' : 'sleep';
          this.purrTarget = 0.5;
          this.lookAt = null;
          if (n.energy > 0.985) this.begin('stretchWake', ctx);
        }
        break;
      }

      case 'stretchWake':
        cat.pose = a.t < 2 ? 'stretch' : 'sit';
        if (a.t > 3.5) this.begin('wander', ctx);
        break;

      case 'groom':
        cat.stop();
        cat.pose = 'groom';
        this.licking = true;
        this.purrTarget = 0.25;
        n.hygiene = Math.min(1, n.hygiene + sdt / 12);
        this.lookAt = null;
        break;

      case 'scratch':
        if (a.phase === 'go') {
          if (this.arrive(a.target)) { a.phase = 'do'; a.t = 0; }
          this.lookAt = P.post.pos;
        } else {
          cat.turnTo(Math.atan2(P.post.pos.x - cat.position.x, P.post.pos.z - cat.position.z), dt, 4);
          cat.pose = 'scratch';
          n.play = Math.min(1, n.play + sdt / 40);
        }
        break;

      case 'litter':
        if (a.phase === 'go') {
          if (this.arrive(a.target, n.litter < 0.12 ? 'trot' : 'walk')) { a.phase = 'do'; a.t = 0; }
        } else {
          cat.stop();
          cat.pose = a.t < 5 ? 'crouch' : 'sit';
          n.litter = Math.min(1, n.litter + sdt / 6);
          n.hygiene = Math.max(0, n.hygiene - sdt / 60);
          if (a.t > 7) this.begin('groom', ctx);
        }
        break;

      case 'perch':
        if (a.phase === 'go') {
          const spot = this.perchSpot;
          if (cat.position.y < 0.05 && Math.hypot(spot.stand.x - cat.position.x, spot.stand.z - cat.position.z) > 0.18) {
            this.arrive(spot.stand);
          } else if (this.arrive(a.target)) { a.phase = 'do'; a.t = 0; }
        } else {
          cat.stop();
          cat.pose = a.t % 18 < 9 ? 'sit' : 'loaf';
          this.lookAt = ctx.birdPoint || new THREE.Vector3(0.4, 1.4, -4);
          if (Math.random() < dt * 0.12) this.say('chirp');
        }
        break;

      case 'affection': {
        const hand = ctx.handPoint || ctx.playerPoint;
        if (!hand) { this.begin('wander', ctx); break; }
        const d = Math.hypot(hand.x - cat.position.x, hand.z - cat.position.z);
        this.lookAt = hand;
        if (d > 0.45) {
          cat.moveTo(new THREE.Vector3(hand.x, 0, hand.z), n.social < 0.25 ? 'trot' : 'walk');
          if (Math.random() < dt * 0.35) this.say('meow');
        } else {
          cat.stop();
          cat.faceTowards(hand, dt, 3);
          cat.pose = 'rub';
          this.purrTarget = 0.8;
          n.social = Math.min(1, n.social + sdt / 14);
        }
        break;
      }

      case 'pet':
        cat.stop();
        cat.pose = Math.random() < 0.5 ? 'rub' : 'loaf';
        this.purrTarget = 1;
        this.lookAt = ctx.handPoint;
        n.social = Math.min(1, n.social + sdt / 5);
        this.trust = Math.min(1, this.trust + sdt / 90);
        a.t = 0; // keep going while the hand is on the cat
        if (!ctx.petting) this.begin('groom', ctx);
        break;

      case 'laser': {
        const dot = ctx.laser;
        if (!dot) { this.begin('idle', ctx); break; }
        this.lookAt = dot;
        const d = Math.hypot(dot.x - cat.position.x, dot.z - cat.position.z);
        if (d > 0.85) {
          cat.moveTo(dot, 'run');
        } else if (d > 0.3) {
          cat.moveTo(dot, 'trot');
          this.stalking = true;
        } else {
          cat.stop();
          cat.faceTowards(dot, dt, 6);
          cat.pose = Math.sin(a.t * 4) > 0.2 ? 'playPaw' : 'crouch';
          n.play = Math.min(1, n.play + sdt / 10);
          n.energy = Math.max(0, n.energy - sdt / 90);
        }
        a.t = 0;
        break;
      }

      case 'play': {
        const ball = this.world.ball;
        const bp = ball.position;
        this.lookAt = bp;
        const d = Math.hypot(bp.x - cat.position.x, bp.z - cat.position.z);
        this.playTimer = (this.playTimer || 0) + dt;
        if (d > 0.55) {
          cat.moveTo(new THREE.Vector3(bp.x, 0, bp.z), ctx.ballMoving ? 'run' : 'trot');
          this.playPhase = 'approach';
        } else if (d > 0.22) {
          cat.moveTo(new THREE.Vector3(bp.x, 0, bp.z), 'walk');
          this.stalking = true;
          this.playPhase = 'stalk';
        } else {
          cat.stop();
          cat.faceTowards(bp, dt, 6);
          if (this.playTimer > 1.2) {
            this.playTimer = 0;
            const dir = new THREE.Vector3(bp.x - cat.position.x, 0, bp.z - cat.position.z).normalize();
            dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rnd(-1.1, 1.1));
            ball.userData.vel.copy(dir.multiplyScalar(rnd(1.0, 2.6))).setY(rnd(0.6, 1.8));
            cat.pose = 'playPaw';
            this.say('chirp');
          } else {
            cat.pose = this.playTimer > 0.8 ? 'playPaw' : 'crouch';
          }
          n.play = Math.min(1, n.play + sdt / 12);
          n.energy = Math.max(0, n.energy - sdt / 80);
        }
        break;
      }

      case 'zoomies':
        cat.pose = 'run';
        if (this.arrive(a.target, 'run') || a.t % 2.2 < dt) {
          a.target = this.randomFloorPoint();
        }
        n.play = Math.min(1, n.play + sdt / 14);
        n.energy = Math.max(0, n.energy - sdt / 30);
        this.lookAt = a.target;
        break;

      case 'wander':
        if (a.phase === 'go' || cat.moveTarget) {
          if (this.arrive(a.target, 'walk')) { a.phase = 'do'; a.t = Math.max(a.t, a.dur - rnd(2, 5)); }
          this.lookAt = ctx.attention || a.target;
        } else {
          cat.stop();
          cat.pose = 'alert';
          this.lookAt = ctx.attention || ctx.handPoint;
        }
        break;

      default: // idle
        cat.stop();
        cat.pose = a.t % 12 < 5 ? 'sit' : (a.t % 12 < 9 ? 'loaf' : 'alert');
        this.lookAt = ctx.attention || ctx.handPoint;
        this.purrTarget = 0.1;
    }

    // pupils react to excitement
    this.excitement = ['laser', 'play', 'zoomies', 'startled'].includes(a.id) ? 1 : 0;
    this.cat.animator.cur.pupil = THREE.MathUtils.lerp(
      this.cat.animator.cur.pupil, this.excitement ? 0.95 : 0.35, dt * 1.5,
    );
  }

  updateMood() {
    const n = this.needs;
    if (this.startle > 0.3) this.mood = 'frightened';
    else if (n.hunger < 0.25) this.mood = 'hungry';
    else if (n.energy < 0.25) this.mood = 'sleepy';
    else if (this.cat.purr > 0.6) this.mood = 'blissful';
    else if (n.play < 0.3) this.mood = 'restless';
    else if (n.social < 0.3) this.mood = 'lonely';
    else this.mood = 'content';
  }
}
