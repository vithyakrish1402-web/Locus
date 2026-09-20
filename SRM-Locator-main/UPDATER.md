# LOCUS in-app updater

LOCUS is sideloaded, not distributed through Play, so the app ships its own update
mechanism, in two tiers:

| | **Phase 1** — full APK | **Phase 2** — JS-only bundle |
|---|---|---|
| Carries | anything: native permissions, plugins, manifest, icons | web bundle only: logic, UI, CSS |
| User sees | Android's installer, a reinstall prompt | a "restart to apply" strip |
| Release tag | `v1.2.0` | `js-1.2.1` |
| Command | `npm run release -- 1.2.0` | `npm run release:bundle -- 1.2.1` |
| Dependencies | **none** | `@capgo/capacitor-updater` |

**Rule of thumb: if the change touches anything under `android/`, or adds a Capacitor
plugin, it is a Phase 1 release.** Everything else — the overwhelming majority of
day-to-day fixes — can go out as a Phase 2 bundle with no reinstall at all.

# Phase 1 — full APK self-updater

## How it works

The GitHub release **is** the update manifest — there is no separate JSON file to keep in
sync. On each cold start (and from the **CHECK FOR UPDATES** button in the LOCUS guide),
the app calls:

```
GET https://api.github.com/repos/vithyakrish1402-web/Locus/releases?per_page=30
```

then keeps only `v*` tags and picks the **highest version** among them.

This used to read `/releases/latest`, which is wrong once both tag series exist: "latest"
means whichever release was published most recently across *every* tag, so cutting a
`js-*` bundle handed this check a tag it cannot parse. It failed closed, as designed — but
the consequence was that an old native shell silently stopped being told a real APK update
existed, which is exactly the device a `[MANDATORY]` release is meant to reach. Phase 2
already listed and filtered for the same reason; Phase 1 now does too.

Two things that came free with `/releases/latest` are now done by hand, in
`selectLatestApkRelease`:

- **Drafts and prereleases are excluded.** The `latest` endpoint skipped them server-side;
  the list endpoint returns everything.
- **Highest version wins, not first in the list.** Listing order follows publish date, so a
  republished or back-dated release could otherwise offer every device an older APK.

From the selected release it reads three things:

| From | Meaning |
|---|---|
| `tag_name` | the release version, compared against `App.getInfo().version` |
| asset named `locus-latest.apk` | the download URL |
| `body` | release notes, plus `SHA256: <64 hex>` and an optional `[MANDATORY]` marker |

A release missing the APK asset or the `SHA256:` line is **rejected** rather than offered —
nothing unverified is ever handed to the installer. Version comparison also fails closed:
an unparseable tag means "no update", not "update every launch". A listing with no usable
`v*` release at all is treated the same way: no update offered.

Then: download to the app cache with a progress bar → verify SHA-256 → `FileProvider` URI
+ `ACTION_VIEW` → Android's own installer UI takes over.

**Check frequency is once per cold start plus the manual button.** No periodic background
polling, deliberately — it would cost battery and network for a build that changes weekly
at most.

### `[MANDATORY]` releases

If the release body contains the literal string `[MANDATORY]`, the update modal becomes a
full-screen gate: no LATER button, no Escape, Android Back is swallowed
([useBackButtonGuard](src/hooks/useBackButtonGuard.js)), and it is returned *before* every
other render branch in `App.jsx` — including the auth screen and the loading state. The
only way into the app is to install.

### Where the code lives

| File | Role |
|---|---|
| [src/utils/updateManifest.js](src/utils/updateManifest.js) | Pure parsing + version comparison. All of it unit tested. |
| [src/utils/locusUpdater.js](src/utils/locusUpdater.js) | `registerPlugin` bridge, with a rejecting web stub |
| [src/hooks/useAppUpdate.js](src/hooks/useAppUpdate.js) | Policy: throttle, check, permission dance, download, install |
| [src/components/UpdateModal.jsx](src/components/UpdateModal.jsx) | HUD modal and the mandatory gate |
| [LocusUpdaterPlugin.java](android/app/src/main/java/com/locus/app/LocusUpdaterPlugin.java) | Native: download + hash + install intent |
| [scripts/release.mjs](scripts/release.mjs) | Cuts a release the client can consume |

**Zero new npm dependencies.** The native half is a locally-defined Capacitor plugin,
registered by hand in `MainActivity` (Capacitor only auto-discovers plugins under
`node_modules`). The two community plugins that expose the package-install intent
(`@m430/capacitor-app-install`, `@bixbyte/capacitor-apk-installer`) are both pre-1.0 and
roughly a year stale, and going native also avoided adding `@capacitor/filesystem` purely
to stream one file into the cache directory.

---

## One-time setup: the release keystore

