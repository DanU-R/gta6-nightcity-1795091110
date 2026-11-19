// The game's rules and state, with no drawing and no browser in it: the city, the player on
// foot or in a car, traffic, pedestrians, police, bullets, particles, the wanted level and the
// three missions. step() advances one fixed step from the player's intent and returns an event
// bit-flag word so the caller (loop, audio) can react without the world knowing about screens.
import {
  BLOCK_PITCH, BULLET, CAR, CITY, MISSIONS, PED, PLAYER, POLICE, STEP, TRAFFIC, WANTED,
  blockInner, roadStart,
} from './config.js';
import { generateCity } from './city.js';
import { approach, clamp, dist, turnToward } from './math.js';

// --- events returned by step() ----------------------------------------------
export const EV_NONE = 0;
export const EV_SHOT = 1 << 0;
export const EV_HIT = 1 << 1;
export const EV_KILL = 1 << 2;
export const EV_CRASH = 1 << 3;
export const EV_EXPLODE = 1 << 4;
export const EV_CASH = 1 << 5;
export const EV_MISSION = 1 << 6;
export const EV_BUSTED = 1 << 7;
export const EV_WASTED = 1 << 8;
export const EV_STEAL = 1 << 9;
export const EV_WIN = 1 << 10;
export const EV_ENTER = 1 << 11;
export const EV_PANIC = 1 << 12;

const CAR_LEN = CAR.length;
const CAR_WID = CAR.width;

/** A car's oriented bounding box, approximated by its four corners (for collisions). */
function carCorners(car) {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const hx = CAR_LEN / 2;
  const hy = CAR_WID / 2;
  return [
    [car.x + c * hx - s * hy, car.y + s * hx + c * hy],
    [car.x + c * hx + s * hy, car.y + s * hx - c * hy],
    [car.x - c * hx + s * hy, car.y - s * hx - c * hy],
    [car.x - c * hx - s * hy, car.y - s * hx + c * hy],
  ];
}

