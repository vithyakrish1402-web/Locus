# Release plan (draft, nothing released)

Two JS-only bundles, in this order. Neither is marked mandatory. Nothing below runs until you say go.

## (a) The offline-alert fix alone, from `main`

- **What:** branch `fix/offline-sos-alert` (one commit, `e5a9160`, on `main` `69819b0`): the fix in the old look's wording, with the offline notices protected from being pushed out. App only: no socket event, data shape, Firestore field or server change.
- **Before:** your phone test on `test/offline-sos-sidetest` (LOCUS Test). Then `gh release list` to confirm nothing above 1.1.19 has shipped since.
- **Steps (after your go-ahead):**
  1. PR `fix/offline-sos-alert` into `main`, review, merge.
  2. On `main`: `npm ci`, full test run file by file, `npx eslint .`.
  3. `npm run release:bundle -- 1.1.20` (number 1.1.20 or the next free one). Not mandatory: no `[MANDATORY]` marker.
  4. `npm run release:verify -- --bundle`.
  5. Update CLAUDE.md's number line ("next release must be 1.1.21 or higher").
- **On phones:** an installed LOCUS (shell v1.1.0) finds js-1.1.20, downloads it, and shows the "update ready" strip; it applies when the person taps Restart. Until then they keep running js-1.1.19.

## (b) The redesign, after (a)

- **What:** branch `claude/redesign-fixes-a-b`, JS-only (see "Native files" below), released as the next number after (a), e.g. js-1.1.21. Not mandatory.
- **Bringing the two copies of the fix together, so it isn't applied twice.** After (a) is merged, `main` holds the old-look copy of the fix and the redesign branch holds its own (the original `9dad5a8` plus the Stop 1 rework and the safety-notice commit). They are the same fix written twice, so git sees them as two changes to the same lines.
  - **Merge `main` into the redesign branch** (not rebase). A rebase would rewrite 96 unpushed commits and replay each of them against the old-look fix; a merge resolves it once.
  - A dry run (`git merge-tree`, nothing written) gives conflicts in exactly six files: `App.jsx`, `SosTrigger.jsx`, `copy/emergency.js`, `utils/notify.js`, `utils/sosOutbox.js`, `tests/sosOfflineApp.test.jsx`. In each, the redesign's version is the later, reviewed one: take it whole (`git checkout --ours` for those six).
  - Everything else merges cleanly and nothing doubles up: in the dry run `tests/notify.test.js` has its safety tests once, and `App.jsx` calls `sosOutbox.markInGroup()` once.
  - After the merge, check that each of these appears exactly once in `App.jsx`: `createSosOutbox(`, `sosOutbox.markInGroup()`, `sosOutbox.drop('gone')`, `sosOutbox.drop('left')`. Then run the full suite file by file and lint.
- **Steps (after your go-ahead for (b)):** the merge above, PR into `main`, review, merge, `npm ci`, full test run, lint, `npm run release:bundle -- 1.1.21`, `npm run release:verify -- --bundle`, CLAUDE.md number line.
- **What the old-look app does when the redesign bundle arrives:** an installed LOCUS on js-1.1.20 checks GitHub on cold start, sees js-1.1.21 with `MIN_NATIVE: 1.1.0` (its own shell, so allowed), downloads it in the background and shows the old look's "update ready" strip. Nothing changes until the person taps Restart; the WebView then reloads into the new look. Because the app doesn't keep its group across a restart, they rejoin with the group code afterwards. They stay signed in (Firebase keeps the session). The theme starts on System. The first-run guide doesn't show to someone already signed in. If they dismiss the strip, they keep the old look and are offered it again on a later start.

## Native files

The redesign branch differs from `main` in these files outside the web app:

| File | Change | Reaches phones? |
|---|---|---|
| `android/app/build.gradle` | adds the `sidetest` build type (`initWith debug`, `applicationIdSuffix ".sidetest"`), and a `preReleaseBuild` check that refuses non-production web assets | No: only in an APK built from it. `defaultConfig` and the `release` build type are unchanged, so a release APK built from it has the same app ID, name, signature, version and manifest. The check only stops a wrong release build. |
| `android/app/src/sidetest/res/values/strings.xml` | the name "LOCUS Test" | No: only in the `sidetest` build type. |
| `package.json` | one script line, `sidetest:install` | No: no dependency changed. |

No Capacitor plugin, native API or dependency is added. The redesign's JavaScript uses only what shell v1.1.0 already has. So the redesign ships as a JS bundle; no APK release is needed for it, and none is planned.
