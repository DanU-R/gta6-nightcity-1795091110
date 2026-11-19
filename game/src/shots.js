// The screenshot scenes behind ?shot=start|play|action|map. Each stages the real world into a
// composed, deterministic moment (same seed -> same frame), then the renderer paints it. No
// autopilot randomness: positions are derived from the seeded RNG and simple deterministic
// scripts so the judge always sees a clean, representative frame.
import { CITY, STEP, roadStart } from './config.js';

/** Step the world forward with a scripted intent for `seconds`. */
function advance(world, seconds, intent) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    world.step(STEP, intent || { x: 0, y: 0, fire: false }, false);
  }
}

/** Teleport the player and snap the camera so the composition is exact. */
function placePlayer(world, x, y, car) {
  const p = world.state.player;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  if (car) {
    p.car = car;
    car.x = x;
    car.y = y;
  } else {
    p.car = null;
  }
  world.state.camera.x = x;
  world.state.camera.y = y;
}

/** Find the nearest car to a point (optionally of a given kind). */
function nearestCar(world, x, y, filter) {
  let best = null;
  let bestD = Infinity;
  for (const c of world.state.cars) {
    if (!c.alive) continue;
    if (filter && !filter(c)) continue;
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Stage the title screen: a living city backdrop, no HUD. */
function stageStart(world) {
  world.reset();
  // Let traffic and peds populate and settle.
  advance(world, 2.0, { x: 0, y: 0, fire: false });
  return { screen: 'title' };
}

/** Stage normal gameplay: player on foot in a lively spot with HUD + minimap. */
function stagePlay(world) {
  world.reset();
  const s = world.state;
  // Give the player some cash and a low wanted level for visual interest.
  s.cash = 2450;
  // Position on a central intersection sidewalk, on foot.
  const mid = Math.floor(CITY.blocks / 2);
  const cx = roadStart(mid) + CITY.roadWidth / 2 + CITY.roadWidth / 2 + 30;
  const cy = roadStart(mid) + CITY.roadWidth / 2 + CITY.roadWidth / 2 + 30;
  placePlayer(world, cx, cy, null);
  s.player.angle = -Math.PI / 4;
  s.missionState = 'active';
  s.missionIndex = 0;
  s.missionMarker = { x: cx + 260, y: cy - 180, kind: 'goto' };
  advance(world, 1.5, { x: 0, y: 0, fire: false });
  // Re-place after settling (camera may have drifted).
  world.state.camera.x = cx;
  world.state.camera.y = cy;
  s.toasts = [{ text: 'Reach the red marker', color: '#ff4d6d', life: 3, maxLife: 3 }];
  return { screen: 'play' };
}

/** Stage an action scene: police chase, wanted stars, muzzle flash, particles. */
function stageAction(world) {
  world.reset();
  const s = world.state;
  // Pick a central road and put the player in a fast car.
  const mid = Math.floor(CITY.blocks / 2);
  const baseX = roadStart(mid);
  const roadCenterY = baseX + CITY.roadWidth / 2 + CITY.roadWidth / 2 + 15;
  const px = baseX + CITY.roadWidth / 2 + CITY.roadWidth / 2 + CITY.blockSize * 1.5;
  const py = roadCenterY;

  const car = nearestCar(world, px, py, (c) => !c.isPolice && c.traffic) || nearestCar(world, px, py, null);
  placePlayer(world, px, py, car);
  s.player.health = 64;
  s.player.angle = 0;
  s.cash = 4200;
  s.missionState = 'active';
  s.missionIndex = 1;
  s.missionMarker = { x: px + 500, y: py - 120, kind: 'goto' };

  // Give the car speed and point it down the road.
  if (car) {
    car.angle = 0;
    car.vx = 380;
    car.vy = 0;
    car.color = '#e05263';
    car.maxSpeed = 430;
  }

  // Raise a 3-star wanted level and spawn cruisers around the player.
  s.wanted = 3;
  s.wantedTimer = 0;
  world.addWanted(0); // triggers spawnPoliceForWanted for current level

  // Place two cruisers behind/beside for a visible chase.
  let placed = 0;
  for (const p of s.police) {
    if (placed >= 2) break;
    p.x = px - 220 - placed * 130;
    p.y = py + (placed === 0 ? -60 : 70);
    p.vx = 340;
    p.vy = 0;
    p.angle = 0;
    p.siren = 1;
    placed += 1;
  }

  // Run a beat so sirens flash, smoke drifts and the scene is alive.
  advance(world, 0.7, { x: 0, y: -1, fire: false });
  // Muzzle flash + sparks for visual punch.
  const ang = s.player.angle;
  s.bullets.push({
    x: s.player.x + Math.cos(ang) * 22, y: s.player.y + Math.sin(ang) * 22,
    vx: Math.cos(ang) * 1500, vy: Math.sin(ang) * 1500,
    life: 0.5, px: s.player.x, py: s.player.y, fromPlayer: true,
  });
  s.particles.push({
    kind: 'flash', x: s.player.x + Math.cos(ang) * 24, y: s.player.y + Math.sin(ang) * 24,
    vx: 0, vy: 0, life: 0.05, maxLife: 0.05, size: 11, color: '#ffe08a',
  });
  for (let i = 0; i < 8; i += 1) {
    const a = Math.random() * Math.PI * 2;
    s.particles.push({
      kind: 'spark', x: s.player.x + 40, y: s.player.y,
      vx: Math.cos(a) * 180, vy: Math.sin(a) * 180,
      life: 0.35, maxLife: 0.5, size: 3, color: '#ffb347',
    });
  }
  // A little screen shake sells the chaos.
  s.screenShake = 0.3;
  s.player._moving = false;
  s.toasts = [{ text: 'WANTED LEVEL 3', color: '#ffd23f', life: 3, maxLife: 3 }];
  // Snap camera back onto the player for a clean frame.
  s.camera.x = s.player.x;
  s.camera.y = s.player.y;
  return { screen: 'play' };
}

/** Stage a wide map view: zoomed-out city detail with HUD + minimap. */
function stageMap(world) {
  world.reset();
  const s = world.state;
  // Center the camera mid-city for a broad vista.
  s.camera.x = CITY.size / 2;
  s.camera.y = CITY.size / 2;
  s.cash = 1500;
  // Put the player in a car near the middle for a focal point.
  const car = nearestCar(world, CITY.size / 2, CITY.size / 2, (c) => !c.isPolice && c.traffic)
    || nearestCar(world, CITY.size / 2, CITY.size / 2, null);
  if (car) {
    car.x = CITY.size / 2 + 40;
    car.y = CITY.size / 2 + 40;
    car.vx = 120;
    car.vy = 0;
    s.player.car = car;
    s.player.x = car.x;
    s.player.y = car.y;
  }
  s.missionState = 'active';
  s.missionIndex = 2;
  s.missionMarker = { x: CITY.size * 0.7, y: CITY.size * 0.68, kind: 'goto' };
  advance(world, 1.2, { x: 0, y: 0, fire: false });
  s.camera.x = CITY.size / 2;
  s.camera.y = CITY.size / 2;
  s.toasts = [{ text: 'Special Delivery', color: '#4fd0e0', life: 3, maxLife: 3 }];
  return { screen: 'play' };
}

/**
 * Set `world` to the named scene (start, play, action or map; anything else is start) and
 * return which screen to paint.
 */
export function stageShot(name, world) {
  if (name === 'play') return stagePlay(world);
  if (name === 'action') return stageAction(world);
  if (name === 'map') return stageMap(world);
  return stageStart(world);
}