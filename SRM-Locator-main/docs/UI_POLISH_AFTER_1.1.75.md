# UI polish and performance work after 1.1.75

Base: published `v1.1.75`, commit `570d59c388bc3ed1647c0a42d33df1dd7c3751df`.
Source branch: `fixes/1.1.75-polish-performance`. No release or update index is created.

## Changes

- Buildings uses the app's light/dark surfaces, a campus heading, searchable directory, category chips with counts, nearest-first ordering when location is available, and clear empty states.
- Building details now use theme tokens too. Navigate, rally and AR Scan remain separate actions.
- Building cards have keyboard-accessible detail buttons and 44px action targets.
- Removed every building row's Framer Motion layout measurement and backdrop blur. Offscreen cards use content visibility; images remain lazy and decode asynchronously.
- The directory is memoized with stable handlers, and unmounted behind the phone's Map tab. Actions always use committed location/navigation state.
- Devices reporting <=4GB memory or <=4 logical CPU cores get solid surfaces, fewer decorative animations and no tap-ring overlay; touch haptics remain. Unknown hardware keeps normal effects. Tracking and group update rates are unchanged.
- Theme shortcut shows Sun in light mode, Moon in dark mode, and its accessible label describes the destination. Settings and the shortcut apply through the same store immediately, without waiting for WebView view-transition promises or disabling the control.

## Validation

- 186 targeted tests passed, including isolated App tests for switching tabs, selecting buildings, navigation, Settings theme choice, rapid theme switching, stalled View Transition APIs, persisted preferences, stable callbacks, press feedback and the 13 detail-card action scenarios. The latter fixtures now clear remembered-group state and include 1.1.75's existing rally description field.
- Production build and Capacitor Android sync passed. Generated native path-only changes were discarded.
- New/rewritten focused modules passed ESLint.
- Playwright/Edge at 360x844 and 390x844 with 6x CPU throttling and simulated 2GB/4-core hardware: no page errors or horizontal overflow; search, category selection, empty-state reset, details/navigation callbacks and last-row clearance above the tabs passed. Twenty repeated theme changes completed synchronously without locking. Local reports/screenshots are in ignored `verification/`.
- A broader legacy integration run is not green: it hit obsolete building-info expectations and remembered-group state leaking between scenarios. Do not treat the targeted checks as proof the entire repository suite passes.

This is browser throttling, not a physical low-end Android benchmark. Real-device frame rate and vendor WebView behaviour still need field testing. No signing key or release asset is included.
