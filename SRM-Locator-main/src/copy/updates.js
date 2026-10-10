// Words for the update screens (redesign P10): the full app update (UpdateModal) and the small
// update strip (LiveUpdateToast). Provisional: from the design where it shows them, otherwise
// from the Step 0 wording inventory, until the wording review.
//
// Never claim an old version "can't connect": a mandatory update locks the app on its own
// screen, but the old version still reaches the server (owner, 2026-10-05).

export const UPDATE = {
  available: {
    title: 'A new version of LOCUS is ready',
    body: (version, size) => `Version ${version}${size ? ` · ${size}` : ''}. It installs over this one; you will be asked to confirm.`,
    update: 'Update now',
    later: 'Later',
  },
  downloading: {
    title: 'Downloading the update',
    body: 'When it finishes, LOCUS checks it, then you can install it.',
    // A percent only when the size is known (see displayPercent in useAppUpdate).
    progress: (percent) => (percent >= 0 ? `Downloading update… ${percent}%` : 'Downloading…'),
    amount: (loaded, total) => `${loaded} of ${total}`,
  },
  verifying: {
    progress: 'Checking the update…',
  },
  ready: {
    title: 'The update is ready',
    body: 'Android will ask you to confirm the install.',
    progress: 'Update ready. Tap to install.',
    install: 'Install',
  },
  permission: {
    title: 'Allow LOCUS to install its update',
    body: 'To install this update, allow LOCUS to install apps. Tap here to open the setting.',
    open: 'Open Android settings',
    notNow: 'Not now',
  },
  failed: {
    // While installing a downloaded update, and while looking for one.
    installTitle: "The update couldn't be installed",
    checkTitle: "Couldn't check for updates",
    tryAgain: 'Try again',
    later: 'Later',
  },
  mandatory: {
    title: 'Please update LOCUS',
    body: 'This version needs updating before you can keep using LOCUS. The update takes about a minute.',
    downloadingTitle: 'Updating LOCUS',
    downloadingBody: 'When the download finishes, LOCUS checks it, then you can install it.',
    progress: (percent) => (percent >= 0 ? `Downloading update… ${percent}% · keep LOCUS open` : 'Downloading… keep LOCUS open'),
    emergencyNote: 'Emergency alerts from your group still appear while you update.',
  },
};

// Which failures happen while installing (the rest happen while looking for an update).
// A failure from useAppUpdate's download or install also carries `during: 'download'`.
export const INSTALL_FAILURES = new Set([
  'CHECKSUM_MISMATCH', 'SIZE_MISMATCH', 'CHECKSUM_MISSING', 'MISSING_CHECKSUM', 'IO_ERROR', 'STALLED',
  'CANCELLED', 'PERMISSION_DENIED', 'INSTALL_FAILED', 'NOT_FOUND',
]);

// One plain sentence per failure. The "damaged" sentence is only for a download that really
// failed its checksum or size check.
const DIDNT_FINISH = "The download didn't finish. Check your internet and tap to try again.";
const DAMAGED = 'The update file looks damaged, so it was not installed. Tap to try again.';
const FAILURE_SENTENCES = {
  CHECKSUM_MISMATCH: DAMAGED,
  SIZE_MISMATCH: DAMAGED,
  CHECKSUM_MISSING: "This version was published without its safety check, so it can't be installed. Nothing was changed.",
  MISSING_CHECKSUM: "This version was published without its safety check, so it can't be installed. Nothing was changed.",
  IO_ERROR: DIDNT_FINISH,
  STALLED: DIDNT_FINISH,
  INSTALL_FAILED: "Android couldn't open the installer, so nothing was changed. Tap to try again.",
  CANCELLED: 'The download was stopped, so nothing was changed.',
  PERMISSION_DENIED: 'Android didn\'t allow the install. Turn on "Allow from this source" for LOCUS, then try again.',
  NETWORK: "LOCUS couldn't reach the update server. Check your connection and try again.",
  RATE_LIMITED: 'The update server is busy. Try again in a few minutes.',
};
const OTHER_FAILURE = "This update can't be installed right now. Nothing was changed.";

/**
 * The sentence for a failure's code (error.code from useAppUpdate). A download failure with
 * a code of its own (an HTTP status, say) reads as a download that didn't finish.
 */
export const failureSentence = (code, { download = false } = {}) =>
  FAILURE_SENTENCES[code] ?? (download ? DIDNT_FINISH : OTHER_FAILURE);

export const LIVE_UPDATE = {
  ready: { title: 'Update ready', body: (version) => `Restart to use version ${version}.` },
  downloading: {
    title: 'Updating LOCUS',
    body: (version) => `Downloading version ${version}. Keep LOCUS open until it's ready; closing it stops the download.`,
    preparing: 'Preparing',
    elapsed: (seconds) => `${seconds} s`,
  },
  failed: {
    title: "Update didn't install",
    body: (version, reason) => `Version ${version} didn't install${reason ? ` (${reason})` : ''}. LOCUS will try again next time you open it.`,
  },
  blocked: {
    title: 'Update needs the full app',
    body: (version, minNative) => `Version ${version} needs app version ${minNative} or newer. Install the full update first.`,
  },
  restart: 'Restart',
  restarting: 'Restarting…',
  dismiss: 'Dismiss update notice',
  bar: 'Update download',
};
