# LOCUS in-app updater

LOCUS is sideloaded, not distributed through Play, so the app ships its own update
mechanism. **Phase 1** (this document) replaces the whole APK and can carry any change —
native permissions, new Capacitor plugins, manifest edits, icons. A second tier for
JS-only live updates would sit on top of it for day-to-day logic/UI fixes.

## How it works

The GitHub release **is** the update manifest — there is no separate JSON file to keep in
sync. On each cold start (and from the **CHECK FOR UPDATES** button in the LOCUS guide),
the app calls:

```
GET https://api.github.com/repos/vithyakrish1402-web/Locus/releases/latest
```

and reads three things out of the response:

| From | Meaning |
|---|---|
| `tag_name` | the release version, compared against `App.getInfo().version` |
| asset named `locus-latest.apk` | the download URL |
| `body` | release notes, plus `SHA256: <64 hex>` and an optional `[MANDATORY]` marker |

A release missing the APK asset or the `SHA256:` line is **rejected** rather than offered —
nothing unverified is ever handed to the installer. Version comparison also fails closed:
an unparseable tag means "no update", not "update every launch".

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

`android/*.jks` and `android/*.keystore` are gitignored. **Back this file up somewhere
outside the repo** — a password manager attachment or an encrypted drive.

### 2. Point Gradle at it

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

---

## Verifying on a real device

The `FileProvider` + install-intent path does not meaningfully exercise on an emulator —
verify on real hardware:

1. **Clean slate.** Uninstall any existing LOCUS, install the v1.0.0 release APK by hand.
2. **Publish a newer release** (`npm run release -- 1.0.1`).
3. **Cold start the app** — fully swipe it away first; the check is once per *process*,
   not per foreground. The modal should appear with the release notes.
4. **UPDATE NOW** → on the first ever update Android shows the "install unknown apps"
   consent. Grant it; returning to LOCUS should resume the download automatically with no
   second tap. On the *next* update that prompt must not reappear.
5. **Checksum rejection.** Edit the published release body's `SHA256:` line to a wrong
   64-hex digest, cold start, and tap UPDATE NOW. The download must complete and then be
   rejected with the integrity error — no installer UI at all. Put the real digest back.
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