**This matters more than anything else here.** Android refuses to install an update whose
signing certificate differs from the installed app. Every release, forever, must be signed
with the same key. Lose it and the only recovery is having everyone uninstall and reinstall.

Before the updater existed, LOCUS had no `signingConfig` at all, so every APK you sent
testers was a **debug** build. The first signed release is therefore a clean break:
**everyone uninstalls LOCUS once and installs v1.0.0 by hand.** Every update after that is
self-served.

### 1. Generate the keystore

```bash
keytool -genkeypair -v -keystore android/locus-release.jks -alias locus -keyalg RSA -keysize 2048 -validity 10000
```

`android/*.jks` and `android/*.keystore` are gitignored (the stock Android template ships
those two rules commented out; they were uncommented for exactly this reason).

### 2. Back it up — properly, before you ship anything

This keystore is now the single most important file in the project. Losing it re-triggers
the forced manual reinstall this updater exists to avoid, permanently, for everyone
already on a signed build.

- **Store it outside the repo and outside your dev machine's disk** — a password manager
  attachment or an encrypted drive. Back up the *passwords* with it: a keystore whose
  password is gone is as lost as one that was deleted.
- **If more than one person might ever cut a release**, make sure they can reach that
  backup without going through you.
- **Restore it once and prove it works.** A backup nobody has restored is not a backup.
  Pull the file back down to a scratch path, point `LOCUS_KEYSTORE_FILE` at that copy, and
  run `gradlew assembleRelease`. If the output is `app-release.apk` rather than
  `app-release-unsigned.apk`, both the file and the passwords are good. This is cheap now
  and impossible once you actually need it.
- **Record the certificate fingerprint** somewhere durable:

  ```bash
  keytool -list -v -keystore android/locus-release.jks
  ```

  With the SHA-256 fingerprint saved, you can later check any APK with
  `keytool -printcert -jarfile locus-latest.apk` and know it will install over what
  testers already have. Without it, the only way to find out is to try and watch it fail.

### 3. Point Gradle at it

Add to `android/local.properties` (gitignored, never committed):

```properties
LOCUS_KEYSTORE_FILE=locus-release.jks
LOCUS_KEYSTORE_PASSWORD=<store password>
LOCUS_KEY_ALIAS=locus
LOCUS_KEY_PASSWORD=<key password>
```

`LOCUS_KEYSTORE_FILE` resolves relative to `android/`. If these are absent Gradle still
builds, but emits `app-release-unsigned.apk` — and `scripts/release.mjs` hard-fails on
that rather than publishing something nobody can install over.

---

## Cutting a release

```bash
npm run release -- 1.1.0
```

That one command:

1. Refuses to run on a dirty working tree, an already-used tag, or a non-newer version
2. Bumps `versionCode` (+1) and `versionName` in `android/app/build.gradle`
3. `npm run build` → `npx cap sync android` → `gradlew assembleRelease`
4. Fails loudly if the APK came out unsigned
5. Stages it as `locus-latest.apk` and computes the SHA-256
6. Builds the release body: your notes + `SHA256:` + optionally `[MANDATORY]`
7. Commits the version bump, pushes, and `gh release create`s the tag with the APK attached

Useful flags:

```bash
npm run release -- 1.1.0 --dry-run              # build + hash, publish nothing, revert the bump
npm run release -- 1.1.0 --mandatory            # lock clients until they install it
npm run release -- 1.1.0 --notes RELEASE.md     # hand-written notes instead of the commit log
```

Requires the `gh` CLI, authenticated (`gh auth login`).

> Hand-editing `versionCode`/`versionName`, or attaching an APK to a release by hand, is
> how a published checksum stops matching its binary. Let the script do it.

### The first release is a special case

`build.gradle` ships at `1.0.0`, and normally the script refuses a version that is not
strictly newer than what is already there. For the **baseline** release that rule would
make `v1.0.0` impossible to cut at all, so the script detects it: when no `v*` tag exists
yet, publishing the current `versionName` as-is is allowed, and `versionCode` is left
alone rather than bumped.

```bash
npm run release -- 1.0.0     # the baseline; nothing is bumped
```

Once that first tag exists the strict check resumes, because from then on there are
installs in the field that need to see a higher version.

## Verifying a release before handing it out

```bash
npm run release:verify                                      # the latest v* APK release
npm run release:verify -- --bundle                          # the latest js-* bundle release
npm run release:verify -- --file dist-release/locus-latest.apk   # a local build, before publishing
```

Run this **after every publish, before telling anyone to install it**. It downloads the
published asset and checks it the way a device would — importing the very same parsing
modules the app uses, so "the verifier passed" means the client parses it identically.

For an APK it checks:

- the app would **accept** the release at all (same `parseReleaseManifest` the client runs)
- the downloaded bytes match the published `SHA256:` line
- the APK's own `versionName` matches the tag — if the tag says `1.1.0` but the binary
  says `1.0.0`, devices install it and are then re-offered the same update *forever*,
  because `App.getInfo()` keeps reporting the old version
