// The city: a deterministic grid of blocks separated by two-lane roads, generated from the
// seeded RNG once at boot. Each block holds a set of buildings (axis-aligned rectangles with a
// colour, a pseudo-3D height for the shadow and a window pattern) plus optional decoration
// (trees, streetlights, a parking lot or a pocket park). Everything is laid out so the renderer
// can draw it with a couple of camera-visible-range filters and nothing allocates per frame.
import { BLOCK_PITCH, CITY, ROAD_LANES, blockInner, roadStart } from './config.js';

/** A small integer hash -> 0..1, deterministic, for picking colours without storing them. */
function hash01(n) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const BUILDING_COLORS = [
  { face: '#8fa8c8', top: '#a9bfda', trim: '#6d87a8' },
  { face: '#c8a88f', top: '#e0c2a7', trim: '#a88a6d' },
  { face: '#9db89a', top: '#b8cfb4', trim: '#7d9a79' },
  { face: '#c49a9a', top: '#ddb4b4', trim: '#a67a7a' },
  { face: '#b0a4c8', top: '#c8bde0', trim: '#8c7fa8' },
  { face: '#d8c88f', top: '#eee0a8', trim: '#b4a46d' },
  { face: '#8fb8c0', top: '#aad2d8', trim: '#6d96a0' },
  { face: '#c8b89a', top: '#ded0b4', trim: '#a8987a' },
];

/** Split [0,size] into 1..n parts with random-ish but balanced lengths. */
function splitSpan(random, start, size, maxParts, minLen) {
  const parts = [];
  let cursor = start;
  let remaining = size;
  let guard = 0;
  while (remaining > minLen * 1.5 && parts.length < maxParts && guard < 40) {
    guard += 1;
    const want = minLen + random() * (remaining - minLen);
    const take = Math.min(remaining - minLen, want);
    if (take < minLen) break;
    parts.push({ a: cursor, len: take });
    cursor += take;
    remaining -= take;
    // occasionally leave a small alley gap
    if (remaining > minLen * 2 && random() < 0.18) {
      const gap = 12 + random() * 22;
      cursor += gap;
      remaining -= gap;
    }
  }
  if (remaining > 4) parts.push({ a: cursor, len: remaining });
  return parts;
}

function makeBuilding(random, x, y, w, h) {
  const palette = BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)];
  // Height in "floors" -> a longer shadow and a brighter top face.
  const floors = 1 + Math.floor(random() * 4);
  return {
    x, y, w, h,
    face: palette.face,
    top: palette.top,
    trim: palette.trim,
    floors,
    // window grid density
    winCols: Math.max(1, Math.floor(w / 46)),
    winRows: Math.max(1, Math.floor(h / 46)),
    lit: random(),
  };
}

/**
 * Build the whole city. Returns:
 *   roads        : [{k, vertical, base, lanes:[c1,c2]}] the centre-lines, for traffic + minimap
 *   buildings    : every building rect (collision + render)
 *   blocks       : per-block decoration lists {trees, lamps, parks, lots}
 *   intersections: [{x,y}] road crossings, for traffic lights
 */
export function generateCity(random) {
  const roads = [];
  for (let k = 0; k <= CITY.blocks; k += 1) {
    const base = roadStart(k);
    const lanes = [base + CITY.roadWidth / 2 - ROAD_LANES / 2, base + CITY.roadWidth / 2 + ROAD_LANES / 2];
    roads.push({ k, vertical: true, base, lanes });
    roads.push({ k, vertical: false, base, lanes });
  }

  const buildings = [];
  const blocks = [];
  const intersections = [];
  const n = CITY.blocks;

  for (let bi = 0; bi < n; bi += 1) {
    for (let bj = 0; bj < n; bj += 1) {
      const ix = blockInner(bi);
      const iy = blockInner(bj);
      const size = CITY.blockSize;
      const inner = { x: ix, y: iy, w: size, h: size };
      const block = {
        x: ix, y: iy, w: size, h: size,
        trees: [], lamps: [], parks: [], lots: [], buildings: [],
      };

      // Choose a block "type" deterministically from its coordinates.
      const kind = hash01(bi * 71 + bj * 131 + 7);
      if (kind < 0.14) {
        // Pocket park: grass with a scattering of trees and a path.
        block.parks.push({ x: ix, y: iy, w: size, h: size });
        const treeCount = 6 + Math.floor(hash01(bi * 13 + bj * 7) * 8);
        for (let t = 0; t < treeCount; t += 1) {
          block.trees.push({
            x: ix + 30 + hash01(bi * 991 + bj * 37 + t * 17) * (size - 60),
            y: iy + 30 + hash01(bi * 53 + bj * 911 + t * 29) * (size - 60),
            r: 16 + hash01(t * 101 + bi * 3 + bj) * 14,
          });
        }
        // benches / path lamps
        for (let l = 0; l < 3; l += 1) {
          block.lamps.push({
            x: ix + 40 + hash01(bi + bj * 5 + l) * (size - 80),
            y: iy + 40 + hash01(bi * 3 + bj + l) * (size - 80),
          });
        }
      } else if (kind < 0.26) {
        // Parking lot: dark asphalt with painted bays.
        block.lots.push({ x: ix, y: iy, w: size, h: size });
        for (let l = 0; l < 4; l += 1) {
          block.lamps.push({
            x: ix + 50 + l * (size - 100) / 3,
            y: iy + 30,
          });
        }
      } else {
        // Built-up block: subdivide into 1..6 buildings.
        const cols = splitSpan(random, ix + 8, size - 16, 3, 120);
        for (const col of cols) {
          const rows = splitSpan(random, iy + 8, size - 16, 3, 120);
          for (const row of rows) {
            // Leave a small setback.
            const pad = 6 + random() * 10;
            const b = makeBuilding(
              random,
              col.a + pad, row.a + pad,
              col.len - pad * 2, row.len - pad * 2,
            );
            if (b.w > 30 && b.h > 30) {
              buildings.push(b);
              block.buildings.push(b);
            }
          }
        }
        // Street trees along the block edges.
        const treeCount = 1 + Math.floor(random() * 3);
        for (let t = 0; t < treeCount; t += 1) {
          block.trees.push({
            x: ix - 10 + random() * (size + 20),
            y: iy - 10 + random() * (size + 20),
            r: 15 + random() * 10,
          });
        }
        // A lamp at the corner.
        block.lamps.push({ x: ix - 14, y: iy - 14 });
      }

      blocks.push(block);

      // Intersection lights at each corner of this block.
      for (const [ox, oy] of [
        [0, 0], [BLOCK_PITCH, 0], [0, BLOCK_PITCH], [BLOCK_PITCH, BLOCK_PITCH],
      ]) {
        intersections.push({ x: roadStart(bi) + ox + CITY.roadWidth / 2, y: roadStart(bj) + oy + CITY.roadWidth / 2 });
      }
    }
  }

  // De-duplicate intersections (shared corners).
  const seen = new Set();
  const uniq = [];
  for (const p of intersections) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    if (!seen.has(key)) { seen.add(key); uniq.push(p); }
  }

  return { roads, buildings, blocks, intersections: uniq };
}