# LOCUS redesign: Step 0 follow-ups

Date: 2026-10-05. Written after Fix A (Paused) and Fix B (notices over AR Scan), on branch `claude/redesign-fixes-a-b`. Nothing in this note has been changed in code. Each section ends with options for you to choose from.

One correction to the Step 0 report first. I wrote that the sharing mode "resets to Live on every app start and every join". **It resets only when the app starts.** Leaving a group and joining another keeps the mode you had (`telemetryMode` is not reset in `endSquadSession`, `App.jsx`).

---

## 1. What a Paused member and a Hidden member reveal, and to whom

This describes the app **after Fix A**. Names in the code: Live = `ACTIVE`, Paused = `FROZEN`, Hidden = `GHOST`.

Where the data goes:

- **Other members' apps** get the `users-update` broadcast from the server. Each entry carries name, photo, position, speed, heading, battery and status.
- **The Group Lead's "Refresh locations" table** reads the server's `locationCache` (`request-telemetry`, `backend/server.js:177`). It prefers the heartbeat's position (`safety-ping`) and shows battery and "last update".
- **Server storage** means two in-memory records: `users[socket]` and `locationCache[socket]`. There is no database. A server restart wipes both. A disconnect deletes them after raising "signal lost" (`server.js:652-695`).

### Paused (after Fix A)

| Who | Position | Battery | Other |
|---|---|---|---|
| Other members' maps and group list | **The spot where you paused**, marked `FROZEN`. Your card's age ("2 min ago") counts from the pause. | Shows **100 %**. The pause message has always sent a fixed `battery: 100` (`App.jsx`, the mode-change effect). It is wrong, but not a leak. | Speed 0. Heading as it was at the pause. |
| Group Lead's table | **The spot where you paused**, with the pause time as "last update". | **Live.** The heartbeat still sends your real battery every 1, 5 or 15 s. | — |
| Server memory | Paused spot only. | Live battery (heartbeat), 100 (location record). | — |
| If your connection drops | "Signal lost" marker for everyone **at the paused spot**. | Last battery from the location record (100). | — |
| Emergency alert | **Your current position** (by design). | — | Mode stays Paused. |

Known limit: after a reconnect, the app re-sends the paused spot so you don't vanish from the group. The server stamps that re-send with the current time, so your card's age restarts from the reconnect. Keeping the original pause time would need a new field in `update-location`, which is a data-shape change, so I have not done it.

Suggested honest wording for Paused:
> "Your group sees where you were when you paused, and how long ago. Your battery level is still shared with the Group Lead. An emergency alert always sends your current location."

### Hidden (unchanged)

| Who | Position | Battery | Other |
|---|---|---|---|
| Other members' maps and group list | **Not shown.** Their apps drop any entry marked `GHOST` (`App.jsx`, `users-update` handler). **But the data still reaches their phones.** Every time you move, your app sends `update-location` with your live position and status `GHOST`, and the server broadcasts it to the whole group. | Arrives on their phones too, not shown. | You vanish from their group list as well as their map. |
| Group Lead's table | **Your live position**, from the heartbeat every 1, 5 or 15 s, marked fresh. | **Live.** | — |
| Server memory | **Live position** (both records). | Live. | — |
| If your connection drops | "Signal lost" marker for **everyone**, **at your last live position**. Hidden members do appear here. | Shown in the marker's details. | — |
| Emergency alert | Your current position. | — | Mode stays Hidden. |

**Decided (2026-10-05):** the wording for Hidden is **"Other members won't see you on their map"**. Never "invisible" and never "nobody can see you". Neither is true while the Group Lead's table and "signal lost" markers still show a Hidden member. There is no server change in this phase. It is on the "Before real rollout" list at the end of this note.

### What it would take to hide a Hidden member from the Group Lead's table too

The table gets a Hidden member's position by two routes:

1. the heartbeat (`safety-ping`, every 1, 5 or 15 s);
2. the movement reports (`update-location` with status `GHOST`). The server falls back to these when there is no heartbeat position (`backend/telemetry.js`).

