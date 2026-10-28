import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Every web build says which Vite mode built it, in dist/locus-build.json. The release
// scripts and the Android release build refuse anything but 'production', so a test build
// (npm run sidetest:install, mode 'sidetest') or a device check can never ship. Only the
// mode, no time: the same source still builds the same bytes (release-bundle.mjs relies on it).
const buildModeMarker = (mode) => ({
  name: 'locus-build-mode-marker',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'locus-build.json', source: `${JSON.stringify({ mode })}\n` })
  },
})

// Which source a build came from, for the Floor 7 walk recorder's summary file (test build
// only: nothing else reads it, so no other build contains it).
const git = (cmd) => { try { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return 'unknown' } }
const buildInfo = () => ({
  version: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
  branch: git('rev-parse --abbrev-ref HEAD'),
  commit: git('rev-parse --short HEAD'),
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: { __LOCUS_BUILD__: JSON.stringify(buildInfo()) },
  plugins: [
    react(),
    tailwindcss(),
    buildModeMarker(mode),
  ],
  // Tests assume the keyless (Leaflet) build whatever the developer's .env holds, and a
  // phone where location was allowed before (tests/setup/locationAllowed.js). A test server
  // founds far more Groups as one person than the server's hourly limit lets anyone else.
  test: {
    env: { VITE_GOOGLE_MAPS_API_KEY: '', LOCUS_MAX_GROUPS_PER_HOUR: '100000' },
    setupFiles: ['./tests/setup/locationAllowed.js'],
    // The tests that render the whole App take 1 to 10 s each when the machine is quiet and
    // more than the 5 s default when the suite runs in parallel on a busy one. A test that
    // really hangs still fails, only later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}))
