// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between screens: title, play, paused, busted, wasted and win. Audio is initialised on the
// first gesture. ?seed=N fixes the city; ?shot=start|play|action|map stages a deterministic scene
// for the screenshot tool and sets window.__shotReady once painted.
import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EV_BUSTED, EV_CASH, EV_CRASH, EV_EXPLODE, EV_MISSION, EV_SHOT, EV_STEAL, EV_WASTED, EV_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED, SCREEN_WIN } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : (Math.random() * 4294967296) >>> 0;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();
window.__audio = audio; // input.js resumes this on the first gesture
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
let currentScreen = 'title'; // mirrored from runGame's local `screen` for the debug handle

// --- save/load -------------------------------------------------------------
function loadSave() {
  try {
    const raw = window.localStorage.getItem('neon-syndicate.save');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.cash === 'number' && typeof data.mission === 'number') return data;
  } catch { /* ignore */ }
  return null;
}
function persist() {
  try {
    window.localStorage.setItem('neon-syndicate.save', JSON.stringify({
      cash: world.state.cash,
      mission: world.state.missionIndex,
    }));
  } catch { /* storage can be off */ }
}

function announce(message) {
  status.textContent = message;
}

// --- toasts ----------------------------------------------------------------
function toast(text, color, life) {
  if (!world.state.toasts) world.state.toasts = [];
  world.state.toasts.push({ text, color: color || '#fff', life: life || 2.6, maxLife: life || 2.6 });
  if (world.state.toasts.length > 4) world.state.toasts.shift();
}
function updateToasts(dt) {
  const t = world.state.toasts;
  if (!t) return;
  for (let i = t.length - 1; i >= 0; i -= 1) {
    t[i].life -= dt;
    if (t[i].life <= 0) t.splice(i, 1);
  }
}

// --- screenshot mode -------------------------------------------------------
function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  const t0 = performance.now();
  function paint() {
    const t = (performance.now() - t0) / 1000;
    if (scene.screen === SCREEN_TITLE) {
      renderer.drawTitle(world.state, t);
    } else {
      renderer.draw(world.state);
    }
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// --- normal game -----------------------------------------------------------
function runGame() {
  const input = createInput(canvas);
  const save = loadSave();
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let endFade = 0;
  let titleTime = 0;

  // Apply a loaded save to the state without starting a mission.
  function applySave() {
    if (!save) return;
    world.state.cash = save.cash || 0;
  }

  function startGame() {
    world.reset();
    world.state.toasts = [];
    accumulator = 0;
    endFade = 0;
    screen = SCREEN_PLAY;
    currentScreen = screen;
    // Restore progress from the save (cash + mission index).
    const s = loadSave();
    if (s) {
      world.state.cash = s.cash || 0;
      if (typeof s.mission === 'number' && s.mission > 0 && s.mission < 3) {
        world.state.missionIndex = s.mission;
        world.startMission(s.mission);
      }
    }
    toast('Welcome to Neon City', '#4fd0e0', 3);
    announce('Playing.');
  }

  function endGame(kind) {
    screen = kind;
    currentScreen = screen;
    endFade = 0;
    persist();
    audio.setEngine(0, false);
    audio.setSiren(0);
    audio.fail();
    announce(kind === SCREEN_BUSTED ? 'Busted.' : kind === SCREEN_WASTED ? 'Wasted.' : 'City owned!');
  }

  function handleActions() {
    const actions = input.takeActions();
    audio.init();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame();
      return;
    }
    if (screen === SCREEN_PLAY) {
      if (actions & ACTION_ENTER) world.tryEnterExit();
      if (actions & ACTION_PAUSE) { screen = SCREEN_PAUSED; currentScreen = screen; announce('Paused.'); }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) { screen = SCREEN_PLAY; currentScreen = screen; announce('Playing.'); }
    } else {
      // Busted / wasted / win: restart.
      if (actions & ACTION_CONFIRM) startGame();
    }
  }

  function stepPlay() {
    const ax = input.axisX();
    const ay = input.axisY();
    const intent = {
      x: ax,
      y: ay,
      sprint: input.wantsSprint ? input.wantsSprint() : false,
      fire: input.wantsFire(),
    };
    const events = world.step(STEP, intent);

    // Audio cues.
    if (events & EV_SHOT) audio.shot();
    if (events & EV_CRASH) audio.crash();
    if (events & EV_EXPLODE) audio.boom();
    if (events & EV_CASH) audio.cash();
    if (events & EV_MISSION) audio.sting();
    if (events & EV_STEAL) toast('Grand theft auto!', '#ffd23f');
    if (events & EV_BUSTED) { endGame(SCREEN_BUSTED); return; }
    if (events & EV_WASTED) { endGame(SCREEN_WASTED); return; }
    if (events & EV_WIN) { endGame(SCREEN_WIN); return; }

    // Engine + siren audio tracking.
    const car = world.state.player.car;
    if (car) {
      const sp = Math.hypot(car.vx, car.vy);
      audio.setEngine(Math.min(1, sp / 430), true);
      if (car.turnSmoke > 0 && Math.random() < 0.08) audio.skid();
    } else {
      audio.setEngine(0, false);
    }
    audio.setSiren(world.state.nearestSiren);

    // Player "moving" flag for the walk animation.
    world.state.player._moving = Math.abs(ax) + Math.abs(ay) > 0.01;

    updateToasts(STEP);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += dt;
    last = now;
    handleActions();

    if (screen === SCREEN_TITLE) {
      titleTime += dt;
      accumulator = 0;
      // Animate the title backdrop with a harmless world tick.
      world.step(STEP, { x: 0, y: 0, fire: false }, true);
      renderer.drawTitle(world.state, titleTime);
      return;
    }

    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        stepPlay();
        accumulator -= STEP;
        if (screen !== SCREEN_PLAY) break;
      }
      renderer.draw(world.state);
      return;
    }

    if (screen === SCREEN_PAUSED) {
      accumulator = 0;
      renderer.draw(world.state);
      renderer.drawPaused(world.state);
      return;
    }

    // End screens: keep animating particles/camera a little, fade in.
    endFade = Math.min(1, endFade + 0.04);
    renderer.draw(world.state);
    renderer.drawEndScreen(world.state, screen, now / 1000, endFade);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Neon Syndicate. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();

// A debug handle for automated testing and screenshots: the live game's world and helpers.
// Harmless in normal play; lets the test harness drive and inspect the simulation.
window.__game = {
  world,
  renderer,
  get screen() { return currentScreen; },
};