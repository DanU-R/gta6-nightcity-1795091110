// Every tuning number and colour in one place. The playfield is a fixed 1280x720 logical
// area; the renderer scales it to the window, so no rule here depends on the screen size.

export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The city grid: blocks are square, separated by two-lane roads with sidewalks. */
export const CITY = {
  blocks: 9,          // blocks per side
  blockSize: 520,     // buildable square, each side
  roadWidth: 132,     // asphalt width (two lanes + markings)
  sidewalk: 46,       // sidewalk ring around each block
  size: 0,            // filled in below: full world extent
};

/** Pitch from one block origin to the next. */
export const BLOCK_PITCH = CITY.blockSize + CITY.roadWidth;
/** Full city extent in pixels (blocks * pitch + one trailing road). */
CITY.size = CITY.blocks * BLOCK_PITCH + CITY.roadWidth;
export const ROAD_LANES = 30; // half-width of one lane

/** Centre-line positions for a road band starting at `base`: two 30px lanes. */
export function laneCenters(base) {
  const c = base + CITY.roadWidth / 2;
  return [c - ROAD_LANES / 2, c + ROAD_LANES / 2];
}

/** World coordinate where road band k (k in 0..blocks) starts, on either axis. */
export const roadStart = (k) => k * BLOCK_PITCH;

/** Block k's inner buildable origin (inside its sidewalk ring), on either axis. */
export const blockInner = (k) => k * BLOCK_PITCH + CITY.roadWidth + CITY.sidewalk;

export const PLAYER = {
  radius: 13,
  speed: 230,
  sprint: 1.45,
  health: 100,
  fireRate: 0.14,      // seconds between shots
};

export const CAR = {
  length: 64,
  width: 32,
  maxSpeed: 430,
  reverseSpeed: 150,
  accel: 330,
  brake: 520,
  drag: 120,
  grip: 0.86,          // lateral velocity retained per step (lower = grippier)
  turnRate: 2.6,       // rad/sec at full speed
  bulletDamage: 14,
  ramDamage: 26,
};

export const TRAFFIC = {
  count: 22,
  maxSpeed: 180,
  speedVariance: 70,
};

export const PED = {
  count: 34,
  walkSpeed: 62,
  panicSpeed: 165,
  panicRadius: 230,
  panicTime: 3.5,
};

export const POLICE = {
  spawnPerStar: 1,     // one cruiser per wanted star
  speed: 300,
  maxSpeed: 380,
  accel: 260,
  turnRate: 2.4,
  bustRadius: 60,      // on-foot distance to bust
  bustTime: 1.6,       // seconds in range to be busted
  boxDistance: 150,    // cars must be within this to count as boxing
  boxTime: 2.4,
};

export const WANTED = {
  max: 5,
  decayDelay: 9,       // seconds without crime before stars begin to fade
  decayEvery: 5,       // seconds per star lost
};

export const BULLET = {
  speed: 1500,
  life: 0.75,
  damage: 34,
};

export const WORLD = {
  trafficLightPeriod: 11,
};

/** localStorage key for cash + mission progress. */
export const SAVE_KEY = 'neon-syndicate.save';

export const MISSIONS = [
  {
    id: 0,
    title: 'Warm Welcome',
    brief: 'A rival crew is muscling in. Take their wheelman off the board.',
    objective: 'Reach the red marker',
    target: { x: 3.2, y: 1.4 },   // in block units
    reward: 500,
    next: 'Steal any car and lose the heat',
  },
  {
    id: 1,
    title: 'Grand Theft Auto',
    brief: 'Boost a fresh ride and shake the cops. Keep it clean.',
    objective: 'Steal a car and escape the police',
    reward: 900,
    next: 'Collect the briefcase across town',
  },
  {
    id: 2,
    title: 'Special Delivery',
    brief: 'A briefcase of cash is waiting downtown. Go get it.',
    objective: 'Reach the green marker',
    target: { x: 6.8, y: 6.4 },
    reward: 1600,
    next: null,
  },
];

export const PALETTE = {
  backdrop: '#0c1020',
  asphalt: '#3a3f52',
  asphaltDark: '#33384a',
  laneLine: '#f4d35e',
  laneDash: '#e9edf5',
  sidewalk: '#b9bec9',
  sidewalkEdge: '#9aa0ad',
  grass: '#5fae5f',
  grassDark: '#4d9a4d',
  tree: '#2f7d3a',
  treeDark: '#276730',
  trunk: '#6b4a2f',
  buildingShadow: 'rgba(20, 24, 40, 0.22)',
  roadGlow: 'rgba(255, 214, 110, 0.55)',
  policeRed: '#ff3b5c',
  policeBlue: '#2f6bff',
  policeBody: '#20242f',
  player: '#4fd0e0',
  playerDark: '#2b9aa8',
  ped: ['#e85d75', '#f2a541', '#4fb3e8', '#8e6fd4', '#5fcf80', '#ef7bb0', '#d8d8d8'],
  carColors: ['#e05263', '#f2a541', '#4fb3e8', '#7dc35a', '#b07de0', '#e8e8e8', '#4a4a58', '#2f8f9a'],
  policeLight: '#ffd34d',
  muzzle: '#ffe08a',
  tracer: '#ffd34d',
  wanted: '#ffd23f',
  wantedEmpty: 'rgba(255,255,255,0.18)',
  health: '#4fd36b',
  healthLow: '#ff5a4f',
  cash: '#5fe08a',
  white: '#ffffff',
  panel: 'rgba(16, 20, 34, 0.82)',
  panelEdge: 'rgba(255,255,255,0.10)',
  shadow: 'rgba(10, 12, 22, 0.35)',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const DISPLAY_FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';