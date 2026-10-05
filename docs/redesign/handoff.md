# LOCUS redesign: handoff for the coding agent

Read this with `CLAUDE.md`. The design lives on the "LOCUS — App redesign" canvas. Everything you need to build is written out below, so this note works without the canvas.

## Ground rules

- **New look and wording only.** Keep every tab, feature and placement as it is today. The only layout change is a Settings button in the phone top bar, next to Sign out. It has been approved.
- **Two themes, light and dark.** Settings offers System / Light / Dark, and the default is System. Apply the theme before the first paint so the wrong theme never flashes on screen.
- **Red means emergency or destructive, nothing else.** Red is allowed only for:
  - the Emergency alert button and its screens;
  - Leave group;
  - Remove and block;
  - Vote to remove, once that feature is built.

  Ordinary errors and problems use the amber warning role with an alert icon.
- **Typography.** Inter everywhere, in sentence case. Remove DotGothic16 and Space Mono, and drop all monospace or all-caps "terminal" text. Use `font-variant-numeric: tabular-nums` on every distance, time, count, code and version.
- **Animation.** Animate only `transform` and `opacity`. Never animate width, height, top, left or filter.
- **Out of scope:**
  - Indoor WiFi positioning UI (floor picker, confidence halo, WiFi readout) stays out.
  - The server's "last known location" record stays as it is. It is a later change.
- **Testing.** Follow the bug-fix and test rules in `CLAUDE.md`. Run `npm test` after each step.

## Status key

| Label | Meaning |
|---|---|
| **Restyle** | The feature exists; change its look and wording only. |
| **New** | New client work. |
| **Ready** | Build it now. |
| **Decision** | Needs a decision from the owner first. Don't build it yet. |
| **Later** | Not in this phase. |

## Build order

