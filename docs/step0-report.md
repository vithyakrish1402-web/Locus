# LOCUS redesign: Step 0 report (read-only check)

Date: 2026-10-05. Checked against `main` at `69819b0`.

## Files found

The redesign files are in two subfolders of `docs/`, not directly in `docs/`:

- `docs/redesign/handoff.md`: **I used this as the handoff note.**
- `docs/screens/README.md`: an index of the exported screens.
- `docs/screens/01-access/` … `docs/screens/10-proposed/`: 148 PNG files (74 screens, each in light and dark).

There is a second copy of the handoff note at `SRM-Locator-main/REDESIGN_HANDOFF.md` (also untracked). Its text is identical to `docs/redesign/handoff.md`. Only the line endings and the final newline differ. `docs/screens/README.md` points to that second copy.

There is one small mismatch in the README. It links `settings-settings-light.png` and `settings-settings-dark.png`, but the files are named `settings-light.png` and `settings-dark.png`.

## What I ran

- I read the code and ran `git`, `gh release list`, `gh pr list` and `gh pr view` (all read-only).
- I ran `npm run build` once, to check whether the production bundle contains WiFi code. It only wrote to `SRM-Locator-main/dist/`, which git ignores. `git status` shows no changes to tracked files. I did not run `cap sync`.
- I ran `npm test`. The results are in section 8.
- I did not touch Firebase, Render, the phone or any release.
- The only file I created is this report.

---

## The most important findings (read these first)

1. **Paused sharing does not pause.** In Paused (`FROZEN`) mode, the 5-second heartbeat still sends your current position to the group (`App.jsx:1367-1376`). Only the movement updates stop. The new wording "Sharing paused · group sees your last spot" would be untrue.
2. **Hidden is not hidden from everyone.** In Hidden (`GHOST`) mode the app still sends `safety-ping` with your live coordinates on every heartbeat (`App.jsx:1362`). It also still sends `update-location` with status `GHOST` (`App.jsx:1405`). The server keeps both. The Group Lead's "Refresh locations" table shows them. If a hidden member's signal drops, everyone sees a "signal lost" marker at their last position. "Hidden from group members" is only half true.
3. **"Unblock" does not exist on the server.** The server has `block-user` but no unblock event. The app's REVOKE button only edits a local list. Also, a blocked person is removed from `users`, so the Blocked tab is almost always empty. The new confirmation text, "You can unblock them later in Join requests › Blocked", would be untrue.
4. **In the design's peek panel, the Emergency button disappears.** In `group-peek-*.png` the panel covers the bottom of the screen and no SOS button is shown. Today the SOS button (z 1150) stays above the open panel (z 900). This conflicts with "must not become harder to reach".
5. **AR Scan covers the Emergency button and the notifications.** AR Scan is a full screen at z 9999. The SOS button is at z 1150 and notifications at z 9000, so both are hidden while AR Scan is open. ALIGN results and "Compass access denied" are posted as notifications, so nobody ever sees them. (A received alert, at z 10002, still draws over AR Scan.)
6. **Settings is already reachable on phones.** The gear button in the map's right-hand control column has no `md:hidden` (`App.jsx:2894`). Only the top-bar Sliders button is desktop-only. Moving Settings into the top bar removes the gear from the right column, so the right column changes as well.
7. **There are no design tokens today.** There is no `@theme` block and not one CSS variable (`var(--` appears 0 times in `src/`). Colours are written directly: about 1,084 Tailwind colour classes, 67 hex values and 89 `rgb()`/`rgba()` values.
8. **Groups have no names.** The data has only a 6-character code. The design shows "Hostel Friends", and the copy uses `{group}` in many places. Either a name has to be added (a data change, which the rules forbid) or the code is shown instead.
9. **The "Navigate" button also sets the group's meeting point.** Today WAYPOINT / SELECT_WAYPOINT calls `publishSquadWaypoint`, which moves the whole group's meeting point (`App.jsx:1712-1737`). A plain "Navigate" label would hide that.
10. **Open draft PR #12 touches the same Android files as item 27** (splash, icons, `colors.xml`, `capacitor.config.json`).
11. **The full test suite has 36 failures on this PC on a clean `main`.** All of them are timeouts under load. Every failing file passes when run on its own (section 8).

---

## 1. Is the handoff accurate about the code?

### Build-order table, item by item

| # | Verdict | Files | What is true / correction |
|---|---|---|---|
| 1 | **Wrong** (in part) | `src/index.css`, `vite.config.js` | Tailwind v4 is right (`@tailwindcss/vite` 4.2, `@import "tailwindcss"`). There is **no `@theme` block and no CSS variables**. Tokens are new work, not a restyle. |
| 2 | Partly matches | `index.html`, `main.jsx`, `App.jsx:471-477` | There is no theme script and no saved settings at all. A `sysConfig.theme` value ('tactical'/'stealth') exists, but nothing can change it, so `STEALTH_MAP_STYLES` is dead code. Pre-paint theme needs new storage (e.g. `localStorage`) and an inline script in `index.html`. |
| 3 | Partly matches | `src/components/` | The folder exists. There are almost no shared parts: `HudButton` lives only in UpdateModal, `CornerBrackets` is copied three times, and `MAP_CONTROL` is a string constant. Most UI is inline in `App.jsx`. |
| 4 | Partly matches | `utils/motion.js`, `index.css`, `utils/pressFeedback.js` | Springs and helpers are confirmed. The blur in `modalCard` is confirmed. The red ring's **colour lives in `index.css` (`.locus-ping`, lines 44-73)**. `pressFeedback.js` only creates the element (its comment says "red ring"). See the detailed list below. |
| 5 | Matches | everywhere | Old words are everywhere (section 4). |
| 6 | Matches | `App.jsx:204-214` `BootScreen` | Radar sweep plus "INITIALIZING_SECURE_LINK...". |
| 7 | Partly matches | `App.jsx:216-422` `AuthTerminal`, `1513-1570` | The sign-in and create-account screen is there. "Password reset sent" and "sign-in problem" are **notifications, not screens** today. "Signing in" is the `loginMethod` overlay (`App.jsx:399-419`). |
| 8 | Partly matches | `App.jsx:1980-2084` (lobby), `2502-2529` (waiting), `SquadCode.jsx` | "Code not found" is the red `lobbyNotice` box. "Not approved" is a notification and a jump back to the lobby (`App.jsx:1220-1225`). The waiting overlay's `ACCESS_DENIED` text can never show, because `hasJoinedSquad` is set false first. |
| 9 | Matches | `App.jsx:1205-1214` | No "You're in" screen exists. The natural hook is the `access-granted` handler. |
| 10 | Partly matches | `App.jsx:2086-2145` (top bar), `2859-2901` (controls), `TacticalLeafletMap.jsx`, markers | The top bar exists. Settings **is** on phones (see 6 above). Today there are four right-hand controls: recentre on campus, locate me, satellite, Settings. The design shows two. "Finding your location…" has no equivalent today. The location problem is a red banner. |
| 11 | Partly matches | `App.jsx:2903-2969`, `BuildingInfo.jsx` | Today's actions are Building Info, AR_TRACK and WAYPOINT/SET_DESTINATION. BuildingInfo adds "Take me there" and "Show on map". **WAYPOINT also publishes the group meeting point.** |
| 12 | Matches | `SosTrigger.jsx` | Timings match. See the exact behaviour below. |
| 13 | Partly matches | `SosOverlay.jsx` | It is full screen and Acknowledge is the only way out. A queue exists, but it says "+N more waiting", not "1 of 2". The footer claim is true when the sender had a fix (see below). |
| 13a | Decision | `SosOverlay.jsx`, `useIncomingSos.js` | See section 7. |
| 14 | Partly matches | `App.jsx:2271-2378`, `SquadMemberCard.jsx` | **There is no group name.** The role chip exists ("ACTIVE_CHANNEL // OWNER"). There is no share button in the panel; share exists only in the lobby. Today's member cards also show **battery and speed**, which the design rows drop. |
| 15 | Partly matches | `App.jsx:2186-2251` | It is one height today (see below). A three-height panel is a medium-to-large change, and peek collides with SOS. |
| 16 | Matches | `App.jsx:2971-3105` | Tabs are INBOUND and BLACKLIST. Blocked/unblock is broken (finding 3). |
| 17 | Partly matches | `SquadMemberCard.jsx:99-176` | Separate PING, AR (crosshair) and TRACK_TARGET buttons exist, plus the ban icon for the Group Lead. **TRACK_TARGET only centres the map on the member**; there is no route to a person. "Navigate to member" would promise more than it does. |
| 18 | Matches | `App.jsx:1599-1609`, `SquadMemberCard.jsx:100` | Today a single tap on the ban icon removes and blocks, **with no confirmation**. |
| 19 | Matches | `ARCompass.jsx`, `components/AR*`, `utils/ar*` | The CSS arrow today is `perspective(300px) rotateX(55deg)` (`ARArrow3D.jsx`). The handoff wants 520px/58deg, and `arArrow3d.test.jsx` checks the constants. |
| 20 | **New work** | `ARCompass.jsx`, `App.jsx:3520-3537` | **There is no target picker.** AR Scan opens on whatever was tapped. The Scan tab picks the first member with a fix, otherwise "SRM_HQ". |
| 21 | Partly matches | `CommsFeed.jsx`, `utils/notify.js` | The four types exist and it never blocks. But it sits at the **top of the screen, over the top bar**, not under it. Notices do **not wait** during an emergency; they are hidden behind it and expire. Pings, signal-lost, location-error and the meeting-point banner use a **separate older banner system** (`App.jsx:2530-2645`), not CommsFeed. |
| 22 | Partly matches | `App.jsx:3229-3377` | Settings is a modal (z 5000), not a full screen. Its sections are Sonar audio, Map render mode and map status, Polling rate, AR render mode, AR feature overrides, and Send App. **The audio toggle does nothing** (`sysConfig.audio` is never read). Nothing is saved across restarts. "Check for updates" and "How LOCUS works" exist only on the signed-out guide page. |
| 23 | Matches | `UpdateModal.jsx`, `LiveUpdateToast.jsx` | All the states exist. An emergency alert draws over the mandatory screen (tested). |
| 24 | Partly matches | `ARCompass.jsx:355-378`, `App.jsx:1322`, `App.jsx:946-956` | **Camera:** AR Scan already shows its own screen ("SYS_AR // OPTICS_SYNC", GRANT_ACCESS) **every time it opens**, before the camera prompt. **Location:** there is no explainer; Android's prompt fires as soon as you enter a group. **Notifications:** asked with no explainer right after sign-in. |
| 25 | Later | — | Not checked further. |
| 26 | Partly matches | `LocusGuide.jsx` | It is not a five-step guide. It is a long landing page, shown **before sign-in on every cold start** (`hasSeenGuide` is not saved). It mentions Google sign-in, geofence alerts and secret routes. It cannot be opened once signed in. |
| 27 | Matches | `android/app/src/main/res/` | See the detail below. PR #12 overlaps. |
| 28 | Matches | `backend/server.js:131-159`, `App.jsx:908-931` | The server handles `vote-to-kick` (the vote needs more than half the members, minimum 2). The app never sends it. It only logs `mutiny-status` and shows "exiled by majority vote". |
| 29 | Decision | — | See section 7. |
| 30 | Decision | — | See section 7. |
| 31-33 | Later | — | Not checked further. |