export function createWorld(random) {
  const city = generateCity(random);
  const buildingRects = city.buildings;

  // --- entity pools --------------------------------------------------------
  const cars = [];
  const peds = [];
  const bullets = [];
  const particles = [];
  const police = [];

  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    angle: -Math.PI / 2,
    health: PLAYER.health,
    car: null,            // the Car the player is driving, or null (on foot)
    radius: PLAYER.radius,
    fireCooldown: 0,
    panicGlow: 0,
  };

  const state = {
    player,
    city,
    cars, peds, bullets, particles, police,
    time: 0,
    wanted: 0,
    wantedTimer: 0,       // counts up while there is no fresh crime
    decayTimer: 0,
    cash: 0,
    cashPop: 0,           // >0 while the cash counter should pop
    missionIndex: 0,
    missionState: 'brief', // 'brief' | 'active' | 'complete'
    missionMarker: null,
    missionTimer: 0,
    copSpawnTimer: 0,
    nearestSiren: 0,      // 0..1 for the audio
    camera: { x: 0, y: 0 },
    bustProgress: 0,      // 0..1 while a cop is busting you
    busted: false,
    wasted: false,
    won: false,
    screenShake: 0,
    events: EV_NONE,
    // cached autopilot target for screenshots
    _auto: null,
  };

  // --- spawn helpers -------------------------------------------------------
  function randomRoadPosition() {
    const vertical = random() < 0.5;
    const k = Math.floor(random() * (CITY.blocks + 1));
    const base = roadStart(k);
    const lane = base + CITY.roadWidth / 2 + (random() < 0.5 ? -15 : 15);
    const along = random() * CITY.size;
    return vertical ? { x: lane, y: along, dir: 0, vertical } : { x: along, y: lane, dir: Math.PI / 2, vertical };
  }

  function makeCar(traffic) {
    const p = randomRoadPosition();
    const dir = p.vertical ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (random() < 0.5 ? 0 : Math.PI);
    return {
      x: p.x, y: p.y,
      vx: 0, vy: 0,
      angle: p.vertical ? Math.PI / 2 : 0,
      dir,
      speed: 0,
      maxSpeed: traffic ? TRAFFIC.maxSpeed - random() * TRAFFIC.speedVariance : CAR.maxSpeed,
      color: CAR_COLORS[Math.floor(random() * CAR_COLORS.length)],
      traffic,
      alive: true,
      destroyed: 0,        // >0 = explosion anim timer
      braking: false,
      turnSmoke: 0,
      siren: 0,            // >0 while siren lights flash (police)
      isPolice: false,
      driver: true,        // occupied (stealable)
      health: 100,
      lane: p.vertical ? 'v' : 'h',
      axis: p.vertical ? 'v' : 'h',
      cooldown: 0,
    };
  }

  const CAR_COLORS = ['#e05263', '#f2a541', '#4fb3e8', '#7dc35a', '#b07de0', '#e8e8e8', '#4a4a58', '#2f8f9a'];

  function spawnTraffic() {
    for (let i = 0; i < TRAFFIC.count; i += 1) {
      const car = makeCar(true);
      // Place traffic away from the player's start.
      cars.push(car);
    }
  }

  function spawnPed() {
    // Place on a sidewalk ring around a random block.
    const bi = Math.floor(random() * CITY.blocks);
    const bj = Math.floor(random() * CITY.blocks);
    const ix = blockInner(bi);
    const iy = blockInner(bj);
    const side = Math.floor(random() * 4);
    let x;
    let y;
    const m = 12 + random() * (CITY.blockSize - 24);
    if (side === 0) { x = ix - CITY.sidewalk / 2; y = iy + m; }
    else if (side === 1) { x = ix + CITY.blockSize + CITY.sidewalk / 2; y = iy + m; }
    else if (side === 2) { x = ix + m; y = iy - CITY.sidewalk / 2; }
    else { x = ix + m; y = iy + CITY.blockSize + CITY.sidewalk / 2; }
    const speed = PED.walkSpeed * (0.7 + random() * 0.6);
    const angle = Math.floor(random() * 4) * (Math.PI / 2) + (random() - 0.5) * 0.4;
    peds.push({
      x, y,
      angle,
      speed,
      baseSpeed: speed,
      color: PED_COLORS[Math.floor(random() * PED_COLORS.length)],
      panic: 0,
      panicDir: 0,
      phase: random() * Math.PI * 2,
      walkT: 0,
      alive: true,
      hitFlash: 0,
      home: { x, y },
      // wander box
      wx: x, wy: y, wt: 1 + random() * 3,
    });
  }

  const PED_COLORS = ['#e85d75', '#f2a541', '#4fb3e8', '#8e6fd4', '#5fcf80', '#ef7bb0', '#d8d8d8'];

  // --- mission / wanted ----------------------------------------------------
  function startMission(i) {
    state.missionIndex = i;
    state.missionState = 'active';
    state.missionTimer = 0;
    const m = MISSIONS[i];
    if (m.target) {
      const bx = blockInner(Math.min(CITY.blocks - 1, Math.floor(m.target.x)));
      const by = blockInner(Math.min(CITY.blocks - 1, Math.floor(m.target.y)));
      const fx = (m.target.x - Math.floor(m.target.x)) * CITY.blockSize;
      const fy = (m.target.y - Math.floor(m.target.y)) * CITY.blockSize;
      state.missionMarker = { x: bx + fx, y: by + fy, kind: i === 1 ? 'escape' : 'goto' };
    } else {
      state.missionMarker = { x: player.x, y: player.y, kind: 'escape' };
    }
  }

  function completeMission() {
    const m = MISSIONS[state.missionIndex];
    state.cash += m.reward;
    state.cashPop = 1.2;
    state.missionState = 'complete';
    state.missionTimer = 0;
    state.events |= EV_CASH | EV_MISSION;
    // clear some heat as a reward
    state.wanted = Math.max(0, state.wanted - 1);
    state.missionMarker = null;
  }

  function addWanted(n) {
    state.wanted = clamp(state.wanted + n, 0, WANTED.max);
    state.wantedTimer = 0;
    state.decayTimer = 0;
    spawnPoliceForWanted();
  }

  function spawnPoliceForWanted() {
    const want = state.wanted;
    while (police.length < want * POLICE.spawnPerStar) {
      // Spawn a cruiser at a road position away from the player.
      let best = null;
      let bestD = -1;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const p = randomRoadPosition();
        const d = dist(p.x, p.y, player.x, player.y);
        if (d > bestD && d > 380) { bestD = d; best = p; }
      }
      const car = makeCar(false);
      car.x = best.x;
      car.y = best.y;
      car.isPolice = true;
      car.color = POLICE_BODY;
      car.maxSpeed = POLICE.maxSpeed;
      car.siren = 1;
      car.dir = best.vertical ? Math.PI / 2 : 0;
      car.angle = best.vertical ? Math.PI / 2 : 0;
      police.push(car);
      cars.push(car);
    }
  }

  const POLICE_BODY = '#20242f';

  function removePolice() {
    for (let i = police.length - 1; i >= 0; i -= 1) {
      const p = police[i];
      const idx = cars.indexOf(p);
      if (idx >= 0) cars.splice(idx, 1);
      police.splice(i, 1);
    }
  }

  // --- reset ---------------------------------------------------------------
  function reset() {
    cars.length = 0;
    peds.length = 0;
    bullets.length = 0;
    particles.length = 0;
    police.length = 0;
    // Player starts on a central road intersection.
    const mid = CITY.blocks / 2;
    const cx = roadStart(Math.floor(mid)) + CITY.roadWidth / 2;
    const cy = roadStart(Math.floor(mid)) + CITY.roadWidth / 2;
    player.x = cx;
    player.y = cy;
    player.vx = 0;
    player.vy = 0;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.car = null;
    player.fireCooldown = 0;
    player.panicGlow = 0;
    state.time = 0;
    state.wanted = 0;
    state.wantedTimer = 0;
    state.decayTimer = 0;
    state.cash = 0;
    state.cashPop = 0;
    state.missionIndex = 0;
    state.missionState = 'brief';
    state.missionMarker = null;
    state.missionTimer = 0;
    state.copSpawnTimer = 0;
    state.nearestSiren = 0;
    state.camera.x = cx;
    state.camera.y = cy;
    state.bustProgress = 0;
    state.busted = false;
    state.wasted = false;
    state.won = false;
    state.screenShake = 0;
    spawnTraffic();
    for (let i = 0; i < PED.count; i += 1) spawnPed();
  }

  // --- collision with buildings -------------------------------------------
  function collidesBuildings(x, y, r) {
    for (let i = 0; i < buildingRects.length; i += 1) {
      const b = buildingRects[i];
      // Quick reject.
      if (x + r < b.x || x - r > b.x + b.w || y + r < b.y || y - r > b.y + b.h) continue;
      // Circle vs AABB.
      const nx = clamp(x, b.x, b.x + b.w);
      const ny = clamp(y, b.y, b.y + b.h);
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return b;
    }
    return null;
  }

  // --- on-foot movement ----------------------------------------------------
  function movePlayerFoot(intent, dt) {
    let mx = intent.x;
    let my = intent.y;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    const sprint = intent.sprint ? PLAYER.sprint : 1;
    const speed = PLAYER.speed * sprint;
    let nx = player.x + mx * speed * dt;
    let ny = player.y + my * speed * dt;
    // Axis-separated collision against buildings + world bounds.
    const margin = player.radius;
    nx = clamp(nx, margin, CITY.size - margin);
    if (!collidesBuildings(nx, player.y, player.radius)) player.x = nx;
    ny = clamp(ny, margin, CITY.size - margin);
    if (!collidesBuildings(player.x, ny, player.radius)) player.y = ny;
    if (mag > 0.01) player.angle = Math.atan2(my, mx);
    player.panicGlow = approach(player.panicGlow, 0, dt * 2);
  }

  // --- car physics ---------------------------------------------------------
  function drivePlayerCar(intent, dt) {
    const car = player.car;
    if (!car) return;
    const throttle = intent.y < 0 ? 1 : intent.y > 0 ? -1 : 0; // up=forward
    const steer = intent.x;
    const fwdX = Math.cos(car.angle);
    const fwdY = Math.sin(car.angle);
    const fwdSpeed = car.vx * fwdX + car.vy * fwdY;

    // Acceleration / braking / reverse.
    if (throttle > 0) {
      if (fwdSpeed < -5) {
        car.vx += fwdX * CAR.brake * dt;
        car.vy += fwdY * CAR.brake * dt;
        car.braking = true;
      } else {
        car.vx += fwdX * CAR.accel * dt;
        car.vy += fwdY * CAR.accel * dt;
        car.braking = false;
      }
    } else if (throttle < 0) {
      if (fwdSpeed > 5) {
        car.vx -= fwdX * CAR.brake * dt;
        car.vy -= fwdY * CAR.brake * dt;
        car.braking = true;
      } else {
        car.vx -= fwdX * CAR.accel * 0.6 * dt;
        car.vy -= fwdY * CAR.accel * 0.6 * dt;
        car.braking = false;
      }
    } else {
      // Engine drag slows toward zero.
      const drag = CAR.drag * dt;
      const sp = Math.hypot(car.vx, car.vy);
      if (sp > 0) {
        const k = Math.max(0, sp - drag) / sp;
        car.vx *= k;
        car.vy *= k;
      }
      car.braking = false;
    }

    // Steering scales with speed; reverse steering when going backwards.
    const sp = Math.hypot(car.vx, car.vy);
    if (sp > 6) {
      const dirSign = fwdSpeed >= 0 ? 1 : -1;
      const turn = steer * CAR.turnRate * dirSign * clamp(sp / 160, 0.25, 1) * dt;
      const na = car.angle + turn;
      // Lateral grip: split velocity into forward (kept) and lateral (damped).
      const c = Math.cos(na);
      const s = Math.sin(na);
      let f = car.vx * c + car.vy * s;
      let l = -car.vx * s + car.vy * c;
      l *= CAR.grip;
      // Handbrake-ish drift on very hard turns at speed.
      if (Math.abs(steer) > 0.6 && sp > 220) {
        l *= 0.9;
        car.turnSmoke = Math.max(car.turnSmoke, 0.3);
      }
      car.vx = c * f - s * l;
      car.vy = s * f + c * l;
      car.angle = na;
    }

    // Speed cap.
    const maxF = throttle < 0 ? CAR.reverseSpeed : car.maxSpeed;
    const newSp = Math.hypot(car.vx, car.vy);
    if (newSp > maxF) {
      const k = maxF / newSp;
      car.vx *= k;
      car.vy *= k;
    }

    // Integrate + collide with buildings (bounce).
    let nx = car.x + car.vx * dt;
    let ny = car.y + car.vy * dt;
    nx = clamp(nx, CAR_LEN / 2, CITY.size - CAR_LEN / 2);
    ny = clamp(ny, CAR_LEN / 2, CITY.size - CAR_LEN / 2);
    const hit = collidesBuildings(nx, ny, CAR_WID * 0.72);
    if (hit) {
      // Reflect velocity with heavy damping.
      car.vx *= -0.35;
      car.vy *= -0.35;
      if (sp > 140) { state.events |= EV_CRASH; state.screenShake = Math.max(state.screenShake, clamp(sp / 400, 0.2, 0.9)); }
    } else {
      car.x = nx;
      car.y = ny;
    }

    // Player follows the car.
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;

    // Tyre smoke.
    if (car.turnSmoke > 0) {
      car.turnSmoke -= dt;
      if (random() < 0.6) {
        spawnSmoke(car.x - Math.cos(car.angle) * 24, car.y - Math.sin(car.angle) * 24);
      }
    }
  }

  // --- particles -----------------------------------------------------------
  function spawnSmoke(x, y) {
    if (particles.length > 320) return;
    particles.push({
      kind: 'smoke', x, y,
      vx: (random() - 0.5) * 30, vy: (random() - 0.5) * 30,
      life: 0.6 + random() * 0.4, maxLife: 1.0, size: 6 + random() * 8,
    });
  }

  function spawnSpark(x, y, color, n) {
    for (let i = 0; i < n; i += 1) {
      if (particles.length > 380) return;
      const a = random() * Math.PI * 2;
      const sp = 60 + random() * 220;
      particles.push({
        kind: 'spark', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.3 + random() * 0.4, maxLife: 0.7,
        size: 2 + random() * 3, color,
      });
    }
  }

  function spawnExplosion(x, y) {
    for (let i = 0; i < 40; i += 1) {
      if (particles.length > 420) break;
      const a = random() * Math.PI * 2;
      const sp = 40 + random() * 320;
      particles.push({
        kind: i % 3 === 0 ? 'smoke' : 'spark',
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + random() * 0.7, maxLife: 1.2,
        size: i % 3 === 0 ? 14 + random() * 20 : 3 + random() * 4,
        color: i % 3 === 0 ? '#555' : (random() < 0.5 ? '#ff8a3a' : '#ffd34d'),
      });
    }
  }

  // --- shooting ------------------------------------------------------------
  function tryShoot(dt) {
    player.fireCooldown -= dt;
    if (player.fireCooldown > 0) return false;
    if (player.car) {
      // Drive-by is allowed but less accurate.
    }
    player.fireCooldown = PLAYER.fireRate;
    const a = player.angle;
    const muzzleX = player.x + Math.cos(a) * 18;
    const muzzleY = player.y + Math.sin(a) * 18;
    bullets.push({
      x: muzzleX, y: muzzleY,
      vx: Math.cos(a) * BULLET.speed + (player.car ? player.car.vx * 0.5 : 0),
      vy: Math.sin(a) * BULLET.speed + (player.car ? player.car.vy * 0.5 : 0),
      life: BULLET.life,
      px: muzzleX, py: muzzleY,
      fromPlayer: true,
    });
    // Muzzle flash particle.
    particles.push({
      kind: 'flash', x: muzzleX, y: muzzleY,
      vx: 0, vy: 0, life: 0.05, maxLife: 0.05, size: 10, color: '#ffe08a',
    });
    return true;
  }

  function firePolice(car) {
    if (car.cooldown > 0) return;
    car.cooldown = 0.7 + random() * 0.6;
    const a = Math.atan2(player.y - car.y, player.x - car.x);
    bullets.push({
      x: car.x + Math.cos(a) * 22, y: car.y + Math.sin(a) * 22,
      vx: Math.cos(a) * BULLET.speed * 0.8 + car.vx * 0.4,
      vy: Math.sin(a) * BULLET.speed * 0.8 + car.vy * 0.4,
      life: BULLET.life,
      px: car.x, py: car.y,
      fromPlayer: false,
    });
  }

  // --- update bullets ------------------------------------------------------
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      const b = bullets[i];
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0;
      if (b.x < 0 || b.y < 0 || b.x > CITY.size || b.y > CITY.size) dead = true;
      // Building hit.
      if (!dead) {
        const bh = collidesBuildings(b.x, b.y, 2);
        if (bh) { spawnSpark(b.x, b.y, '#ffd34d', 3); dead = true; }
      }
      if (dead) { bullets.splice(i, 1); continue; }

      if (b.fromPlayer) {
        // Hit cars.
        let hitSomething = false;
        for (let c = 0; c < cars.length; c += 1) {
          const car = cars[c];
          if (!car.alive) continue;
          if (pointInCar(b.x, b.y, car)) {
            damageCar(car, BULLET.damage, true);
            spawnSpark(b.x, b.y, '#ffb347', 4);
            hitSomething = true;
            break;
          }
        }
        if (hitSomething) { bullets.splice(i, 1); continue; }
        // Hit pedestrians (non-lethal flash + panic).
        for (let p = 0; p < peds.length; p += 1) {
          const ped = peds[p];
          if (!ped.alive) continue;
          const dx = b.x - ped.x;
          const dy = b.y - ped.y;
          if (dx * dx + dy * dy < 14 * 14) {
            ped.hitFlash = 0.25;
            ped.panic = PED.panicTime;
            panicNearby(ped.x, ped.y, 120);
            spawnSpark(b.x, b.y, '#ffffff', 3);
            state.events |= EV_HIT;
            bullets.splice(i, 1);
            break;
          }
        }
      } else {
        // Police bullet: hit the player.
        const pr = player.car ? CAR_WID * 0.6 : player.radius;
        const dx = b.x - player.x;
        const dy = b.y - player.y;
        if (dx * dx + dy * dy < (pr + 3) * (pr + 3)) {
          if (player.car) damageCar(player.car, BULLET.damage * 0.7, false);
          else { player.health -= BULLET.damage * 0.6; state.screenShake = Math.max(state.screenShake, 0.35); }
          state.events |= EV_HIT;
          spawnSpark(b.x, b.y, '#ff5a4f', 4);
          if (player.health <= 0) { player.health = 0; state.wasted = true; state.events |= EV_WASTED; }
          bullets.splice(i, 1);
        }
      }
    }
  }

  function pointInCar(x, y, car) {
    const c = Math.cos(-car.angle);
    const s = Math.sin(-car.angle);
    const dx = x - car.x;
    const dy = y - car.y;
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    return Math.abs(lx) < CAR_LEN / 2 && Math.abs(ly) < CAR_WID / 2;
  }

  function damageCar(car, dmg, byPlayer) {
    if (!car.alive) return;
    car.health -= dmg;
    if (car.health <= 0) {
      car.alive = false;
      car.destroyed = 1.2;
      spawnExplosion(car.x, car.y);
      state.events |= EV_EXPLODE;
      state.screenShake = Math.max(state.screenShake, 1.0);
      if (byPlayer) {
        // Destroying cars is a crime.
        addWanted(1);
      }
      if (player.car === car) {
        // Car blew up with the player inside.
        player.car = null;
        player.x = car.x;
        player.y = car.y;
        player.health = 0;
        state.wasted = true;
        state.events |= EV_WASTED;
      }
    }
  }

  // --- pedestrians ---------------------------------------------------------
  function panicNearby(x, y, radius) {
    for (let i = 0; i < peds.length; i += 1) {
      const p = peds[i];
      if (!p.alive) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < radius) {
        p.panic = PED.panicTime;
        p.panicDir = Math.atan2(p.y - y, p.x - x) + (random() - 0.5) * 0.8;
      }
    }
  }

  function updatePeds(dt) {
    for (let i = 0; i < peds.length; i += 1) {
      const p = peds[i];
      if (!p.alive) continue;
      if (p.hitFlash > 0) p.hitFlash -= dt;
      let speed;
      let ang;
      if (p.panic > 0) {
        p.panic -= dt;
        speed = PED.panicSpeed;
        ang = p.panicDir;
        p.walkT += dt * 16;
      } else {
        // Wander within a small box around home.
        p.wt -= dt;
        if (p.wt <= 0) {
          p.wt = 1.5 + random() * 3;
          if (random() < 0.4) p.wander = 0;
          else p.wander = Math.floor(random() * 4) * (Math.PI / 2) + (random() - 0.5) * 0.5;
        }
        if (dist(p.x, p.y, p.home.x, p.home.y) > 70) {
          p.wander = Math.atan2(p.home.y - p.y, p.home.x - p.x);
        }
        ang = p.wander || 0;
        speed = p.panic > 0 ? PED.panicSpeed : p.baseSpeed;
        if (p.wander === 0) speed = 0;
        p.walkT += dt * (speed > 0 ? 8 : 0);
      }
      p.angle = ang;
      if (speed > 0) {
        const nx = p.x + Math.cos(ang) * speed * dt;
        const ny = p.y + Math.sin(ang) * speed * dt;
        // Pedestrians avoid buildings.
        if (!collidesBuildings(nx, p.y, 8)) p.x = nx; else p.panicDir = ang + 1.2;
        if (!collidesBuildings(p.x, ny, 8)) p.y = ny; else p.panicDir = ang + 1.2;
        p.x = clamp(p.x, 6, CITY.size - 6);
        p.y = clamp(p.y, 6, CITY.size - 6);
      }

      // Car proximity panic.
      const pc = nearestCarDist(p.x, p.y);
      if (pc < 60 && p.panic <= 0) {
        p.panic = 0.6;
        p.panicDir = Math.atan2(p.y - nearestCar.y, p.x - nearestCar.x);
      }
    }
  }

  let nearestCar = { x: 0, y: 0 };
  function nearestCarDist(x, y) {
    let best = Infinity;
    for (let i = 0; i < cars.length; i += 1) {
      const c = cars[i];
      if (!c.alive) continue;
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < best) { best = d; nearestCar.x = c.x; nearestCar.y = c.y; }
    }
    return Math.sqrt(best);
  }

  // --- traffic -------------------------------------------------------------
  function updateTraffic(dt) {
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (car.isPolice) continue;      // handled separately
      if (car === player.car) continue; // player-driven
      if (!car.alive) { updateWreck(car, dt); continue; }
      if (!car.traffic) continue;
      updateTrafficCar(car, dt, i);
    }
  }

  function updateWreck(car, dt) {
    if (car.destroyed > 0) car.destroyed -= dt;
    // Wrecks coast to a stop.
    car.vx *= 0.9;
    car.vy *= 0.9;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
  }

  function updateTrafficCar(car, dt, selfIndex) {
    // Follow the current lane: steer toward a target point down the road.
    const axis = car.axis;
    const sp = Math.hypot(car.vx, car.vy);
    const targetSpeed = car.maxSpeed;
    // Accelerate / brake toward target speed.
    const along = axis === 'v' ? car.vy : car.vx;
    const dirSign = Math.sign(along) || 1;

    // Look ahead for the player or a red light to stop for.
    let wantStop = false;
    const lookAhead = 90 + sp * 0.35;
    // Stop for the player if close ahead.
    const pdx = player.x - car.x;
    const pdy = player.y - car.y;
    const forwardDot = pdx * Math.cos(car.angle) + pdy * Math.sin(car.angle);
    const sideDot = Math.abs(-pdx * Math.sin(car.angle) + pdy * Math.cos(car.angle));
    if (forwardDot > 0 && forwardDot < lookAhead && sideDot < 46 && !player.car) wantStop = true;
    // Stop for other cars ahead (simple).
    for (let j = 0; j < cars.length; j += 1) {
      if (j === selfIndex) continue;
      const o = cars[j];
      if (!o.alive || o === player.car) continue;
      const dx = o.x - car.x;
      const dy = o.y - car.y;
      const fdot = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
      const sdot = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
      if (fdot > 10 && fdot < lookAhead && sdot < 40) { wantStop = true; break; }
    }

    let target = targetSpeed;
    if (wantStop) target = 0;
    // Ease speed.
    const cur = Math.hypot(car.vx, car.vy);
    const newSpeed = approach(cur, target, (wantStop ? 420 : 160) * dt);
    if (cur > 0.01) {
      const k = newSpeed / cur;
      car.vx *= k;
      car.vy *= k;
    } else if (newSpeed > 0) {
      car.vx = Math.cos(car.angle) * newSpeed;
      car.vy = Math.sin(car.angle) * newSpeed;
    }
    car.braking = wantStop && cur > 20;

    // Keep in lane: gently steer toward the lane centre-line.
    let laneTarget;
    if (axis === 'v') {
      const k = clamp(Math.round(car.x / BLOCK_PITCH), 0, CITY.blocks);
      const base = roadStart(k);
      const lanes = [base + CITY.roadWidth / 2 - 15, base + CITY.roadWidth / 2 + 15];
      laneTarget = Math.abs(lanes[0] - car.x) < Math.abs(lanes[1] - car.x) ? lanes[0] : lanes[1];
    } else {
      const k = clamp(Math.round(car.y / BLOCK_PITCH), 0, CITY.blocks);
      const base = roadStart(k);
      const lanes = [base + CITY.roadWidth / 2 - 15, base + CITY.roadWidth / 2 + 15];
      laneTarget = Math.abs(lanes[0] - car.y) < Math.abs(lanes[1] - car.y) ? lanes[0] : lanes[1];
    }

    // Desired angle: down the road, biased toward lane centre.
    let desired;
    if (axis === 'v') {
      const laneErr = laneTarget - car.x;
      desired = (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2) - clamp(laneErr / 120, -0.5, 0.5) * dirSign;
    } else {
      const laneErr = laneTarget - car.y;
      desired = (dirSign > 0 ? 0 : Math.PI) + clamp(laneErr / 120, -0.5, 0.5) * dirSign;
    }
    car.angle = turnToward(car.angle, desired, 2.2 * dt);

    // Wrap around the world edges.
    const m = 40;
    if (car.x < -m) car.x = CITY.size + m;
    if (car.x > CITY.size + m) car.x = -m;
    if (car.y < -m) car.y = CITY.size + m;
    if (car.y > CITY.size + m) car.y = -m;

    car.x += car.vx * dt;
    car.y += car.vy * dt;
    // Nudge out of buildings.
    const bh = collidesBuildings(car.x, car.y, CAR_WID * 0.6);
    if (bh) { car.vx *= -0.4; car.vy *= -0.4; }
  }

  // --- police --------------------------------------------------------------
  function updatePolice(dt) {
    // Desired number of cruisers.
    spawnPoliceForWanted();

    // If wanted has decayed to 0, clear them out.
    if (state.wanted === 0 && police.length > 0) {
      // Let them linger a moment then despawn.
      state.copSpawnTimer += dt;
      if (state.copSpawnTimer > 3) { removePolice(); state.copSpawnTimer = 0; }
    }

    let nearestSiren = 0;
    for (let i = 0; i < police.length; i += 1) {
      const car = police[i];
      if (!car.alive) { updateWreck(car, dt); continue; }
      if (car === player.car) continue;
      const d = dist(car.x, car.y, player.x, player.y);
      // Siren volume by proximity.
      const prox = clamp(1 - d / 700, 0, 1);
      if (prox > nearestSiren) nearestSiren = prox;

      if (d < 520) {
        // Steer directly at the player.
        const desired = Math.atan2(player.y - car.y, player.x - car.x);
        car.angle = turnToward(car.angle, desired, POLICE.turnRate * dt);
        // Accelerate.
        const sp = Math.hypot(car.vx, car.vy);
        const newSpeed = approach(sp, d < 160 ? POLICE.speed * 0.5 : POLICE.speed, POLICE.accel * dt);
        if (sp > 0.01) {
          const k = newSpeed / sp;
          car.vx *= k;
          car.vy *= k;
        } else {
          car.vx = Math.cos(car.angle) * newSpeed;
          car.vy = Math.sin(car.angle) * newSpeed;
        }
        // Avoid buildings.
        const bh = collidesBuildings(car.x + car.vx * dt, car.y + car.vy * dt, CAR_WID * 0.7);
        if (bh) { car.angle += 0.9 * dt * 8; }
        car.x += car.vx * dt;
        car.y += car.vy * dt;
        car.x = clamp(car.x, 30, CITY.size - 30);
        car.y = clamp(car.y, 30, CITY.size - 30);

        // Shooting at the player when close and roughly facing them.
        if (d < 340 && Math.abs(Math.cos(car.angle) * (player.x - car.x) + Math.sin(car.angle) * (player.y - car.y)) > 0) {
          const facing = Math.cos(car.angle) * (player.x - car.x) + Math.sin(car.angle) * (player.y - car.y);
          if (facing > 0) firePolice(car);
        }
        car.cooldown -= dt;

        // Busing / ramming the player's car.
        if (player.car && d < 90) {
          // Both nearly stopped close together = boxed in.
          const psp = Math.hypot(player.car.vx, player.car.vy);
          const csp = Math.hypot(car.vx, car.vy);
          if (psp < 40 && csp < 120) {
            state.bustProgress += dt / POLICE.boxTime;
          }
        }
      } else {
        // Cruise toward the player's general area.
        const desired = Math.atan2(player.y - car.y, player.x - car.x);
        car.angle = turnToward(car.angle, desired, 1.2 * dt);
        const sp = Math.hypot(car.vx, car.vy);
        const newSpeed = approach(sp, POLICE.speed * 0.7, POLICE.accel * 0.6 * dt);
        if (sp > 0.01) { const k = newSpeed / sp; car.vx *= k; car.vy *= k; }
        else { car.vx = Math.cos(car.angle) * newSpeed; car.vy = Math.sin(car.angle) * newSpeed; }
        const bh = collidesBuildings(car.x + car.vx * dt, car.y + car.vy * dt, CAR_WID * 0.7);
        if (bh) car.angle += 0.9 * dt * 8;
        car.x += car.vx * dt;
        car.y += car.vy * dt;
        car.cooldown -= dt;
      }
      car.siren = (state.time * 6 + i) % 2;
    }

    state.nearestSiren = state.wanted > 0 ? nearestSiren : 0;

    // Busting on foot: a cop car nearly stopped right next to the player.
    if (!player.car && state.wanted > 0) {
      let busting = false;
      for (let i = 0; i < police.length; i += 1) {
        const car = police[i];
        if (!car.alive) continue;
        const d = dist(car.x, car.y, player.x, player.y);
        const sp = Math.hypot(car.vx, car.vy);
        if (d < POLICE.bustRadius && sp < 50) { busting = true; break; }
      }
      if (busting) {
        state.bustProgress += dt / POLICE.bustTime;
      } else {
        state.bustProgress = Math.max(0, state.bustProgress - dt * 0.8);
      }
    } else if (!player.car) {
      state.bustProgress = Math.max(0, state.bustProgress - dt);
    }

    if (state.bustProgress >= 1 && !state.busted) {
      state.busted = true;
      state.events |= EV_BUSTED;
    }
  }

  // --- wanted decay --------------------------------------------------------
  function updateWanted(dt) {
    if (state.wanted > 0) {
      state.wantedTimer += dt;
      if (state.wantedTimer > WANTED.decayDelay) {
        state.decayTimer += dt;
        if (state.decayTimer > WANTED.decayEvery) {
          state.decayTimer = 0;
          state.wanted -= 1;
          if (state.wanted <= 0) {
            state.wanted = 0;
            state.wantedTimer = 0;
          }
        }
      }
    }
  }

  // --- missions ------------------------------------------------------------
  function updateMissions(dt) {
    state.missionTimer += dt;
    if (state.missionState === 'brief' && state.missionIndex < MISSIONS.length) {
      // Auto-start the first mission after a short beat.
      if (state.missionTimer > 1.2) startMission(0);
      return;
    }
    if (state.missionState === 'active') {
      const marker = state.missionMarker;
      if (!marker) return;
      const m = MISSIONS[state.missionIndex];
      if (m.kind === 'escape' || marker.kind === 'escape') {
        // Complete when wanted is 0.
        if (state.wanted === 0 && state.missionTimer > 4) {
          completeMission();
        }
      } else {
        // Reach the marker.
        const d = dist(player.x, player.y, marker.x, marker.y);
        if (d < 46) {
          if (state.missionIndex === 0) {
            // First mission: reaching triggers a car theft objective.
            completeMission();
          } else {
            completeMission();
          }
        }
      }
    } else if (state.missionState === 'complete') {
      if (state.missionTimer > 3) {
        // Advance to next mission or win.
        if (state.missionIndex + 1 < MISSIONS.length) {
          state.missionIndex += 1;
          state.missionState = 'active';
          state.missionTimer = 0;
          const m = MISSIONS[state.missionIndex];
          if (m.target) {
            const bx = blockInner(Math.min(CITY.blocks - 1, Math.floor(m.target.x)));
            const by = blockInner(Math.min(CITY.blocks - 1, Math.floor(m.target.y)));
            const fx = (m.target.x - Math.floor(m.target.x)) * CITY.blockSize;
            const fy = (m.target.y - Math.floor(m.target.y)) * CITY.blockSize;
            state.missionMarker = { x: bx + fx, y: by + fy, kind: 'goto' };
          } else {
            state.missionMarker = { x: player.x, y: player.y, kind: 'escape' };
          }
        } else {
          state.won = true;
          state.events |= EV_WIN;
        }
      }
    }
  }

  // --- enter / exit car ----------------------------------------------------
  function tryEnterExit() {
    if (player.car) {
      // Exit: place the player beside the car.
      const car = player.car;
      const side = Math.cos(car.angle + Math.PI / 2) >= 0 ? 1 : -1;
      let ex = car.x + Math.cos(car.angle + Math.PI / 2) * (CAR_WID / 2 + player.radius + 4) * side;
      let ey = car.y + Math.sin(car.angle + Math.PI / 2) * (CAR_WID / 2 + player.radius + 4) * side;
      if (collidesBuildings(ex, ey, player.radius)) {
        ex = car.x - Math.cos(car.angle + Math.PI / 2) * (CAR_WID / 2 + player.radius + 4) * side;
        ey = car.y - Math.sin(car.angle + Math.PI / 2) * (CAR_WID / 2 + player.radius + 4) * side;
      }
      player.x = ex;
      player.y = ey;
      car.vx *= 0.3;
      car.vy *= 0.3;
      const wasPolice = car.isPolice;
      const wasTraffic = car.traffic;
      player.car = null;
      state.events |= EV_ENTER;
      // Exiting a stolen car is fine; no new crime.
      if (wasPolice && state.missionIndex === 1 && state.missionState === 'active') {
        // Mission 2 progress: escape on foot counts if wanted clears.
      }
    } else {
      // Enter nearest car within reach.
      let best = null;
      let bestD = 64;
      for (let i = 0; i < cars.length; i += 1) {
        const car = cars[i];
        if (!car.alive) continue;
        const d = dist(player.x, player.y, car.x, car.y);
        if (d < bestD) { bestD = d; best = car; }
      }
      if (best) {
        // Commit the theft.
        player.car = best;
        player.x = best.x;
        player.y = best.y;
        player.angle = best.angle;
        state.events |= EV_ENTER;
        if (best.isPolice) {
          addWanted(2);
          state.events |= EV_STEAL;
        } else if (best.traffic || best.driver) {
          addWanted(1);
          state.events |= EV_STEAL;
          best.traffic = false;
          best.driver = false;
        } else {
          // Empty parked car: no crime.
        }
        // Panic nearby pedestrians.
        panicNearby(best.x, best.y, PED.panicRadius * 0.6);
      }
    }
  }

  // --- camera --------------------------------------------------------------
  function updateCamera(dt) {
    const targetX = player.x;
    const targetY = player.y;
    const k = 1 - Math.pow(0.001, dt); // smooth lerp
    state.camera.x += (targetX - state.camera.x) * k;
    state.camera.y += (targetY - state.camera.y) * k;
    // Clamp so the view stays inside the city (with a little overshoot for edges).
    const half = 640;
    const halfY = 360;
    state.camera.x = clamp(state.camera.x, half, CITY.size - half);
    state.camera.y = clamp(state.camera.y, halfY, CITY.size - halfY);
  }

  // --- particles update ----------------------------------------------------
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'smoke') { p.vx *= 0.96; p.vy *= 0.96; p.size += 18 * dt; }
      else if (p.kind === 'spark') { p.vx *= 0.92; p.vy *= 0.92; }
    }
  }

  // --- main step -----------------------------------------------------------
  function step(dt, intent, harmless) {
    state.events = EV_NONE;
    state.time += dt;
    if (state.screenShake > 0) state.screenShake = Math.max(0, state.screenShake - dt * 2.4);
    if (state.cashPop > 0) state.cashPop = Math.max(0, state.cashPop - dt);

    if (harmless) {
      // Title backdrop: advance traffic and peds for life, but no combat, no cops, no missions.
      updatePeds(dt);
      updateTraffic(dt);
      updateParticles(dt);
      return state.events;
    }

    if (intent.fire && tryShoot(dt)) state.events |= EV_SHOT;
    else player.fireCooldown -= dt;

    if (player.car) drivePlayerCar(intent, dt);
    else movePlayerFoot(intent, dt);

    updateBullets(dt);
    updatePeds(dt);
    updateTraffic(dt);
    updatePolice(dt);
    updateWanted(dt);
    updateMissions(dt);
    updateParticles(dt);
    updateCamera(dt);

    // Destroyed car animation timers.
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (!car.alive && car.destroyed > 0) car.destroyed = Math.max(0, car.destroyed - dt);
    }

    // Pedestrians hit by the player's car.
    if (player.car) {
      const car = player.car;
      const sp = Math.hypot(car.vx, car.vy);
      if (sp > 90) {
        for (let i = 0; i < peds.length; i += 1) {
          const p = peds[i];
          if (!p.alive) continue;
          if (pointInCar(p.x, p.y, car)) {
            p.hitFlash = 0.3;
            p.panic = PED.panicTime;
            panicNearby(p.x, p.y, PED.panicRadius);
            state.events |= EV_PANIC;
            // Nudge them away.
            p.x += Math.cos(car.angle) * 30;
            p.y += Math.sin(car.angle) * 30;
            // Hitting pedestrians with a car raises wanted.
            if (random() < 0.5) addWanted(1);
          }
        }
      }
    }

    return state.events;
  }

  reset();

  return {
    state,
    reset,
    step,
    tryEnterExit,
    startMission,
    addWanted,
    // exposed for the screenshot stager
    _city: city,
    _buildingRects: buildingRects,
    _makeCar: makeCar,
    _spawnTraffic: spawnTraffic,
    _spawnPed: spawnPed,
    _collidesBuildings: collidesBuildings,
    _panicNearby: panicNearby,
    _damageCar: damageCar,
    _carCorners: carCorners,
  };
}