Both are needed for a hidden member to drop out of the table.

- **Option H1, app only:** while Hidden, send the heartbeat without coordinates (or skip it), and send one `update-location` with `status: 'GHOST'` and no position, then nothing more.
  - This also stops your live position reaching other members' phones.
  - Risk: the server's "signal lost" code reads `lat || latitude` and passes it on. With no position stored, it would send an empty position. The app then builds a "signal lost" marker from `lastKnownLocation.latitude` without checking, which could put a marker at an invalid point, or break.
  - So H1 needs an app change in the "signal lost" handler (ignore a loss with no position). Even then, **old installed apps** in the group would still receive the empty position.
  - Sending `null` where a number used to be is arguably a data-shape change. Your call.
- **Option H2, small server change:** the server leaves out members whose status is `GHOST` from the Group Lead's table, from the `users-update` broadcast to others, and from "signal lost".
  - This is the cleanest: no position of a hidden member leaves the server.
  - It is a server change, and needs a Render deploy plus a review of what "status" a hidden member's record carries after a reconnect.
- **Option H3, both:** H1 so the position never leaves the phone, and H2 so older apps and the server agree.

**My recommendation is H3.** Approve H2 first, since it protects everyone regardless of app version. None of this is built.

**Decided (2026-10-05):** no server change in this phase. H2 is listed under "Before real rollout" below.

---

## 2. The Emergency button during AR Scan

Today AR Scan is a full-screen layer (`ARCompass.jsx`, now `LAYER.arScan`). The Emergency button (`SosTrigger.jsx`, `z-[1150]`) sits underneath it, so it cannot be seen or pressed until AR Scan is closed (top-right ✕). A received alert still draws over AR Scan.

In every option below, the button is the same `SosTrigger` component, with the same 1.2 s arm, 4 s window and 1.2 s confirm, and the same size. The two-hold safeguard does not change.

**Decided (2026-10-05): E1 is approved for a later piece.** Same spot, same two holds, and no overlap with AR Scan's controls.

- **Option E1 (recommended): lift the button over AR Scan, in the same spot as on the map.**
  - Give it a layer just above AR Scan (the planned `--z-emergency-button-raised`) while AR Scan is open. It would sit at bottom-left, where people already know it is.
  - AR Scan's bottom readout (place name and distance) would need a left margin of about 6 rem on phones so the button doesn't cover it.
  - AR Scan has no swipe or drag gestures near the bottom-left. The only long-press is on the title at the top (it opens the debug view). So no AR gesture can start a hold by accident.
  - Work: small. One layer value, one margin in AR Scan, and a test that the button is above AR Scan and still needs both holds.
- **Option E2: a smaller emergency control inside AR Scan's header.**
  - Not recommended. A different size and place from the map breaks muscle memory, and the header is where Align and ✕ are tapped often, which raises accidental-touch risk.
- **Option E3: keep it as today and make leaving AR Scan quicker.**
  - For example, the Android Back gesture closes AR Scan (today Back is only blocked during an alert or mandatory update).
  - That is still two actions before the alert can start, so it is harder to reach than on the map.

**For the P12 plan (owner, 2026-10-05):** sheets stay above the Emergency button for now, as today's modals do. The P12 plan must propose whether any sheet should keep the Emergency button visible.

Related, not asked: Settings, Join requests, the Group Lead's table and the update dialog also cover the Emergency button today. If E1 is chosen, the same raised layer could apply there. I suggest deciding that when the Settings piece is built.

---

## 3. "Navigate" moving the group's meeting point

### The code path

All of these call `handleWaypointSelect` (`App.jsx`, "TACTICAL ROUTING ENGINE"):

- the place card's **WAYPOINT / SET_DESTINATION** button;
- the buildings list's **SELECT_WAYPOINT** button;
- Building Info's **Take me there**.

`handleWaypointSelect`:

