// The two things the human is responsible for: the water bowl and the litter
// tray. Kept apart from the rest of the world so the headless test can drive
// exactly the same code the game runs.
//
// `waterMesh` and `clumps` are optional — pass plain objects with `visible`,
// `scale` and `position` and this still works.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Water left in the bowl evaporates over roughly 23 minutes of cat time. */
export const EVAPORATION_PER_SECOND = 1 / 1400;
/** How much of the tray one visit fouls. */
export const SOIL_PER_VISIT = 0.2;
/** Above this she will not step into the tray. */
export const REFUSAL_SOIL = 0.92;

export function attachSupplies(target, { waterMesh = null, clumps = [] } = {}) {
  // NOTE: Object.assign would evaluate the getters once and copy the *values*,
  // so waterAvailable would freeze at its startup value. Copy descriptors.
  const api = {
    waterLevel: 1,
    litterSoil: 0,
    clumps,

    setWater(v) {
      this.waterLevel = clamp01(v);
      if (!waterMesh) return;
      const l = this.waterLevel;
      waterMesh.visible = l > 0.03;
      // the disc thins and sinks as the bowl empties
      waterMesh.scale.set(0.82 + 0.18 * l, Math.max(0.12, l), 0.82 + 0.18 * l);
      waterMesh.position.y = 0.0265 + 0.0135 * l;
    },
    consumeWater(amount) { this.setWater(this.waterLevel - amount); },
    refillWater() { this.setWater(1); },
    evaporate(dt) { if (this.waterLevel > 0) this.setWater(this.waterLevel - dt * EVAPORATION_PER_SECOND); },
    get waterAvailable() { return this.waterLevel > 0.02; },

    setLitterSoil(v) {
      this.litterSoil = clamp01(v);
      const shown = Math.round(this.litterSoil * this.clumps.length);
      this.clumps.forEach((c, i) => { c.visible = i < shown; });
    },
    soilLitter(amount = SOIL_PER_VISIT) { this.setLitterSoil(this.litterSoil + amount); },
    cleanLitter() { this.setLitterSoil(0); },
    get litterUsable() { return this.litterSoil < REFUSAL_SOIL; },
  };
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(api));
  target.setWater(1);
  target.setLitterSoil(0);
  return target;
}
