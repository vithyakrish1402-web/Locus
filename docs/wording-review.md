# Wording review

The strings that need your decision before the wording pass. Everything else is a straight old-word-to-new-word swap (listed at the end), done after you answer, with the tests changed alongside (F10).

Checked against the code on `claude/redesign-fixes-a-b` (2026-10-09). The Step 0 inventory (`docs/step0-report.md`, section 4) is older than most of the redesign, so many of its rows are already done.

## Needs your decision

| # | Where | Current text | Proposed text | Why it needs you |
|---|---|---|---|---|
| D1 | Locations table, signal column, under 10 s (`App.jsx` `getSignalFreshness`) | OPTIMAL (< 10s) | Updated just now | The inventory proposed "Live", but a Hidden member checks in every few seconds too, so "Live" would call a Hidden member Live. |
| D2 | Locations table, no time at all | NO_SIGNAL | No update yet | "No signal" suggests their phone lost signal; it means the server has no time for them yet. |
| D3 | Admin tools banner (`AdminTools.jsx`) | CLASSIFIED // COMMANDER-LEVEL CONTROLS — ALL ACTIONS PUSH TO GLOBAL MATRIX | Routes you publish go to everyone in your group. | Untrue today: a published route goes only to your own group (the server scopes it). |
| D4 | AR Scan's default target (`App.jsx`, the Scan tab with no member to aim at) | SRM_HQ ("Finding SRM_HQ") | SRM campus | It points at a fixed spot near the middle of campus (12.8237, 80.0444), not a building called HQ. "SRM campus" is true. Name a building instead if you want one. |
| D5 (F9) | Names of accounts made before the redesign | Shown as saved, in capitals (e.g. "RAHUL K") | Keep as saved | New accounts save names as typed. Changing old names' case on screen guesses wrongly for names like "McDonald", and changing the stored names is a data change. |
| D6 (new) | Close button on the locations table and admin tools (screen-reader name) | (none: the old buttons were an unnamed X) | Close | New string, added with the restyle. |
| D7 (new) | Buildings list, a search with no match | (a blank list) | No building called "…" | New string. You approved it as a deviation; listed so it gets reviewed with the rest. |

## Already settled (no decision needed)

- **F1** groups have no name: nothing shows one. The panel says "Your group" and the code.
- **F2** Paused: since Fix A, Paused really shows your last spot, so "Paused shows your last spot" is true.
- **F3** Hidden: you chose "Other members won't see you on their map" (2026-10-05), which is true. The Group Lead's table and "signal lost" markers still show a Hidden member; hiding them there is the server change H2, on the Before-rollout list.
- **F4** Navigate no longer sets the group's meeting point.
- **F5** the member option is "Show on map" (it only centres the map). Only the dev preview's sample sheet still says "Navigate to Meera"; it is fixed in the pass.
- **F6** no Unblock exists, and nothing offers one ("can't ask to join again").
- **F7** the meeting point is still sent as "RALLY POINT" for older apps and shown as "Meeting point".
- **F8** the geofence banners are removed.
- **F10** each piece of the pass changes its tests in the same commit.
- "SOS beacon" in the button's screen-reader names becomes "Emergency alert button" (your decision, 2026-10-07).
- The Alert sounds setting works (the inventory said it did nothing; it was fixed since).

## Straight swaps after you answer

Proposed words as in the inventory, no change of meaning:

- **Locations table:** SYS_TELEMETRY // MATRIX → Group locations; COMMANDER CLASSIFIED CLEARANCE → (removed); NODE_DESIGNATION / LAST_KNOWN_COORDS / POWER_CORE / SIGNAL_INTEGRITY → Name / Last position / Battery / Last update; COORDS: / POWER: / SIGNAL: → Position / Battery / Updated; NO_CACHE_DATA → No position yet; LAT: / LNG: → Lat / Lng; UNKNOWN → Unknown; GOOD (Ns ago) / WARN (Nm ago) / STALE (> 5m) → {n} s ago / {n} min ago / Not seen for 5+ min; NO OTHER OPERATIVES IN THE SQUAD YET. → No one else is in the group yet.; AUTO-REFRESHING EVERY 5 SECONDS → Updates every 5 seconds (true: it refreshes every 5 s while open); FORCE_SYNC / SYNCING... → Refresh now / Refreshing…
- **Admin tools:** ADMIN_OVERRIDE → Admin tools; RESTRICTED ACCESS // {email} → Signed in as {email}; SECTION_01 // PATH_RECORDER → Record a path; its paragraph → "Tap points on the map to trace a route between two buildings, then publish it to your group."; INITIATE_RECORD_PATH → Start recording; RECORDING ACTIVE — {n} NODES CAPTURED / RECORDING_NODES: {n} → Recording · {n} points; PUBLISH_ROUTE / PUBLISH → Publish; ABORT → Discard; CLOSE_TERMINAL → Close; COMMANDER // {name} → (removed); the two prompts → "Start building (for example, Tech Park)" / "End building (for example, Java Green)".
- **Emergency button screen-reader names:** every "SOS beacon" → "Emergency alert button".
- **Fallback member names:** 'Squad Node' and the AR label's 'SQUAD_NODE' → "Group member".
- **Dev preview only:** the sample sheet's "Navigate to Meera" → "Show on map".

Not in the pass: the WiFi readout, floor picker and floor tag (WiFi positioning code, which stays untouched while the feature is off); the AR debug overlay (developer only); console messages (never shown to users); the custom route's `eta: "TACTICAL"` (data sent to other phones).