1. sets `routeStart` (your location) and `routeEnd` (the place), and works out a straight-line distance and walking time for the route card;
2. **calls `publishSquadWaypoint(place)`**. That sets `activeWaypoint` locally and emits `publish-waypoint` to the server, which sends `new-waypoint` to the whole group. Everyone gets a "designated a rally point" notice, and the marker moves on every map.

Everything that "navigates" hangs off the meeting point, not off the route:

- The real walking route line is drawn only toward `activeWaypoint` (`useWalkingRoute`, `useWaypointNavigationLine`).
- AR Scan's road line is drawn only when AR Scan is aimed at the meeting point (`arRoutePathFor`).
- The route card closes when the meeting point is cleared.

### Deliberate or a side effect?

**Deliberate.** Commit `8602d13` (2026-08-03, "squad-wide waypoint broadcast…") says: "SELECT_WAYPOINT in the Matrix sidebar now actually publishes a rally point to the squad … instead of only computing a local route/ETA, so tapping it finally puts a marker on everyone's map."

So "choose a destination" and "set the group's meeting point" were merged on purpose, back when the button was the only way to share a place. Since then, the Group Lead's Meeting point button and the floating meeting-point button both set a meeting point by tapping the map. A building, though, can only become the meeting point through this button.

### Proposal

- **Navigate** (place card, buildings list, "Take me there") starts **your own route only**:
  - it sets `routeStart`/`routeEnd`, shows the route card ("Walking to Tech Park · 6 min · 450 m");
  - it emits nothing;
  - nobody else is told;
  - the group's meeting point is untouched.
- **Set as meeting point** is a new, separate action on the place card. It sets the meeting point exactly as today (`publish-waypoint`, same payload). Who can use it follows the server's current rule: any member can set one, and the Group Lead or the person who set it can clear it.
  - It could ask "Set Tech Park as the meeting point for your group?" because it notifies everyone. That is your call; today there is no confirmation.
- **Your own route line:**
  - **(a) Smaller:** the personal route shows only the route card and the highlighted building, with no line on the map. That is exactly what a personal route (start → end) does today.
  - **(b) Fuller:** extend `useWalkingRoute` to follow the personal destination when you're not heading to the meeting point. You then get the same walking line, and AR Scan's road line, to any place. This is medium-sized and touches the AR road tests.
- **What changes for people:**
  - Members who used SELECT_WAYPOINT to share a building would now have to use "Set as meeting point".
  - Tests that rely on the old link need updating: `rallyPointClear`, `mapFocusApp`, `buildingInfoApp`, `arRoadLineApp`.
- No socket event, payload or server change is needed for either part.

I suggest building this inside the place-card piece (P5c), after you choose (a) or (b) and say whether "Set as meeting point" should confirm first.

**Decided (2026-10-05): approved for a later piece.** Navigate starts only your own route, and "Set as meeting point" is a separate action. The change notes must name commit `8602d13` (2026-08-03) as where the two were joined. Still open: route line (a) or (b), and whether "Set as meeting point" asks to confirm.

---

## About PR #12 (answering point 10)

- **Who:** opened 2026-09-20 from **your own GitHub account** (`vithyakrish1402-web`) by an earlier Claude Code session. The commit `f7be07c` is co-authored by "Claude Opus 5". Its description says it is recovered, unfinished work, committed so it wouldn't be lost, "never finished or reviewed".
- **What it changes:**
  - **Launcher icon:** a competing LOCUS icon set (18 PNGs across densities). The adaptive-icon XML switches its background from a colour to a PNG layer.
  - **Splash:** 13 new night-mode splash images, plus the existing ones replaced.
  - **`values/colors.xml`** (new): `colorPrimary`/`colorPrimaryDark` `#170D0E` (near-black maroon), `colorAccent` `#FF3B3F` (red).
  - **`capacitor.config.json`:** adds `backgroundColor: #170D0E`. Its version **predates and would delete** the live-update (`CapacitorUpdater`) settings if taken as is.
  - **`AndroidManifest.xml`:** whitespace reformatting only.
  - **`package.json`:** adds the `@capacitor/assets` icon-generator tool, which drags in an old `@capacitor/cli` 5.x copy.
  - **`resources/`:** SVG sources for icon and splash.
  - Its own description already lists **23 merge conflicts with `main`**.
