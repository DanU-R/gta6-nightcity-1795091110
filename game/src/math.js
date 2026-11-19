// Small math helpers shared by the simulation, the renderer and the screenshot staging.
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Distance between two points. */
export function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Signed shortest difference between two angles in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Approach value `v` toward target by at most step. */
export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return v;
}

/** Rotate angle `a` toward `b` by at most `max` radians. */
export function turnToward(a, b, max) {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= max) return b;
  return a + Math.sign(d) * max;
}

/** Classful rectangle-vs-rectangle overlap (half-open, strict). */
export function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}