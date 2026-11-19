// Procedural city: a grid of blocks separated by roads, each block filled with one or
// more rectangular buildings with varied colours and "heights" (drawn as a lighter roof).
// Everything is derived from the seeded RNG so a seed always yields the same city, and the
// same layout can be rebuilt for the simulation and for rendering.
import { CITY, CELL, WORLD, PALETTE } from './config.js';
import { int, pick, range } from './random.js';

/**
 * Build the city for a given RNG. Returns:
 *   buildings: [{ x, y, w, h, color, roof, windows }]  — solid rectangles in world space
 *   blocks:    [{ x, y, w, h }]                          — sidewalk areas (for peds / greenery)
 *   roads:     { xs: [x...], ys: [y...], centers }       — road centre lines and widths
 *   roadRects: [{ x, y, w, h, vertical }]                — drivable road rectangles
 *   isRoad(x, y): boolean                                — point test against road rects
 */
export function createCity(random) {
  const buildings = [];
  const blocks = [];
  const roadXs = [];
  const roadYs = [];
  const roadRects = [];

  const { cols, rows, block, road, margin } = CITY;

  // Vertical roads run between block columns; horizontal between block rows. A road of
  // width `road` sits at each cell boundary. World origin is margin + half a road in.
  for (let c = 0; c <= cols; c++) {
    const x = margin + c * CELL;
    roadXs.push(x + road / 2);
    roadRects.push({ x, y: margin, w: road, h: rows * CELL + road, vertical: true });
  }
  for (let r = 0; r <= rows; r++) {
    const y = margin + r * CELL;
    roadYs.push(y + road / 2);
    roadRects.push({ x: margin, y, w: cols * CELL + road, h: road, vertical: false });
  }

  // Each block: a sidewalk pad with 1-4 buildings inside it.
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const bx = margin + road + c * CELL;
      const by = margin + road + r * CELL;
      const pad = 10; // sidewalk width around buildings
      blocks.push({ x: bx, y: by, w: block, h: block });

      // Decide how to split the block into 1-4 lots.
      const split = int(random, 1, 3); // 1 => one big, 2 => halves, 3 => quarters
      const inner = { x: bx + pad, y: by + pad, w: block - pad * 2, h: block - pad * 2 };
      const lots = [];
      if (split === 1) {
        lots.push(inner);
      } else if (split === 2) {
        if (random() < 0.5) {
          const w = inner.w / 2 - 4;
          lots.push({ x: inner.x, y: inner.y, w, h: inner.h });
          lots.push({ x: inner.x + w + 8, y: inner.y, w: inner.w - w - 8, h: inner.h });
        } else {
          const h = inner.h / 2 - 4;
          lots.push({ x: inner.x, y: inner.y, w: inner.w, h });
          lots.push({ x: inner.x, y: inner.y + h + 8, w: inner.w, h: inner.h - h - 8 });
        }
      } else {
        const w = inner.w / 2 - 4;
        const h = inner.h / 2 - 4;
        lots.push({ x: inner.x, y: inner.y, w, h });
        lots.push({ x: inner.x + w + 8, y: inner.y, w: inner.w - w - 8, h });
        lots.push({ x: inner.x, y: inner.y + h + 8, w, h: inner.h - h - 8 });
        lots.push({ x: inner.x + w + 8, y: inner.y + h + 8, w: inner.w - w - 8, h: inner.h - h - 8 });
      }

      for (const lot of lots) {
        // Occasionally leave a lot empty (a small park / parking area).
        if (random() < 0.12) continue;
        const inset = range(random, 2, 8);
        const w = lot.w - inset * 2;
        const h = lot.h - inset * 2;
        if (w < 30 || h < 30) continue;
        const color = pick(random, PALETTE.building);
        const roof = pick(random, PALETTE.buildingTop);
        // Window grid derived deterministically from size.
        const windows = [];
        const cols2 = Math.max(1, Math.floor(w / 26));
        const rows2 = Math.max(1, Math.floor(h / 26));
        for (let wy = 0; wy < rows2; wy++) {
          for (let wx = 0; wx < cols2; wx++) {
            if (random() < 0.55) {
              windows.push({
                x: lot.x + inset + 8 + wx * ((w - 16) / cols2),
                y: lot.y + inset + 8 + wy * ((h - 16) / rows2),
              });
            }
          }
        }
        buildings.push({
          x: lot.x + inset,
          y: lot.y + inset,
          w,
          h,
          color,
          roof,
          windows,
        });
      }
    }
  }

  function isRoad(x, y) {
    // Inside the drivable area?
    if (x < margin || y < margin || x > WORLD.width - margin || y > WORLD.height - margin) return false;
    // On a vertical road?
    for (let c = 0; c <= cols; c++) {
      const rx = margin + c * CELL;
      if (x >= rx && x <= rx + road) return true;
    }
    for (let r = 0; r <= rows; r++) {
      const ry = margin + r * CELL;
      if (y >= ry && y <= ry + road) return true;
    }
    return false;
  }

  return { buildings, blocks, roadXs, roadYs, roadRects, isRoad };
}

/** Axis-aligned overlap test between two rects {x,y,w,h}. */
export function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** True if a circle at (x,y) radius r intersects any building rect. */
export function circleHitsBuildings(city, x, y, r) {
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    // Closest point on rect to circle centre.
    const cx = Math.max(b.x, Math.min(x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return b;
  }
  return null;
}

/** True if an oriented-ish box (approximated by its bounding circle) hits a building. */
export function boxHitsBuildings(city, x, y, halfLen, halfWid) {
  const r = Math.sqrt(halfLen * halfLen + halfWid * halfWid);
  return circleHitsBuildings(city, x, y, r) !== null;
}