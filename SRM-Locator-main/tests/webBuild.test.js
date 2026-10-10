// The release scripts ship only a production web build made by that same run
// (scripts/lib/webBuild.mjs): never the test build's JavaScript, a device check, or a
// build left over from before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_MARKER, readBuildMode, webBuildProblem } from '../scripts/lib/webBuild.mjs';

let dir;
const mark = (mode) => writeFileSync(join(dir, BUILD_MARKER), `${JSON.stringify({ mode })}\n`);
const problem = (builtAfter = Date.now() - 5000) => webBuildProblem({ dir, builtAfter, label: 'dist/' });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'locus-web-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('which build a folder holds', () => {
  it('reads the mode', () => {
    mark('sidetest');
    expect(readBuildMode(dir)).toBe('sidetest');
  });

  it('nothing when there is no marker or it is unreadable', () => {
    expect(readBuildMode(dir)).toBeNull();
    writeFileSync(join(dir, BUILD_MARKER), 'not json');
    expect(readBuildMode(dir)).toBeNull();
  });
});

describe('whether it may ship', () => {
  it('a production build made by this run may', () => {
    mark('production');
    expect(problem()).toBeNull();
  });

  it('the test build may not', () => {
    mark('sidetest');
    expect(problem()).toMatch(/'sidetest' build, not production/);
  });

  it('a device check may not', () => {
    mark('device-check');
    expect(problem()).toMatch(/'device-check' build/);
  });

  it('a build with no marker may not', () => {
    expect(problem()).toMatch(/no locus-build\.json/);
  });

  it('a production build from before this run may not', () => {
    mark('production');
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(join(dir, BUILD_MARKER), old, old);
    expect(problem(Date.now() - 5000)).toMatch(/older than this run/);
  });
});