- the APK signature verifies, printing the scheme and the certificate's SHA-256 digest so
  you can confirm it matches every previous release (a mismatch means Android refuses the
  install). This uses **apksigner**, not `keytool` — `minSdkVersion` is 24, so the build
  signs with APK Signature Scheme v2/v3 and skips legacy v1 JAR signing, and
  `keytool -printcert -jarfile` only understands v1. Pointed at a correctly signed modern
  APK, keytool reports "Not a signed jar file" and exits 0, which reads as unsigned.
- whether `[MANDATORY]` is set — worth seeing before it locks everyone out

For a bundle it checks the checksum, that `index.html` is at the zip root, that no entry
uses backslash separators, and that `MIN_NATIVE` is not gated above the shell it was
built from.

Almost all of these are failures that otherwise surface only on a phone, usually after
the release has already gone out.

---

## Verifying on a real device

The `FileProvider` + install-intent path does not meaningfully exercise on an emulator —
verify on real hardware.

> ### How to actually cold start
>
> Both tiers check **once per process**, not per foreground. Swiping the app out of the
> recents list does *not* reliably kill the process on Android — relaunching often drops
> you back into the same JS context, no check runs, and a perfectly working updater looks
> broken.
>
> Use **Settings → Apps → LOCUS → Force stop** between every attempt below. Every "cold
> start" in this document means that, not a swipe.

0. **Verify the release first** — `npm run release:verify`. It catches a bad checksum, an
   unsigned or mis-signed APK, and a tag/versionName mismatch from your desk, before you
   burn a device cycle on it.
1. **Clean slate.** Uninstall any existing LOCUS, install the v1.0.0 release APK by hand.
2. **Publish a newer release** (`npm run release -- 1.0.1`).
3. **Cold start the app.** The modal should appear with the release notes.
4. **Checksum rejection — do this one first.** Edit the published release body's `SHA256:`
   line to a wrong 64-hex digest, cold start, and tap UPDATE NOW. The download must
   complete and then be rejected with the integrity error — **no installer UI at all**.
   Put the real digest back afterwards. Confirming it fails safe matters more than
   confirming it succeeds, so it is worth proving before anything installs cleanly.
5. **UPDATE NOW** → on the first ever update Android shows the "install unknown apps"
   consent. Grant it; returning to LOCUS should resume the download automatically with no
   second tap. On the *next* update that prompt must not reappear.
6. **Mandatory gate.** Publish with `--mandatory` and confirm the app is unusable until
   installed: no LATER, Back does nothing, and it shows before the login screen.

---

## Limits worth knowing

- **Unauthenticated GitHub API**: 60 requests/hour per IP. One check per cold start is far
  inside that; a 403 surfaces as "rate limit reached, try again in a few minutes".
- **The install is not silent.** Android always shows its own installer confirmation. The
  app is killed and replaced when the user accepts, so there is no post-install callback.
- **Private repos won't work** without an access token in the client, which is exactly the
  kind of secret that should not ship in an APK. The repo must stay public.

---

# Phase 2 — JS-only live updates

For anything that does not touch `android/`: ship the new web bundle straight into the
installed shell, no APK download and no installer prompt at all.

## How it works

Same manifest-is-the-release idea as Phase 1, on its own tag series so the two never
collide. The client lists `/releases`, keeps only `js-*` tags, and picks the **highest
version** (not whatever GitHub listed first — a republished release must not be able to
hand every device an older bundle).

| From | Meaning |
|---|---|
| `tag_name` (`js-1.2.1`) | the bundle version |
| asset named `locus-bundle.zip` | the zipped `dist/` output |
| `SHA256:` in the body | verified natively before the bundle is ever activated |
| `MIN_NATIVE:` in the body | the oldest native shell allowed to run this bundle |

Then: download + verify → stage → show a "restart to apply" strip. The swap is **never**
applied mid-session: `CapacitorUpdater.set()` reloads the WebView immediately, and pulling
the map out from under someone mid-navigation is exactly the wrong moment. The user taps
RESTART when they are ready.

### The `MIN_NATIVE` compatibility gate

**This is the part that matters.** A JS bundle cannot add a native permission or plugin.
A bundle that calls an API the installed shell lacks would white-screen the app with no
way back except a manual reinstall — so it must never be applied there in the first place.

- `MIN_NATIVE` defaults to the `versionName` currently in `build.gradle`, which is right
  whenever the bundle was built against the shell you have.
- A device whose native version is **below** `MIN_NATIVE` refuses the bundle and shows
  "install the full update first" instead — it is routed to Phase 1, not broken.
- The gate **fails closed**: an unreadable version on either side blocks the swap. A
  refused good update costs a delay; an applied bad one costs a reinstall on every device.
