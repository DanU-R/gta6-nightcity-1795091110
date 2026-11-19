// Drawing only: the world's state and the current screen in, pixels out. The 1280x720 logical
// view is scaled to fit the window and centred; the camera lerps over the city. Everything is
// canvas 2D: flat shapes with soft shadows, additive light for lamps and siren glows, a vignette,
// a clean HUD, a minimap and the title / busted / wasted / win screens.
import { CAR, CITY, DISPLAY_FONT, FONT, MISSIONS, PALETTE, PLAYER, VIEW, WANTED } from './config.js';
import { TAU, clamp } from './math.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_WIN = 'win';

const V = VIEW;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };

  // Offscreen canvas for the minimap.
  const mini = document.createElement('canvas');
  mini.width = 200;
  mini.height = 200;
  const mctx = mini.getContext('2d');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * ratio);
    const h = Math.round(window.innerHeight * ratio);
    canvas.width = w;
    canvas.height = h;
    view.scale = Math.min(w / V.width, h / V.height);
    view.x = (w - V.width * view.scale) / 2;
    view.y = (h - V.height * view.scale) / 2;
  }

  // --- primitives ----------------------------------------------------------
  function rr(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  function fillRR(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    rr(x, y, w, h, r);
    ctx.fill();
  }
  function strokeRR(x, y, w, h, r, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || 2;
    rr(x, y, w, h, r);
    ctx.stroke();
  }

  // --- text ----------------------------------------------------------------
  const fontCache = new Map();
  function font(size, weight, display) {
    const key = `${size}|${weight || ''}|${display ? 1 : 0}`;
    let f = fontCache.get(key);
    if (!f) {
      f = `${weight ? weight + ' ' : ''}${size}px ${display ? DISPLAY_FONT : FONT}`;
      fontCache.set(key, f);
    }
    ctx.font = f;
  }

  // --- camera --------------------------------------------------------------
  function applyCamera(state, shake) {
    const cam = state.camera;
    let sx = 0;
    let sy = 0;
    if (shake > 0) {
      const s = shake * 11;
      sx = Math.sin(state.time * 91) * s;
      sy = Math.cos(state.time * 77) * s;
    }
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.translate(V.width / 2 - cam.x + sx, V.height / 2 - cam.y + sy);
  }

  function visibleRange(cam, pad) {
    const p = pad || 100;
    return {
      x0: cam.x - V.width / 2 - p,
      y0: cam.y - V.height / 2 - p,
      x1: cam.x + V.width / 2 + p,
      y1: cam.y + V.height / 2 + p,
    };
  }

  // --- ground & roads ------------------------------------------------------
  function drawGround(state) {
    const cam = state.camera;
    const r = visibleRange(cam);
    const road = CITY.roadWidth;
    const pitch = road + CITY.blockSize;

    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);

    // Vertical asphalt bands.
    ctx.fillStyle = PALETTE.asphalt;
    const kStart = Math.max(0, Math.floor(r.x0 / pitch) - 1);
    const kEnd = Math.min(CITY.blocks, Math.ceil(r.x1 / pitch) + 1);
    const yTop = Math.max(0, r.y0);
    const yBot = Math.min(CITY.size, r.y1);
    for (let k = kStart; k <= kEnd; k += 1) {
      ctx.fillRect(k * pitch, yTop, road, yBot - yTop);
    }
    // Horizontal asphalt bands.
    const jStart = Math.max(0, Math.floor(r.y0 / pitch) - 1);
    const jEnd = Math.min(CITY.blocks, Math.ceil(r.y1 / pitch) + 1);
    const xL = Math.max(0, r.x0);
    const xR = Math.min(CITY.size, r.x1);
    for (let k = jStart; k <= jEnd; k += 1) {
      ctx.fillRect(xL, k * pitch, xR - xL, road);
    }

    // Dashed centre lines.
    ctx.strokeStyle = PALETTE.laneDash;
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 20]);
    for (let k = kStart; k <= kEnd; k += 1) {
      const cx = k * pitch + road / 2;
      ctx.beginPath();
      ctx.moveTo(cx, yTop);
      ctx.lineTo(cx, yBot);
      ctx.stroke();
    }
    for (let k = jStart; k <= jEnd; k += 1) {
      const cy = k * pitch + road / 2;
      ctx.beginPath();
      ctx.moveTo(xL, cy);
      ctx.lineTo(xR, cy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Solid edge lines.
    ctx.strokeStyle = 'rgba(244, 211, 94, 0.45)';
    ctx.lineWidth = 2;
    for (let k = kStart; k <= kEnd; k += 1) {
      const base = k * pitch;
      for (const off of [11, road - 11]) {
        ctx.beginPath();
        ctx.moveTo(base + off, yTop);
        ctx.lineTo(base + off, yBot);
        ctx.stroke();
      }
    }
    for (let k = jStart; k <= jEnd; k += 1) {
      const base = k * pitch;
      for (const off of [11, road - 11]) {
        ctx.beginPath();
        ctx.moveTo(xL, base + off);
        ctx.lineTo(xR, base + off);
        ctx.stroke();
      }
    }
  }

  function drawCrosswalks(state) {
    const cam = state.camera;
    const r = visibleRange(cam, 40);
    const road = CITY.roadWidth;
    const pitch = road + CITY.blockSize;
    const stripeW = 15;
    const gap = 9;
    ctx.fillStyle = 'rgba(240, 244, 250, 0.82)';
    const ki0 = Math.max(0, Math.floor(r.x0 / pitch) - 1);
    const ki1 = Math.min(CITY.blocks, Math.ceil(r.x1 / pitch) + 1);
    const kj0 = Math.max(0, Math.floor(r.y0 / pitch) - 1);
    const kj1 = Math.min(CITY.blocks, Math.ceil(r.y1 / pitch) + 1);
    for (let i = ki0; i <= ki1; i += 1) {
      for (let j = kj0; j <= kj1; j += 1) {
        const ix = i * pitch + road / 2;
        const iy = j * pitch + road / 2;
        band(ix - road / 2 - 26, iy, true, r);
        band(ix + road / 2 + 10, iy, true, r);
        band(ix, iy - road / 2 - 26, false, r);
        band(ix, iy + road / 2 + 10, false, r);
      }
    }
    function band(x, y, vertical, r) {
      if (x < r.x0 - 30 || x > r.x1 + 30 || y < r.y0 - 30 || y > r.y1 + 30) return;
      if (vertical) {
        for (let s = -road / 2 + 9; s < road / 2 - 9; s += stripeW + gap) ctx.fillRect(x, y + s, 22, stripeW);
      } else {
        for (let s = -road / 2 + 9; s < road / 2 - 9; s += stripeW + gap) ctx.fillRect(x + s, y, stripeW, 22);
      }
    }
  }

  function drawSidewalks(state) {
    const cam = state.camera;
    const r = visibleRange(cam);
    const road = CITY.roadWidth;
    const sw = CITY.sidewalk;
    const pitch = road + CITY.blockSize;
    const bi0 = Math.max(0, Math.floor((r.x0 - road) / pitch));
    const bi1 = Math.min(CITY.blocks - 1, Math.ceil(r.x1 / pitch));
    const bj0 = Math.max(0, Math.floor((r.y0 - road) / pitch));
    const bj1 = Math.min(CITY.blocks - 1, Math.ceil(r.y1 / pitch));

    // Sidewalk slab (outer block footprint).
    ctx.fillStyle = PALETTE.sidewalk;
    for (let i = bi0; i <= bi1; i += 1) {
      for (let j = bj0; j <= bj1; j += 1) {
        const x = i * pitch + road - sw;
        const y = j * pitch + road - sw;
        const s = CITY.blockSize + sw * 2;
        ctx.fillRect(x, y, s, s);
      }
    }
    // Grass infill (inner block).
    ctx.fillStyle = PALETTE.grass;
    for (let i = bi0; i <= bi1; i += 1) {
      for (let j = bj0; j <= bj1; j += 1) {
        const x = i * pitch + road + sw;
        const y = j * pitch + road + sw;
        ctx.fillRect(x, y, CITY.blockSize, CITY.blockSize);
      }
    }
    // Edge line.
    ctx.strokeStyle = PALETTE.sidewalkEdge;
    ctx.lineWidth = 2;
    for (let i = bi0; i <= bi1; i += 1) {
      for (let j = bj0; j <= bj1; j += 1) {
        const x = i * pitch + road - sw;
        const y = j * pitch + road - sw;
        ctx.strokeRect(x + 1, y + 1, CITY.blockSize + sw * 2 - 2, CITY.blockSize + sw * 2 - 2);
      }
    }
  }

  // --- blocks --------------------------------------------------------------
  function drawBlocks(state) {
    const cam = state.camera;
    const r = visibleRange(cam);
    const blocks = state.city.blocks;
    for (let bi = 0; bi < blocks.length; bi += 1) {
      const b = blocks[bi];
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 || b.y > r.y1) continue;

      for (const p of b.parks) {
        fillRR(p.x, p.y, p.w, p.h, 0, PALETTE.grassDark);
        ctx.fillStyle = PALETTE.sidewalk;
        ctx.fillRect(p.x + p.w / 2 - 14, p.y, 28, p.h);
        ctx.fillRect(p.x, p.y + p.h / 2 - 14, p.w, 28);
      }
      for (const lot of b.lots) {
        fillRR(lot.x, lot.y, lot.w, lot.h, 0, PALETTE.asphaltDark);
        ctx.strokeStyle = 'rgba(255,255,255,0.26)';
        ctx.lineWidth = 2;
        const bays = Math.floor(lot.w / 60);
        for (let b2 = 1; b2 < bays; b2 += 1) {
          const x = lot.x + b2 * 60;
          ctx.beginPath();
          ctx.moveTo(x, lot.y + 12);
          ctx.lineTo(x, lot.y + 62);
          ctx.stroke();
        }
      }
      for (const bd of b.buildings) drawBuilding(bd);
      for (const t of b.trees) drawTree(t);
      for (const l of b.lamps) drawLamp(l, state.time);
    }
  }

  function drawBuilding(bd) {
    const sh = 4 + bd.floors * 4;
    // Soft drop shadow.
    ctx.fillStyle = PALETTE.buildingShadow;
    ctx.fillRect(bd.x + sh, bd.y + sh, bd.w, bd.h);
    // Face.
    ctx.fillStyle = bd.face;
    ctx.fillRect(bd.x, bd.y, bd.w, bd.h);
    // Top band.
    ctx.fillStyle = bd.top;
    ctx.fillRect(bd.x, bd.y, bd.w, Math.min(11, bd.h * 0.2));
    // Outline.
    ctx.strokeStyle = bd.trim;
    ctx.lineWidth = 2;
    ctx.strokeRect(bd.x + 1, bd.y + 1, bd.w - 2, bd.h - 2);
    // Windows.
    if (bd.w < 40 || bd.h < 40) return;
    const cols = bd.winCols;
    const rows = bd.winRows;
    const padX = 8;
    const padY = 13;
    const cw = (bd.w - padX * 2) / cols;
    const ch = (bd.h - padY * 2) / rows;
    const wW = Math.max(4, cw * 0.5);
    const wH = Math.max(4, ch * 0.44);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = bd.x + padX + c * cw + (cw - wW) / 2;
        const y = bd.y + padY + r * ch + (ch - wH) / 2;
        const lit = (r * 7 + c * 13 + Math.floor(bd.x)) % 5 < 2;
        ctx.fillStyle = lit ? 'rgba(255, 236, 160, 0.92)' : 'rgba(58, 78, 108, 0.55)';
        ctx.fillRect(x, y, wW, wH);
      }
    }
  }

  function drawTree(t) {
    ctx.fillStyle = 'rgba(20,40,20,0.20)';
    ctx.beginPath();
    ctx.ellipse(t.x + 6, t.y + 8, t.r * 0.95, t.r * 0.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PALETTE.trunk;
    ctx.fillRect(t.x - 3, t.y - 2, 6, 14);
    ctx.fillStyle = PALETTE.treeDark;
    ctx.beginPath();
    ctx.arc(t.x, t.y - 4, t.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PALETTE.tree;
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.35, t.r * 0.72, 0, TAU);
    ctx.fill();
  }

  function drawLamp(l, time) {
    ctx.fillStyle = '#4a4f5e';
    ctx.fillRect(l.x - 2, l.y - 22, 4, 22);
    const flicker = 0.85 + Math.sin(time * 3 + l.x) * 0.15;
    const g = ctx.createRadialGradient(l.x, l.y - 24, 2, l.x, l.y - 24, 26);
    g.addColorStop(0, `rgba(255, 226, 140, ${0.8 * flicker})`);
    g.addColorStop(1, 'rgba(255, 226, 140, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(l.x, l.y - 24, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.arc(l.x, l.y - 24, 4, 0, TAU);
    ctx.fill();
  }

  // --- cars ----------------------------------------------------------------
  function drawCar(car, state) {
    if (!car.alive && car.destroyed <= 0) return;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const L = CAR.length;
    const W = CAR.width;

    if (!car.alive) {
      ctx.fillStyle = '#2a2a30';
      rr(-L / 2, -W / 2, L, W, 8);
      ctx.fill();
      ctx.fillStyle = '#1a1a1e';
      rr(-L / 2 + 6, -W / 2 + 4, L - 12, W - 8, 6);
      ctx.fill();
      const f = 0.5 + Math.sin(state.time * 20 + car.x) * 0.5;
      ctx.fillStyle = `rgba(255, ${120 + f * 60}, 40, ${0.7 * f})`;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + f * 6, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Shadow.
    ctx.fillStyle = 'rgba(10,12,20,0.28)';
    rr(-L / 2 + 4, -W / 2 + 6, L, W, 9);
    ctx.fill();

    // Wheels.
    ctx.fillStyle = '#15151a';
    for (const [wx, wy] of [[-L / 2 + 11, -W / 2 - 1], [L / 2 - 23, -W / 2 - 1], [-L / 2 + 11, W / 2 - 5], [L / 2 - 23, W / 2 - 5]]) {
      ctx.fillRect(wx, wy, 11, 6);
    }

    // Body.
    ctx.fillStyle = car.color;
    rr(-L / 2, -W / 2, L, W, 8);
    ctx.fill();
    // Cabin.
    ctx.fillStyle = 'rgba(28, 38, 58, 0.78)';
    rr(-L * 0.16, -W / 2 + 4, L * 0.42, W - 8, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(185, 212, 240, 0.5)';
    rr(L * 0.14, -W / 2 + 5, L * 0.1, W - 10, 3);
    ctx.fill();

    if (car.isPolice) {
      ctx.fillStyle = '#f4f4f8';
      rr(-L / 2 + 4, -W / 2 + 4, L * 0.26, W - 8, 3);
      ctx.fill();
      ctx.fillStyle = PALETTE.policeBody;
      rr(L * 0.04, -W / 2 + 4, L * 0.5, W - 8, 3);
      ctx.fill();
      drawSiren(car, state);
    }

    // Headlights.
    ctx.fillStyle = '#fff3c4';
    rr(L / 2 - 3, -W / 2 + 5, 6, 6, 2);
    ctx.fill();
    rr(L / 2 - 3, W / 2 - 11, 6, 6, 2);
    ctx.fill();
    // Taillights.
    const brake = car.braking ? 1 : 0.5;
    ctx.fillStyle = `rgba(255, 60, 60, ${brake})`;
    rr(-L / 2 - 1, -W / 2 + 5, 5, 6, 2);
    ctx.fill();
    rr(-L / 2 - 1, W / 2 - 11, 5, 6, 2);
    ctx.fill();

    if (state.player.car === car) {
      ctx.strokeStyle = 'rgba(120, 230, 255, 0.9)';
      ctx.lineWidth = 2;
      rr(-L / 2 - 3, -W / 2 - 3, L + 6, W + 6, 11);
      ctx.stroke();
    }
    ctx.restore();

    if (car.alive) drawHeadlightGlow(car);
  }

  function drawHeadlightGlow(car) {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const fx = car.x + c * (CAR.length / 2 + 2);
    const fy = car.y + s * (CAR.length / 2 + 2);
    const g = ctx.createRadialGradient(fx, fy, 2, fx, fy, 72);
    g.addColorStop(0, 'rgba(255, 244, 200, 0.20)');
    g.addColorStop(1, 'rgba(255, 244, 200, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, 72, 0, TAU);
    ctx.fill();
  }

  function drawSiren(car, state) {
    const phase = Math.floor(state.time * 6) % 2;
    ctx.fillStyle = phase === 0 ? PALETTE.policeRed : '#5a1620';
    ctx.beginPath();
    ctx.arc(-9, -6, 4.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = phase === 1 ? PALETTE.policeBlue : '#10204a';
    ctx.beginPath();
    ctx.arc(1, -6, 4.5, 0, TAU);
    ctx.fill();
    const glowColor = phase === 0 ? '255,59,92' : '47,107,255';
    const g = ctx.createRadialGradient(-4, -6, 2, -4, -6, 42);
    g.addColorStop(0, `rgba(${glowColor}, 0.65)`);
    g.addColorStop(1, `rgba(${glowColor}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(-4, -6, 42, 0, TAU);
    ctx.fill();
  }

  // --- pedestrians ---------------------------------------------------------
  function drawPed(ped) {
    if (!ped.alive) return;
    const bob = Math.sin(ped.walkT) * 1.6;
    const swing = Math.sin(ped.walkT) * 3.5;
    ctx.save();
    ctx.translate(ped.x, ped.y);
    ctx.fillStyle = 'rgba(10,12,20,0.25)';
    ctx.beginPath();
    ctx.ellipse(1, 8, 7, 3.5, 0, 0, TAU);
    ctx.fill();
    const flash = ped.hitFlash > 0;
    ctx.strokeStyle = '#2a2a33';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, 2 + bob);
    ctx.lineTo(-2 - swing * 0.4, 9);
    ctx.moveTo(2, 2 + bob);
    ctx.lineTo(2 + swing * 0.4, 9);
    ctx.stroke();
    ctx.fillStyle = flash ? '#ffffff' : ped.color;
    rr(-5, -8 + bob, 10, 12, 3);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#f0c9a0';
    ctx.beginPath();
    ctx.arc(0, -12 + bob, 4.5, 0, TAU);
    ctx.fill();
    if (ped.panic > 0) {
      ctx.fillStyle = '#ffd23f';
      font(14, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('!', 0, -22 + bob);
    }
    ctx.restore();
  }

  // --- player on foot ------------------------------------------------------
  function drawPlayerFoot(player, time, moving) {
    const swing = moving ? Math.sin(time * 14) * 3.5 : 0;
    const bob = moving ? Math.abs(Math.sin(time * 14)) * 1.5 : 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = 'rgba(10,12,20,0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 9, 8, 4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1e2a44';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, 2 - bob);
    ctx.lineTo(-2 - swing * 0.5, 10);
    ctx.moveTo(2, 2 - bob);
    ctx.lineTo(2 + swing * 0.5, 10);
    ctx.stroke();
    ctx.fillStyle = PALETTE.playerDark;
    rr(-6, -9 - bob, 12, 13, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.player;
    rr(-6, -9 - bob, 12, 7, 3);
    ctx.fill();
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(0, -13 - bob, 5, 0, TAU);
    ctx.fill();
    // Gun arm toward aim.
    ctx.rotate(player.angle);
    ctx.fillStyle = '#2a2a33';
    rr(2, -2, 13, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  // --- bullets & particles -------------------------------------------------
  function drawBullets(state) {
    for (const b of state.bullets) {
      const dx = b.x - b.px;
      const dy = b.y - b.py;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const tail = 18;
      const grad = ctx.createLinearGradient(b.x - nx * tail, b.y - ny * tail, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,211,77,0)');
      grad.addColorStop(1, b.fromPlayer ? 'rgba(255,230,140,1)' : 'rgba(255,120,120,1)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x - nx * tail, b.y - ny * tail);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(120,120,130,${0.35 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color || '#ffc850';
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'flash') {
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.size * 2);
        g.addColorStop(0, `rgba(255,240,180,${a})`);
        g.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, TAU);
        ctx.fill();
      }
    }
  }

  // --- mission marker ------------------------------------------------------
  function drawMissionMarker(state) {
    const m = state.missionMarker;
    if (!m || state.missionState !== 'active') return;
    const pulse = 1 + Math.sin(state.time * 4) * 0.12;
    const r = 26 * pulse;
    const color = m.kind === 'escape' ? '#ffd23f' : '#ff4d6d';
    const g = ctx.createRadialGradient(m.x, m.y, 4, m.x, m.y, r * 1.8);
    g.addColorStop(0, hexA(color, 0.5));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 1.8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 7, 0, TAU);
    ctx.fill();
    const bob = Math.sin(state.time * 3) * 5;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - r - 10 - bob);
    ctx.lineTo(m.x - 8, m.y - r - 22 - bob);
    ctx.lineTo(m.x + 8, m.y - r - 22 - bob);
    ctx.closePath();
    ctx.fill();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }

  // --- vignette ------------------------------------------------------------
  function drawVignette() {
    const g = ctx.createRadialGradient(V.width / 2, V.height / 2, V.height * 0.34, V.width / 2, V.height / 2, V.height * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(5, 8, 18, 0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, V.width, V.height);
  }

  // --- HUD -----------------------------------------------------------------
  function drawHud(state) {
    drawHealthBar(state);
    drawWantedStars(state);
    drawCash(state);
    drawMissionText(state);
    drawMinimap(state);
    drawBustMeter(state);
  }

  function drawHealthBar(state) {
    const p = state.player;
    const x = 24;
    const y = V.height - 54;
    const w = 220;
    const h = 18;
    const frac = clamp(p.health / PLAYER.health, 0, 1);
    fillRR(x - 8, y - 24, w + 76, h + 32, 10, 'rgba(10,14,24,0.65)');
    font(13, 'bold');
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HEALTH', x, y - 8);
    fillRR(x, y, w, h, 6, 'rgba(255,255,255,0.14)');
    const col = frac > 0.4 ? PALETTE.health : PALETTE.healthLow;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, col);
    grad.addColorStop(1, shade(col, -20));
    ctx.fillStyle = grad;
    if (w * frac > 1) { rr(x, y, w * frac, h, 6); ctx.fill(); }
    ctx.fillStyle = p.car ? PALETTE.player : 'rgba(255,255,255,0.5)';
    font(13, 'bold');
    ctx.fillText(p.car ? 'VEHICLE' : 'ON FOOT', x + w + 12, y + 14);
  }

  function drawWantedStars(state) {
    const n = state.wanted;
    const size = 26;
    const gap = 8;
    const totalW = WANTED.max * (size + gap) - gap;
    const x0 = V.width - 24 - totalW;
    const y = 24;
    fillRR(x0 - 12, y - 10, totalW + 24, size + 20, 10, 'rgba(10,14,24,0.6)');
    for (let i = 0; i < WANTED.max; i += 1) {
      const cx = x0 + i * (size + gap) + size / 2;
      const cy = y + size / 2;
      const active = i < n;
      let scale = 1;
      if (active && i === n - 1) {
        const pulse = 0.5 + Math.sin(state.time * 8) * 0.5;
        scale = 1 + pulse * 0.25;
      }
      drawStar(cx, cy, 5, size / 2 * scale, size / 4 * scale, active ? PALETTE.wanted : PALETTE.wantedEmpty, active);
    }
  }

  function drawStar(cx, cy, spikes, outer, inner, color, glow) {
    ctx.save();
    ctx.translate(cx, cy);
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i += 1) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawCash(state) {
    const pop = state.cashPop;
    const scale = pop > 0 ? 1 + Math.sin((1.2 - pop) * 12) * 0.07 * (pop / 1.2) : 1;
    ctx.save();
    ctx.translate(24, 50);
    ctx.scale(scale, scale);
    fillRR(-6, -20, 158, 40, 10, 'rgba(10,14,24,0.6)');
    font(24, 'bold');
    ctx.fillStyle = PALETTE.cash;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('$' + state.cash.toLocaleString('en-US'), 8, 9);
    ctx.restore();
  }

  function drawMissionText(state) {
    const m = MISSIONS[state.missionIndex];
    if (!m) return;
    let line = '';
    if (state.missionState === 'active') {
      if (m.kind === 'escape' || state.missionMarker?.kind === 'escape') {
        line = state.wanted > 0 ? `LOSE THE HEAT — ${state.wanted} STAR${state.wanted > 1 ? 'S' : ''}` : 'LOSING THE HEAT...';
      } else line = m.objective;
    } else if (state.missionState === 'complete') {
      line = 'MISSION COMPLETE  +$' + m.reward;
    } else if (state.missionState === 'brief') {
      line = m.brief;
    }
    if (!line) return;
    font(15, 'bold');
    const w = ctx.measureText(line).width + 36;
    const x = (V.width - w) / 2;
    const y = 20;
    fillRR(x, y, w, 34, 9, 'rgba(10,14,24,0.62)');
    ctx.fillStyle = state.missionState === 'complete' ? PALETTE.cash : PALETTE.wanted;
    rr(x, y, 6, 34, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(line, V.width / 2, y + 17);
  }

  function drawBustMeter(state) {
    if (state.bustProgress <= 0.01) return;
    const cx = V.width / 2;
    const cy = V.height / 2;
    const rad = 46;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.policeRed;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(state.bustProgress, 0, 1));
    ctx.stroke();
    font(13, 'bold');
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BUSTING', cx, cy);
  }

  // --- minimap -------------------------------------------------------------
  let miniFrame = 0;
  function drawMinimap(state) {
    miniFrame += 1;
    if (miniFrame % 10 === 1) renderMinimap(state);
    const size = 190;
    const x = V.width - size - 24;
    const y = V.height - size - 24;
    fillRR(x - 6, y - 6, size + 12, size + 12, 12, 'rgba(10,14,24,0.72)');
    strokeRR(x - 6, y - 6, size + 12, size + 12, 12, 'rgba(255,255,255,0.14)', 2);
    ctx.drawImage(mini, x, y, size, size);
    drawMinimapArrow(state, x, y, size);
  }

  function renderMinimap(state) {
    const S = 200;
    const scale = S / CITY.size;
    mctx.clearRect(0, 0, S, S);
    mctx.fillStyle = PALETTE.grassDark;
    mctx.fillRect(0, 0, S, S);
    mctx.fillStyle = PALETTE.asphalt;
    const road = CITY.roadWidth * scale;
    const pitch = (CITY.roadWidth + CITY.blockSize) * scale;
    for (let k = 0; k <= CITY.blocks; k += 1) {
      mctx.fillRect(k * pitch, 0, road, S);
      mctx.fillRect(0, k * pitch, S, road);
    }
    const m = state.missionMarker;
    if (m && state.missionState === 'active') {
      mctx.fillStyle = m.kind === 'escape' ? '#ffd23f' : '#ff4d6d';
      mctx.beginPath();
      mctx.arc(m.x * scale, m.y * scale, 5, 0, TAU);
      mctx.fill();
    }
    mctx.fillStyle = PALETTE.policeRed;
    for (const p of state.police) {
      if (!p.alive) continue;
      mctx.beginPath();
      mctx.arc(p.x * scale, p.y * scale, 3.2, 0, TAU);
      mctx.fill();
    }
  }

  function drawMinimapArrow(state, mx, my, size) {
    const scale = size / CITY.size;
    const px = mx + state.player.x * scale;
    const py = my + state.player.y * scale;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(state.player.angle + Math.PI / 2);
    ctx.fillStyle = PALETTE.player;
    ctx.strokeStyle = '#0c1020';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // --- toasts --------------------------------------------------------------
  function drawToasts(state) {
    const toasts = state.toasts;
    if (!toasts) return;
    for (let i = 0; i < toasts.length; i += 1) {
      const t = toasts[i];
      const a = clamp(t.life / 0.4, 0, 1);
      const y = 90 + i * 44;
      ctx.globalAlpha = a;
      font(15, 'bold');
      const w = ctx.measureText(t.text).width + 36;
      const x = (V.width - w) / 2;
      fillRR(x, y, w, 34, 9, 'rgba(12,16,28,0.85)');
      ctx.fillStyle = t.color || PALETTE.white;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, V.width / 2, y + 17);
      ctx.globalAlpha = 1;
    }
  }

  // --- master world draw ---------------------------------------------------
  function drawWorld(state) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    applyCamera(state, state.screenShake);
    drawGround(state);
    drawSidewalks(state);
    drawCrosswalks(state);
    drawBlocks(state);
    drawMissionMarker(state);
    drawBullets(state);

    // Depth-sorted drawables.
    const list = [];
    for (const c of state.cars) list.push({ y: c.y, kind: 0, ref: c });
    for (const p of state.peds) if (p.alive) list.push({ y: p.y, kind: 1, ref: p });
    if (!state.player.car) list.push({ y: state.player.y, kind: 2, ref: state.player });
    list.sort((a, b) => a.y - b.y);
    const moving = state.player._moving;
    for (const d of list) {
      if (d.kind === 0) drawCar(d.ref, state);
      else if (d.kind === 1) drawPed(d.ref);
      else drawPlayerFoot(d.ref, state.time, moving);
    }

    drawParticles(state);
    drawVignette();

    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawHud(state);
    drawToasts(state);
  }

  // --- full-screen screens -------------------------------------------------
  function drawTitle(state, t) {
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    // Animated city backdrop: pan the real camera slowly.
    state.camera.x = CITY.size / 2 + Math.sin(t * 0.05) * 260;
    state.camera.y = CITY.size / 2 + Math.cos(t * 0.04) * 200;
    drawGround(state);
    drawSidewalks(state);
    drawBlocks(state);
    // Dark gradient for legibility.
    const g = ctx.createLinearGradient(0, 0, 0, V.height);
    g.addColorStop(0, 'rgba(8,10,20,0.55)');
    g.addColorStop(0.5, 'rgba(8,10,20,0.35)');
    g.addColorStop(1, 'rgba(8,10,20,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, V.width, V.height);

    // Logo.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const bob = Math.sin(t * 1.6) * 4;
    // Glow behind the title.
    const tg = ctx.createRadialGradient(V.width / 2, 230, 20, V.width / 2, 230, 380);
    tg.addColorStop(0, 'rgba(79, 208, 224, 0.20)');
    tg.addColorStop(1, 'rgba(79, 208, 224, 0)');
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, V.width, V.height);

    font(76, 'bold', true);
    ctx.fillStyle = PALETTE.player;
    ctx.shadowColor = 'rgba(79, 208, 224, 0.8)';
    ctx.shadowBlur = 24;
    ctx.fillText('NEON', V.width / 2 - 150, 250 + bob);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.wanted;
    ctx.shadowColor = 'rgba(255, 210, 63, 0.8)';
    ctx.shadowBlur = 24;
    ctx.fillText('SYNDICATE', V.width / 2 + 130, 250 + bob);
    ctx.shadowBlur = 0;

    font(20, 'bold');
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('AN OPEN-WORLD CRIME SAGA', V.width / 2, 300 + bob);

    // Controls panel.
    const py = 400;
    fillRR(V.width / 2 - 250, py, 500, 190, 16, 'rgba(10,14,24,0.72)');
    strokeRR(V.width / 2 - 250, py, 500, 190, 16, 'rgba(255,255,255,0.10)', 2);
    font(16, 'bold');
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'left';
    const lx = V.width / 2 - 220;
    let ly = py + 38;
    const rows = [
      ['WASD / ARROWS', 'Move / Drive'],
      ['E', 'Enter / Exit vehicle'],
      ['SPACE / CLICK', 'Shoot'],
      ['SHIFT', 'Sprint'],
    ];
    for (const [k, v] of rows) {
      ctx.fillStyle = PALETTE.player;
      font(15, 'bold');
      ctx.fillText(k, lx, ly);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      font(15);
      ctx.fillText(v, lx + 180, ly);
      ly += 34;
    }

    // Prompt.
    const prompt = 'PRESS SPACE OR CLICK TO START';
    const blink = 0.55 + Math.sin(t * 3) * 0.45;
    font(22, 'bold');
    ctx.globalAlpha = blink;
    ctx.fillStyle = PALETTE.wanted;
    ctx.textAlign = 'center';
    ctx.fillText(prompt, V.width / 2, V.height - 90);
    ctx.globalAlpha = 1;

    font(14);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('Lose the cops. Finish the jobs. Own the city.', V.width / 2, V.height - 52);
  }

  function drawEndScreen(state, kind, t, fade) {
    // Fade from black.
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const a = clamp(fade, 0, 1);
    ctx.fillStyle = `rgba(6,8,16,${a * 0.82})`;
    ctx.fillRect(0, 0, V.width, V.height);

    const label = kind === SCREEN_BUSTED ? 'BUSTED' : kind === SCREEN_WASTED ? 'WASTED' : 'CITY OWNED';
    const sub = kind === SCREEN_BUSTED
      ? 'The cops caught up with you.'
      : kind === SCREEN_WASTED
        ? 'You got taken out.'
        : 'You ran the syndicate. The city is yours.';
    const col = kind === SCREEN_BUSTED ? PALETTE.policeBlue : kind === SCREEN_WASTED ? PALETTE.policeRed : PALETTE.cash;

    const scale = 1 + Math.sin(t * 2) * 0.02;
    ctx.save();
    ctx.translate(V.width / 2, V.height / 2 - 40);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    font(84, 'bold', true);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 30;
    ctx.fillText(label, 0, 0);
    ctx.shadowBlur = 0;
    font(20);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(sub, 0, 70);
    ctx.restore();

    font(22, 'bold');
    const blink = 0.55 + Math.sin(t * 3) * 0.45;
    ctx.globalAlpha = blink * a;
    ctx.fillStyle = PALETTE.white;
    ctx.textAlign = 'center';
    ctx.fillText('PRESS SPACE TO PLAY AGAIN', V.width / 2, V.height / 2 + 150);
    ctx.globalAlpha = 1;
  }

  function drawPaused(state) {
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.fillStyle = 'rgba(6,8,16,0.6)';
    ctx.fillRect(0, 0, V.width, V.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    font(56, 'bold', true);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('PAUSED', V.width / 2, V.height / 2 - 20);
    font(18);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Press P or Esc to resume', V.width / 2, V.height / 2 + 40);
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    draw: drawWorld,
    drawTitle,
    drawEndScreen,
    drawPaused,
    drawFadeOverlay(alpha, color) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
      ctx.fillStyle = color || `rgba(6,8,16,${alpha})`;
      ctx.fillRect(0, 0, V.width, V.height);
    },
    SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_BUSTED, SCREEN_WASTED, SCREEN_WIN,
  };
}

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = clamp(parseInt(h.slice(0, 2), 16) + amt, 0, 255);
  const g = clamp(parseInt(h.slice(2, 4), 16) + amt, 0, 255);
  const b = clamp(parseInt(h.slice(4, 6), 16) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}