| # | Item | Where in code | Work | Status |
|---|---|---|---|---|
| 1 | Design tokens: CSS variables for both themes, accent set, map roles. Map them in Tailwind v4 `@theme`. | `src/index.css` | Restyle | Ready |
| 2 | Theme setting (System / Light / Dark), applied before first paint. | `index.html`, `main.jsx`, Settings | New | Ready |
| 3 | Shared components (see "Components" below). | `src/components/` | Restyle | Ready |
| 4 | Motion pass (see "Motion" below): keep the existing springs, remove the blur from `modalCard`, turn the tap ping ring accent blue, retire the radar, glitch and scanline effects. | `utils/motion.js`, `index.css`, `utils/pressFeedback.js` | Restyle | Ready |
| 5 | Wording pass across all screens (table below). | everywhere | Restyle | Ready |
| 6 | Loading screen: accent mark tile, "LOCUS", "Find your group on campus". | `BootScreen` in `App.jsx` | Restyle | Ready |
| 7 | Sign in, create account, password reset sent, sign-in problem. | `AuthTerminal` in `App.jsx` | Restyle | Ready |
| 8 | Create a group, join a group, code not found, waiting for approval, not approved. | lobby and waiting overlay in `App.jsx`, `SquadCode.jsx` | Restyle | Ready |
| 9 | "You're in" confirmation after approval. It says that location is now shared live and where to change that. | `App.jsx` | New (small) | Ready |
| 10 | Map home (details below). | `App.jsx`, `TacticalLeafletMap.jsx`, markers | Restyle + New (Settings button, chip, location-off card) | Ready |
| 11 | Place card and "More about this place", which expands in place. Actions: Navigate, AR Scan, More about this place. | location card in `App.jsx`, `BuildingInfo.jsx` | Restyle | Ready |
| 12 | Emergency button and sending states. Timings unchanged: hold 1.2 s to arm, then within 4 s hold 1.2 s again to send; letting go early sends nothing. Wording details below. | `SosTrigger.jsx` | Restyle + new copy | Ready |
| 13 | Emergency alert received: full screen, Acknowledge is the only control, "1 of 2" when alerts are queued. Footer: "Alerts always include the sender's location, even if they had paused sharing or were hidden." | `SosOverlay.jsx` | Restyle | Ready |
| 13a | Received alert with no location: a "Last seen near …" card, shown only if the app holds that member's last shared position. Otherwise leave the card out. | `SosOverlay.jsx` | New | Decision (needs that data) |
| 14 | Group panel content (details below). | sheet in `App.jsx`, `SquadMemberCard.jsx` | Restyle | Ready |
| 15 | Group panel: three resting heights (peek 136 px, half 55 % of screen, full) plus empty, loading and refresh-failed states. | sheet in `App.jsx` | New | Ready |
| 16 | Join requests sheet with Waiting and Blocked tabs. | requests modal in `App.jsx` | Restyle | Ready |
| 17 | Member options sheet: Ping, Navigate to member, Find with AR Scan, and Remove and block (red, Group Lead only). It gathers today's per-card buttons into one sheet. | `SquadMemberCard.jsx`, `App.jsx` | New (same actions) | Ready |
| 18 | Remove and block confirmation (wording below). | `toggleBlock` in `App.jsx` | New | Ready |
| 19 | AR Scan (details below). | `ARCompass.jsx`, `components/AR*`, `utils/ar*` | Restyle | Ready |
| 20 | AR target picker sheet (people first, then nearby places, with search). Check `ARCompass` first: if a picker exists, restyle it; if not, it is new work. | `ARCompass.jsx` | Restyle or New | Ready |
| 21 | Notifications: stack under the top bar, never block, wait while an emergency alert is open. Success, ping (info), warning and problem types. | `CommsFeed.jsx`, `utils/notify.js` | Restyle | Ready |
| 22 | Settings as a full screen opened from the top bar. Sections: Theme; Location refresh rate (Battery saver 15 s / Standard 5 s / Fast 1 s); AR Scan quality (Efficient / Standard / Realistic); Alert sounds; Emergency alerts "Always on" (locked); About (version, Check for updates, How LOCUS works). | settings modal in `App.jsx` | Restyle + New (theme) | Ready |
| 23 | Updates: small update ready (Restart), full update (Update now / Later), downloading, install permission, safety check failed, mandatory update (no Later; emergency alerts still draw over it). | `UpdateModal.jsx`, `LiveUpdateToast.jsx` | Restyle | Ready |
| 24 | Permission explainers for location and camera: one short sheet each, shown before Android's own prompt. | `App.jsx`, `ARCompass.jsx` | New | Ready |
| 25 | Permission explainer for notifications (it also covers vibration). It needs a native notification plugin, which ships in a full APK release. | — | New | Later (depends on app update) |
| 26 | Guide: five steps (group and code, map and meeting points, AR Scan, Live / Paused / Hidden, emergency alert). Do not mention the vote, Google sign-in or area alerts. | `LocusGuide.jsx` | Restyle (rewrite) | Ready |
| 27 | App icon, native splash and status-bar colours. Icon: accent tile, white rounded chevron with a dot below, plus a monochrome layer. Ships as a Phase 1 APK. | `android/` | Restyle | Ready |
| 28 | Vote to remove: confirm, progress ("2 of 3"), and the notice to the removed member, "The group's members voted to remove you." The server already handles `vote-to-kick`; the app has no screen to cast a vote yet. Hide the "Vote to remove" row in member options until then. | `App.jsx` | New | Later (planned, not built yet) |
| 29 | Privacy and sharing screen, plus a Pause button on the map's sharing chip. | — | New | Decision |
| 30 | Demo mode label: a "Demo · sample data" pill. | — | New | Decision |
| 31 | First-time home banner. It needs the map to open before the user joins a group. | — | New | Later (depends on app update) |
| 32 | Role choice at sign-up (Student, Hosteler, Faculty, Research scholar). | — | New | Later |
| 33 | Option B: sending an alert switches the sender to Live until the alert ends. | — | New | Later |

### Map home (item 10)

- **Top bar:** logo, "LOCUS", "Map view" or "Satellite view", then Settings and Sign out.
- **Sharing chip** under the top bar, matching your own setting:
  - "Sharing live with {group}"
  - "Sharing paused · group sees your last spot"
  - "Hidden from group members"
- **Route card.**
- **Map controls** on the right: map/satellite toggle and recentre.
- **Bottom of screen:** Emergency button at bottom left, meeting point button at bottom right.
- **Map styles:** light and dark styles replace `TACTICAL_MAP_STYLES` and `STEALTH_MAP_STYLES`. The Leaflet fallback gets matching tile filters.
- **Other states:**
  - Loading: "Finding your location…".
  - Location off: an amber card with a "Turn on location" button.
  - Choosing a meeting point: a banner reading "Tap the map to place a meeting point", with Cancel.

### Emergency sending wording (item 12)

- **Armed, while Paused or Hidden:** "Your current location will be sent to your group with this alert."
- **Sent:** "Emergency alert sent to {group}" followed by "Your current location was sent with it." Add "Your sharing is still paused." when that applies.
- **Sent without a fix:** "Alert sent, but without your location".
- **Let go early:** "Emergency alert not sent". Use the info style, not red.

### Group panel content (item 14)

- Header with the group name, the role chip and the group code with a share button.
- Live / Paused / Hidden segmented control, with a helper line for each mode.
- Group Lead tools: Join requests (with a count), Refresh locations, Meeting point.
- Member rows: dot plus status words, distance, clock direction and a compass arrow.
- Leave group (red).

### Remove and block confirmation (item 18)

