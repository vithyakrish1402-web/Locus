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
    body: 'When it finishes, Android will ask you to confirm the install.',
    progress: 'Downloading…',
    amount: (loaded, total) => `${loaded} of ${total}`,
  },
  installing: {
    title: 'Installing the update',
    body: 'Android is asking you to confirm the install.',
    progress: 'Checked and ready to install',
  },
  permission: {
    title: 'Allow LOCUS to install its update',
    body: 'LOCUS updates itself instead of through the Play Store, so Android needs your permission once. Turn on "Allow from this source" for LOCUS, then come back.',
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
    downloadingBody: 'When the download finishes, Android will ask you to confirm the install.',
    progress: 'Downloading… keep LOCUS open',
    emergencyNote: 'Emergency alerts from your group still appear while you update.',
  },
};

// Which failures happen while installing (the rest happen while looking for an update).
export const INSTALL_FAILURES = new Set(['CHECKSUM_MISMATCH', 'CHECKSUM_MISSING', 'MISSING_CHECKSUM', 'IO_ERROR', 'CANCELLED', 'PERMISSION_DENIED']);

// One plain sentence per failure. The "safety check" sentence is only for a download that
// really failed its checksum.
const FAILURE_SENTENCES = {
  CHECKSUM_MISMATCH: "The download didn't pass its safety check, so nothing was changed. Try again on a steady connection.",
  CHECKSUM_MISSING: "This version was published without its safety check, so it can't be installed. Nothing was changed.",
  MISSING_CHECKSUM: "This version was published without its safety check, so it can't be installed. Nothing was changed.",
  IO_ERROR: "The download didn't finish, so nothing was changed. Check your connection and try again.",
  CANCELLED: 'The download was stopped, so nothing was changed.',
  PERMISSION_DENIED: 'Android didn\'t allow the install. Turn on "Allow from this source" for LOCUS, then try again.',
  NETWORK: "LOCUS couldn't reach the update server. Check your connection and try again.",
  RATE_LIMITED: 'The update server is busy. Try again in a few minutes.',
};
const OTHER_FAILURE = "This update can't be installed right now. Nothing was changed.";

/** The sentence for a failure's code (error.code from useAppUpdate). */
export const failureSentence = (code) => FAILURE_SENTENCES[code] ?? OTHER_FAILURE;

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
