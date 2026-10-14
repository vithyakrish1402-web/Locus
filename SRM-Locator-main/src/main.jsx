import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ColdStartSplash from './components/ColdStartSplash.jsx'
import { installPressFeedback } from './utils/pressFeedback.js'
import { installTheme } from './theme/theme.js'

// Light or dark: the saved choice, else the phone's own setting, followed live while the
// choice is System (index.html already set it once, before first paint).
installTheme()

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
    {/* Cold-start animation over the app: it plays once, then fades once the sign-in check
        has settled. Mounted here, not in App.jsx, which has ~10 early-return screens. */}
    <ColdStartSplash />
  </StrictMode>,
)
