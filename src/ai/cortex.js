// Glue between the LLM bridge and the cat's utility brain.
// The LLM never drives bones or steering — it only biases *which* behaviour the
// brain picks next, and supplies the inner monologue.
const NEAR = 0.85;

export class Cortex {
  constructor({ llm, brain, world, audio, onThought }) {
    this.llm = llm;
    this.brain = brain;
    this.world = world;
    this.audio = audio;
    this.onThought = onThought || (() => {});
    this.interval = 12;        // seconds between spontaneous thoughts
    this.timer = 3;
    this.pendingEvent = null;
    this.pendingMessage = null;
    this.lastCtx = {};
  }

  /** Something happened that the cat should react to right away. */
  notify(event) {
    this.pendingEvent = event;
    this.timer = Math.min(this.timer, 0.6);
  }

  /** The human typed something at the cat. */
  say(message) {
    this.pendingMessage = message;
    this.timer = 0;
  }

  place() {
    const p = this.brain.cat.position;
    let best = null, bestD = NEAR;
    for (const [name, pt] of Object.entries(this.world.points)) {
      const d = Math.hypot(pt.pos.x - p.x, pt.pos.z - p.z);
      if (d < bestD) { bestD = d; best = name; }
    }
    const NAMES = {
      food: 'at her food bowl', water: 'at her water bowl', bed: 'in her cat bed',
      post: 'by the scratching post', litter: 'in the litter tray', sofa: 'on the sofa',
      sill: 'on the windowsill', shelf: 'on the high wall shelf', sunspot: 'in the sun patch',
      table: 'on the coffee table',
    };
    if (best) return NAMES[best] || best;
    return this.brain.cat.position.y > 0.1 ? 'up on the furniture' : 'in the middle of the room';
  }

  snapshot(ctx) {
    const b = this.brain;
    const cat = b.cat;
    const r = (v) => Math.round(v * 100) / 100;
    const hand = ctx.handPoint;
    const dist = hand ? Math.hypot(hand.x - cat.position.x, hand.z - cat.position.z) : 99;
    return {
      needs: Object.fromEntries(Object.entries(b.needs).map(([k, v]) => [k, r(v)])),
      mood: b.mood,
      trust: r(b.trust),
      personality: Object.fromEntries(Object.entries(b.personality).map(([k, v]) => [k, r(v)])),
      currently: b.action.id,
      where: this.place(),
      human: {
        distance_m: r(Math.min(dist, 9)),
        petting_me: !!ctx.petting,
        calling_me: !!ctx.calling,
        laser_pointer_on: !!ctx.laser,
      },
      room: {
        food_in_bowl: !!ctx.foodAvailable,
        water_in_bowl: !!ctx.waterAvailable,
        litter_tray: ctx.litterClean === false ? 'filthy, needs scooping' : 'clean enough',
        toy_ball_moving: !!ctx.ballMoving,
      },
      event: this.pendingEvent,
    };
  }

  update(dt, ctx) {
    this.lastCtx = ctx;
    if (!this.llm.enabled) return;
    this.timer -= dt;
    if (this.timer > 0 || this.llm.inFlight) return;
    this.timer = this.interval;

    const state = this.snapshot(ctx);
    const message = this.pendingMessage;
    this.pendingEvent = null;
    this.pendingMessage = null;

    this.llm.think(state, message).then((out) => {
      if (!out) return;
      const b = this.brain;
      b.llmBias = { action: out.action, weight: 1.4, until: b.clock + out.commit_seconds };
      if (b.action.id !== out.action && !['litter', 'startled'].includes(b.action.id)) {
        b.begin(out.action, this.lastCtx);
      }
      if (out.vocalise === 'purr') b.purrBoost = 3;
      else if (out.vocalise !== 'none') b.emit('vocalise', { kind: out.vocalise });
      if (out.thought) {
        b.llmThought = out.thought;
        this.onThought(out.thought, out.action, message);
        this.llm.remember(`${out.action} — ${out.thought}`);
      }
    });
  }
}