### Items 1 and 2: how colours are defined today

- `index.css` imports Tailwind and defines a few hand-made classes (`.text-nothing-red`, `.bg-nothing-red`, `.glass-panel`, `.nothing-panel`, `.bg-dots`, `.dark-map`, `.locus-dark-tiles`).
- Every screen uses Tailwind's own palette directly (`bg-red-500`, `text-zinc-400`, `border-white/20`, `shadow-[0_0_20px_rgba(239,68,68,0.6)]`).
- Counts in `src/`:
  - About 1,084 palette-class uses.
  - 67 hex colours.
  - 89 `rgb()`/`rgba()` values.
  - 0 CSS variables.
- Some colours are passed as JS props to markers and lines: `#10B981` for your dot, `#EF4444` for members and route, `#A1A1AA` for ghosts. Three.js uses hex numbers too. None of these can follow a CSS variable without code changes.

### Item 4: motion

- `SHEET_SPRING`, `PANEL_SPRING`, `INDICATOR_SPRING`, `projectMomentum`, `shouldDismissSheet`: **all present** in `utils/motion.js`. They are tested (`tests/motion.test.js`).
- `modalCard` blur: **confirmed** (`filter: 'blur(6px)'`, `motion.js:52-54`).
- Red tap ring: **confirmed**, but the colour is in `index.css:50-63`.

These animations change layout or filter instead of transform/opacity:

| Where | What animates |
|---|---|
| `motion.js:52-54` `modalCard` | `filter: blur` (all modals) |
| `CommsFeed.jsx:31-32` | `filter: blur` on each notice |
| `SquadCode.jsx:40-41` | `filter: blur` on code tiles |
| `App.jsx:272-273` sign-in card | `filter: blur(10px)` |
| `App.jsx:297-299` username field | `height: 0 → auto` |
| `UpdateModal.jsx:49` | `transition-[width]` progress bar |
| `LiveUpdateToast.jsx:75` | `transition-[width]` progress bar |
| `index.css:113` `.locus-download-sweep` | keyframes on `left` |
| `LocusGuide.jsx:165` | `filter: grayscale` transition |
| `LocusGuide.jsx:168` | `transition-[width]` scroll bar |
| `LocusGuide.jsx:380` | `max-height` transition (FAQ) |
| `App.jsx:2247,2249` sheet dots | `transition-all` (includes size) |
| `SosTrigger.jsx:188` | `box-shadow` / border-colour transition |
| `SosTrigger.jsx:206,220` | SVG `stroke-dashoffset` (the hold rings) |
| `index.css:25-31` every button | transition list includes `filter`, `box-shadow`, colours |

The SVG ring fill is how the emergency rings show time. It should stay; it is cheap. I suggest writing it down as an agreed exception rather than rebuilding it.

Old effects that are animated:

- Radar: `.locus-radar-sweep` (BootScreen), the spinning rings on sign-in (`App.jsx:265-269`), the "LINKING..." spinner, the spinning dashed rings in the empty requests tabs (`App.jsx:3034, 3085`), and the guide's hero rings.
- Glitch: `.locus-glitch`, in the guide only, on hover.
- Scanlines: none as such. The nearest are the grid overlays in AR Scan (`ARCompass.jsx:401`) and the requests modal (`App.jsx:2990`).

### Items 9, 17, 20, 24: what already exists

- **ARCompass target picker:** none. New work.
- **Separate Ping / Navigate / AR buttons on the member card:** yes. They are PING, an AR crosshair icon, and TRACK_TARGET (centres the map only), plus a Ban icon for the Group Lead.
- **Permission explainers:** only AR Scan's own pre-permission screen (camera and compass). It shows every time AR Scan opens. There is nothing for location or notifications.
- **"You're in":** none.

### Items 10 and 22: Settings and the phone top bar

- The phone top bar (`App.jsx:2090-2144`) shows the Navigation icon tile, "LOCUS", "TACTICAL GRID"/"ORBITAL RECON", and the Logout button.
- On desktop it also shows a profile badge, an admin button (owner only) and a Sliders Settings button.
- **Settings is reachable on phones today** through the gear at the bottom of the right-hand control column (`App.jsx:2893-2900`).
- So the "one approved layout change" also means removing the gear from the right column, or keeping both. That is your call.

### Items 12 and 13: exactly how the Emergency alert works today

Sending (`SosTrigger.jsx`):

1. **Idle.** Press down: a 1.2 s hold starts (`arming`) and the white ring fills.
2. **Letting go, sliding off the button, or the touch being cancelled before 1.2 s** cancels it. It goes back to idle and **nothing is sent** (`cancelHold`, lines 161-166).
3. At 1.2 s it becomes **armed**. Then:
   - an inner ring drains over 4 s;
   - the button pulses every 0.6 s;
   - the label reads "HOLD TO CONFIRM".
4. If nothing happens within 4 s, it goes back to idle. Nothing is sent.
5. A press **started** within those 4 s begins a second 1.2 s hold (`confirming`). This clears the 4 s timer. So the second hold only has to start inside the window; it may finish up to about 5.2 s after arming.
6. **Letting go early in the second hold goes straight back to idle, not back to armed.** You must start again from the first hold. Nothing is sent.
7. At the end of the second hold it sends `sos-broadcast` and shows "SOS SENT" for 2 s.
8. There is no check that the socket is connected. If offline, socket.io queues the emit. There is no message either way.

So "hold 1.2 s to arm, then hold 1.2 s again within 4 s; letting go early sends nothing" is **correct**, with two small clarifications:

- "within 4 s" means the second press must *start* within 4 s;
- an early release in the second hold resets to the very beginning.

What location is sent:

- It sends `getLocation()`, which is `liveLocationRef.current` (`App.jsx:3588`).
- The GPS watch keeps that ref up to date in **every** mode. In Paused, the ref is updated before the early return (`App.jsx:1385-1401`). In Hidden, it is updated as normal.
- So **a Paused or Hidden sender sends their current position**.
- If there is no fix yet, it asks the GPS once (3 s timeout, 5 s old fix allowed). Failing that, it sends `lat: null, lng: null`.
- The server forwards exactly what was sent (`server.js:575-595`). It has no fallback position.
- **The sender's sharing mode does not change.** `SosTrigger` never touches `telemetryMode`.
- The app does not tell the sender whether a location went with the alert.

Other facts:

- The SOS button also shows over the **waiting-for-approval** screen (z 1150 over 1000). The server drops an alert from someone not yet approved (`resolveSosRoom`), and the sender is not told.
- The button is not shown in the lobby or on sign-in (it is only in the map branch).

Receiving (`SosOverlay.jsx`, `useIncomingSos.js`):

- It is full screen. Acknowledge is the only way out. Back is blocked by `useBackButtonGuard`.
- It plays a two-tone alarm and vibrates `[300,150,300,150,300]`.
- It queues per sender. A repeat from the same sender replaces their earlier alert.
- Missed alerts are replayed after a reconnect (`sos-sync`).

### Item 15: how the group panel's height works today

- It is one `motion.div`. On phones it is `fixed`, running from just under the top bar (`top: calc(max(1rem, safe-area) + 3.2rem)`) down to `bottom-16`, above the tab bar.
- It is either fully open (`y: 0`) or fully off-screen (`y: '100%'`). There is no partial height.
- You can drag it only by the handle strip, and only downwards to close. `shouldDismissSheet` decides whether it closes.
- Swiping left or right switches between the MATRIX (buildings) and SQUAD lists.

Three heights (peek 136 px, half 55 %, full) is **a medium-to-large change, close to a rewrite of the sheet's behaviour**, for four reasons:

- It needs snap points, upward dragging, and choosing a height from the momentum projection.
- The content has to work at 136 px.
- The panel would now sit on the map all the time, which changes the map layout.
- At 136 px plus the 64 px tab bar, it covers where the SOS button (80 px tall, 80 px up) and the meeting-point button sit today. In the design's peek screen the SOS button is gone. **That needs your decision first.**

### Item 28: vote to remove

Confirmed. `vote-to-kick` is handled at `server.js:131-159`. No code in `src/` sends it. The app only listens to `mutiny-status` (to log it) and `exiled`.

### Item 27: Android icon, splash and status bar

- **Icon:** adaptive icon `res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`. These use PNG layers in `mipmap-*/ic_launcher_foreground.png` and `ic_launcher_background.png`, plus legacy `ic_launcher.png`/`ic_launcher_round.png`. There is **no monochrome layer**. `values/ic_launcher_background.xml` = `#FFFFFF`.
- **Splash:** `values/styles.xml` `AppTheme.NoActionBarLaunch` uses the Android 12 SplashScreen. It takes `windowSplashScreenBackground` = `@color/colorPrimaryDark` and the icon from `drawable*/splash.png` (11 PNGs, port and land).
- **Colours:** `colorPrimary`/`colorPrimaryDark`/`colorAccent` are referenced, but **there is no `colors.xml` on `main`**. They come from Capacitor's library defaults.
- **Status bar:** nothing sets it. There is no `@capacitor/status-bar` plugin, and nothing in `MainActivity`. The theme parent is `Theme.AppCompat.DayNight.NoActionBar`.
- **App name:** "LOCUS" (`values/strings.xml`). It needs no change.

The least risky way to change them:

1. Add `values/colors.xml` and `values-night/colors.xml` with the new colours.
2. Set `android:statusBarColor`, `android:navigationBarColor` and `windowLightStatusBar` in `styles.xml` (and `values-night`).
3. Swap the foreground and background PNGs (or make them vector XML), and add `<monochrome>` to both adaptive-icon XMLs.
4. Swap the splash images.

This needs no new plugin and no Java. Two catches:

- **It ships only in a full APK (Phase 1).**
- Native bars follow the **phone's** theme, not an in-app "Light"/"Dark" choice. Making them follow the in-app choice needs a status-bar plugin, which is also Phase 1.

