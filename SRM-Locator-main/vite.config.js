import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    buildModeMarker(mode),
  ],
  server: {
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/node_modules/**'],
    },
  },
  // Tests assume the keyless (Leaflet) build whatever the developer's .env holds, and a
  // phone where location was allowed before (tests/setup/locationAllowed.js).
  test: { env: { VITE_GOOGLE_MAPS_API_KEY: '' }, setupFiles: ['./tests/setup/locationAllowed.js', './tests/setup/freshPhone.js'] },
}))