- `release-bundle.mjs` refuses to publish a `--min-native` newer than the current native
  `versionName`, which would gate the bundle off every device in existence.

### Rollback safety net

The plugin arms a rollback timer on every bundle it activates. `notifyAppReady()` runs at
app start ([src/utils/liveUpdater.js](src/utils/liveUpdater.js)); a bundle that never gets
there is reverted to the previous one on next launch. A JS release that crashes on boot
therefore un-ships itself — but it also means removing that call would silently roll back
every *good* update too.

`resetWhenUpdate: true` (the plugin default) also drops all downloaded bundles whenever
the native shell is updated, so a Phase 1 install always lands on its own bundled JS
rather than an older downloaded one.

### Where the code lives

| File | Role |
|---|---|
| [src/utils/liveUpdateManifest.js](src/utils/liveUpdateManifest.js) | Pure parsing, version selection and the MIN_NATIVE gate. Unit tested. |
| [src/utils/liveUpdater.js](src/utils/liveUpdater.js) | Plugin bridge + `notifyAppReady` |
| [src/hooks/useLiveUpdate.js](src/hooks/useLiveUpdate.js) | Check, gate, download, stage |
| [src/components/LiveUpdateToast.jsx](src/components/LiveUpdateToast.jsx) | The restart strip |
| [scripts/release-bundle.mjs](scripts/release-bundle.mjs) | Publishes a `js-*` release |
| [scripts/lib/zip.mjs](scripts/lib/zip.mjs) | Dependency-free ZIP writer |

Phase 2 is **separable**: delete those six files, the `@capgo/capacitor-updater`
dependency, the `plugins.CapacitorUpdater` block in `capacitor.config.json` and the two
`liveUpdate` lines in `App.jsx`, and Phase 1 is untouched.

> The bundle zip is written in-process rather than by `Compress-Archive` or `zip`.
> PowerShell writes entry names with **backslash** separators, which Android's unzip reads
> as flat filenames rather than paths — the bundle would unpack with no `assets/` folder
> and `index.html` would 404 its own scripts. A device-only white screen. `scripts/lib/zip.mjs`
> writes spec-correct forward slashes on every platform.

## Shipping a JS-only fix

```bash
npm run release:bundle -- 1.0.1
```

1. Refuses an already-used `js-*` tag, or a `--min-native` newer than the native shell
2. `npm run build`
3. Zips `dist/` with `index.html` at the archive root
4. Computes the SHA-256
5. Publishes a `js-1.0.1` release with the zip attached and both markers in the body

```bash
npm run release:bundle -- 1.0.1 --dry-run                 # build + hash, publish nothing
npm run release:bundle -- 1.0.1 --min-native 1.1.0        # require a newer shell
npm run release:bundle -- 1.0.1 --notes NOTES.md          # hand-written notes
```

Note this does **not** bump `versionCode`/`versionName` — those describe the native shell,
which a JS bundle does not change.

## Verifying Phase 2 on a real device

Same rule as Phase 1: **"cold start" means Force stop**, not a swipe — see
[How to actually cold start](#how-to-actually-cold-start) above. Phase 2 also checks once
per process, so a swiped-away app will not pick up a new bundle.

0. **Verify the bundle first** — `npm run release:verify -- --bundle`.
1. Install a Phase 1 release APK (say native `1.0.0`) and open it once.
2. Make a visible JS-only change (a label, a colour) and
   `npm run release:bundle -- 1.0.1`.
3. Cold start. The restart strip should appear; tap RESTART and confirm the change is live
   **with no installer prompt and no download of an APK at all**.
4. Cold start again and confirm the change persisted and the strip does not reappear.
5. **The gate.** Publish `npm run release:bundle -- 1.0.2 --min-native 1.0.0`, then edit
   that release's body by hand to `MIN_NATIVE: 9.9.9`. Cold start on the `1.0.0` device:
   the bundle must be **refused** with "install the full update first", and the app must
   keep running the bundle it already had — not apply it and break.

   Unlike Phase 1's checksum test, this one has to come *after* a successful swap. A
   refusal here looks like "nothing happened", which is indistinguishable from "the check
   never ran" — so you need steps 3–4 to have proved the pipeline works first.
6. **Rollback.** Publish a bundle that throws before `notifyAppReady()` runs, apply it,
   then relaunch: the app must come back on the previous bundle by itself.

## Limits worth knowing

- **Only the web bundle changes.** Native permissions, plugins, the manifest and icons all
  require Phase 1.
- **Not instant.** The check is once per cold start, same as Phase 1 — a fix ships the next
  time someone fully relaunches, not while they are using the app.
- The Render backend is **not** in this path. Bundles come from GitHub's CDN, so a sleeping
  free-tier service can never stall or break an update check.
