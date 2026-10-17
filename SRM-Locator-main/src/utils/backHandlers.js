// A tiny stack for the Android Back button: a surface that wants Back (the building sheet
// collapsing to its cloud) pushes a handler; useBackButtonGuard runs the newest one first and
// only falls through to its own behaviour when none claims the press.
const stack = [];

/** @param {() => boolean | void} fn return false to decline the press. @returns {() => void} remove */
export function pushBackHandler(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** @returns {boolean} true when a handler took the press. */
export function runBackHandler() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true;
  }
  return false;
}
