// Key poses, expressed as body-space paw targets + spine angles.
// Everything is blended continuously, so the cat never "snaps" between states.
const F = 0.053, H = 0.059; // default paw half-widths

export const BASE = {
  hipY: 0.185, hipZ: 0, hipX: 0,
  pitch: 0, roll: 0, spineCurl: 0, spineTwist: 0, spineSide: 0,
  neckPitch: 0, neckYaw: 0, headPitch: 0, headRoll: 0,
  feet: {
    FL: [F, 0.017, 0.232], FR: [-F, 0.017, 0.232],
    HL: [H, 0.017, -0.03], HR: [-H, 0.017, -0.03],
  },
  tail: { lift: 0.25, curl: 0.15, side: 0, stiff: 0.5, wag: 0 },
  // offset from the paw back to the wrist/hock — controls whether the last
  // segment stands upright (default) or lies flat on the floor (sitting)
  wristVec: [0, -0.036, 0.022], hockVec: [0, -0.045, 0.032],
  earPitch: 0, earSpread: 0, eyeOpen: 1, pupil: 0.35,
  breathe: 1, fluff: 0, blend: 4.0, lookWeight: 1,
};

const p = (o) => ({ ...BASE, ...o, feet: { ...BASE.feet, ...(o.feet || {}) }, tail: { ...BASE.tail, ...(o.tail || {}) } });
const FLAT_HOCK = [0, -0.004, 0.052];   // metatarsus flat on the ground
const FLAT_WRIST = [0, -0.005, 0.038]; // forearm flat, paws stretched forward

