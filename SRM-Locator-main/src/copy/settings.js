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
    ready: 'The update is ready to install.',
    error: "Couldn't check for updates. Try again later.",
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
};

export const SEND_APP = {
  title: 'Send LOCUS to someone',
  loading: 'Finding the installer…',
  ready: (version, size) => `LOCUS ${version}${size ? ` · ${size}` : ''}. Download the installer to pass it on, or copy its link into a chat. It keeps itself up to date once installed.`,
  error: (reason) => `Couldn't find the installer: ${reason}.`,
  tryAgain: 'Try again',
  download: 'Download installer',
  copyLink: 'Copy link',
  copied: 'Link copied',
  copyFailed: "Couldn't copy",
};
