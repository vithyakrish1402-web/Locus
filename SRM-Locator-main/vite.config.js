import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Tests assume the keyless (Leaflet) build whatever the developer's .env holds.
  test: { env: { VITE_GOOGLE_MAPS_API_KEY: '' } },
})
