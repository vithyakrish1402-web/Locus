import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installPressFeedback } from './utils/pressFeedback.js'

// App-wide "sonar ping" on every press (see src/utils/pressFeedback.js).
installPressFeedback()

// Device-check builds only (npm run device-check:wifi). Vite replaces MODE with a
// constant, so in every other build this branch and its import are compiled out.
if (import.meta.env.MODE === 'device-check') {
  import('./devtools/wifiDeviceCheck.js').then((check) => check.installWifiDeviceCheck())
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