- **Title:** "Remove and block {name}?"
- **Body:** "{name} is removed from {group} straight away and can't ask to join again. You can unblock them later in Join requests › Blocked."
- **Buttons:** a red "Remove and block" button, and Cancel.

### AR Scan (item 19)

- Labels sit on translucent plates: white at 90 % in light theme, ink #161A21 at 86 % in dark theme. They must read over both bright and dark camera scenes.
- The target tag has a 2 px accent border.
- The road guide is a narrowing accent band.
- The 3D arrow is drawn with `perspective(520px) rotateX(58deg)`.
- The bottom readout shows a large distance and the clock direction.
- **Notices:**
  - compass calibration (figure 8);
  - camera off, with "Open phone settings" (direction and distance still work);
  - too dark (labels hide; arrow, guide and distance stay).

## Colour roles (light / dark)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--color-bg` | #F4F6F8 | #0E1116 | screen background |
| `--color-surface` | #FFFFFF | #161A21 | cards, sheets, bars |
| `--color-raised` | #FFFFFF (+shadow 2) | #1E232C | floating controls, notifications |
| `--color-sunken` | #EDF0F3 | #12161C | input fills, segmented track, skeletons |
| `--color-border` | #DCE1E7 | #2A303A | dividers (decorative) |
| `--color-border-control` | #8A94A3 | #5F6875 | input and toggle outlines (3:1) |
| `--color-text` | #14181F | #EEF1F5 | primary text |
| `--color-text-secondary` | #566070 | #A3ACB9 | supporting text (≥5.9:1) |
| `--accent` | #1F4FB8 | #8AB0FF | brand: Academic blue |
| `--accent-pressed` | #183F94 | #A9C4FF | pressed |
| `--accent-on` | #FFFFFF | #0B1A3A | text on accent |
| `--accent-soft` | #E8EEFA | #1B2740 | tonal buttons, selected fills |
| `--accent-halo` | rgba(31,79,184,.18) | rgba(138,176,255,.22) | focus ring, your-location halo |
| `--color-success` / `-soft` | #1E7B3C / #E6F4EA | #5BC77E / #15291D | live dot, approved |
| `--color-warning` / `-soft` | #8F5400 / #FDF1DE | #F0B44C / #2E2412 | problems, paused |
| `--color-danger` / `-pressed` | #C62828 / #A31F1F | #FF6B6B / #FF8A8A | emergency, destructive only |
| `--color-danger-on` / `-soft` | #FFFFFF / #FDECEC | #2A0606 / #3A1717 | |
| `--color-emergency` | #C62828 | #9F1D1D | received-alert band (white text) |
| `--color-backdrop` | rgba(20,24,31,.36) | rgba(0,0,0,.56) | scrims |
| `--shadow-1` | 0 1px 2px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.06) | 0 1px 2px rgba(0,0,0,.4) | cards |
| `--shadow-2` | 0 2px 4px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.12) | 0 8px 24px rgba(0,0,0,.5) | floating |
| `--shadow-3` | 0 -4px 12px rgba(16,24,40,.06), 0 -12px 40px rgba(16,24,40,.12) | 0 -12px 40px rgba(0,0,0,.55) | sheets |
| `--map-land / road / block` | #EEF0EC / #FFFFFF / #DDE1E6 | #171B21 / #262C35 / #20252D | map tiles |
| `--map-green / water` | #D6E8D2 / #CFE0EE | #18241C / #142230 | |
| `--map-casing` | #FFFFFF | #0E1116 | 3 px ring under markers and the route |
| `--map-plate` | rgba(255,255,255,.94) | rgba(22,26,33,.92) | behind every map label |
| `--map-self`, `--map-route` | = accent | = accent | your dot (22 px), route (5 px on a 9 px casing) |
| `--map-member` | surface + 2 px accent ring | same | 36 px avatars |
| `--map-building` | #566070 | #A3ACB9 | 12 px dots |
| `--map-meeting` | #14181F | #EEF1F5 | ink pin with a flag icon |
| `--map-last-known` | #8A94A3 dashed, 60 % | #6B7480 dashed | "6 min ago" members |

Swap the accent in one place: the five `--accent*` values for each theme. The two alternative accents are on the canvas.

## Spacing, sizes, type

- **Spacing:** `--space-1…12` = 4, 8, 12, 16, 20, 24, 32, 40, 48 px. Screen margin is 16 px; map overlays use 12 px.
- **Corners:**
  - `--radius-sm` 8: small fills
  - `-md` 12: inputs, plates
  - `-lg` 16: cards, notifications
  - `-xl` 24: sheets, dialogs
  - `-full`: buttons, chips, toggles
- **Sizes:**
  - minimum touch target 44
  - button 48 (large 56)
  - meeting point button 56
  - Emergency button 72 (including the 4 px casing)
  - top bar 56
  - tab bar 64 + bottom inset
  - avatar 40 in lists, 36 on the map
  - input 52
- **Type scale (in rem):**

  | Style | Size / line height | Weight |
  |---|---|---|
  | Display | 28/34 | 700 |
  | Title | 22/28 | 600 |
  | Heading | 17/24 | 600 |
  | Body | 15/22 | 400 |
  | Label | 15/20 | 600 |
  | Secondary | 13/18 | 400 |
  | Caption | 12/16 | 500 |
  | Numeric | 34/40 | 600 |

  Everything must still fit at 130 % text size: use minimum heights, never fixed ones.

## Motion

| Token | Value |
|---|---|
| press | 70 ms in, 220 ms out, scale 0.97 |
| fade | 200 ms |
| screen | 240 ms, slide 24 px + fade; forward from the right, back from the left |
| exit | 180 ms |
| list | 240 ms, 40 ms stagger for the first 5 items, first appearance only |
| `ease.standard` | cubic-bezier(.2,0,0,1) |
| `ease.enter` | cubic-bezier(0,0,0,1) |
| `ease.exit` | cubic-bezier(.3,0,1,1) |
| springs | keep `SHEET_SPRING` (sheets), `PANEL_SPRING` (cards, dialogs, notifications), `INDICATOR_SPRING` (tab pill, segmented thumb) |
| sheet release | `shouldDismissSheet` / `projectMomentum` |
| emergency rings | linear, 1200 ms per hold, 4000 ms armed window |
| skeletons | pulse opacity 1 → .55 → 1 over 1400 ms |

**Reduced motion:**

- Slides become 150 ms fades.
- Sheets still follow the finger and settle with a 150 ms ease.
- No stagger; pulses hold still.
- The ping ring becomes a brief still glow.
- Emergency rings still fill, because they show time.

## Wording

| Old | New |
|---|---|
| Squad | Group |
| Commander | Group Lead |
| Squad / room code | Group code |
| Gatekeeper | Join approval |
| Mutiny | Vote to remove (planned) |
| SYS_CONFIG | Settings |
| SYNC_TELEMETRY | Refresh locations |
| Rally point | Meeting point |
| Geofence / zone alert | Area alert |
| QUERY_DATA | More about this place |
| ACTIVE / FROZEN / GHOST | Live / Paused / Hidden |

Labels around the SOS button say "Emergency alert". Messages are short, kind sentences that say what happened and what to do next.

## Release

- **Phase 2 (JS bundle):** all web-layer work.
- **Phase 1 (full APK):** the icon, native splash, system bar colours and the notification plugin (item 25).
- Number every release above the newest one published in either series. Check with `gh release list`.

## Implementation notes (where the code differs from this note)

Added by the coding agent. The code is in `SRM-Locator-main/src/theme/tokens.css`.

- **Corner names.** `--radius-sm/md/lg/xl` are Tailwind's own corner sizes, and today's screens already use one of them (`rounded-lg`). Taking those names would have changed screens before they were converted. Same values, named by purpose:

  | This note | Code | Value |
  |---|---|---|
  | `--radius-sm` | `--radius-fill` | 8 px |
  | `--radius-md` | `--radius-input` | 12 px |
  | `--radius-lg` | `--radius-card` | 16 px |
  | `--radius-xl` | `--radius-sheet` | 24 px |
  | `--radius-full` | Tailwind's `rounded-full` | — |

- **Accent names.** `--accent`, `--accent-pressed`, `--accent-on`, `--accent-soft` and `--accent-halo` are `--color-accent`, `--color-accent-pressed`, `--color-accent-on`, `--color-accent-soft` and `--color-accent-halo`. The `--color-` prefix makes Tailwind turn them into classes (`bg-accent`, `text-accent-on`). The other colour roles already had it. The map roles are `--color-map-*` for the same reason. Swapping the accent is still the five `--color-accent*` values in each theme.
- **`--map-member`** is not a single token. It is a surface-coloured disc with a 2 px accent ring, so markers use `--color-surface` and `--color-accent`.
- **Light `--color-border-control` is `#808A99`, not `#8A94A3`** (owner's decision, 2026-10-05). `#8A94A3` was 2.83:1 on the light background. `#808A99` is 3.22:1 on the background, 3.49:1 on white and 3.05:1 on the input fill. The dark value `#5F6875` is unchanged. It reaches 3:1 on the dark background, surface and input fill, but is 2.80:1 on the dark raised surface (`#1E232C`).
- **Light `--color-text-secondary` `#566070`** is 5.87:1 on the light background, just under the "≥5.9:1" stated above, and 5.56:1 on the input fill. Both pass the 4.5:1 minimum for text. Unchanged.