export const POSES = {
  stand: p({}),

  alert: p({
    hipY: 0.191, spineCurl: -0.05, neckPitch: -0.12, earPitch: 0.1,
    tail: { lift: 0.55, curl: 0.2, stiff: 0.75 }, pupil: 0.3, blend: 5,
  }),

  walk: p({ hipY: 0.182, spineCurl: 0.02, tail: { lift: 0.45, curl: 0.35, stiff: 0.35, wag: 0.1 }, blend: 3.5 }),

  trot: p({ hipY: 0.185, spineCurl: -0.02, neckPitch: -0.05, tail: { lift: 0.7, curl: 0.25, stiff: 0.6 }, blend: 4 }),

  run: p({
    hipY: 0.174, spineCurl: 0.12, neckPitch: -0.18, pupil: 0.6,
    tail: { lift: 0.2, curl: -0.1, stiff: 0.85 }, blend: 5,
  }),

  sit: p({
    hipY: 0.075, hipZ: -0.018, pitch: -0.48, spineCurl: -0.10, neckPitch: 0.10,
    feet: {
      FL: [F, 0.017, 0.200], FR: [-F, 0.017, 0.200],
      HL: [H + 0.014, 0.017, 0.055], HR: [-H - 0.014, 0.017, 0.055],
    },
    hockVec: FLAT_HOCK,
    tail: { lift: -0.75, curl: 0.25, side: 0.75, stiff: 0.2, wag: 0.05 },
    blend: 2.2,
  }),

  loaf: p({ // classic bread-loaf, paws tucked
    hipY: 0.062, hipZ: -0.004, pitch: -0.10, spineCurl: 0.06, neckPitch: 0.14,
    feet: {
      FL: [F - 0.006, 0.016, 0.238], FR: [-F + 0.006, 0.016, 0.238],
      HL: [H + 0.006, 0.016, 0.022], HR: [-H - 0.006, 0.016, 0.022],
    },
    hockVec: FLAT_HOCK, wristVec: FLAT_WRIST,
    tail: { lift: -0.5, curl: 1.0, side: 1.0, stiff: 0.22 },
    earPitch: 0.05, eyeOpen: 0.7, pupil: 0.45, blend: 1.8,
  }),

  lie: p({ // lying on the side, stretched out
    hipY: 0.054, roll: 0.55, pitch: 0.02, spineCurl: 0.18, spineSide: 0.25,
    feet: {
      FL: [F + 0.030, 0.016, 0.262], FR: [-F + 0.026, 0.016, 0.245],
      HL: [H + 0.042, 0.016, -0.050], HR: [-H + 0.028, 0.016, -0.040],
    },
    hockVec: FLAT_HOCK, wristVec: FLAT_WRIST,
    tail: { lift: -0.6, curl: 0.7, side: 1.1, stiff: 0.15 },
    eyeOpen: 0.45, pupil: 0.5, blend: 1.4, lookWeight: 0.4,
  }),

  sleep: p({ // curled up
    hipY: 0.060, roll: 0.30, spineCurl: 0.42, spineSide: 0.55, neckPitch: 0.45, headRoll: 0.35,
    feet: {
      FL: [F - 0.004, 0.015, 0.215], FR: [-F + 0.014, 0.015, 0.205],
      HL: [H + 0.002, 0.015, 0.030], HR: [-H + 0.006, 0.015, 0.024],
    },
    hockVec: FLAT_HOCK, wristVec: FLAT_WRIST,
    tail: { lift: -0.7, curl: 1.9, side: 1.5, stiff: 0.1 },
    earPitch: -0.12, eyeOpen: 0, pupil: 0.8, breathe: 1.6, blend: 1.0, lookWeight: 0,
  }),

  crouch: p({ // stalking
    hipY: 0.100, pitch: 0.06, spineCurl: 0.16, neckPitch: -0.22, headPitch: 0.10,
    feet: {
      FL: [F, 0.017, 0.215], FR: [-F, 0.017, 0.215],
      HL: [H + 0.008, 0.017, -0.016], HR: [-H - 0.008, 0.017, -0.016],
    },
    tail: { lift: -0.55, curl: 0.15, stiff: 0.25, wag: 0.9 },
    earPitch: 0.16, pupil: 0.95, blend: 3.5,
  }),

  pounce: p({
    hipY: 0.212, pitch: -0.25, spineCurl: -0.28, neckPitch: -0.2,
    feet: {
      FL: [F, 0.115, 0.290], FR: [-F, 0.105, 0.285],
      HL: [H, 0.030, -0.081], HR: [-H, 0.030, -0.081],
    },
    tail: { lift: 0.5, curl: -0.2, stiff: 0.9 },
    pupil: 1.0, blend: 9,
  }),

  eat: p({
    hipY: 0.170, pitch: 0.14, spineCurl: 0.30, neckPitch: 1.05, headPitch: 0.35,
    feet: {
      FL: [F, 0.017, 0.210], FR: [-F, 0.017, 0.210],
      HL: [H, 0.017, -0.036], HR: [-H, 0.017, -0.036],
    },
    tail: { lift: 0.0, curl: 0.4, side: 0.3, stiff: 0.3, wag: 0.25 },
    eyeOpen: 0.75, blend: 2.4, lookWeight: 0,
  }),

  groom: p({
    hipY: 0.084, hipZ: -0.014, pitch: -0.40, spineCurl: 0.26, spineSide: 0.38,
    neckPitch: 0.85, headRoll: 0.32,
    feet: {
      FL: [F, 0.017, 0.196], FR: [-F, 0.017, 0.196],
      HL: [H + 0.014, 0.017, 0.052], HR: [-H - 0.014, 0.017, 0.052],
    },
    hockVec: FLAT_HOCK,
    tail: { lift: -0.45, curl: 0.7, side: 0.8, stiff: 0.25 },
    eyeOpen: 0.35, blend: 2.0, lookWeight: 0,
  }),

  stretch: p({
    hipY: 0.166, pitch: 0.30, spineCurl: -0.42, neckPitch: -0.28,
    feet: {
      FL: [F, 0.016, 0.330], FR: [-F, 0.016, 0.330],
      HL: [H, 0.017, -0.056], HR: [-H, 0.017, -0.056],
    },
    tail: { lift: 0.85, curl: -0.3, stiff: 0.8 },
    eyeOpen: 0.2, blend: 2.0, lookWeight: 0.2,
  }),

  rub: p({ // rubbing against the player's hand / furniture
    hipY: 0.180, roll: 0.16, spineSide: 0.45, spineCurl: -0.05, headRoll: 0.5, neckPitch: -0.1,
    tail: { lift: 1.0, curl: 0.5, side: 0.2, stiff: 0.7, wag: 0.15 },
    eyeOpen: 0.3, earPitch: -0.05, blend: 2.5,
  }),

  scratch: p({ // front claws on the post
    hipY: 0.200, pitch: -0.42, spineCurl: -0.25, neckPitch: -0.15,
    feet: {
      FL: [F, 0.240, 0.215], FR: [-F, 0.185, 0.215],
      HL: [H, 0.017, -0.056], HR: [-H, 0.017, -0.056],
    },
    tail: { lift: 0.4, curl: 0.2, stiff: 0.5, wag: 0.3 },
    eyeOpen: 0.5, blend: 3.5,
  }),

  playPaw: p({ // sitting and batting at something with a front paw
    hipY: 0.118, pitch: -0.34, spineCurl: -0.12,
    feet: {
      FL: [F + 0.02, 0.150, 0.265], FR: [-F, 0.017, 0.205],
      HL: [H + 0.012, 0.018, 0.022], HR: [-H - 0.012, 0.018, 0.022],
    },
    tail: { lift: 0.2, curl: 0.4, side: 0.4, stiff: 0.4, wag: 0.7 },
    pupil: 0.9, blend: 5,
  }),

  startled: p({
    hipY: 0.203, spineCurl: -0.35, roll: 0, neckPitch: -0.25,
    feet: {
      FL: [F + 0.012, 0.017, 0.215], FR: [-F - 0.012, 0.017, 0.215],
      HL: [H + 0.012, 0.017, -0.061], HR: [-H - 0.012, 0.017, -0.061],
    },
    tail: { lift: 1.25, curl: 0.1, stiff: 1.0 },
    earPitch: -0.45, earSpread: 0.5, pupil: 1.0, fluff: 1, blend: 12,
  }),
};
