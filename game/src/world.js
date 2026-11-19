// The whole simulation: the city, the player on foot or behind the wheel, traffic,
// pedestrians, police, the wanted level, missions, bullets and particles. No drawing, no
// DOM. step() advances one fixed step from the player's input and returns what happened as
// bit flags so the caller can react (sound, overlays) without the world knowing about them.
import {
  CAR, CITY, CELL, PED, PLAYER, POLICE, TRAFFIC, WANTED, WORLD, MISSIONS, PALETTE,
} from './config.js';
import { createCity, circleHitsBuildings, boxHitsBuildings } from './city.js';
import { int, pick, range } from './random.js';

export const EVENT_BUSTED = 1;
export const EVENT_WASTED = 2;
export const EVENT_SHOT = 4;
export const EVENT_MISSION = 8;
export const EVENT_CRASH = 16;
export const EVENT_PICKUP = 32;
export const EVENT_STAR = 64;
export const EVENT_SIREN = 128;
export const EVENT_WIN = 256;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

export function createWorld(random) {
  const city = createCity(random);

  // ---- Persistent-ish entities ------------------------------------------
  const player = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, radius: PLAYER.radius,
    health: PLAYER.maxHealth, onFoot: true, car: null, fireCd: 0, hurtCd: 0, walkPhase: 0,
  };
  const cars = [];     // drivable: parked, police, or player-driven (car.player)
  const traffic = [];  // AI lane traffic
  const peds = [];
  const police = [];   // references into cars with type 'police'
  const bullets = [];
  const particles = [];

  const state = {
    player, cars, traffic, peds, police, bullets, particles,
    cash: 0,
    wanted: 0,          // 0..5 float
    stars: 0,           // integer shown on HUD
    crimeTimer: 0,      // seconds since last crime (for decay)
    sirenTimer: 0,
    missionIndex: 0,
    missionPhase: 0,    // 0 = go to marker, 1 = survive countdown (final mission)
    surviveTimer: 0,
    marker: { x: 0, y: 0 },
    objective: { x: 0, y: 0 },
    safehouse: { x: 0, y: 0 },
    shake: 0,
    overlay: null,      // 'BUSTED' | 'WASTED' | 'WIN' | null
    overlayTimer: 0,
    message: '',
    messageTimer: 0,
    elapsed: 0,
    busted: false,
    dead: false,
  };

  // ---- Spawning helpers --------------------------------------------------

  function randomRoadSide() {
    // Returns a point and heading on a random road, for placing cars/peds.
    if (random() < 0.5) {
      const c = int(random, 0, CITY.cols);
      const x = city.roadXs[c];
      const down = random() < 0.5;
      return { x, y: range(random, 0, WORLD.height), vertical: true, dir: down ? 1 : -1, cross: x, road: c };
    }
    const r = int(random, 0, CITY.rows);
    const y = city.roadYs[r];
    const right = random() < 0.5;
    return { x: range(random, 0, WORLD.width), y, vertical: false, dir: right ? 1 : -1, cross: y, road: r };
  }

  function laneOffset() { return (random() < 0.5 ? 1 : -1) * CITY.road * 0.22; }

  function spawnParkedCars() {
    const n = 30;
    for (let i = 0; i < n; i++) {
      const s = randomRoadSide();
      const off = laneOffset();
      const vertical = s.vertical;
      const x = vertical ? s.cross + off : s.x;
      const y = vertical ? s.y : s.cross + off;
      // Skip if colliding with a building.
      if (boxHitsBuildings(city, x, y, vertical ? CAR.height / 2 : CAR.width / 2, vertical ? CAR.width / 2 : CAR.height / 2)) continue;
      const angle = vertical ? (s.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (s.dir > 0 ? 0 : Math.PI);
      cars.push({
        type: 'parked', x, y, angle, vx: 0, vy: 0, speed: 0,
        color: pick(random, PALETTE.carColors), occupied: random() < 0.35,
        w: CAR.width, h: CAR.height, player: false, hp: 100, crashCd: 0, dead: false,
      });
    }
  }

  function spawnTraffic() {
    for (let i = 0; i < TRAFFIC.count; i++) {
      const s = randomRoadSide();
      const dir = s.dir;
      const off = laneOffset();
      const vertical = s.vertical;
      const t = {
        x: vertical ? s.cross + off : s.x,
        y: vertical ? s.y : s.cross + off,
        vertical, dir, road: s.road, off,
        speed: TRAFFIC.speed * range(random, 0.8, 1.2),
        color: pick(random, PALETTE.carColors), angle: 0,
        w: CAR.width, h: CAR.height, crashCd: 0,
      };
      if (vertical) t.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      else t.angle = dir > 0 ? 0 : Math.PI;
      traffic.push(t);
    }
  }

  function spawnPeds() {
    for (let i = 0; i < PED.count; i++) {
      const s = randomRoadSide();
      const vertical = s.vertical;
      const side = random() < 0.5 ? 1 : -1;
      const off = side * (CITY.road / 2 + 4);
      const p = {
        x: vertical ? s.cross + off : s.x,
        y: vertical ? s.y : s.cross + off,
        vertical, dir: s.dir,
        baseX: 0, baseY: 0,
        angle: 0,
        speed: PED.speed * range(random, 0.8, 1.2),
        flee: 0, fleeAngle: 0, panicX: 0, panicY: 0,
        shirt: pick(random, ['#c96f6f', '#6f8fc9', '#c9b06f', '#6fc98a', '#b06fc9', '#cfd4da', '#e0a06f']),
        alive: true, hitCd: 0,
      };
      p.baseX = vertical ? s.cross + off : 0;
      p.baseY = vertical ? 0 : s.cross + off;
      peds.push(p);
    }
  }

  function placeMarker() {
    // Choose intersections well spread across the map for mission markers.
    const ci = clamp(2 + state.missionIndex * 3, 1, CITY.cols - 1);
    const ri = clamp(CITY.rows - 3 - state.missionIndex * 2, 1, CITY.rows - 1);
    return { x: city.roadXs[ci], y: city.roadYs[ri] };
  }

  function placeSafehouse() {
    return { x: city.roadXs[Math.floor(CITY.cols / 2)], y: city.roadYs[Math.floor(CITY.rows / 2)] };
  }

  // ---- Reset / boot ------------------------------------------------------

  function reset(keepCash) {
    const savedCash = keepCash ? state.cash : 0;
    const savedMission = keepCash ? state.missionIndex : 0;
    player.x = city.roadXs[Math.floor(CITY.cols / 2)];
    player.y = city.roadYs[Math.floor(CITY.rows / 2)] + CITY.road / 2 + 6;
    player.vx = 0; player.vy = 0; player.angle = -Math.PI / 2;
    player.health = PLAYER.maxHealth; player.onFoot = true; player.car = null;
    player.fireCd = 0; player.hurtCd = 0;

    cars.length = 0; traffic.length = 0; peds.length = 0; police.length = 0;
    bullets.length = 0; particles.length = 0;
    spawnParkedCars();
    spawnTraffic();
    spawnPeds();

    state.cash = savedCash;
    state.wanted = 0; state.stars = 0; state.crimeTimer = 0; state.sirenTimer = 0;
    state.missionIndex = savedMission;
    state.missionPhase = 0;
    state.surviveTimer = 0;
    state.safehouse = placeSafehouse();
    state.marker = placeMarker();
    state.objective.x = state.marker.x;
    state.objective.y = state.marker.y;
    state.shake = 0;
    state.overlay = null; state.overlayTimer = 0;
    state.message = ''; state.messageTimer = 0;
    state.elapsed = 0;
    state.busted = false; state.dead = false;
  }

  // ---- Particles ---------------------------------------------------------

  function addParticle(x, y, vx, vy, life, color, size) {
    if (particles.length > 220) return;
    particles.push({ x, y, vx, vy, life, maxLife: life, color, size });
  }

  function sparkBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const sp = range(random, 40, 220);
      addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, range(random, 0.2, 0.5), color, range(random, 2, 4));
    }
  }

  function muzzleFlash(x, y, angle) {
    addParticle(x, y, Math.cos(angle) * 60, Math.sin(angle) * 60, 0.08, '#ffe08a', 7);
    for (let i = 0; i < 4; i++) {
      const a = angle + range(random, -0.4, 0.4);
      addParticle(x, y, Math.cos(a) * range(random, 80, 160), Math.sin(a) * range(random, 80, 160), 0.12, '#ffd23f', 3);
    }
  }

  // ---- Wanted level ------------------------------------------------------

  function addCrime(amount) {
    const before = state.stars;
    state.wanted = clamp(state.wanted + amount, 0, WANTED.max);
    state.crimeTimer = 0;
    state.stars = Math.min(WANTED.max, Math.ceil(state.wanted));
    if (state.stars > before) return true;
    return false;
  }

  function spawnPoliceCar() {
    // Spawn just outside the camera view, on a road, aimed roughly at the player.
    const ang = random() * Math.PI * 2;
    const r = POLICE.spawnRadius;
    let x = clamp(player.x + Math.cos(ang) * r, 60, WORLD.width - 60);
    let y = clamp(player.y + Math.sin(ang) * r, 60, WORLD.height - 60);
    // Snap onto the nearest road line so cops drive sensibly.
    let best = Infinity, bx = x, by = y, bv = false;
    for (const rx of city.roadXs) { const d = Math.abs(rx - x); if (d < best) { best = d; bx = rx; by = y; bv = true; } }
    for (const ry of city.roadYs) { const d = Math.abs(ry - y); if (d < best) { best = d; bx = x; by = ry; bv = false; } }
    x = bx; y = by;
    const car = {
      type: 'police', x, y, angle: angleTo(x, y, player.x, player.y),
      vx: 0, vy: 0, speed: 0, color: PALETTE.policeCar,
      w: CAR.width, h: CAR.height, player: false, hp: 100, crashCd: 0, dead: false,
      siren: 0, bust: 0, lightPhase: random() * 10,
    };
    cars.push(car);
    police.push(car);
  }

  // ---- Crimes from combat / collisions ----------------------------------

  function hurtPlayer(amount) {
    if (player.hurtCd > 0 || player.car) return; // in a car, the car takes the hit
    player.health -= amount;
    player.hurtCd = 0.6;
    state.shake = Math.max(state.shake, 7);
    sparkBurst(player.x, player.y, '#ff6b6b', 6);
    if (player.health <= 0) {
      player.health = 0;
      triggerWasted();
    }
  }

  function triggerBusted() {
    if (state.overlay) return;
    state.overlay = 'BUSTED';
    state.overlayTimer = 3.0;
    state.busted = true;
  }

  function triggerWasted() {
    if (state.overlay) return;
    state.overlay = 'WASTED';
    state.overlayTimer = 3.0;
    state.dead = true;
  }

  function respawn() {
    // Lose some cash, drop the wanted level, return to the safehouse on foot.
    state.cash = Math.max(0, Math.round(state.cash * 0.8) - 100);
    state.wanted = 0; state.stars = 0; state.crimeTimer = 0;
    player.x = state.safehouse.x; player.y = state.safehouse.y;
    player.vx = 0; player.vy = 0; player.health = PLAYER.maxHealth;
    player.onFoot = true; player.car = null; player.hurtCd = 1.5;
    // Remove nearby police so the player gets breathing room.
    for (const c of police) c.dead = true;
    police.length = 0;
    state.busted = false; state.dead = false;
    state.overlay = null; state.overlayTimer = 0;
  }

  // ---- Bullets -----------------------------------------------------------

  function fireBullet() {
    const a = player.angle;
    const mx = player.x + Math.cos(a) * 18;
    const my = player.y + Math.sin(a) * 18;
    bullets.push({
      x: mx, y: my, vx: Math.cos(a) * PLAYER.bulletSpeed, vy: Math.sin(a) * PLAYER.bulletSpeed,
      life: PLAYER.bulletLife,
    });
    muzzleFlash(mx, my, a);
    addCrime(0.4);
    if (state.stars > 0) state.shake = Math.max(state.shake, 2);
  }

  // ---- Entering / exiting cars ------------------------------------------

  function nearestEnterableCar() {
    let best = null;
    let bestD = CAR.enterRadius;
    for (const c of cars) {
      if (c.dead || c.player || c.type === 'police') continue;
      const d = dist(player.x, player.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function enterCar(car) {
    player.car = car;
    player.onFoot = false;
    car.player = true;
    if (car.occupied && !car.stolen) {
      // Grand theft auto.
      car.stolen = true;
      if (addCrime(1.0)) return true;
    }
    return false;
  }

  function exitCar() {
    const car = player.car;
    if (!car) return;
    // Place the player beside the car, on a free spot.
    const side = player.angle + Math.PI / 2;
    player.x = car.x + Math.cos(side) * (CAR.width / 2 + 14);
    player.y = car.y + Math.sin(side) * (CAR.width / 2 + 14);
    player.angle = car.angle;
    player.vx = 0; player.vy = 0;
    player.car = null;
    player.onFoot = true;
    car.player = false;
    car.vx *= 0.2; car.vy *= 0.2;
  }

  // ---- Core step ---------------------------------------------------------

  function applyCarPhysics(car, throttle, steer, dt) {
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    let fwd = car.vx * cos + car.vy * sin;
    let lat = -car.vx * sin + car.vy * cos;

    fwd += throttle * CAR.accel * dt;
    if (throttle < 0) fwd = Math.max(fwd, -CAR.reverseSpeed);
    fwd = clamp(fwd, -CAR.reverseSpeed, CAR.maxSpeed);
    if (throttle === 0) fwd *= Math.pow(CAR.friction, dt * 60);
    // Grip: lateral velocity bleeds away.
    lat *= Math.pow(0.001, dt);

    // Steering depends on speed and direction of travel.
    const grip = clamp(Math.abs(fwd) / 140, 0, 1);
    car.angle += steer * CAR.turnRate * dt * grip * (fwd < 0 ? -1 : 1);
    car.angle = normAngle(car.angle);

    const c2 = Math.cos(car.angle);
    const s2 = Math.sin(car.angle);
    car.vx = fwd * c2 - lat * s2;
    car.vy = fwd * s2 + lat * c2;
    car.speed = fwd;

    const nx = car.x + car.vx * dt;
    const ny = car.y + car.vy * dt;
    const halfLen = CAR.width / 2;
    const halfWid = CAR.height / 2;
    if (boxHitsBuildings(city, nx, ny, halfLen, halfWid)) {
      // Crash: stop, shake, sparks.
      car.x += car.vx * dt * 0.2;
      car.y += car.vy * dt * 0.2;
      car.vx *= -0.25; car.vy *= -0.25;
      car.speed *= -0.2;
      if (car.crashCd <= 0 && (Math.abs(fwd) > 120)) {
        car.crashCd = 0.4;
        state.shake = Math.max(state.shake, 8);
        sparkBurst(car.x + c2 * halfLen * Math.sign(fwd || 1), car.y + s2 * halfLen * Math.sign(fwd || 1), '#ffd23f', 8);
        if (car.player) hurtPlayerInCar(6);
        EVENT_CRASH_PENDING = true;
      }
    } else {
      car.x = nx;
      car.y = ny;
    }
    car.x = clamp(car.x, 20, WORLD.width - 20);
    car.y = clamp(car.y, 20, WORLD.height - 20);
  }

  let EVENT_CRASH_PENDING = false;

  function hurtPlayerInCar(amount) {
    player.health -= amount;
    state.shake = Math.max(state.shake, 8);
    if (player.health <= 0) { player.health = 0; triggerWasted(); }
  }

  function updatePlayerOnFoot(dt, move) {
    const speed = PLAYER.speed;
    if (move.x !== 0 || move.y !== 0) {
      player.angle = Math.atan2(move.y, move.x);
      player.walkPhase += dt * 10;
    }
    let nx = player.x + move.x * speed * dt;
    let ny = player.y + move.y * speed * dt;
    // Slide along buildings: try full move, then each axis.
    if (!circleHitsBuildings(city, nx, ny, player.radius)) {
      player.x = nx; player.y = ny;
    } else {
      if (!circleHitsBuildings(city, nx, player.y, player.radius)) player.x = nx;
      if (!circleHitsBuildings(city, player.x, ny, player.radius)) player.y = ny;
    }
    player.x = clamp(player.x, 16, WORLD.width - 16);
    player.y = clamp(player.y, 16, WORLD.height - 16);
  }

  function updatePlayerCar(dt, move) {
    const car = player.car;
    const throttle = -move.y; // up = forward
    const steer = move.x;
    applyCarPhysics(car, throttle, steer, dt);
    player.x = car.x; player.y = car.y; player.angle = car.angle;
  }

  // Where a police car aims: straight at the player. Cops move kinematically (see
  // updatePolice) so they always converge instead of snagging on buildings; they mostly
  // follow roads because the player mostly drives on them.
  function policeTarget(car) {
    return { x: player.x, y: player.y };
  }

  function updatePolice(dt) {
    for (const car of police) {
      if (car.dead) continue;
      car.crashCd -= dt;
      // Kinematic movement along grid waypoints: cops always reach the player instead of
      // getting stuck against buildings. The body angle turns smoothly toward travel for looks.
      const d = dist(car.x, car.y, player.x, player.y);
      const tgt = policeTarget(car);
      const desired = angleTo(car.x, car.y, tgt.x, tgt.y);
      car.angle = car.angle + normAngle(desired - car.angle) * Math.min(1, dt * 8);
      const speed = d < 300 ? POLICE.ramSpeed : POLICE.chaseSpeed;
      const dx = tgt.x - car.x;
      const dy = tgt.y - car.y;
      const seg = Math.hypot(dx, dy);
      if (seg > 0.001) {
        const step = Math.min(seg, speed * dt);
        car.x += (dx / seg) * step;
        car.y += (dy / seg) * step;
      }
      car.vx = seg > 0.001 ? (dx / seg) * speed : 0;
      car.vy = seg > 0.001 ? (dy / seg) * speed : 0;
      car.speed = speed;
      car.x = clamp(car.x, 20, WORLD.width - 20);
      car.y = clamp(car.y, 20, WORLD.height - 20);

      car.lightPhase += dt * 8;

      // Ramming the player's car hurts.
      if (player.car && d < 44) {
        const push = angleTo(car.x, car.y, player.x, player.y);
        player.car.vx += Math.cos(push) * 40;
        player.car.vy += Math.sin(push) * 40;
        if (car.crashCd <= 0) { car.crashCd = 0.5; hurtPlayerInCar(7); sparkBurst((car.x+player.x)/2,(car.y+player.y)/2,'#ffd23f',6); }
      }

      // Busted: close to player on foot and player is slow.
      if (player.onFoot) {
        const pSpeed = Math.hypot(player.vx, player.vy);
        if (d < POLICE.bustRadius && pSpeed < 40) {
          car.bust += dt;
          if (car.bust >= POLICE.bustTime) triggerBusted();
        } else {
          car.bust = Math.max(0, car.bust - dt);
        }
      } else {
        car.bust = 0;
      }
    }
    // Cull dead / far police.
    for (let i = police.length - 1; i >= 0; i--) {
      if (police[i].dead || dist(police[i].x, police[i].y, player.x, player.y) > 2600) {
        police[i].dead = true;
        const idx = cars.indexOf(police[i]);
        if (idx >= 0) cars.splice(idx, 1);
        police.splice(i, 1);
      }
    }
  }

  function updateTraffic(dt) {
    for (const t of traffic) {
      const v = t.speed * t.dir * dt;
      if (t.vertical) {
        t.y += v;
        if (t.y < -40) t.y = WORLD.height + 40;
        if (t.y > WORLD.height + 40) t.y = -40;
      } else {
        t.x += v;
        if (t.x < -40) t.x = WORLD.width + 40;
        if (t.x > WORLD.width + 40) t.x = -40;
      }
      t.crashCd -= dt;
      // Collide with player car.
      if (player.car) {
        const d = dist(t.x, t.y, player.car.x, player.car.y);
        if (d < 34 && t.crashCd <= 0) {
          t.crashCd = 0.6;
          const a = angleTo(t.x, t.y, player.car.x, player.car.y);
          player.car.vx += Math.cos(a) * 30; player.car.vy += Math.sin(a) * 30;
          player.car.vx *= 0.6; player.car.vy *= 0.6;
          hurtPlayerInCar(4);
          state.shake = Math.max(state.shake, 6);
          sparkBurst((t.x + player.car.x) / 2, (t.y + player.car.y) / 2, '#ffd23f', 6);
        }
      }
    }
  }

  function updatePeds(dt) {
    for (const p of peds) {
      if (!p.alive) continue;
      p.hitCd -= dt;
      // Panic if a fast car is close, or a shot just rang out nearby.
      if (p.flee > 0) {
        p.flee -= dt;
        const sp = PED.fleeSpeed;
        p.x += Math.cos(p.fleeAngle) * sp * dt;
        p.y += Math.sin(p.fleeAngle) * sp * dt;
      } else {
        // Check for threats.
        let threatX = 0, threatY = 0, scared = false;
        const ref = player.car || player;
        const refSpeed = player.car ? Math.hypot(player.car.vx, player.car.vy) : Math.hypot(player.vx, player.vy);
        const dp = dist(p.x, p.y, ref.x, ref.y);
        if (dp < PED.fleeRadius && refSpeed > 90) { threatX = ref.x; threatY = ref.y; scared = true; }
        if (scared) {
          p.fleeAngle = angleTo(threatX, threatY, p.x, p.y);
          p.flee = range(random, 0.8, 1.6);
        } else {
          const v = p.speed * p.dir * dt;
          if (p.vertical) {
            p.y += v;
            if (p.y < -20) p.y = WORLD.height + 20;
            if (p.y > WORLD.height + 20) p.y = -20;
          } else {
            p.x += v;
            if (p.x < -20) p.x = WORLD.width + 20;
            if (p.x > WORLD.width + 20) p.x = -20;
          }
        }
      }
      p.x = clamp(p.x, 10, WORLD.width - 10);
      p.y = clamp(p.y, 10, WORLD.height - 10);
      // Run over by player car.
      if (player.car && p.hitCd <= 0) {
        const d = dist(p.x, p.y, player.car.x, player.car.y);
        if (d < 24 && Math.hypot(player.car.vx, player.car.vy) > 80) {
          p.alive = false;
          p.hitCd = 99;
          sparkBurst(p.x, p.y, '#ff8866', 8);
          if (addCrime(1.0)) { /* new star */ }
        }
      }
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const steps = 2; // substep for fast bullets
      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        b.x += b.vx * dt / steps;
        b.y += b.vy * dt / steps;
        // Hit building?
        if (circleHitsBuildings(city, b.x, b.y, 2)) {
          sparkBurst(b.x, b.y, '#cccccc', 3);
          removed = true; break;
        }
        // Hit peds?
        for (const p of peds) {
          if (!p.alive) continue;
          if (dist(b.x, b.y, p.x, p.y) < PED.radius + 2) {
            p.alive = false;
            sparkBurst(p.x, p.y, '#ff8866', 6);
            if (addCrime(0.8)) { /* new star */ }
            removed = true; break;
          }
        }
        if (removed) break;
        // Hit police cars?
        for (const c of police) {
          if (c.dead) continue;
          if (Math.abs(b.x - c.x) < CAR.width / 2 && Math.abs(b.y - c.y) < CAR.height / 2) {
            c.hp -= 34;
            sparkBurst(b.x, b.y, '#ffd23f', 4);
            if (c.hp <= 0) { c.dead = true; sparkBurst(c.x, c.y, '#ff6b3b', 14); addCrime(1.2); }
            removed = true; break;
          }
        }
      }
      if (removed) { bullets.splice(i, 1); continue; }
      b.life -= dt;
      if (b.life <= 0) bullets.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.02, dt);
      p.vy *= Math.pow(0.02, dt);
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateWanted(dt) {
    state.crimeTimer += dt;
    if (state.wanted > 0 && state.crimeTimer > WANTED.decayDelay) {
      state.wanted = Math.max(0, state.wanted - WANTED.decayRate * dt);
    }
    state.stars = Math.min(WANTED.max, Math.ceil(state.wanted - 1e-6));
    if (state.stars < 0) state.stars = 0;

    // Maintain a police presence matching the wanted level.
    state.sirenTimer -= dt;
    const target = state.stars;
    if (police.length < target && state.overlay === null) {
      spawnPoliceCar();
    }
  }

  function updateMissions(dt) {
    const m = MISSIONS[state.missionIndex];
    if (!m) { state.objective = state.safehouse; return; }
    // The objective location depends on the mission: the safehouse mission targets the
    // safehouse, the others target the current marker.
    const targetLoc = m.target === 'safehouse' ? state.safehouse : state.marker;
    state.objective.x = targetLoc.x;
    state.objective.y = targetLoc.y;
    const d = dist(player.x, player.y, targetLoc.x, targetLoc.y);

    if (state.missionPhase === 1) {
      // Survive countdown.
      state.surviveTimer -= dt;
      if (state.surviveTimer <= 0) {
        completeMission();
      }
      return;
    }

    if (m.target === 'car') {
      if (player.car && d < 60) completeMission();
    } else if (m.target === 'safehouse') {
      if (d < 70) {
        // Lay low: reaching the safehouse clears the wanted level.
        state.wanted = 0; state.stars = 0;
        completeMission();
      }
    } else if (m.target === 'survive') {
      if (d < 70) {
        // Reached the docks: start the survive phase, bring the heat.
        state.missionPhase = 1;
        state.surviveTimer = 20;
        state.wanted = Math.max(state.wanted, 3);
        state.stars = Math.max(state.stars, 3);
        setMessage('Hold out for 20 seconds!');
      }
    }
  }

  function completeMission() {
    const m = MISSIONS[state.missionIndex];
    if (!m) return;
    state.cash += m.reward;
    state.missionIndex += 1;
    state.missionPhase = 0;
    setMessage(`Mission complete! +$${m.reward}`, 3.5);
    EVENT_MISSION_FIRED = true;
    if (state.missionIndex >= MISSIONS.length) {
      // All missions done.
      state.overlay = 'WIN';
      state.overlayTimer = 6;
      EVENT_WIN_FIRED = true;
    } else {
      state.marker = placeMarker();
      setMessage(`Next: ${MISSIONS[state.missionIndex].title}`, 4);
    }
  }

  let EVENT_MISSION_FIRED = false;
  let EVENT_WIN_FIRED = false;

  function setMessage(text, time) {
    state.message = text;
    state.messageTimer = time || 2.5;
  }

  // ---- Main step ---------------------------------------------------------

  function step(dt, move, actions) {
    let events = 0;
    EVENT_CRASH_PENDING = false;
    EVENT_MISSION_FIRED = false;
    EVENT_WIN_FIRED = false;
    state.elapsed += dt;

    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 22);
    if (state.messageTimer > 0) {
      state.messageTimer -= dt;
      if (state.messageTimer <= 0) state.message = '';
    }

    // Overlays (BUSTED/WASTED/WIN) freeze the action briefly.
    if (state.overlay) {
      state.overlayTimer -= dt;
      updateParticles(dt);
      if (state.overlayTimer <= 0) {
        if (state.overlay === 'WIN') {
          // Stay on the win screen until restart handled by caller; clear to free roam.
          state.overlay = null;
        } else {
          respawn();
        }
      }
      return events;
    }

    if (player.fireCd > 0) player.fireCd -= dt;
    if (player.hurtCd > 0) player.hurtCd -= dt;

    // Actions: enter/exit, shoot.
    if (actions && (actions.enter)) {
      if (player.car) exitCar();
      else {
        const car = nearestEnterableCar();
        if (car) { const stole = enterCar(car); if (stole && addCrime(0)) {} }
      }
    }
    if (actions && (actions.shoot) && player.onFoot && player.fireCd <= 0) {
      player.fireCd = PLAYER.fireCooldown;
      fireBullet();
      events |= EVENT_SHOT;
      // Gunfire scares nearby peds.
      for (const p of peds) {
        if (p.alive && dist(p.x, p.y, player.x, player.y) < PED.fleeRadius) {
          p.fleeAngle = angleTo(player.x, player.y, p.x, p.y);
          p.flee = range(random, 0.8, 1.6);
        }
      }
    }

    // Player movement.
    state._nearCar = false;
    if (player.car) {
      updatePlayerCar(dt, move);
    } else {
      updatePlayerOnFoot(dt, move);
      player.vx = move.x * PLAYER.speed;
      player.vy = move.y * PLAYER.speed;
      state._nearCar = nearestEnterableCar() !== null;
    }

    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateWanted(dt);
    updateMissions(dt);

    if (EVENT_CRASH_PENDING) events |= EVENT_CRASH;
    if (EVENT_MISSION_FIRED) events |= EVENT_MISSION;
    if (EVENT_WIN_FIRED) events |= EVENT_WIN;
    if (state.busted && state.overlay === 'BUSTED') events |= EVENT_BUSTED;
    if (state.dead && state.overlay === 'WASTED') events |= EVENT_WASTED;

    return events;
  }

  reset(false);

  return {
    state, city, player, cars, traffic, peds, police, bullets, particles,
    reset, step,
    // Helpers used by shots.js to stage scenes.
    spawnPoliceCar,
    setMessage,
    placeMarker,
  };
}