// Boot and the one loop. Input is read each frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The
// game moves between title, play and paused screens; BUSTED/WASTED/WIN are overlays the world
// raises and the loop reacts to (sound + auto-respawn).
//
// ?shot=start|play|action|map (with &seed=N) stages that deterministic scene instead of
// running the loop, paints it twice, and sets window.__shotReady for a screenshot.
import { STEP, SAVE_KEY } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_BUSTED, EVENT_WASTED, EVENT_SHOT, EVENT_MISSION, EVENT_CRASH, EVENT_WIN, EVENT_STAR } from './world.js';
import { ACT_ENTER, ACT_SHOOT, ACT_RESTART, ACT_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

// ---- Save / load --------------------------------------------------------

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: Math.floor(world.state.cash),
      missionIndex: world.state.missionIndex,
    }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

// ---- Shot mode ----------------------------------------------------------

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, world.city);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// ---- Game mode ----------------------------------------------------------

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  function announce(message) { status.textContent = message; }

  const saved = loadSave();
  if (saved && typeof saved.cash === 'number') {
    world.state.cash = saved.cash;
    world.state.missionIndex = Math.min(2, Math.max(0, saved.missionIndex | 0));
    world.reset(true);
  }

  function startGame() {
    audio.resume();
    world.reset(true); // keep loaded cash / mission progress
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. WASD to move. E to enter a car. Space to shoot.');
  }

  function handleActions(actions) {
    if (actions & ACT_RESTART) {
      if (screen === SCREEN_TITLE) startGame();
      else if (screen === SCREEN_PAUSED) screen = SCREEN_PLAY;
    }
    if (screen === SCREEN_PLAY) {
      if (actions & ACT_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & ACT_PAUSE) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function step(actions) {
    const move = input.move();
    const worldActions = {
      enter: !!(actions & ACT_ENTER),
      shoot: !!(actions & ACT_SHOOT),
    };
    const events = world.step(STEP, move, worldActions);
    reactToEvents(events);
    // Persist progress whenever something meaningful changes.
    if (events & (EVENT_MISSION | EVENT_WIN)) writeSave();
  }

  function reactToEvents(events) {
    if (events & EVENT_SHOT) audio.shoot();
    if (events & EVENT_CRASH) audio.crash();
    if (events & EVENT_MISSION) { audio.mission(); writeSave(); }
    if (events & EVENT_WIN) { audio.mission(); announce('All missions complete. You made it!'); }
    if (events & EVENT_BUSTED) { audio.busted(); audio.engine(false); announce('Busted. Respawning at the safehouse.'); }
    if (events & EVENT_WASTED) { audio.busted(); audio.engine(false); announce('Wasted. Respawning at the safehouse.'); }
    if (events & EVENT_STAR) audio.star();
    // Engine hum follows driving.
    if (world.player.car) {
      audio.engine(true);
      audio.engineSpeed(Math.min(1, Math.abs(world.player.car.speed || 0) / 520));
    } else {
      audio.engine(false);
    }
    // Sirens when there's a wanted level and cops around.
    if (world.state.stars > 0 && world.state.police.length > 0) {
      world.state.sirenTimer -= STEP;
      if (world.state.sirenTimer <= 0) {
        audio.siren();
        world.state.sirenTimer = 0.6;
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_PLAY) {
      // Enter/exit and shooting are edge-triggered: only fire once even if several fixed
      // steps run this frame.
      let firstActions = actions;
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step(firstActions);
        firstActions = 0;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
      // Title screen: keep the world alive (traffic/peds) but don't move the player.
      if (screen === SCREEN_TITLE) world.step(STEP, { x: 0, y: 0 }, { enter: false, shoot: false });
      audio.engine(false);
    }
    renderer.draw(world.state, screen, world.city);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
      writeSave();
    }
  });
  // Save on unload too.
  window.addEventListener('beforeunload', writeSave);

  announce('Port Meridian Vice. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();