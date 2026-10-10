// Which web build a folder holds, from the locus-build.json every Vite build writes
// (vite.config.js), and whether it may ship. The release scripts call this on what they just
// built and synced, so test JavaScript (npm run sidetest:install builds in mode 'sidetest')
// or a device check can never reach a release: a release takes only a production build made
// by that same run.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BUILD_MARKER = 'locus-build.json';

/** The Vite mode that built `dir`, or null when it says nothing (no marker, unreadable). */
export function readBuildMode(dir) {
  const file = join(dir, BUILD_MARKER);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).mode ?? null;
  } catch {
    return null;
  }
}

/**
 * Why `dir` must not ship, or null when it may: a production build written at or after
 * `builtAfter` (epoch ms), i.e. by this run, not left over from an earlier one.
 * @param {{ dir: string, builtAfter: number, label: string }} input
 */
export function webBuildProblem({ dir, builtAfter, label }) {
  const mode = readBuildMode(dir);
  if (mode === null) return `${label} has no ${BUILD_MARKER}: not a build this script made`;
  if (mode !== 'production') return `${label} is a '${mode}' build, not production (a test or check build must never ship)`;
  // A second's slack: some filesystems store whole-second times.
  if (statSync(join(dir, BUILD_MARKER)).mtimeMs < builtAfter - 1000) return `${label} is older than this run: rebuild it`;
  return null;
}