- **Conflict with the redesign:** yes.
  - Its colours are the old tactical look (dark maroon and red). The redesign's icon is an Academic-blue tile with a white chevron, and it uses light and dark system colours.
  - It also overlaps every file item 27 would touch.
  - The reusable part is the tooling idea: SVG sources plus `@capacitor/assets` to regenerate icons and splashes in one command. The new SVGs would have to be drawn fresh.
  - I have not touched it.

**Decided (2026-10-05):** leave PR #12 untouched. Item 27 (icon, native splash, system bar colours) stays out of this phase.

---

## Decisions recorded on 2026-10-05

- Fix A's known limit is accepted: after a reconnect, a paused member's age restarts from the reconnect time.
- Hidden wording: "Other members won't see you on their map" (see section 1).
- Approved for later pieces: the Emergency button raised over AR Scan (section 2), and Navigate split from "Set as meeting point" (section 3).

## Before real rollout

These must be done before LOCUS goes to real users beyond the demonstration. None of them is in this phase.

1. **Hide Hidden members on the server (option H2, section 1).**
   - Leave members whose status is `GHOST` out of the Group Lead's Refresh locations table, out of the `users-update` sent to other members, and out of "signal lost".
   - This is a server change, so it needs a Render deploy.
   - Until it is done, a Hidden member's live position still reaches the Group Lead's table and other members' phones (not their maps), and "signal lost" shows their last spot.
2. **Settings other than the theme reset on restart.** Only the theme is saved on the phone (`locus.theme`). Location refresh rate, AR Scan quality, AR feature overrides, Alert sounds and Map/Satellite go back to their defaults each time the app starts. Kept as it is for now (owner, 2026-10-05).

## Later

- **Ping with distance and direction.** The design's ping notice says how far away the sender is and in which direction. `receive-ping` carries only `senderName`, so this needs the sender's id added to `receive-ping` (a data and server change), not a match by name. Until then the notice names the sender only.
- **Hide on the update download sheet.** The design has a Hide button while a full update downloads. Today the download and install sheets cannot be dismissed (no Later, Escape blocked while busy), and that stays for now (owner, 2026-10-05). If Hide is added, a failure after hiding must always bring the sheet back.

## Decisions for batch 1 (owner, 2026-10-05)

- Names: new accounts save the name as typed. Capitals-only names are shown as stored everywhere except the greeting's first name.
- Avatars (member card piece): initials in a ring, display only. The stored robot picture stays and is still sent.
- Alert sounds works: off silences the ping and signal-lost sounds. The emergency alarm always plays ("Always on", locked). Default on.
- Settings keeps everything the design leaves out (Map/Satellite, map engine status, AR feature overrides, Send App) under "More" at the bottom.
- Place card: "Set as meeting point" is a third, quieter button, with a confirmation. Route line (b) only if it reuses today's drawing; otherwise (a).
- Camera explainer: shown only until camera permission is granted. AR Scan's own start screen stays, restyled.
- Location explainer: in the Map batch, with the location-off state.
- Guide: shown once on first run, remembered on the phone; Skip and Get started both count. Always reachable from Settings › About. "Check for updates" moves to Settings › About. Stealth goes only if it is purely a map look.
- Route card (owner, 2026-10-05): its X is now "End route" and ends only your own route. It never clears the group's meeting point. That changes `2ec4aa8` (2026-08-03), where closing the route card also cleared the meeting point, because Navigate was then what set it. The meeting point is removed only by Remove on its marker or the Group Lead's clear, with the server's permission rules unchanged. Your own route also no longer closes when the meeting point is removed.
- Place card: Navigate (card, buildings list) starts your own route only; "Take me there" went (it was the same action). The map's walking line follows your own destination while you have one, using the same walking-route code; AR Scan's road line still follows the meeting point only, until the AR batch.