**PR #12 (draft, 2026-09-20) already changes most of these files.** Decide whether to close it, rebase it, or reuse its SVG sources before starting.

---

## 2. Red audit

Red is allowed only for Emergency, Leave group, Remove and block, and Vote to remove. Everything below is red, or red-leaning, used for something else. ("Red" here includes `red-*` classes, `#EF4444`, `#DC2626`, `#F87171`, `#FCA5A5`, `#7F1D1D`, `#450A0A`, `#4A0A0A`, `#f00` and `rgba(239,68,68…)`/`rgba(220,38,38…)`.) There are about 242 red Tailwind uses plus the literals, in 21 files.

**App-wide**
- `index.css:44-73`: tap ring (red glow) on every press.
- `index.css:161`: scrollbar thumb turns red on hover.
- `index.css:221-230`: `.text/bg/border-nothing-red` classes.
- `App.jsx:251, 2087`: red text-selection colour.
- `BottomTabBar.jsx:395-411, 432`: the active tab is red with a red glow, and a red line runs along the bar.

**Loading and sign-in**
- `App.jsx:208-210, index.css:77`: radar ring and centre dot (BootScreen).
- `App.jsx:247, 258`: latency badge goes red over 150 ms.
- `App.jsx:267`: red ring in the background radar.
- `App.jsx:285`: "AWAITING CREDENTIALS..." in red.
- `App.jsx:306, 320, 332`: inputs get a red border on focus.
- `App.jsx:351`: forgot-password link turns red on hover.
- `App.jsx:361-362`: the create-account button is solid red, and the sign-in button turns red on hover.
- `App.jsx:411, 416`: red spinner and red "ESTABLISHING SECURE CONNECTION".
- Sign-in errors use the red `error` notification type (`App.jsx:238, 1567`).

**Lobby and waiting**
- `App.jsx:1987`: red glow around the card.
- `App.jsx:1994`: red shield icon.
- `App.jsx:2025`: "code not found" / "code taken" box is red.
- `App.jsx:2032`: red box around the generated code.
- `App.jsx:2044`: red "new code" button.
- `App.jsx:2054`: solid red INITIALIZE SQUAD button.
- `App.jsx:2075`: CONNECT button turns red on hover.
- `SquadCode.jsx:211-227`: code tiles and caret are red.
- `App.jsx:2505`: red spinner on the waiting screen.
- `App.jsx:2524`: red "ABORT HANDSHAKE" (a cancel, not destructive).
- `App.jsx:1224`: "denied your entry" is a red error notification.

**Map home**
- `App.jsx:2138`: Sign out turns red on hover (not on the allowed list).
- `App.jsx:2113`: red square when there is no avatar (desktop).
- `App.jsx:2153-2175`: the route card has a red border and glow, a red title and a red distance.
- `App.jsx:2617-2626`: the location error banner is fully red (it should be amber).
- `App.jsx:2872, 2876`: the locate-me button is red with a red beacon ring.
- `App.jsx:3547`: the meeting-point button is **solid red** (`bg-red-600`), the same red as SOS, next to it.
- `BuildingMarker.jsx:308-314`: every building is a red dot with a red ping.
- `App.jsx:2783`, `TacticalLeafletMap.jsx:231`: other members' markers are red (`#EF4444`).
- `App.jsx:2785`, `TacticalLeafletMap.jsx:233`: red floor tags (indoor, compiled out today).
- `WaypointMarker.jsx:262-266, 275, 284`: meeting-point marker is red with a red ping and red label; its buttons turn red on hover.
- `App.jsx:1833`, `useWaypointNavigationLine.js:20`, `TacticalLeafletMap.jsx:208-209`: the walking route line is red.
- `IndoorMarkers.jsx`: one red use (compiled out today).

**Place card and buildings list**
- `App.jsx:2398, 2918`: red category tag.
- `App.jsx:2419, 2945`: AR button turns red on hover.
- `App.jsx:2939`: red Info icon.

**Group panel**
- `App.jsx:2247, 2249`: red page dots.
- `App.jsx:2277-2279`: NODE_ACCESS (join requests) button is red, and so is its count badge.
- `App.jsx:2289, 2301`: refresh error is red (should be amber).
- `App.jsx:2309`: RALLY POINT button is red.
- `App.jsx:2326, 2332`: the channel box and group code are red.
- `SquadMemberCard.jsx:22`: "lost" freshness shows red text and a red bar.
- `SquadMemberCard.jsx:59`: the direction arrow is red with a red glow.
- `SquadMemberCard.jsx:100`: the ban icon turns red on hover. This one is allowed (Remove and block).
- `SquadMemberCard.jsx:115`: the clock direction text is red.
- `SquadMemberCard.jsx:120`: the battery bar goes red under 25 %.
- `SquadMemberCard.jsx:162`: AR button turns red on hover.
- Allowed: `App.jsx:2336`, DISCONNECT (Leave group).

**Join requests**
- `App.jsx:2981-3024`: red border, red corners, red header icon, red subtitle and red tab underline.
- `App.jsx:3032-3035`: red empty-state icon and ring.
- `App.jsx:3045, 3053`: red pulsing dot and red "REQUESTING_ACCESS".
- `App.jsx:3073`: DENY is red. Declining a request is not "Remove and block".
- `App.jsx:3092`: blocked rows have a red left edge.

**Refresh locations table**
- `App.jsx:150`: battery under 20 % is red.
- `App.jsx:499, 504`: "NO_SIGNAL" and "STALE" are red.
- `App.jsx:3210`: errors are red.

**Settings**
- `App.jsx:3261`: muted icon is red.
- `App.jsx:3266`: MUTED option is red.
- `App.jsx:3309`: MAX (1s) is red.
- `App.jsx:3329`: REALISTIC is red.
- `App.jsx:35`: the REALISTIC override is red.

**Notifications**
- `CommsFeed.jsx:223`: the `error` type is red. It is used for ordinary problems such as sign-in errors and ALIGN refusals.

**Updates**
- `UpdateModal.jsx:32, 49, 124, 216, 230`: red primary button, red progress bar, red error text, red "LOCUS // UPDATE" label and red "required" box.
- `LiveUpdateToast.jsx:75, 77, 107, 143`: red bar, red sweep, red title and red Restart button.

**AR Scan**
- `ARCompass.jsx:358, 361, 366`: red permission-screen icon, target name and button.
- `ARCompass.jsx:420, 422`: red debug overlay border and title.
- `ARCompass.jsx:450, 459`: red AR_TRACKER title and red "OPTICS ONLINE" badge.
- `ARCompass.jsx:468, 484`: red ALIGN and close buttons.
- `ARCompass.jsx:518, 530`: red centre dot, and the ring has a red border and glow.
- `ARCompass.jsx:550`: red distance.
- `ARArrow3D.jsx:193-206`: the arrow is red.
- `arArrowScene.js`: the three.js arrow is red.
- `ARRoadLine.jsx:240-245`: the road ribbon is red.
- `arRoadScene.js`: the three.js road is red.
- `ARTag.jsx:21, 36, 43, 45, 52`: the target tag is red.
- "Compass access denied" and ALIGN refusals use the red `error` notification type.

**Guide (signed-out landing page)**
- `LocusGuide.jsx`: 25 red uses. They include the red progress bar, red nav hover, red hero glow and red primary button, red step labels, red feature dots and labels, red "Online"/"Signal Active" dots, the red boot text and caret, and red campus dots.

**Received alert**
- `SosOverlay.jsx`: red hex pattern, red border, strobe and maroon background. All of it belongs to the emergency, so it is allowed.

---

## 3. Old-look inventory

| Old element | Where | How widespread |
|---|---|---|
| **DotGothic16** (`font-dot`) | 196 uses in 20 files; `App.jsx` alone has 128 | Everywhere |
| **Space Mono** | `body` font in `index.css:134`, so **every element without a font class** | Everywhere (the default font) |
| `font-mono` | `SosOverlay.jsx` (4), `App.jsx:3177`, `ARCompass.jsx:420` | A few places |
| **All caps** (`uppercase`) | 191 uses in 19 files; most strings are also typed in capitals | Everywhere |
| `tracking-widest` letter-spacing | On nearly every `font-dot` line | Everywhere |
| Glows (`shadow-[0_0_…rgba]`, `drop-shadow`) | About 60 places: buttons, markers, tab bar, modals, AR | Everywhere |
| Dotted background (`bg-dots`) | Boot, sign-in, lobby, map root, telemetry, settings, admin and guide | Most full screens |
| Grid backgrounds | Requests modal (`App.jsx:2990`), AR Scan (`ARCompass.jsx:401`) | Two places |
| Hex grid | `SosOverlay.jsx:117-148`, with a "Tactical Grid" caption | One place |
| Radar effects | Boot sweep, sign-in rings, LINKING spinner, requests empty rings, guide hero rings, locate-me beacon ring, building/waypoint `animate-ping` | About 8 places |
| Glitch | `.locus-glitch` in the guide | One component |
| Scanlines | None found | — |
| Cut-corner / corner-bracket shapes | Square corner blocks in sign-in, lobby, UpdateModal, guide (×3 copies). Corner L-brackets in requests, telemetry, admin. `LiveLocationMarker` corner brackets when navigating | About 8 places |
| Square-cornered "terminal" panels | Nearly every panel has no radius | Everywhere |
| Terminal text (`//`, `[ … ]`, `_` words, "> ") | Labels throughout, the guide boot sequence, distances like `[ 120 M ]` | Everywhere |
| Strobe / blink | `SosOverlay` strobe (allowed), the `blink` class on LINKING, `animate-pulse` in about 15 places | Many places |
| Robot avatars | `App.jsx:1541`, DiceBear "bottts" robots on black, stored on the Firebase profile | Every new account |
| Uppercased names | `App.jsx:308, 1545`: usernames are forced to capitals and saved that way | Every account made since |
| Emoji | Guide steps and access cards, and the OS notification titles (🎯 📡) | A few places |

The fonts load from `@fontsource/dotgothic16` and `@fontsource/space-mono` (`index.css:4-6`, `package.json`). Removing them is safe only after every screen has moved to Inter. Until then, any missed text falls back to the browser default.

---

## 4. Wording inventory

No earlier wording inventory exists. I searched for `locus-wording-inventory.md` and any `*wording*` file, and found none. So this is a new one. I list each string once, at its first place, and note repeats.

