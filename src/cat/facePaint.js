// Procedural face decal.
//
// The marching-cubes body cannot resolve a 3 mm mouth line, so the fine facial
// features are painted instead: this module renders an RGBA "make-up" map with
// 2D signed-distance shapes, in real-world metres, using the cat's rest-pose
// (x, y) as a frontal projection. Both the WebGL fur shader and the offline
// CPU previewer sample this exact same buffer, so what you verify is what ships.
//
//   RGB = tint to multiply the coat with, A = how strongly to apply it.

export const FACE_BOX = { x0: -0.060, x1: 0.060, y0: 0.212, y1: 0.332 };

/**
 * The eyeball, shared with features.js. Only `bulge` of the ball clears the
 * skull, so the painted eyelid aperture is derived from the radius of that
 * visible cap — otherwise the paint draws a socket far bigger than the eye
 * that actually pokes through it.
 */
export const EYE = { x: 0.0220, y: 0.2812, ballR: 0.0135, bulge: 0.0055, tilt: 0.22 };
export const EYE_CAP = Math.sqrt(EYE.ballR ** 2 - (EYE.ballR - EYE.bulge) ** 2);

// Landmarks in rest-pose object space (metres). Mirrored on |x|.
export const FACE = {
  eye: { x: EYE.x, y: EYE.y, rx: EYE_CAP * 1.03, ry: EYE_CAP * 0.86, tilt: EYE.tilt },
  nose: { x: 0, y: 0.2560, rx: 0.0092, ry: 0.0068 },
  philtrum: { top: 0.2492, bottom: 0.2436 },
  mouthCorner: { x: 0.0150, y: 0.2400 },
  pad: { x: 0.0106, y: 0.2476, rx: 0.0118, ry: 0.0086 },
  chin: { x: 0, y: 0.2348, rx: 0.0105, ry: 0.0068 },
  browTop: 0.3145,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
/** Signed distance to an axis-aligned (optionally rotated) ellipse, in metres. */
function sdEllipse(px, py, cx, cy, rx, ry, tilt = 0) {
  let dx = px - cx, dy = py - cy;
  if (tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const nx = dx * c + dy * s;
    dy = -dx * s + dy * c;
    dx = nx;
  }
  const k = Math.hypot(dx / rx, dy / ry);
  return (k - 1) * Math.min(rx, ry);
}
/** Almond / vesica shape: two circle arcs meeting at sharp corners — a cat eye. */
function sdVesica(px, py, cx, cy, w, h, tilt = 0) {
  let dx = px - cx, dy = py - cy;
  if (tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const nx = dx * c + dy * s;
    dy = -dx * s + dy * c;
    dx = nx;
  }
  const R = (w * w + h * h) / (2 * h);
  const up = Math.hypot(dx, dy - (h - R)) - R;      // arc opening upwards
  const dn = Math.hypot(dx, dy + (h - R)) - R;      // arc opening downwards
  return Math.max(up, dn);
}

/** Rounded downward-pointing triangle — the nose leather. */
function sdNose(ax, y, cy, halfW, up, down, round) {
  const dTop = y - (cy + up);
  const ex = halfW, ey = -(up + down);              // edge vector from (halfW, cy+up) to (0, cy-down)
  const len = Math.hypot(ex, ey);
  const dEdge = ((ax - halfW) * -ey - (y - (cy + up)) * ex) / len;
  return Math.max(dTop, dEdge) - round;
}

/** Signed distance to a rounded 2D segment. */
function sdSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy || 1e-12;
  let t = (wx * vx + wy * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(wx - vx * t, wy - vy * t);
}
/** Distance to a quadratic bezier, sampled (cheap, plenty accurate at 0.2 mm/px). */
function sdCurve(px, py, p0, p1, p2, steps = 24) {
  let best = 1e9, prevX = p0[0], prevY = p0[1];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    best = Math.min(best, sdSeg(px, py, prevX, prevY, x, y));
    prevX = x; prevY = y;
  }
  return best;
}

/**
 * @param {object} coat entry from COATS (gives muzzle / liner colours)
 * @param {number} size texture resolution
 * @returns {{size:number, data:Uint8Array, box:typeof FACE_BOX}}
 */
