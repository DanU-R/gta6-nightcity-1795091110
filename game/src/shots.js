// The screenshot scenes behind ?shot=start|play|action|map. Each one plays the real
// simulation forward from a fresh world for a fixed number of steps, steered by a small
// autopilot, so the frame is what a real game looks like and the same seed always gives the
// same frame. Returns { screen, snap } for the renderer.
import { STEP } from './config.js';
import { SCREEN_TITLE, SCREEN_PLAY } from './render.js';

const START_SECONDS = 1.5;
const PLAY_SECONDS = 8;
const ACTION_SECONDS = 14;
const MAP_SECONDS = 6;

/** A simple autopilot: walk toward the marker, occasionally grab a nearby car. */
function autopilotOnFoot(world) {
  const s = world.state;
  const p = s.player;
  const m = s.marker;
  const dx = m.x - p.x;
  const dy = m.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d, enter: false, shoot: false };
}

/** Driving autopilot: full throttle, steer toward the marker. */
function autopilotDrive(world) {
  const s = world.state;
  const car = s.player.car;
  const m = s.marker;
  if (!car) return { x: 0, y: 0, enter: false, shoot: false };
  const desired = Math.atan2(m.y - car.y, m.x - car.x);
  let diff = desired - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, diff * 2));
  return { x: steer, y: -1, enter: false, shoot: false }; // y=-1 => throttle forward
}

/** Put the player into the nearest usable car, return true on success. */
function grabCar(world) {
  const s = world.state;
  if (s.player.car) return true;
  // Pick a parked car that is on or near a road (not buried in a block).
  let best = null, bestD = Infinity;
  for (const c of world.cars) {
    if (c.type !== 'parked' || c.dead || c.player) continue;
    const d = Math.hypot(c.x - s.player.x, c.y - s.player.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return false;
  s.player.x = best.x + 24;
  s.player.y = best.y;
  world.step(1/60, { x: 0, y: 0 }, { enter: true, shoot: false });
  return !!s.player.car;
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 *   start  — title screen over a live city backdrop
 *   play   — on foot mid-city, walking toward the first marker
 *   action — driving fast with a wanted level and police in pursuit
 *   map    — a wider feel: driving across town with police and the minimap busy
 */
export function stageShot(name, world) {
  world.reset(false);
  const s = world.state;

  if (name === 'start') {
    for (let i = 0; i < START_SECONDS / STEP; i++) {
      world.step(STEP, autopilotOnFoot(world), { enter: false, shoot: false });
    }
    return { screen: SCREEN_TITLE, snap: true };
  }

  if (name === 'play') {
    for (let i = 0; i < PLAY_SECONDS / STEP; i++) {
      world.step(STEP, autopilotOnFoot(world), { enter: false, shoot: false });
    }
    return { screen: SCREEN_PLAY, snap: true };
  }

  if (name === 'action') {
    // Grab a car, commit a crime so we have a wanted level, then drive for a while.
    grabCar(world);
    s.wanted = 3;
    s.stars = 3;
    s.crimeTimer = 0;
    world.spawnPoliceCar();
    world.spawnPoliceCar();
    for (let i = 0; i < ACTION_SECONDS / STEP; i++) {
      // Keep the scene alive and readable: pin health, wanted and the car so the shot is
      // always a high-speed police chase rather than a respawn.
      if (s.player.health < 100) s.player.health = 100;
      if (s.overlay) { s.overlay = null; s.overlayTimer = 0; grabCar(world); }
      world.step(STEP, autopilotDrive(world), { enter: false, shoot: false });
      s.wanted = Math.max(s.wanted, 3);
      s.stars = Math.max(s.stars, 3);
      s.crimeTimer = 0;
    }
    return { screen: SCREEN_PLAY, snap: true };
  }

  // map (default): a calm drive across town with a bit of wanted heat.
  grabCar(world);
  s.wanted = 1; s.stars = 1; s.crimeTimer = 0;
  for (let i = 0; i < MAP_SECONDS / STEP; i++) {
    world.step(STEP, autopilotDrive(world), { enter: false, shoot: false });
  }
  return { screen: SCREEN_PLAY, snap: true };
}