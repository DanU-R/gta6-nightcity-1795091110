// Keyboard + pointer input. Held keys give movement; one-shot presses (enter/exit car,
// interact, restart, pause) are queued as bit flags and taken once by the loop, so a
// press between two frames is never lost and never counted twice.

export const ACT_ENTER = 1;    // E — enter / exit vehicle
export const ACT_SHOOT = 2;    // Space / click — fire
export const ACT_RESTART = 4;  // Enter — start / restart
export const ACT_PAUSE = 8;    // P / Esc — pause

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const ENTER = new Set(['KeyE']);
const SHOOT = new Set(['Space']);
const RESTART = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const HANDLED = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, ...ENTER, ...SHOOT, ...RESTART, ...PAUSE]);

export function createInput(target) {
  let left = false;
  let right = false;
  let up = false;
  let down = false;
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    if (!HANDLED.has(event.code)) return;
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (ENTER.has(event.code)) { if (!event.repeat) actions |= ACT_ENTER; }
    else if (SHOOT.has(event.code)) { if (!event.repeat) actions |= ACT_SHOOT; }
    else if (RESTART.has(event.code)) { if (!event.repeat) actions |= ACT_RESTART; }
    else if (PAUSE.has(event.code)) { if (!event.repeat) actions |= ACT_PAUSE; }
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
  });

  // A key released while the tab is hidden never sends keyup: let go on blur.
  window.addEventListener('blur', () => {
    left = false; right = false; up = false; down = false;
  });

  target.addEventListener('pointerdown', () => { actions |= ACT_SHOOT; });

  return {
    /** Movement vector, normalised to length <= 1. */
    move() {
      let x = (right ? 1 : 0) - (left ? 1 : 0);
      let y = (down ? 1 : 0) - (up ? 1 : 0);
      if (x !== 0 && y !== 0) {
        const inv = 1 / Math.SQRT2;
        x *= inv; y *= inv;
      }
      return { x, y };
    },
    /** Held shoot state (for automatic fire feel we use the queued action instead). */
    shooting() {
      return false;
    },
    /** The one-shot presses since the last call, as ACT_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}