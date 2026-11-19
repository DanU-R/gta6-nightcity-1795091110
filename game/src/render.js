// Drawing only: the world's state and the current screen in, pixels out. A camera follows the
// player, scaled so the 1280x720 logical view fits the window. The world (grass, roads,
// sidewalks, buildings) is drawn with culling to the camera window, then the cars, peds,
// player, bullets and particles, then the HUD (health, stars, cash, minimap) and any overlay.
import { CAR, CITY, CELL, FONT, PALETTE, PED, PLAYER, VIEW, WORLD, MISSIONS } from './config.js';
import { rectsOverlap } from './city.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) { value = next; text = prefix + next; }
    return text;
  };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  const view = { scale: 1, x: 0, y: 0 };
  const camera = { x: 0, y: 0 };
  const cashLabel = cachedLabel('$');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight) {
    const key = size + '|' + (weight || '');
    if (!fonts.has(key)) fonts.set(key, `${weight || ''} ${size}px ${FONT}`.trim());
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function updateCamera(state, snap) {
    const target = state.player;
    const tx = target.x - VIEW.width / 2;
    const ty = target.y - VIEW.height / 2;
    if (snap) {
      camera.x = tx; camera.y = ty;
    } else {
      camera.x = lerp(camera.x, tx, 0.12);
      camera.y = lerp(camera.y, ty, 0.12);
    }
    camera.x = clamp(camera.x, 0, WORLD.width - VIEW.width);
    camera.y = clamp(camera.y, 0, WORLD.height - VIEW.height);
  }

  function drawGround(city) {
    const cx = camera.x;
    const cy = camera.y;
    // Draw in world space: translate by -camera so all the raw world coordinates below
    // (grass, roads, buildings) land on screen. The per-object draws subtract the camera
    // themselves, so only the ground pass is translated here.
    context.save();
    context.translate(-cx, -cy);
    // Grass base.
    context.fillStyle = PALETTE.grass;
    context.fillRect(cx, cy, VIEW.width, VIEW.height);

    // Sidewalk pads + buildings (culled).
    for (const b of city.blocks) {
      if (b.x + b.w < cx || b.x > cx + VIEW.width || b.y + b.h < cy || b.y > cy + VIEW.height) continue;
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(b.x, b.y, b.w, b.h);
    }

    // Roads.
    context.fillStyle = PALETTE.road;
    for (const r of city.roadRects) {
      if (r.x + r.w < cx || r.x > cx + VIEW.width || r.y + r.h < cy || r.y > cy + VIEW.height) continue;
      context.fillRect(r.x, r.y, r.w, r.h);
    }

    // Lane markings (dashed centre lines).
    context.strokeStyle = PALETTE.roadLine;
    context.lineWidth = 2;
    context.setLineDash([14, 16]);
    for (const x of city.roadXs) {
      if (x < cx || x > cx + VIEW.width) continue;
      context.beginPath();
      context.moveTo(x, Math.max(cy, 0));
      context.lineTo(x, Math.min(cy + VIEW.height, WORLD.height));
      context.stroke();
    }
    for (const y of city.roadYs) {
      if (y < cy || y > cy + VIEW.height) continue;
      context.beginPath();
      context.moveTo(Math.max(cx, 0), y);
      context.lineTo(Math.min(cx + VIEW.width, WORLD.width), y);
      context.stroke();
    }
    context.setLineDash([]);

    // Buildings with a faux-height roof.
    for (const b of city.buildings) {
      if (b.x + b.w < cx || b.x > cx + VIEW.width || b.y + b.h < cy || b.y > cy + VIEW.height) continue;
      // Drop shadow.
      context.fillStyle = 'rgba(0,0,0,0.28)';
      context.fillRect(b.x + 5, b.y + 6, b.w, b.h);
      // Body.
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      // Roof (top strip) for a height illusion.
      context.fillStyle = b.roof;
      context.fillRect(b.x, b.y, b.w, Math.min(16, b.h));
      // Windows.
      context.fillStyle = PALETTE.window;
      for (const w of b.windows) {
        if (w.x < cx || w.x > cx + VIEW.width || w.y < cy || w.y > cy + VIEW.height) continue;
        context.fillRect(w.x, w.y, 6, 6);
      }
    }
    context.restore();
  }

  function drawCar(car, isPolice, lightPhase) {
    context.save();
    context.translate(car.x - camera.x, car.y - camera.y);
    context.rotate(car.angle);
    const w = CAR.width, h = CAR.height;
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
    // Body.
    context.fillStyle = car.color;
    roundRect(-w / 2, -h / 2, w, h, 6);
    context.fill();
    // Windshield.
    context.fillStyle = 'rgba(180,220,255,0.55)';
    context.fillRect(w * 0.08, -h / 2 + 4, w * 0.22, h - 8);
    if (isPolice) {
      // Light bar flashing.
      const on = Math.floor(lightPhase) % 2 === 0;
      context.fillStyle = on ? PALETTE.copLight : '#551010';
      context.fillRect(-4, -h / 2 - 3, 8, 5);
      context.fillStyle = !on ? PALETTE.copLight2 : '#101a55';
      context.fillRect(-4, h / 2 - 2, 8, 5);
    }
    // Damage tint if the player's car is wrecked-looking (hp low).
    if (!isPolice && car.player && car.hp < 50) {
      context.fillStyle = 'rgba(30,30,30,0.35)';
      roundRect(-w / 2, -h / 2, w, h, 6);
      context.fill();
    }
    context.restore();
  }

  function drawPed(p) {
    if (!p.alive) {
      // A faint chalk mark where a ped fell — non-graphic.
      context.fillStyle = 'rgba(255,255,255,0.18)';
      context.beginPath();
      context.arc(p.x - camera.x, p.y - camera.y, PED.radius, 0, Math.PI * 2);
      context.fill();
      return;
    }
    const x = p.x - camera.x;
    const y = p.y - camera.y;
    if (x < -20 || y < -20 || x > VIEW.width + 20 || y > VIEW.height + 20) return;
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.beginPath();
    context.arc(x + 2, y + 3, PED.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = p.shirt;
    context.beginPath();
    context.arc(x, y, PED.radius, 0, Math.PI * 2);
    context.fill();
    // Head.
    context.fillStyle = '#e8c9a0';
    context.beginPath();
    context.arc(x, y - 2, PED.radius * 0.5, 0, Math.PI * 2);
    context.fill();
    if (p.flee > 0) {
      // Panic mark.
      context.fillStyle = PALETTE.danger;
      context.fillRect(x - 1, y - PED.radius - 12, 3, 8);
      context.fillRect(x - 1, y - PED.radius - 2, 3, 3);
    }
  }

  function drawPlayer(state) {
    const p = state.player;
    if (p.car) return; // drawn as the car
    const x = p.x - camera.x;
    const y = p.y - camera.y;
    const blink = p.hurtCd > 0 && Math.floor(p.hurtCd * 12) % 2 === 0;
    context.save();
    context.translate(x, y);
    // Shadow.
    context.fillStyle = 'rgba(0,0,0,0.32)';
    context.beginPath();
    context.arc(2, 4, PLAYER.radius, 0, Math.PI * 2);
    context.fill();
    if (!blink) {
      // Body.
      context.fillStyle = PALETTE.playerBody;
      context.beginPath();
      context.arc(0, 0, PLAYER.radius, 0, Math.PI * 2);
      context.fill();
      // Gun direction indicator.
      context.rotate(p.angle);
      context.fillStyle = '#2a2f38';
      context.fillRect(PLAYER.radius - 3, -3, 12, 6);
      context.fillStyle = PALETTE.playerHead;
      context.beginPath();
      context.arc(3, 0, PLAYER.radius * 0.55, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawBullets(state) {
    context.fillStyle = '#ffe08a';
    for (const b of state.bullets) {
      const x = b.x - camera.x;
      const y = b.y - camera.y;
      context.beginPath();
      context.arc(x, y, 3, 0, Math.PI * 2);
      context.fill();
      // Trail.
      const tx = x - b.vx * 0.012;
      const ty = y - b.vy * 0.012;
      context.strokeStyle = 'rgba(255,224,138,0.5)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(tx, ty);
      context.stroke();
    }
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      context.globalAlpha = a;
      context.fillStyle = p.color;
      const s = p.size * (0.5 + a * 0.5);
      context.fillRect(p.x - camera.x - s / 2, p.y - camera.y - s / 2, s, s);
    }
    context.globalAlpha = 1;
  }

  function drawMarker(state) {
    if (state.overlay === 'WIN') return;
    const m = state.objective || state.marker;
    const x = m.x - camera.x;
    const y = m.y - camera.y;
    if (x < -60 || y < -60 || x > VIEW.width + 60 || y > VIEW.height + 60) {
      // Off-screen: draw an arrow at the edge toward it.
      drawOffscreenArrow(state, m);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 4);
    context.strokeStyle = PALETTE.marker;
    context.lineWidth = 4;
    context.globalAlpha = 0.5 + pulse * 0.5;
    context.beginPath();
    context.arc(x, y, 30 + pulse * 8, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    // Pillar.
    context.fillStyle = PALETTE.marker;
    context.globalAlpha = 0.25;
    context.beginPath();
    context.arc(x, y, 26, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    text('▼', x, y + 6, 22, PALETTE.marker, 'center', 'bold');
  }

  function drawOffscreenArrow(state, m) {
    const cx = VIEW.width / 2;
    const cy = VIEW.height / 2;
    const ang = Math.atan2(m.y - camera.y - cy, m.x - camera.x - cx);
    const rx = VIEW.width / 2 - 40;
    const ry = VIEW.height / 2 - 40;
    // Point on the border ellipse.
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry;
    context.save();
    context.translate(x, y);
    context.rotate(ang);
    context.fillStyle = PALETTE.marker;
    context.beginPath();
    context.moveTo(14, 0);
    context.lineTo(-8, -9);
    context.lineTo(-8, 9);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawMinimap(state, city) {
    const size = 190;
    const pad = 18;
    const x0 = VIEW.width - size - pad;
    const y0 = pad;
    // Background.
    context.fillStyle = 'rgba(10,14,20,0.85)';
    roundRect(x0 - 6, y0 - 6, size + 12, size + 12, 8);
    context.fill();
    context.save();
    context.beginPath();
    roundRect(x0, y0, size, size, 4);
    context.clip();
    context.fillStyle = '#1a2230';
    context.fillRect(x0, y0, size, size);

    const sx = size / WORLD.width;
    const sy = size / WORLD.height;

    // Roads (scaled).
    context.fillStyle = '#2f3542';
    for (const r of city.roadRects) {
      context.fillRect(x0 + r.x * sx, y0 + r.y * sy, r.w * sx, r.h * sy);
    }
    // Police as red dots.
    context.fillStyle = '#ff4d4d';
    for (const c of state.police) {
      context.fillRect(x0 + c.x * sx - 1.5, y0 + c.y * sy - 1.5, 3, 3);
    }
    // Mission marker.
    if (state.overlay !== 'WIN') {
      const obj = state.objective || state.marker;
      context.fillStyle = PALETTE.marker;
      context.beginPath();
      context.arc(x0 + obj.x * sx, y0 + obj.y * sy, 3, 0, Math.PI * 2);
      context.fill();
    }
    // Player as a bright dot.
    context.fillStyle = PALETTE.playerBody;
    context.beginPath();
    context.arc(x0 + state.player.x * sx, y0 + state.player.y * sy, 3.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    // Border.
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.lineWidth = 2;
    roundRect(x0, y0, size, size, 4);
    context.stroke();
    text('N', x0 + size / 2, y0 + 14, 12, PALETTE.hudMuted, 'center', 'bold');
  }

  function drawHud(state) {
    // Health bar (bottom-left).
    const hx = 20;
    const hy = VIEW.height - 46;
    context.fillStyle = PALETTE.hudBg;
    roundRect(hx - 6, hy - 22, 240, 40, 8);
    context.fill();
    text('HEALTH', hx + 4, hy - 6, 13, PALETTE.hudMuted, 'left', 'bold');
    const hpw = 210;
    context.fillStyle = '#2a3140';
    roundRect(hx + 4, hy + 2, hpw, 14, 4);
    context.fill();
    const frac = Math.max(0, state.player.health / PLAYER.maxHealth);
    context.fillStyle = frac < 0.35 ? PALETTE.healthLow : PALETTE.health;
    roundRect(hx + 4, hy + 2, hpw * frac, 14, 4);
    context.fill();

    // Cash (below health).
    text(cashLabel(Math.floor(state.cash)), hx + 4, hy + 38, 26, PALETTE.cash, 'left', 'bold');

    // Wanted stars (top-left).
    const sx = 24;
    const sy = 34;
    text('WANTED', sx, sy - 12, 13, PALETTE.hudMuted, 'left', 'bold');
    for (let i = 0; i < 5; i++) {
      drawStar(sx + i * 30 + 10, sy + 6, 11, i < state.stars ? PALETTE.star : PALETTE.starOff);
    }

    // Minimap (top-right).
    drawMinimap(state, currentCity);

    // Mission objective text (top-centre).
    const m = MISSIONS[state.missionIndex];
    if (m) {
      let obj;
      if (state.missionPhase === 1) obj = `SURVIVE: ${Math.ceil(state.surviveTimer)}s`;
      else if (m.target === 'car') obj = 'OBJECTIVE: Steal a car, reach the marker';
      else if (m.target === 'safehouse') obj = 'OBJECTIVE: Lose the heat, reach the safehouse';
      else obj = 'OBJECTIVE: Reach the docks marker';
      text(obj, VIEW.width / 2, 30, 18, PALETTE.hudText, 'center', 'bold');
      text(`Mission ${state.missionIndex + 1}/${MISSIONS.length}: ${m.title}`, VIEW.width / 2, 52, 14, PALETTE.hudMuted, 'center');
    } else {
      text('All missions complete — free roam', VIEW.width / 2, 30, 18, PALETTE.cash, 'center', 'bold');
    }

    // Transient message banner.
    if (state.message) {
      const w = Math.min(VIEW.width - 80, 120 + state.message.length * 9);
      context.fillStyle = 'rgba(12,16,24,0.9)';
      roundRect((VIEW.width - w) / 2, 86, w, 40, 8);
      context.fill();
      text(state.message, VIEW.width / 2, 112, 20, PALETTE.marker, 'center', 'bold');
    }

    // On-foot hint when near an enterable car.
    if (state.player.onFoot && state._nearCar) {
      text('[E] Enter vehicle', VIEW.width / 2, VIEW.height - 30, 16, PALETTE.hudText, 'center', 'bold');
    }
  }

  function drawStar(cx, cy, r, color) {
    context.fillStyle = color;
    context.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 30;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = 'rgba(8,11,17,0.92)';
    roundRect(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = accent || PALETTE.marker;
    context.lineWidth = 3;
    roundRect(x, y, width, height, 14);
    context.stroke();
    text(title, VIEW.width / 2, y + 70, 54, accent || PALETTE.marker, 'center', 'bold');
    for (let i = 0; i < lines.length; i++) {
      text(lines[i], VIEW.width / 2, y + 118 + i * 30, 20, PALETTE.hudText, 'center');
    }
    if (prompt) text(prompt, VIEW.width / 2, y + height - 28, 22, PALETTE.cash, 'center', 'bold');
  }

  function drawTitle(state) {
    // Dim the live world behind the title.
    context.fillStyle = 'rgba(6,9,14,0.55)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    // Title block, top-ish.
    text('PORT MERIDIAN', VIEW.width / 2, 150, 72, PALETTE.marker, 'center', 'bold');
    text('VICE', VIEW.width / 2, 220, 40, PALETTE.playerBody, 'center', 'bold');
    context.fillStyle = 'rgba(8,11,17,0.9)';
    const bx = VIEW.width / 2 - 300;
    roundRect(bx, 270, 600, 260, 14);
    context.fill();
    context.strokeStyle = PALETTE.marker;
    context.lineWidth = 3;
    roundRect(bx, 270, 600, 260, 14);
    context.stroke();
    const controls = [
      'WASD / Arrows — move (drive when in a car)',
      'E — enter / exit a vehicle',
      'Space / Click — shoot',
      'P / Esc — pause',
    ];
    for (let i = 0; i < controls.length; i++) {
      text(controls[i], VIEW.width / 2, 320 + i * 34, 20, PALETTE.hudText, 'center');
    }
    const blink = 0.5 + 0.5 * Math.sin(state.elapsed * 4);
    context.globalAlpha = 0.5 + blink * 0.5;
    text('Press ENTER to start', VIEW.width / 2, 500, 26, PALETTE.cash, 'center', 'bold');
    context.globalAlpha = 1;
    if (state.cash > 0 || state.missionIndex > 0) {
      text(`Save found: $${Math.floor(state.cash)} · Mission ${state.missionIndex + 1}`, VIEW.width / 2, 560, 18, PALETTE.hudMuted, 'center');
    }
  }

  function drawOverlay(state) {
    if (!state.overlay) return;
    context.fillStyle = 'rgba(6,9,14,0.6)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    if (state.overlay === 'WIN') {
      drawPanel('YOU MADE IT', [
        'Port Meridian is yours.',
        `Final take: $${Math.floor(state.cash)}`,
      ], 'Press ENTER to play again', PALETTE.cash);
    } else {
      const col = state.overlay === 'BUSTED' ? PALETTE.copLight2 : PALETTE.danger;
      drawPanel(state.overlay, [
        state.overlay === 'BUSTED' ? 'The cops boxed you in.' : 'You got wasted out there.',
        'Respawning at the safehouse…',
      ], '', col);
    }
  }

  function drawPaused() {
    context.fillStyle = 'rgba(6,9,14,0.6)';
    context.fillRect(0, 0, VIEW.width, VIEW.height);
    drawPanel('PAUSED', ['Take a breath.'], 'Press P to resume', PALETTE.playerBody);
  }

  // ---- roundRect helper -------------------------------------------------
  function roundRect(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  // ---- Main draw --------------------------------------------------------

  let currentCity = null;

  function draw(state, screen, city) {
    currentCity = city;
    // Decide camera (snap for first paint / shots).
    updateCamera(state, draw._snap !== false);
    draw._snap = false;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    // Apply screen shake.
    const sh = state.shake;
    if (sh > 0) {
      context.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    }

    drawGround(city);
    drawMarker(state);
    for (const p of state.peds) drawPed(p);
    // Traffic.
    for (const t of state.traffic) {
      drawCar({ x: t.x, y: t.y, angle: t.angle, color: t.color, player: false, hp: 100 }, false, 0);
    }
    // Parked / police / player cars.
    for (const c of state.cars) {
      if (c.dead) continue;
      const isPolice = c.type === 'police';
      drawCar(c, isPolice, c.lightPhase || 0);
    }
    drawPlayer(state);
    drawBullets(state);
    drawParticles(state);

    if (screen === SCREEN_TITLE) {
      drawTitle(state);
      return;
    }
    drawHud(state);
    if (screen === SCREEN_PAUSED) drawPaused();
    drawOverlay(state);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, camera };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }