# Changes based on published 1.1.74

Baseline: `js-1.1.74`, commit `10ca769c3ab8a3c2a53df380432e80b9fb8d86f4`.
The downloaded release bundle matches its published SHA256:
`6bb2e375e0673070b8c06025618deb3629669080dc434b0fa03441a2069e1602`.
The latest native baseline is still Android 1.1.73; 1.1.74 was a JavaScript update.

## Changes

1. Ordinary pings now also reach the authenticated native background listener. The server wakes its long poll immediately. Pings retain cooldown, mute and group-membership checks, use the sender's recorded name, expire after two minutes, and are delivered only to the intended user. Native delivery remembers its cursor across service restarts and respects LOCUS Do Not Disturb. Background roster IDs (`bg:<uid>`) are supported.
2. Join requests update the native notification immediately, with the current pending count. The notification clears at zero, opens Group on tap, and is restricted to the Group Lead and moderators. Pings and join notices continue even when the separate SOS-alert switch is off.
3. Navigation starts with camera following enabled. Google uses its vector renderer for heading control; Leaflet has a rotation-aware map engine. Dragging pauses following and Re-center restores it. The self pointer compensates for map bearing, and map taps and overlays use the rotated coordinate system.
4. Leaflet requests tiles during movement and zoom, checks more frequently, retains a small nearby buffer, and no longer applies button transform transitions to marker positioning. Rotation updates only the self-marker layer rather than rerendering all campus markers. Network-dependent tile latency still needs a real-device check.
5. Rally points accept an optional 160-character description. It is displayed on the marker, shared with the group, and restored after reconnecting. Older clients that send no description retain their original payload shape.
6. The navigation pointer is a blue filled arrow with a white edge, with a small position dot at rest.
7. Mobile Map, Buildings and Group have separate bottom tabs. Buildings and Group open fixed pages with independently scrolling content and a Back to map action. The draggable sheet, height stops and swipe-to-switch behavior are removed from the app.
8. AR Scan opens from the map control column immediately above Settings.

The 1.1.74 moderator/stand-in limits and light-theme contrast fixes remain in place.

## Delivery requirements

- Publish the backend changes and a newly signed **full Android release** together. Do not ship this as only a live JavaScript bundle.
- Background alerts use the existing Android sharing service. The user must enable **Keep sharing when the app is closed** and grant Android notification permission. This change does not add Firebase Cloud Messaging or notifications independent of that service. Hidden mode and stopping background sharing also stop its background listener.
- The separate `com.locus.app.sidetest` APK is for review. It has both updaters disabled and does not replace the installed LOCUS app. Its notifications require the changed backend as well.
- Real-device background/lock-screen delivery, battery-management behavior, and Google Maps with a valid API key remain field checks. Automated tests do not prove delivery on every phone.

## Validation

- Production web build and separate Android test APK build.
- Android unit tests, including ping parsing, cursor advancement and repeat suppression.
- Real-server integration tests for disconnected recipients, background roster IDs, identity isolation, join permissions/count clearing, and rally-description persistence.
- Browser checks using the actual Leaflet map: heading compensation, self-marker alignment at zoom 17/18/19, click coordinates after rotation, and rally-description submission. Screenshots are in the local verification artifacts.
- Dedicated app tests cover Map/Buildings/Group switching, native notification taps and AR Scan's position above Settings.
- Role and theme tests cover the retained 1.1.74 behavior.

The inherited full test suite is not green: the initial broad run had 2,913 passes and 433 failures. An untouched 1.1.73 source checkout reproduced 73 failures out of 87 selected legacy tests (group-panel, AR, ping presentation and fallback-map suites), including stale UI expectations and test-state issues. The focused feature and 1.1.74 regression checks are recorded separately; the broad suite is not a release approval.
