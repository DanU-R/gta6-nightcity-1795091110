// Keyboard and pointer input. Held keys give steering; one-shot presses (enter/exit car,
// fire, start/restart, pause) are queued as bit flags and consumed once by the loop, so a
// press between two frames is never lost and never counted twice.

export const ACTION_FIRE = 1;
export const ACTION_ENTER = 2;
export const ACTION_CONFIRM = 4;
export const ACTION_PAUSE = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const ENTER = new Set(['KeyE']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
/** Keys whose default scrolling/navigation we always suppress. */
const OWNED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'KeyE', 'Space', 'Enter', 'KeyP', 'Escape',
]);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let pointerFiring = false;

  window.addEventListener('keydown', (event) => {
    if (!OWNED.has(event.code)) return;
    event.preventDefault();
    held.add(event.code);
    if (event.repeat) return;
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (ENTER.has(event.code)) actions |= ACTION_ENTER;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
  });

  window.addEventListener('keyup', (event) => {
    if (!OWNED.has(event.code)) return;
    event.preventDefault();
    held.delete(event.code);
  });

  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    pointerFiring = false;
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) pointerFiring = true;
    actions |= ACTION_CONFIRM;
    // Resume the audio context on the first gesture anywhere.
    if (window.__audio) window.__audio.resume();
  });
  window.addEventListener('pointerup', () => {
    pointerFiring = false;
  });

  return {
    /** -1 / 0 / 1 axes. */
    axisX() {
      return (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
    },
    axisY() {
      return (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
    },
    /** Held, for per-frame shooting. */
    wantsFire() {
      return held.has('Space') || pointerFiring;
    },
    /** Sprint while held. */
    wantsSprint() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}