**Flags (where the handoff's mapping fits badly):**

- **F1 "Group" + `{group}` name:** groups have no name. Only the code exists.
- **F2 "Paused" / "group sees your last spot":** not true today (finding 1).
- **F3 "Hidden from group members":** not true for the Group Lead's table, or for signal-lost markers (finding 2).
- **F4 "Navigate":** WAYPOINT also sets the group's meeting point (finding 9).
- **F5 "Navigate to member":** TRACK_TARGET only centres the map.
- **F6 "unblock them later":** no unblock exists (finding 3).
- **F7 "Meeting point" as data:** `"RALLY POINT"` is also the `name` sent inside the `publish-waypoint` payload (`App.jsx:1670, 1683`). Older installed apps would show whatever text new apps send. It is safer to keep sending the old value and change only what is displayed, or to accept that old clients will show "Meeting point".
- **F8 Area alert:** nothing sends `geofence-alert` any more (the painter was deleted), so the "PERIMETER BREACH" banner can never show. Renaming it is pointless; it could be removed.
- **F9 Usernames are stored in capitals** in Firebase. Sentence case cannot be applied to names without changing stored data.
- **F10 Tests check many of these strings.** RALLY appears in 14 test files, SQUAD in 15, SYNC_TELEMETRY in 3 and Acknowledge in 4. Every wording piece must update its tests at the same time.

### `App.jsx`

| Line | Current text | Proposed |
|---|---|---|
| 134 | ONLY THE SQUAD COMMANDER CAN SYNC TELEMETRY. | Only the Group Lead can refresh locations. |
| 135 | THE SERVER HAS NO RECORD OF THIS SQUAD FOR THIS DEVICE. DISCONNECT AND REJOIN IT. | This group isn't on the server any more. Leave the group and join again. |
| 212 | INITIALIZING_SECURE_LINK... | LOCUS · Find your group on campus |
| 224 | [SYS_ERROR] ID // EMAIL IS REQUIRED FOR KEY RECOVERY. | Enter your email first, then tap "Forgot password". |
| 229 | [RECOVERY_DISPATCHED] RESET SIGNAL TRANSMITTED TO {EMAIL}. CHECK YOUR INBOX. | We've sent a reset link to {email}. Check your inbox. |
| 234 | [ACCESS_DENIED] NO OPERATIVE FOUND WITH THIS EMAIL. | No account uses this email. |
| 235, 1565 | [SYS_ERROR] MALFORMED ID // EMAIL SYNTAX. | That email address doesn't look right. |
| 236 | [SEC_LOCKOUT] TOO MANY REQUESTS. STAND BY BEFORE RETRYING. | Too many tries. Wait a minute, then try again. |
| 232, 1560 | [SYS_FAILURE] {firebase message} | Something went wrong. Please try again. |
| 255, 259 | SYS_PING / CALCULATING... / {n}MS | Remove, or "Connection · {n} ms" (decision) |
| 284 | Auth_Node | Sign in / Create account |
| 286 | CREATING CREDENTIALS... / AWAITING CREDENTIALS... | (remove) |
| 302 | CODENAME // Username | Your name |
| 305 | E.G. GHOST_01 | e.g. Priya |
| 316 | ID // Email | Email |
| 327 | KEY // Passkey | Password |
| 353 | [ FORGOT KEY? RECOVER ACCESS ] | Forgot password? |
| 365 | REQUEST_ACCESS / INITIALIZE_LINK | Create account / Sign in |
| 375 | [ ABORT // RETRIEVE EXISTING ID ] / [ NO CLEARANCE? REGISTER NEW ID ] | I already have an account / Create an account |
| 415-416 | LINKING... / ESTABLISHING SECURE CONNECTION | Signing in… |
| 499-504 | NO_SIGNAL / OPTIMAL (< 10s) / GOOD (Ns ago) / WARN (Nm ago) / STALE (> 5m) | No signal / Live / {n} s ago / {n} min ago / Not seen for 5+ min |
| 767 | NOT CONNECTED TO THE SERVER. RECONNECTING — TRY AGAIN IN A MOMENT. | You're offline. Reconnecting — try again in a moment. |
| 777 | NO RESPONSE FROM THE SERVER. CHECK YOUR CONNECTION AND TRY AGAIN. | Couldn't refresh locations. Check your connection and try again. |
| 781 | THE SERVER REFUSED THE SYNC. | Couldn't refresh locations. |
| 912 | SYS_BANNED: The Squad Commander has blocked you from this channel. | The Group Lead removed you from this group. |
| 913 | SYS_MUTINY: You have been exiled from the squad by majority vote. | The group's members voted to remove you. |
| 987-988 | RALLY_POINT: A squad member designated a rally point. Tap to view it. | New meeting point. Tap to see it. |
| 992 | OS notification: 🎯 RALLY POINT DESIGNATED / New tactical coordinates uploaded to map. | New meeting point / {name} set a meeting point. |
| 1051 | Squad Node (fallback name) | Group member |
| 1053 | Campus Node (fallback role) | (remove; only shown on cards) |
| 1080, 1084 | A squad member / 📡 PING / {NAME} is pinging you. | A group member / Ping / {Name} pinged you. |
| 1224 | [SYS_REJECTED] The Squad Commander denied your entry. | The Group Lead didn't approve your request. |
| 1233 | SQUAD {CODE} NO LONGER EXISTS ON THE SERVER. | Group {code} has ended. |
| 1234 | NO ACTIVE SQUAD WITH CODE {CODE}. CHECK THE CODE, OR ASK YOUR COMMANDER TO INITIALIZE IT FIRST. | No group uses code {code}. Check the code, or ask the Group Lead to create the group first. |
| 1242 | CODE {CODE} IS ALREADY IN USE BY ANOTHER SQUAD. A NEW CODE HAS BEEN GENERATED: SHARE THIS ONE INSTEAD. | That code is already taken. Here's a new one to share. |
| 1270 | [SYS] THE SQUAD COMMANDER IS BACK. YOU ARE A SQUAD MEMBER AGAIN. | The Group Lead is back. You're a member again. |
| 1524 | [SYS_ERROR] ID AND KEY ARE REQUIRED FOR LINK. | Enter your email and password. |
| 1532 | [SYS_ERROR] CODENAME REQUIRED FOR NEW RECRUITS. | Enter your name. |
| 1562 | [ACCESS_DENIED] CREDENTIALS REJECTED. CHECK ID AND KEY. | Email or password is wrong. |
| 1563 | [SYS_WARN] THIS ID ALREADY EXISTS IN THE MATRIX. INITIATE LOGIN INSTEAD. | An account already uses this email. Sign in instead. |
| 1564 | [SEC_VIOLATION] KEY ENCRYPTION TOO WEAK. MINIMUM 6 CHARACTERS REQUIRED. | Use at least 6 characters for your password. |
| 1649 | Rally point no longer active. | That meeting point has been removed. |
| 1670, 1683 | "RALLY POINT" (data, F7) | display: Meeting point |
| 1723, 2167 | MY_LOCATION / AWAITING_START | Your location / Choose a start |
| 2169 | AWAITING_TARGET | Choose a destination |
| 1770 | {n} KM / {n} M / {n} MIN(S) | {n} km / {n} m / {n} min |
| 1995 | SECURE_CHANNEL | Your group |
| 1997 | INITIALIZE NEW SQUAD PROTOCOL / JOIN EXISTING OPERATIVE NETWORK | Create a group / Join a group |
| 2010, 2020 | CREATE SQUAD / JOIN SQUAD | Create / Join |
| 2033 | GENERATED SQUAD DESIGNATOR | Your group code |
| 2039 | Share this code with your team to grant entry clearance. | Share this code so people can ask to join. |
| 2045 | title "Generate New Code" | New code |
| 2056 | INITIALIZE SQUAD | Create group |
| 2062 | ENTER SQUAD CODE (ALPHANUMERIC ONLY) | Group code |
| 2077 | CONNECT TO SQUAD | Ask to join |
| 2102-2103 | LOCUS / ORBITAL RECON / TACTICAL GRID | LOCUS / Satellite view / Map view |
| 2115 | GUEST_NODE | Guest |
| 2131, 2897 | title "System Configuration (SYS_CONFIG)" | Settings |
| 2139 | title "Disconnect" (sign out) | Sign out |
| 2162 | ACTIVE_WAYPOINT_TRACKING | Walking to {place} |
| 2175 | ETA: {time} | {time} |
| 2248, 2260 | MATRIX | Places |
| 2248, 2267, 3518 | SQUAD | Group |
| 2278 | NODE_ACCESS | Join requests |
| 2293, 3220 | SYNCING... | Refreshing… |
| 2295 | RETRY SYNC | Try again |
| 2297 | SYNC_TELEMETRY | Refresh locations |
| 2311 | SELECT MAP... / RALLY POINT | Tap the map… / Meeting point |
| 2319 | CLEAR | Remove meeting point |
| 2330 | ACTIVE_CHANNEL // OWNER / MEMBER | Group Lead / Member |
| 2338 | DISCONNECT | Leave group |
| 2346 | TELEMETRY_CONTROL | Location sharing |
| 2352, 2358, 2364 | ACTIVE / FROZEN / GHOST | Live / Paused / Hidden (F2, F3) |
| 2373 | SEARCH_MATRIX... / SEARCH_SQUAD... | Search places / Search group |
| 2409 | [ 120 M ] AWAY (via `geoMath.js:48-55`, incl. `[ SIGNAL_LOST ]`) | 120 m away |
| 2413 | [{id}] building id tag | (remove) |
| 2420, 2946, 2421 | title "AR Tracking" / AR_TRACK | AR Scan |
| 2428 | SELECT_WAYPOINT | Navigate (F4) |
| 2462, 2797 | LAST KNOWN / SIGNAL LOST | Last seen / Connection lost |
| 2464 | {m:ss} AGO | {n} min ago |
| 2507 | ACCESS_DENIED / AWAITING_CLEARANCE | Not approved / Waiting for approval |
| 2511 | Handshake rejected by Commander. | The Group Lead didn't approve your request. |
| 2512 | Transmitting handshake to Squad Commander. Stand by... | We've asked the Group Lead to let you in. This screen updates by itself. |
| 2526 | ABORT HANDSHAKE | Cancel request |
| 2552-2555 | PING / {NAME} is pinging you | {Name} pinged you |
| 2572-2576 | PERIMETER BREACH / DEPARTURE … has entered/left {zone} | (dead, F8) |
| 2598-2599 | TARGETING MODE ACTIVE / TAP ANYWHERE ON MAP TO DEPLOY RALLY POINT | Tap the map to place a meeting point |
| 2622 | ⚠ LOCATION ACCESS DENIED — SQUAD CANNOT SEE YOU | Location is off, so your group can't see you. [Turn on location] |
| 2623 | ⚠ NO GPS FIX — SQUAD CANNOT SEE YOU | Can't find your location yet. Your group can't see you. |
| 2640 | ⚠ {name} SIGNAL LOST — TRACKING LAST VECTOR | {Name} lost connection. Showing where they were last. |
| 2652 | LOADING_FALLBACK_GRID... | Loading map… |
| 2866, 2873, 2885 | titles Recenter Campus / Locate Signal / Switch to Tactical Grid / Satellite Recon | Show campus / Show my location / Map view / Satellite view |
| 2919 | SYS_NODE // {category} | {Category} |
| 2939 | Building Info (`buildingInfo.js:14`) | More about this place |
| 2953 | SET_DESTINATION / WAYPOINT | Set destination / Navigate (F4) |
| 2999-3000 | SYS_ACCESS_CONTROL / SECURE_OVERRIDE_TERMINAL | Join requests |
| 3015 | INBOUND [n] | Waiting ({n}) |
| 3023 | BLACKLIST | Blocked |
| 3038-3039 | NO_PENDING_REQUESTS / MONITORING_NETWORK_TRAFFIC... | No one is waiting to join. |
| 3053 | REQUESTING_ACCESS // NODE_LINK | Wants to join |
| 3066 | GRANT_ACCESS | Approve |
| 3075 | DENY | Decline |
| 3088 | BLACKLIST_EMPTY | No one is blocked. |
| 3095 | REVOKE | Unblock (F6) |
| 3128-3129 | SYS_TELEMETRY // MATRIX / COMMANDER CLASSIFIED CLEARANCE | Group locations |
| 3143-3146 | NODE_DESIGNATION / LAST_KNOWN_COORDS / POWER_CORE / SIGNAL_INTEGRITY | Name / Last position / Battery / Last update |
| 3152 | NO OTHER OPERATIVES IN THE SQUAD YET. | No one else is in the group yet. |
| 3178-3197 | COORDS: / POWER: / SIGNAL: / NO_CACHE_DATA / LAT: LNG: | Position / Battery / Updated / No position yet |
| 3212 | AUTO-REFRESHING EVERY 5 SECONDS | Updates every 5 seconds |
| 3221 | FORCE_SYNC | Refresh now |
| 3246-3247 | SYS_CONFIG / LOCAL CLIENT PREFERENCES | Settings |
| 3262, 3265-3266 | SONAR_AUDIO_SIGNALS / ENABLED / MUTED | Alert sounds / On / Off (the toggle does nothing today) |
| 3274 | MAP_RENDER_MODE | Map style |
| 3281, 3287 | TACTICAL (DARK GRID) / ORBITAL (SATELLITE) | Map / Satellite |
| 3291-3292 | Map: Google / Map: Backup (OpenStreetMap) + reasons (`mapEngineStatus.js`) | keep, sentence case already |
| 3300 | TELEMETRY_POLLING_RATE | Location refresh rate |
| 3304-3310 | ECO (15s) / STANDARD (5s) / MAX (1s) | Battery saver · 15 s / Standard · 5 s / Fast · 1 s |
| 3313 | Warning: MAX polling drains battery significantly faster. Use only during active pursuits. | Fast uses much more battery. |
| 3320, 3324-3330 | AR_RENDER_MODE / EFFICIENT / STANDARD / REALISTIC | AR Scan quality / Efficient / Standard / Realistic |
| 3333 | REALISTIC mode uses more battery and needs a newer phone. | Realistic uses more battery and needs a newer phone. |
| 3341, 3343, 3359, 3367 | AR_FEATURE_OVERRIDES / AMBIENT_TAGS / ROAD_LINE / ARROW / AUTO OFF … | Not in the handoff (keep as "Advanced", or drop: decision) |
| 3402-3501 | Admin: ADMIN_OVERRIDE, CLASSIFIED // COMMANDER-LEVEL…, SECTION_01 // PATH_RECORDER, INITIATE_RECORD_PATH, RECORDING ACTIVE…, PUBLISH_ROUTE, ABORT, CLOSE_TERMINAL; HUD `2815-2845` RECORDING_NODES, PUBLISH; `prompt()` texts; `notify` "[SYS] Route … published." | Owner-only; plain wording suggested, low priority |
| 3516 | ORBITAL / GRID | Map |
| 3517 | SCAN | Scan |
| 3533 | SRM_HQ (AR default target name) | SRM campus |
| 3550 | title Cancel Targeting / Deploy Rally Point | Cancel / Place a meeting point |

### Components and helpers

| File:line | Current | Proposed |
|---|---|---|
| `SosTrigger.jsx:17-23` | SOS / HOLD TO CONFIRM / SOS SENT | Emergency alert: hold / Hold again to send / Alert sent (+ new sent/without-location/let-go-early copy from the handoff) |
| `SosTrigger.jsx:25-31` | aria: "…arm SOS beacon…" | "Emergency alert. Press and hold to start." etc. |
| `SosOverlay.jsx:68` | UNKNOWN NODE | A group member |
| `SosOverlay.jsx:71-72` | Sent N min ago // Unacknowledged / Transmitting // Unacknowledged | Sent {n} min ago / Just now |
| `SosOverlay.jsx:77-83` | spoken: "…has triggered an SOS beacon. Last known position… Activate Acknowledge to dismiss." | "{Name} sent an emergency alert…" |
| `SosOverlay.jsx:146` | Tactical Grid | (remove) |
| `SosOverlay.jsx:169` | SOS | Emergency alert |
| `SosOverlay.jsx:174` | {lat}, {lng} / COORDINATES UNAVAILABLE | (map/place card) / Location not included |
| `SosOverlay.jsx:190` | Acknowledge | Acknowledge |
| `SosOverlay.jsx:198` | +N more waiting | 1 of 2 |
| `CommsFeed.jsx:220-223` | SYS_NOTICE / CONFIRMED / CAUTION / SYS_ERROR (default titles) | (no title, icon only) or Info / Done / Check this / Problem |
| `CommsFeed.jsx:267` | aria "Dismiss notice" | Dismiss |
| `notify.js:186-192` | Parses "[TAG]" off messages as titles | Drop the tag convention once the messages above change |
| `SquadMemberCard.jsx:92-95` | LIVE / {n}s AGO / {n}m AGO / NO SIGNAL YET (`direction.js:43-48`) | Live / {n} s ago / {n} min ago / No location yet |
| `SquadMemberCard.jsx:100` | title "Instant Ban" | Remove and block |
| `SquadMemberCard.jsx:112-113` | <15 / KM / M (`direction.js:54-55`) | km / m |
| `SquadMemberCard.jsx:115` | 3 O'CLOCK / AHEAD / BEHIND / WITH YOU / BEARING NE (`direction.js:25, 86`) | 3 o'clock / Ahead / Behind / With you / North-east |
| `SquadMemberCard.jsx:124` | {n} KM/H | {n} km/h |
| `SquadMemberCard.jsx:131` | AWAITING_GPS_FIX | No location yet |
| `SquadMemberCard.jsx:155` | PING | Ping |
| `SquadMemberCard.jsx:163` | title "AR Tracking" | Find with AR Scan |
| `SquadMemberCard.jsx:172` | TRACK_TARGET | Show on map (F5) |
| `SquadCode.jsx:270` | COPY_FAILED: Could not reach the clipboard. Read the code out instead. | Couldn't copy. Read the code out instead. |
| `SquadCode.jsx:276` | share: "LOCUS squad" / "Join my LOCUS squad with code …" | "Join my LOCUS group with code …" |
| `SquadCode.jsx:285, 289` | GENERATING... / "Squad code … Tap to copy." | Making a code… / Group code … |
| `SquadCode.jsx:307, 316` | COPIED / COPY CODE / SHARE | Copied / Copy / Share |
| `SquadCode.jsx:325, 348` | E.G. KTR7X9 / aria "Squad code" | e.g. KTR7X9 / Group code |
| `BottomTabBar` labels (App 3516-3518) | GRID/ORBITAL · SCAN · SQUAD | Map · Scan · Group |
| `BuildingInfo.jsx:291-299` | Departments / Floors / Facilities / From you / You are here | keep (sentence case already) |
| `BuildingInfo.jsx:308, 315` | Take me there / Show on map | Navigate (F4) / Show on map |
| `buildingInfo.js:16` | More details coming soon | keep |
| `WaypointMarker.jsx:275, 283` | titles AR Track Rally Point / Clear Rally Point | Find with AR Scan / Remove meeting point |
| `GhostMemberMarker.jsx:343, 369` | LAST KNOWN / SIGNAL LOST · {m:ss} AGO | Last seen {n} min ago |
| `UpdateModal.jsx:217` | LOCUS // UPDATE REQUIRED / LOCUS // UPDATE AVAILABLE | (remove label) |
| `UpdateModal.jsx:221` | Mandatory update / New build available | Update required / Update available |
| `UpdateModal.jsx:225-226` | INSTALLED {v} → {v} | Version {v} → {v} |
| `UpdateModal.jsx:231` | This release is required. LOCUS stays locked until it is installed. | You need this update to keep using LOCUS. (amber, not red) |
| `UpdateModal.jsx:132-134` | Android needs one-time permission… "Allow from this source"… | keep meaning, shorten |
| `UpdateModal.jsx:146` | INTEGRITY VERIFIED — handing off to the Android installer... | Safety check passed. Opening the installer… |
| `UpdateModal.jsx:147` | DOWNLOADING — {a} / {b} | Downloading · {a} of {b} |
| `UpdateModal.jsx:159, 161` | No release notes provided. / PACKAGE SIZE: {n} | (remove) / {n} MB |
| `UpdateModal.jsx:171-199` | Retry / Later / Grant access / Installing / Downloading / Update now | Try again / Later / Allow / Installing… / Downloading… / Update now |
| `UpdateModal.jsx` errors (from `useAppUpdate.js`) | checksum and network messages | "Safety check failed. The download didn't match. Try again." (check `useAppUpdate.js` wording during the piece) |
| `LiveUpdateToast.jsx:338` | UPDATING / UPDATE FAILED / UPDATE BLOCKED / UPDATE READY | Updating / Update didn't install / Full update needed first / Update ready |
| `LiveUpdateToast.jsx:355` | {n}% / PREPARING · {n}S | {n}% · {n} s |
| `LiveUpdateToast.jsx:361-373` | body sentences (already plain) | keep, light edit ("Bundle" → "Update") |
| `LiveUpdateToast.jsx:388, 397` | Restarting... / Restart / ✕ | Restarting… / Restart / Dismiss |
| `SendApp.jsx:390-429` | SEND_APP / DOWNLOAD APK / COPY LINK / COPIED / COPY FAILED / TRY AGAIN | Share LOCUS / Download installer / Copy link / Copied / Couldn't copy / Try again |
| `ARCompass.jsx:48-52` | [SYS_AR] ALIGN: … (5 refusals) | Align: centre a building first. etc. (amber) |
| `ARCompass.jsx:141` | [SYS_ERROR] Compass access denied. | Compass access is off. Direction may be wrong. |
| `ARCompass.jsx:289` | [SYS_AR] ALIGNED ON {name}: HEADING …, PITCH … | Aligned on {name}. |
| `ARCompass.jsx:359-362` | SYS_AR // OPTICS_SYNC / Tracking target… / Augmented Reality requires access… | AR Scan needs your camera and compass. (the camera explainer, item 24) |
| `ARCompass.jsx:368, 374` | GRANT_ACCESS & INITIATE / ABORT | Continue / Not now |
| `ARCompass.jsx:457, 460` | AR_TRACKER / INSTRUMENT FLIGHT RULES (IFR) / OPTICS ONLINE | AR Scan / Camera off — direction and distance still work / (remove) |
| `ARCompass.jsx:470, 478` | ALIGN / RESET {±n°} | Align / Reset |
| `ARCompass.jsx:502` | CALIBRATE SENSOR: PERFORM FIGURE-8 MOTION | Move your phone in a figure 8 to fix the compass. |
| `ARCompass.jsx:545, 549` | TARGET_LOCK / PROXIMITY | (remove labels; large distance + clock direction) |
| `ARCompass.jsx:242` | SQUAD_NODE (tag fallback) | Group member |
| `ARCompass.jsx:422-438` | SYS_DEBUG overlay | developer-only, leave |
| `LocusGuide.jsx` | whole file: boot lines (`6-16`), FAQ (`20-23`), nav, hero "Tactical Positioning", "tactical tracking network", steps (Google OAuth), Core Systems (Squad Matrix, Dead Reckoning, Secret Routes, Geofence Alerts), Stealth Controls, Access Control (Auth Node, Commander, blacklist rogue nodes), Emergency Protocol, Campus Nodes, "FAQ // Command Log", Build Channel copy (`57-66`), footer | Full rewrite to the five steps (item 26). The current emergency text claims "a native push notification" that does not exist. |
| `index.html:17` | `<title>Locator SRM</title>`, favicon `/vite.svg` | LOCUS, LOCUS icon |

### Shown by Android or the OS

- **App name under the icon:** "LOCUS" (`strings.xml`). No change.
- **Permission prompts** (location, camera, notifications, install unknown apps) use Android's own text. The app supplies no rationale strings, so there is nothing to translate there. The new explainer sheets (item 24) are where our wording goes.
- **OS notifications:** "🎯 RALLY POINT DESIGNATED" and "📡 PING" (see above). They use the browser `Notification` API, which the Android WebView likely does not support. They probably never appear on the phone, and that is worth confirming on the device.
- **Alert sounds:** there are no labelled sounds. There is one sonar blip (ping, rally) and one two-tone alarm (emergency). The only label is the dead "SONAR_AUDIO_SIGNALS" setting.

---

## 5. Layering (stacking order)

### Every z-index and overlay in the app

| z | What | File:line | Position |
|---|---|---|---|
| 20000 | Tap ring (decorative, no touches) | `index.css:54` | fixed |
| **10002** | **Received emergency alert** | `SosOverlay.jsx:107` | fixed, full screen |
| **10000** | **APK update modal (optional and mandatory)** | `UpdateModal.jsx:211` | fixed, full screen |
| 10000 | Guide scroll bar (signed-out only) | `LocusGuide.jsx:168` | fixed |
| 9999 | **AR Scan** (and its permission screen) | `ARCompass.jsx:357, 381` | fixed, full screen |
| 9999 | Guide boot screen (signed-out only) | `LocusGuide.jsx:133` | fixed |
| **9000** | **Notifications (CommsFeed)** | `CommsFeed.jsx:88` | fixed, top |
| 6500 | JS update strip | `LiveUpdateToast.jsx:101` | fixed, bottom |
| 6000 | Admin settings modal | `App.jsx:3385` | fixed |
| 5000 | Settings modal | `App.jsx:3235` | fixed |
| 4000 | Refresh-locations table | `App.jsx:3113` | fixed |
| 2000 | Join requests modal | `App.jsx:2977` | fixed |
| **1150** | **Emergency (SOS) button** | `SosTrigger.jsx:188` | fixed, bottom-left |
| 1100 | Bottom tab bar | `BottomTabBar.jsx:64` | fixed, bottom |
| 1050 | Meeting-point button (phone) | `App.jsx:3544` | fixed, bottom-right |
| 1000 | Top bar | `App.jsx:2094` | absolute |
| 1000 | Waiting-for-approval overlay | `App.jsx:2504` | absolute, full |
| 1000 / 850 | Route card, banner stacks (1000 on desktop, 850 on phone) | `App.jsx:2153, 2539, 2583` | absolute |
| 900 | Group panel (sheet / desktop sidebar) | `App.jsx:2212-2213` | fixed |
| 600 | Place card, admin recording HUD | `App.jsx:2914, 2813` | absolute |
| 500 / 490 | Guide nav and mobile menu | `LocusGuide.jsx:171, 206` | fixed |
| 100 | "Signing in" overlay | `App.jsx:406` | absolute |
| 60 / 61 | Meeting-point marker and its buttons (inside the map) | `WaypointMarker.jsx` | — |
| 50 | Sign-in latency badge, form | `App.jsx:254, 292` | — |
| 40 | Right-hand map controls; building markers; floor picker, WiFi readout (compiled out) | `App.jsx:2859` etc. | absolute |
| 0 | Map container | `App.jsx:2647` | absolute |
| AR internal: 0-40 | blackout 0, grid 10, road 15, UI 20, 3D arrow 22, tags 25, ring 30, debug 40 | `ARCompass.jsx`, `AR*` | — |

### What sits above and below the key layers today

- **Emergency button (1150):**
  - *Above it:* join requests, the refresh-locations table, Settings, admin, the JS update strip (moved out of its way on the map), notifications, **AR Scan**, the update modal, the received alert, and the tap ring.
  - *Below it:* the tab bar, the meeting-point button, the top bar, the waiting overlay, the panel, the place card and the map.
  - *Hidden while:* any modal is open, AR Scan is open, or an optional update is offered. With Settings becoming a full screen, it is hidden there too, as today.
  - *Shown where it is useless:* over the waiting-for-approval screen.
- **Received alert (10002):** above everything except the tap ring. That includes AR Scan and the mandatory update.
- **Update screens (10000):** above everything but the received alert and the tap ring. The update strip (6500) sits under every modal above 6500 and over the others.
- **Notifications (9000):** under AR Scan, the update modal and the received alert. Notices posted while one of those is open are not seen, and they time out.

**Can the received alert still draw over the mandatory update screen?** **Yes.**
- In the mandatory branch, `App.jsx:1909-1916` renders `<UpdateModal>` and then `{sosOverlay}` as siblings.
- 10002 is above 10000.
- `tests/sosOverMandatoryUpdate.test.jsx` covers it.

### Proposed named scale

One file, with names, not numbers scattered through components. Suggested values keep today's relative order wherever it is right:

| Name | Value | Holds |
|---|---|---|
| `--z-map` | 0 | map |
| `--z-map-ui` | 100 | map controls, place card, route card |
| `--z-banner` | 200 | in-map banners (meeting-point choice, location-off card) |
| `--z-panel` | 300 | group panel (all three heights) |
| `--z-chrome` | 400 | top bar, sharing chip, tab bar, meeting-point button |
| `--z-emergency-button` | 500 | Emergency button: above all ordinary chrome and the panel |
| `--z-sheet` | 600 | member options, join requests, confirm sheets, permission explainers |
| `--z-screen` | 700 | full screens: Settings, AR Scan, group locations table, guide |
| `--z-emergency-button-raised` | 750 | Emergency button lifted over full screens, *if you decide* it must stay reachable in AR Scan and Settings |
| `--z-toast` | 800 | notifications, update strip |
| `--z-update` | 900 | update modal (optional and mandatory) |
| `--z-emergency` | 1000 | received alert: always top |
| `--z-feedback` | 1100 | tap ring (no touches) |

Two decisions come out of this:
- Should the Emergency button stay reachable over AR Scan, Settings and sheets? Today it does not.
- Should notifications show over AR Scan? Today they are hidden, which I believe is a bug.

Leaflet's own panes use z-index 400-700 inside the map container. They stay trapped there because the container is its own stacking context (`z-0`). That has to stay true.

---

## 6. Map and AR

### How the maps are styled today

- **Google** (`App.jsx:161-198, 1873-1884`):
  - two style arrays, `TACTICAL_MAP_STYLES` (navy) and `STEALTH_MAP_STYLES` (black);
  - only TACTICAL is ever used, because nothing sets `theme: 'stealth'`;
  - satellite uses `mapTypeId: 'hybrid'` with `styles: []`.
- **Leaflet** (`TacticalLeafletMap.jsx`):
  - plain OpenStreetMap raster tiles, made dark by a CSS filter on the tile layer: `.locus-dark-tiles { filter: invert(1) hue-rotate(180deg) brightness(.62) contrast(1.15) saturate(.18) }` (`index.css:289-291`);
  - satellite uses Esri World Imagery tiles with no filter;
  - `VITE_MAP_TILE_URL` can swap in a keyed provider (the filter is then dropped);
  - `.dark-map` (`index.css:165`) is unused.
- **Which engine runs:** released phone builds have no Google key in their environment, so they use Leaflet (`mapFailReason` starts as `'no-key'`). I could not see the release `.env`. Please confirm.

**Light and dark on Leaflet:**

- **Light:** show OSM tiles with **no filter**, or a mild one (`saturate(.6) brightness(1.02)`) to calm OSM's strong colours toward the design's grey/green palette. It will not match the design's flat custom basemap exactly. OSM draws its own labels, icons and colours.
- **Dark:** keep a filter, re-tuned to the new dark palette (roughly `invert(1) hue-rotate(180deg) brightness(.75) contrast(.9) saturate(.3)`, tuned against the screenshots). Without a keyed dark provider, a filter is the only keyless option.
- **How to switch:** put the filter on the tile layer's class, driven by the theme (a `data-theme` attribute on `<html>` plus two CSS rules). The tile layer is re-mounted when its `url` changes (`key={tiles.url}`), but not when its class changes. So the switch should be done with CSS, not by re-mounting, to avoid a reload flash.
- **Matching the design closely** would need a styled vector or raster provider (Stadia, MapTiler, CARTO light/dark), which needs a key and maybe billing. That is your call.
- Markers, route and labels are drawn by our own React code. They need the new map tokens, and their colours are JS props today (`#10B981`, `#EF4444`, `#A1A1AA`).
- Leaflet's attribution box is default white and needs styling for dark.

**Google style arrays (best effort):**
- Write two arrays (light, dark) from the `--map-*` tokens: geometry = land, road geometry = road, `poi.park` = green, water = water, and label fill and stroke from the text colours. Hide POI icons, as STEALTH does.
- Pick one by theme in the `mapOptions` memo.
- They must stay module-level constants. The comment at `App.jsx:157-160` explains why: a new array each render forces a full restyle.
- Google cannot be checked in my environment without the key.

### AR Scan parts that depend on a dark background

All of these assume a dark camera image or the black fallback, and would be hard to read over a bright scene:

- Header: the AR_TRACKER title (red text, no plate) and the red badge (white on red is fine).
- ALIGN and close buttons on `bg-black/50`.
- Calibration banner: yellow text on `bg-yellow-500/10` (nearly transparent).
- White crosshair ring and ticks (`border-white/20`, `bg-white/50`): they vanish on a bright sky.
- The arrow ring: `bg-black/20` with a red border.
- Footer: `bg-black/60` (fine on light, but its text colours assume dark).
- Tags (`ARTag.jsx`): `bg-black/60` or `/75` with white and zinc text (works on bright scenes); the target is `bg-red-500/20` with white text (poor on bright scenes); the tick lines are white at 40-70 %.
- Grid overlay: white at 3 %, invisible on light.
- The camera-off ("IFR") state: black with faint white rings.
- The road ribbon is red at reduced opacity. It reads on both, but it will become accent blue.

The handoff's fix (plates that are white 90 % in light and ink 86 % in dark) covers the tags and labels. The free-floating crosshair and ring need a casing (a contrasting outline) to work on any scene. **"Too dark" detection does not exist.** It would need reading camera brightness (new work). It is in item 19's notices.

---

## 7. Parts that need your decision

### 13a: received alert with no location

What the app holds today:

- The alert carries the sender's socket id, name, `lat`/`lng` (null if no fix), time and age. It does **not** carry the sender's account id.
- The receiving phone keeps a roster (`users`) with each member's last smoothed position, keyed by socket id. Members in **Hidden** mode are dropped from this list. A Paused member keeps updating (finding 1).
- If a member's connection dropped, the phone keeps a "signal lost" record of their last position (`offlineNodes`), with their account id.
- The server keeps everyone's last heartbeat position, including Hidden members. Only the Group Lead's "Refresh locations" reads it.
- Socket ids change on every reconnect. Matching the alert to the roster by socket id fails if the sender reconnected. Matching by account id would need the server to add `uid` to the alert. That is a data-shape change.
- A sender with no fix when sending usually has no recent roster position either. So the card would often be empty for the same reason the alert has no location.

### 29: privacy and sharing screen (and Pause on the chip)

Facts any privacy copy must match, or code must change first:

- **Paused still sends your live position** every 1, 5 or 15 s (whatever the refresh rate is).
- **Hidden** still sends your live position and battery to the server on every heartbeat. The Group Lead's table shows them. A signal-lost marker shows everyone your last spot.
- An emergency alert always sends your current position, in any mode.
- **The mode resets to Live** on every app start and every join. It is not saved.
- Battery level and speed are shared with the whole group (member cards).
- Nothing is stored in a database. The server keeps everything in memory, and a restart wipes it. Alerts expire after a time limit (`SOS_TTL_MS`).
- New accounts get an avatar from DiceBear, an outside service, using the username as the seed.
- The owner account (hard-coded email, `App.jsx:546`) has an admin path recorder.
- Firestore holds only `wifi_aps`, and it is not read while WiFi positioning is off.

A Pause button on the chip only switches `telemetryMode`. That is client-only and needs no server change. But given the leak above, "paused" would need the heartbeat fixed to mean anything.

### 30: demo mode label

- The app has **no demo mode and no sample data**. Everything on screen is live data from the server.
- A "Demo · sample data" pill needs a source of fake members and places. Something like it exists only in the tests (`tests/helpers`, a fake socket) and would be built for the preview page (section 8).
- If the demo uses real phones on campus, the pill would be false. If it uses fake data, the app needs a switch to load it. That is new code that must never reach normal users.

---

## 8. Testing and screenshots

### How I propose to make screenshots in light and dark

Two tools:

1. **A preview page (new, dev-only).** It renders the separate components with sample data: emergency button states, received alert, notifications, update modal and strip, member card, code tiles, tab bar, building info, AR tags and overlay over a still photo, and the guide. It would sit behind a Vite mode check, like `device-check`, so it is compiled out of every release. Each state would be shown side by side in light and dark.
2. **The real app in the built-in browser.** Run it against a local `npm run server`, with scripted socket clients standing in for other members. Sign-in is skipped with the temporary `?devUser` override used before. That override is never committed. Theme is switched with the browser's light/dark emulation and the new setting.

Screens that can be previewed this way:
- Everything signed-out: guide, boot, sign-in, create account, and the error notifications.
- Lobby, waiting and approved.
- The whole map home: top bar, chip, banners, place card, route card, markers on Leaflet tiles.
- The group panel at every height, member options, confirm sheets, join requests and the table.
- Settings, notifications, update modal and strip (fed fake states).
- The emergency button and received alert (fake socket).
- AR Scan's overlay over a fake camera image.

Screens that cannot be previewed:
- A real Firebase sign-in or account creation (the screens render; the success path does not).
- The Google map, because there is no key here.
- The real camera, compass and tilt in AR Scan.
- Android's own permission prompts.
- The real APK install and live-update flows.
- The native splash, launcher icon and status-bar colours.
- Sound and vibration.

Several screens live inside `App.jsx` and are not exported (`BootScreen`, `AuthTerminal`, lobby, panel, Settings). So the preview page can only show them by mounting the whole app with fakes. The alternative is to move them into their own files, which is a refactor.

### Tests today

The full run on this PC: **86 files, 1,038 tests. 1,002 passed and 36 failed (11 files).**
- All 36 are "Test timed out in 5000ms", or a null read that follows from one, in the App-rendering UI tests.
- The failures named 12 files. I re-ran those 12 files on their own, and **all 96 of their tests passed**.
- So the failures come from load on this machine when everything runs in parallel; they are not real breakages.
- This will make "run `npm test` after each step" noisy. A fix (fewer workers, or a longer timeout for UI tests) would be its own small change. I did not make it.

Tests that cover areas that will change:

- **Emergency:** `SosOverlay.test.jsx`, `useIncomingSos.test.jsx`, `sosOverMandatoryUpdate.test.jsx`, `useAlertAudio.test.jsx`, `useBackButtonGuard.test.jsx`, `sosRelay.test.js`, `sosServer.e2e.test.js`.
- **Updates:** `UpdateModal.test.jsx`, `liveUpdateStrip.test.jsx`, `liveUpdateProgress.test.jsx`.
- **Group panel:** `squadMemberCard.test.jsx`, `leaderSuccession.test.jsx`, `telemetrySync.test.jsx`, `rallyPointClear.test.jsx`, `receivePing.test.jsx`.
- **Lobby:** `squadCode.ui.test.jsx`, `squadCodeRouting.test.jsx`.
- **Map:** `tabBarAndBanners.test.jsx`, `mapFocusApp.test.jsx`, `TacticalLeafletMap.test.jsx`, `mapEngineStatusApp.test.jsx`, `buildingInfoApp.test.jsx`, `buildingInfoPanel.test.jsx`.
- **AR Scan:** 18 `ar*` test files (arrow constants, render mode, overrides, tags, road).
- **Settings:** `arRenderMode.test.jsx`, `arFeatureOverrides.test.jsx`, `sendApp.test.jsx`.
- **Motion and feedback:** `motion.test.js`, `pressFeedback.test.js`, `notify.test.js`.

Many of these find elements by today's text ("SYNC_TELEMETRY", "GRANT_ACCESS", "RALLY POINT", "Acknowledge"). They must change in the same piece as the wording.

Areas with **no tests**:

- `SosTrigger` itself. The hold timings, the armed window, early release, what location is sent, and that the mode is not changed are all untested. Only the server side of `sos-broadcast` is tested.
- Paused/Hidden behaviour on the client (`FROZEN`/`GHOST`): **no test at all**, which is how the heartbeat leak went unnoticed.
- `BootScreen`, the sign-in screen and its error messages.
- The guide (`LocusGuide`).
- Theme (new), the pre-paint script (new), and saved settings (new).
- `CommsFeed` rendering. `notify.js` itself is tested.
- Remove-and-block (`toggleBlock`) on the client, and the Blocked tab.
- The waiting screen's Cancel.
- Stacking order. Only the alert-over-mandatory-update case is tested.
- Android resources.

---

## 9. Working with someone else's changes

- **Current branch:** `main` at `69819b0` (merge of PR #73). It is clean. The only untracked files are `docs/` and `SRM-Locator-main/REDESIGN_HANDOFF.md`.
- **Open pull requests:** one. **PR #12, draft, "feat: LOCUS splash screens, brand colours and icon-generation tooling"**, branch `claude/locus-capacitor-branding-cddfeb`, last updated 2026-09-20. It changes:
  - the Android splash PNGs (adding night variants);
  - the launcher icons;
  - `values/colors.xml` (new);
  - `AndroidManifest.xml`;
  - `capacitor.config.json` and `package.json`/`package-lock.json`;
  - `resources/*.svg`.

  That is item 27's ground. It is 70+ commits behind `main`.
- **Recent commits touching build-order files** (all by Vithya Krishnan R A):

  | Date | Commit | Area |
  |---|---|---|
  | 2026-10-04 | `d0e11f6` | AR Scan landmark engine (`ARCompass.jsx`, AR components) |
  | 2026-10-03 | `af5dd8b` | Map status in Settings (`App.jsx`) |
  | 2026-10-03 | `d0522c6` | Building Info panel (`App.jsx`, `BuildingInfo.jsx`) |
  | 2026-10-03 | `0ed6a16`, `0bfeb81` | Map glide (`App.jsx`) |
  | 2026-09-26 | `17e4473` … `5e492e7` | AR Scan stages 1-6 |
  | 2026-09-24 and 25 | — | Comms feed, code tiles, direction finder, GUI polish, update strip fixes, SOS overlap fix |

  There are many `claude/*` branches on the remote. They all look merged except PR #12's and `claude/nice-sinoussi-ff5e92` (last commit 2026-09-20, "remove the dead building edit-mode path").

**How to avoid editing the same files:**

- **`App.jsx` is the clash point.** It is 3,600 lines, and nearly every piece touches it. If your teammate is changing the front end, agree who owns `App.jsx` each week, or split it first.
- **One idea:** a "no visual change" piece that moves screens out of `App.jsx` into their own files (`BootScreen`, `SignIn`, `Lobby`, `GroupPanel`, `SettingsScreen`, `JoinRequests`, `LocationsTable`). After that, the two of you rarely touch the same file. It also makes the preview page easier. The risk is a large diff to review, but it is mechanical. Tests would prove nothing changed.
- Keep each piece on a short-lived branch, merged quickly, and rebase daily.
- Ask your teammate which files they plan to touch, and list them in each PR description.
- `src/index.css` and the new token file are the other shared hot spots. Land the tokens piece first and early, so everyone builds on it.
- Decide PR #12's fate before the Android piece.

---

## 10. Release state

From `gh release list`:

- **Newest native (APK) release: `v1.1.0`**, published 2026-09-24. The one before was `v1.0.0`.
- **Newest JS bundle: `js-1.1.19`**, published 2026-10-04.
- **The next release of either kind must be 1.1.20 or higher.** This matches `CLAUDE.md`.

WiFi:

- **`WIFI_POSITIONING_ENABLED` = `false`** (`src/utils/positionSource.js:11`).
- **`SHOW_INDOOR_POSITION_TO_SQUAD` = `false`** (line 26).
- **The production bundle has no WiFi code.** I built it once (only `dist/`, which is git-ignored):
  - no `wifi_aps` string in any chunk;
  - none of `WifiReadout`'s unique strings;
  - no WiFi scan plugin calls.
- The Firebase SDK (including Firestore) is still bundled, because `firebase.js` initialises it. But nothing reads it.

I changed neither flag.

---

## 11. Proposed order of work

Items 25, 28, 31, 32, 33 and Decisions 13a, 29, 30 are left out. Item 5 (wording) goes into each piece for the screens it touches. Every piece ends with:

- `npm test` (the files it changes run on their own, plus the full suite);
- screenshots of each state in light and dark from the preview page or browser pane;
- a grep showing no red and no old fonts left in the files it touched.

**Before any piece: three fixes I recommend you decide on.** They are behaviour, not look. The new wording would be untrue without them.
- (a) Paused should stop the heartbeat `update-location`.
- (b) Remove-and-block needs a real unblock (server event) and a Blocked list kept by account id. Otherwise drop the "unblock later" sentence.
- (c) Notifications should show over AR Scan.

Each is small. Each gets a failing test first, as `CLAUDE.md` requires. (a) and (b) need your approval because they change what the server receives. (b) also needs a server deploy.

| # | Piece | Items | Size | What could go wrong | How I'd show it works |
|---|---|---|---|---|---|
| P0 | Preview page + sample data (dev-only, compiled out) | (tooling) | Small | Accidentally shipping it | Release build grep shows it absent; screenshots of the page |
| P1 | Tokens and theme | 1, 2 | Medium | Wrong theme flashes at start; a setting that doesn't stick; Tailwind `@theme` name clashes | Light/dark/system screenshots of a test page; tests for the pre-paint script and saving; reload check in the browser with each setting |
| P2 | Shared parts and motion | 3, 4 | Medium | Changing a shared part restyles screens not yet reviewed; press feedback lost on some control | Preview page of each part in both themes; `motion` and `pressFeedback` tests updated |
| P3 | Loading, sign-in, lobby, waiting, "You're in" | 6, 7, 8, 9 | Medium | Sign-in errors mis-mapped; lobby routing tests break on new text | Screenshots of every access state; `squadCode*` tests; new tests for the sign-in error wording |
| P4 | Notifications and banners | 21 | Medium | Moving the old banners (ping, signal lost, location error) into the feed changes timing; feed placement clashes with the top bar | Screenshots of each type; `notify`/`receivePing` tests |
| P5a | Map home chrome | 10 (top bar + Settings button, chip, controls, location-off card, meeting-point banner, route card) | Medium | Settings gear removed from the right column; chip wording vs the paused leak | Screenshots of each map state; `tabBarAndBanners`, `mapFocusApp` tests |
| P5b | Map tiles and markers, light/dark | 10 (styles, markers) | Medium | Leaflet filter looks muddy; Google arrays untestable here | Screenshots of the Leaflet map in both themes and satellite; marker tests |
| P5c | Place card + "More about this place" | 11 | Small | "Navigate" also moving the meeting point (needs wording or a decision) | Screenshots; `buildingInfo*` tests |
| P6a | Group panel content, member options, remove-and-block confirm | 14, 17, 18 | Large | Dropping battery/speed; "Navigate to member" promise; group name gap | Screenshots for Group Lead and member, each mode; `squadMemberCard`, `leaderSuccession` tests; new confirm test |
| P6b | Join requests (Waiting / Blocked) | 16 | Small | Blocked tab empty (see fix b) | Screenshots; new test for approve/decline/unblock |
| P7 | Group panel three heights + empty/loading/refresh-failed | 15 | Large | **Covering the Emergency button**; drag fights map panning; text at 130 % size | Screenshots at each height with the Emergency button visible; drag tests with `shouldDismissSheet`-style unit tests |
| P8a | AR Scan restyle (plates, accent, readout, notices) | 19, 24 (camera) | Medium | Labels unreadable on bright scenes; arrow test constants | Screenshots over a bright and a dark still photo; `ar*` tests |
| P8b | AR target picker | 20 | Medium | Changes how the Scan tab picks a target | Screenshots; new picker tests; `arTargetFollow` still passing |
| P9 | Settings full screen + About + location explainer | 22, 24 (location) | Medium | Dead audio toggle exposed as "Alert sounds"; overrides and Send App homeless; explainer timing vs Android's prompt | Screenshots; `arRenderMode`, `arFeatureOverrides`, `sendApp` tests; new explainer test |
| P10 | Updates | 23 | Small | Mandatory gate loses focus trap | Screenshots of every state; `UpdateModal`, `liveUpdate*` tests |
| P11 | Guide rewrite (five steps) | 26 | Medium | Where it opens once signed in (Settings → How LOCUS works) | Screenshots of the five steps; new render test |
| P12 | **Emergency button, sending states, received alert, notifications waiting during an alert** | 12, 13 | Medium | Easier to trigger by accident; harder to reach; stacking regressions; "sent without location" message wrong | New `SosTrigger` tests (both holds, the 4 s window, early release in each hold, no send on cancel, location in each mode, mode unchanged), each mutation-checked; screenshots of every state; z-order test |
| P13 | Android icon, splash, status bar (Phase 1 APK) | 27 | Small–Medium | Clash with PR #12; bars not following in-app theme; needs a full APK | Screenshots from the emulator or phone after an approved APK build |
| P14 | Clean-up | — | Small | Removing a font still used somewhere | Grep proof: no `font-dot`, `Space Mono`, `DotGothic16`, `nothing-red`, `bg-dots`, `locus-glitch`, `locus-radar`; full test run |

---

## 12. Anything the handoff missed

These exist in the app but are not covered by the handoff. Without a decision they would stay in the old look.

1. **The buildings list (MATRIX tab of the panel).** You reach it by swiping the panel left or right, or with the desktop tabs. It shows the category tag, building id, distance, an AR button and SELECT_WAYPOINT.
2. **The desktop layout:** the left sidebar instead of the sheet, the desktop tabs, the profile badge, the admin button, and different banner z-orders.
3. **The Group Lead's locations table** ("SYS_TELEMETRY // MATRIX"), which opens after Refresh locations. It shows coordinates, battery and freshness, and auto-refreshes every 5 s.
4. **The admin tools (owner only):** the admin settings modal, the path-recording HUD, and the browser `prompt()` boxes.
5. **The signal-lost system:** the top banner, the grey dashed rows in the group list, the ghost markers with "SIGNAL LOST · 0:42 AGO", and the dashed projection lines.
6. **The ping notice** is its own blue banner, not a CommsFeed notification.
7. **The geofence "PERIMETER BREACH" banner** is dead code (F8).
8. **The meeting-point marker's own buttons** (AR Scan and remove, on the marker).
9. **The waiting screen's dead "ACCESS_DENIED" state.**
10. **The sign-in "SYS_PING" latency badge.**
11. **The lobby's "new code", Copy and Share buttons, and "COPIED".**
12. **AR Scan's pre-permission screen** (every time it opens), the ALIGN and Reset buttons, the hidden debug overlay (long-press on the title), and the camera-off "IFR" state.
13. **The three.js "Realistic" arrow and road colours** (`arArrowScene.js`, `arRoadScene.js`).
14. **The Settings sections the handoff drops:** Map render mode, the map engine status line, AR feature overrides, and Send App.
15. **"Check for updates"** lives on the signed-out guide only (Build Channel). There is no in-app version display once signed in.
16. **OS notifications** for meeting point and ping (emoji titles). These use the web Notification API and may never show on Android. There is also the notification permission request at sign-in.
17. **The custom scrollbar** (red on hover) and the **red text-selection colour**.
18. **Avatars:** DiceBear robot images on black, stored on each account. New accounts can get a new style; old ones keep theirs unless the app ignores stored photos.
19. **Usernames saved in capitals** (F9).
20. **`index.html` title "Locator SRM"** and the Vite favicon.
21. **The guide's boot sequence** and its "Stealth" grayscale toggle.
22. **Leaflet's attribution box** (default white, bottom-right). It may also collide with the meeting-point button.
23. **The indoor floor picker, confidence halo, floor tags and WiFi readout.** They are out of scope and compiled out today, but if the WiFi flag is flipped back on they will appear in the old look.
24. **Fallback names** "Squad Node", "Campus Node", "GUEST_NODE", "SRM_HQ" and "SQUAD_NODE".
25. **Empty and placeholder states:** "LOADING_FALLBACK_GRID...", "GENERATING...", "No release notes provided."
26. **The "1 of 2" counter.** The design implies the alert screen shows its position in the queue. Today the app knows only how many alerts are waiting, so "1 of 2" means adding a count of the ones already acknowledged, or changing the wording.

---

## Output checklist

- [x] No file in the app was changed. Only `docs/step0-report.md` was created. (`npm run build` refreshed the git-ignored `dist/` folder; `git status` shows no tracked changes.)
- [x] Every one of the 33 items (plus 13a) has a matches / partly matches / wrong line.
- [x] The red audit, old-look inventory, wording inventory and stacking list are done.
- [x] The Emergency alert trigger is described exactly as it works today.
- [x] The release numbers and WiFi flag state are reported, not changed.
- [x] A proposed list of reviewable pieces is included.
- [x] I have stopped and am waiting for approval.