export function buildFaceDecal(coat, size = 512) {
  const data = new Uint8Array(size * size * 4);
  const W = FACE_BOX.x1 - FACE_BOX.x0;
  const H = FACE_BOX.y1 - FACE_BOX.y0;

  const cream = coat.belly;                 // muzzle, chin, eye surround
  const liner = coat.stripe.clone().multiplyScalar(0.28);   // eyelid rim, mouth
  const dark = coat.stripe.clone().multiplyScalar(0.55);    // forehead M, cheek lines

  const F = FACE;
  for (let py = 0; py < size; py++) {
    const y = FACE_BOX.y0 + ((py + 0.5) / size) * H;        // row 0 = bottom
    for (let px = 0; px < size; px++) {
      const x = FACE_BOX.x0 + ((px + 0.5) / size) * W;
      const ax = Math.abs(x);

      let r = 0, g = 0, b = 0, a = 0;
      const paint = (col, alpha) => {
        if (alpha <= 0) return;
        const k = alpha * (1 - a);
        r += col.r * k; g += col.g * k; b += col.b * k; a += k;
      };

      // Compositing is FRONT-to-BACK: the finest detail is painted first and
      // broad washes only fill whatever alpha is left, so nothing gets buried.
      const eyeD = sdVesica(ax, y, F.eye.x, F.eye.y, F.eye.rx, F.eye.ry, F.eye.tilt);
      const noseD = sdNose(ax, y, F.nose.y, 0.0092, 0.0046, 0.0064, 0.0022);

      // ---- eyelid rim: heavier on the upper lid, like eyeliner ---------------
      // thickness ramps smoothly from the lower lid to the upper lid (no seam)
      const lidY = -(ax - F.eye.x) * Math.sin(F.eye.tilt) + (y - F.eye.y) * Math.cos(F.eye.tilt);
      const rimW = 0.0011 + 0.0012 * smoothstep(-0.0060, 0.0050, lidY);
      paint(liner, 0.97 * (1 - smoothstep(rimW * 0.5, rimW, Math.abs(eyeD + 0.0005))));
      // dark interior, so any sliver around the eyeball still reads as an eye
      paint(dark, 0.45 * (1 - smoothstep(-0.0014, 0.0002, eyeD)));

      // ---- philtrum + omega shaped mouth ------------------------------------
      paint(liner, 0.55 * (1 - smoothstep(0.0005, 0.0012,
        sdSeg(x, y, 0, F.philtrum.top, 0, F.philtrum.bottom))));
      paint(liner, 0.62 * (1 - smoothstep(0.0006, 0.0015, sdCurve(ax, y,
        [0.0, F.philtrum.bottom],
        [0.0074, F.philtrum.bottom + 0.0006],
        [F.mouthCorner.x, F.mouthCorner.y]))));

      // ---- nose leather ------------------------------------------------------
      paint(liner, 0.80 * (1 - smoothstep(0.0004, 0.0013,
        sdSeg(ax, y, 0.0030, F.nose.y + 0.0018, 0.0050, F.nose.y - 0.0008))));  // nostril
      paint(liner, 0.55 * (1 - smoothstep(0.0004, 0.0013, Math.abs(noseD))));   // rim
      paint(coat.nose, 0.96 * (1 - smoothstep(-0.0006, 0.0006, noseD)));

      // ---- whisker follicle dots --------------------------------------------
      let dots = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const j = Math.sin((row * 7 + col * 3) * 12.9898) * 43758.5453;
          const dx = 0.0050 + col * 0.0040 + row * 0.0013 + (j - Math.floor(j) - 0.5) * 0.0018;
          const k = Math.sin((row * 5 + col * 11) * 78.233) * 43758.5453;
          const dy = F.pad.y + 0.0042 - row * 0.0037 + (k - Math.floor(k) - 0.5) * 0.0016;
          dots = Math.max(dots, 1 - smoothstep(0.0004, 0.0010, Math.hypot(ax - dx, y - dy)));
        }
      }
      paint(dark, 0.38 * dots);

      // ---- forehead "M" and cheek striping -----------------------------------
      {
        const fade = smoothstep(0.2962, 0.3022, y) * (1 - smoothstep(F.browTop - 0.014, F.browTop - 0.002, y));
        let m = 0;
        for (const [bx, w] of [[0.0032, 0.0048], [0.0134, 0.0050], [0.0232, 0.0044], [0.0320, 0.0034]]) {
          const lean = (y - 0.3040) * 0.28;
          m = Math.max(m, 1 - smoothstep(w * 0.40, w * 0.92, Math.abs(ax - (bx + lean))));
        }
        paint(dark, 0.74 * m * fade * coat.stripes);
      }
      paint(dark, 0.50 * coat.stripes * (1 - smoothstep(0.0012, 0.0031,
        sdCurve(ax, y, [0.0350, 0.2872], [0.0424, 0.2936], [0.0470, 0.3040]))));
      paint(dark, 0.26 * coat.stripes * (1 - smoothstep(0.0014, 0.0038,
        sdCurve(ax, y, [0.0338, 0.2760], [0.0392, 0.2686], [0.0388, 0.2588]))));
      // soft shading down the bridge of the nose
      paint(dark, 0.18 * (1 - smoothstep(0.0020, 0.0075, Math.abs(ax - 0.0092)))
        * smoothstep(0.2600, 0.2700, y) * (1 - smoothstep(0.2760, 0.2870, y)));

      // ---- pale fur washes: eye surround, muzzle pads, chin -------------------
      const vertical = 0.45 + 0.55 * Math.min(1, Math.abs(y - F.eye.y) / 0.012);
      paint(cream, 0.42 * vertical * (1 - smoothstep(0.0030, 0.0110, eyeD)));
      const padD = Math.min(
        sdEllipse(ax, y, F.pad.x, F.pad.y, F.pad.rx, F.pad.ry),
        sdEllipse(x, y, F.chin.x, F.chin.y, F.chin.rx, F.chin.ry),
      );
      paint(cream, 0.80 * (1 - smoothstep(-0.0012, 0.0022, padD)));

      const i = (py * size + px) * 4;
      const inv = a > 0 ? 1 / a : 0;
      data[i] = Math.round(clamp01(r * inv) * 255);
      data[i + 1] = Math.round(clamp01(g * inv) * 255);
      data[i + 2] = Math.round(clamp01(b * inv) * 255);
      data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return { size, data, box: FACE_BOX };
}

/** Sample the decal at a rest-space position. Used by the offline previewer. */
export function sampleFaceDecal(decal, x, y) {
  const { box, size, data } = decal;
  const u = (x - box.x0) / (box.x1 - box.x0);
  const v = (y - box.y0) / (box.y1 - box.y0);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const px = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
  const py = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
  const i = (py * size + px) * 4;
  const a = data[i + 3] / 255;
  if (a <= 0.002) return null;
  return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, a];
}
