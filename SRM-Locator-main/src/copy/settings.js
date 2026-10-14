// Words for Settings (redesign P9). Provisional: from the design where it shows them,
// otherwise from the Step 0 wording inventory, until the wording review.

export const SETTINGS = {
  title: 'Settings',
  back: 'Back',
  open: 'Settings',

  appearance: 'Appearance',
  theme: 'Theme',
  themeOptions: { system: 'System', light: 'Light', dark: 'Dark' },
  themeHelp: {
    system: "Follows your phone's setting.",
    light: 'Always light.',
    dark: 'Always dark.',
  },

  refresh: 'Location refresh rate',
  // The values the app has always used: eco 15 s, standard 5 s, max 1 s.
  refreshOptions: {
    eco: { label: 'Battery saver', description: 'Every 15 seconds' },
    standard: { label: 'Standard', description: 'Every 5 seconds' },
    max: { label: 'Fast', description: 'Every second · uses more battery' },
  },

  arQuality: 'AR Scan quality',
  arQualityOptions: { efficient: 'Efficient', standard: 'Standard', realistic: 'Realistic' },
  arQualityHelp: 'Standard balances detail and battery. Efficient suits older phones; Realistic looks best on newer ones.',

  notifications: 'Notifications',
  alertSounds: 'Alert sounds',
  alertSoundsHelp: 'A sound for pings and when someone loses connection.',
  emergencyAlerts: 'Emergency alerts',
  emergencyAlertsHelp: 'Always on. An emergency alert always sounds, whatever you choose above.',

  about: 'About',
  version: 'Version',
  versionUnknown: 'Not installed as an app',
  checkForUpdates: 'Check for updates',
  checking: 'Checking…',
  // What the check found, for the outcomes the update screens don't show themselves.
  updateStatus: {
    idle: '',
    checking: 'Checking for a newer version…',
    'up-to-date': 'You have the latest version.',
    available: 'A new version is ready. See the update screen.',
    'permission-required': 'Waiting for permission to install.',
    downloading: 'Downloading the update…',
    verifying: 'Checking the update…',
    ready: 'The update is ready to install.',
    error: "The update didn't go through. See the update screen.",
  },
  updatesWebOnly: 'Updates are checked in the installed Android app only.',
  howItWorks: 'How LOCUS works',

  more: 'More',
  mapView: 'Map view',
  mapViewOptions: { map: 'Map', satellite: 'Satellite' },
  arParts: 'AR Scan parts',
  arPartsHelp: 'Auto follows AR Scan quality. Set a part on its own, for example the road line off on an older phone.',
  arPartNames: { tags: 'Labels', roadLine: 'Road line', arrow: 'Arrow' },
  arPartOptions: { auto: 'Auto', off: 'Off', efficient: 'Efficient', realistic: 'Realistic' },

  account: 'Account',
  adminTools: 'Admin tools',
  signOut: 'Sign out',
};

export const SEND_APP = {
  title: 'Send LOCUS to someone',
  loading: 'Finding the installer…',
  ready: (version, size) => `LOCUS ${version}${size ? ` · ${size}` : ''}. Download the installer to pass it on, or copy its link into a chat. It keeps itself up to date once installed.`,
  // On a phone whose app can share the file itself (see canShareInstaller).
  readyShare: (version, size) => `LOCUS ${version}${size ? ` · ${size}` : ''}. Send the installer straight to someone's chat, or copy its link. It keeps itself up to date once installed.`,
  error: (reason) => `Couldn't find the installer: ${reason}.`,
  // GitHub refused the lookup: its hourly limit, shared by everyone on this network, is used up.
  busy: (time) => `The download server is busy. Try again ${time ? `after ${time}` : 'in a few minutes'}.`,
  tryAgain: 'Try again',
  download: 'Download installer',
  send: 'Send installer',
  downloading: (percent) => (percent >= 0 ? `Downloading installer… ${percent}%` : 'Downloading installer…'),
  checking: 'Checking the installer…',
  sent: 'Installer ready. Tap Send installer to share it again.',
  theirPhone: 'On their phone, Android asks them to allow installing apps from the app they open it in. That is expected.',
  failed: {
    didntFinish: "The download didn't finish. Check your internet and tap to try again.",
    damaged: 'The installer file looks damaged, so it was not sent. Tap to try again.',
    noShare: "Android couldn't open the share menu. Tap to try again.",
  },
  copyLink: 'Copy link',
  copied: 'Link copied',
  copyFailed: "Couldn't copy",
};
