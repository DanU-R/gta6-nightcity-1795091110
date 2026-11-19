// Every tuning number and colour in one place. The world is a large grid city; the
// renderer draws a camera window onto it. All distances are in world pixels.

// Logical render size: the camera viewport the renderer scales to the window.
export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

// ---- City layout ---------------------------------------------------------
// The city is a grid of blocks separated by roads. One "cell" is a city block plus
// the road that borders it. Roads run along cell boundaries.
export const CITY = {
  cols: 14,            // blocks across
  rows: 14,            // blocks down
  block: 220,          // block (buildings + sidewalk) size in px
  road: 90,            // road width in px (also the gap between blocks)
  margin: 120,         // empty border around the whole city
};
// A cell = block + road. World coordinate of cell (i,j)'s top-left block corner.
export const CELL = CITY.block + CITY.road;
export const WORLD = {
  width: CITY.cols * CELL + CITY.road + CITY.margin * 2,
  height: CITY.rows * CELL + CITY.road + CITY.margin * 2,
};

// ---- Player on foot ------------------------------------------------------
export const PLAYER = {
  radius: 12,
  speed: 190,
  maxHealth: 100,
  fireCooldown: 0.22,
  bulletSpeed: 900,
  bulletLife: 0.7,
};

// ---- Cars ----------------------------------------------------------------
export const CAR = {
  width: 46,
  height: 26,
  maxSpeed: 520,
  accel: 420,
  brake: 640,
  reverseSpeed: 180,
  turnRate: 2.6,        // radians/sec at full grip
  friction: 0.9,        // velocity retained per 1/60 when coasting
  grip: 6,              // how fast velocity aligns to heading
  enterRadius: 60,
};

export const TRAFFIC = {
  count: 26,
  speed: 150,
};

export const PED = {
  count: 40,
  radius: 10,
  speed: 60,
  fleeSpeed: 150,
  fleeRadius: 220,
};

export const POLICE = {
  spawnRadius: 1400,    // spawn just off-screen relative to player
  chaseSpeed: 360,
  ramSpeed: 480,
  bustRadius: 46,       // within this of a stopped player on foot -> busted
  bustTime: 2.2,        // seconds a cop must stay close to bust
};

// ---- Wanted level --------------------------------------------------------
export const WANTED = {
  max: 5,
  decayDelay: 9,        // seconds crime-free before decay starts
  decayRate: 0.28,      // stars per second once decaying
  thresholds: [0, 1, 2, 3, 4, 5], // heat value -> star count
};

export const MISSIONS = [
  {
    id: 'warmup',
    title: 'A Fresh Start',
    brief: ['Welcome to Port Meridian.', 'Grab any parked car and drive it', 'to the marker across town.'],
    target: 'car',          // objective type
    reward: 500,
    story: 'Word on the street is you can handle yourself. Prove it.',
  },
  {
    id: 'heat',
    title: 'Losing the Heat',
    brief: ['The cops noticed that stunt.', 'Lose your wanted level: reach the', 'safehouse and lay low.'],
    target: 'safehouse',
    reward: 1200,
    story: 'Keep your head down until the stars fade. Then we talk business.',
  },
  {
    id: 'score',
    title: 'The Big Score',
    brief: ['One last job. Reach the docks', 'marker and hold out against the', 'heat coming your way.'],
    target: 'survive',
    reward: 2500,
    story: 'The docks. Get there, survive the response, and you are made.',
  },
];

// ---- Palette -------------------------------------------------------------
export const PALETTE = {
  backdrop: '#0b0e14',
  grass: '#22331f',
  grassAlt: '#263a22',
  road: '#2b2f38',
  roadLine: '#c9a84a',
  sidewalk: '#4a4f5a',
  lane: '#3a3f49',
  building: ['#5b6b7a', '#6d5a52', '#52604f', '#66566b', '#4a5568', '#705c4e'],
  buildingTop: ['#73859a', '#857067', '#68796a', '#7f6d87', '#5f6d85', '#8a7060'],
  window: '#ffe08a',
  playerBody: '#3ad0e0',
  playerHead: '#e8c9a0',
  copBody: '#2b3a67',
  copLight: '#ff3b3b',
  copLight2: '#3b6bff',
  carColors: ['#c94f4f', '#4f79c9', '#c9a84f', '#4fc98a', '#c96fc9', '#cfd4da', '#e07b39'],
  policeCar: '#1c2742',
  marker: '#ffd23f',
  markerOk: '#4fd07a',
  hudBg: 'rgba(12,16,24,0.82)',
  hudText: '#eef2f7',
  hudMuted: '#9aa4b4',
  star: '#ffd23f',
  starOff: 'rgba(255,210,63,0.22)',
  danger: '#ff4d4d',
  cash: '#4fd07a',
  health: '#4fd07a',
  healthLow: '#ff5a5a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** localStorage keys. */
export const SAVE_KEY = 'port-meridian.save.v1';