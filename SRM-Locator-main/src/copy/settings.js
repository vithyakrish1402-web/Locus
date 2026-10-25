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
  // LOCUS's own Do Not Disturb (utils/inAppDnd.js), on this phone only.
  inAppDnd: 'Do not disturb',
  inAppDndHelp: 'Pings arrive silently, with no sound or vibration. An SOS still rings.',
  // Letting the alerts through the phone's own Do Not Disturb (Android's access screen).
  dndAccess: 'Ring through Do Not Disturb',
  dndAccessOn: 'Allowed. An SOS rings even when your phone is on Do Not Disturb.',
  dndAccessOff: "Not allowed yet. An SOS rings at full alarm volume, but your phone's Do Not Disturb can still hold it back.",
  dndAccessAllow: 'Allow',
  emergencyAlerts: 'Emergency alerts',
  emergencyAlertsHelp: 'An emergency alert always sounds, whatever you choose above.',
  alwaysOn: 'Always on',

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

// Background sharing: keeping a person on their Group's map while LOCUS is closed. Nothing about
// it is shown unless the phone's app has the sharing service and the server says it is switched on.
export const BACKGROUND_SHARING = {
  section: 'Sharing when LOCUS is closed',
  switchLabel: 'Keep sharing when the app is closed',
  help: 'Needs a Group, and ends when you leave it. Also brings pings and join requests while the app is closed. Pause or stop it from the notification, or here.',
  // Under it, its own switch: hearing a teammate's SOS while the app is closed.
  sos: {
    label: 'SOS alerts when the app is closed',
    description: "If a teammate sends an SOS, you'll be alerted even if you've closed the app.",
    // While sharing is off, in place of the row's own line; the row is greyed out.
    offReason: 'Turn on sharing first.',
    // While sharing is on, under the card.
    needsSharing: 'If you turn sharing off, these alerts stop too.',
    notAudible: "SOS alerts are turned off or silenced for LOCUS in your phone's notification settings. Turn them back on, or you won't hear one.",
    noFullScreen: "Your phone won't let LOCUS take over a locked screen, so an SOS shows as a ringing banner instead.",
  },
  // Under the switch: exactly one of these.
  sharing: (group) => `Sharing with ${group}`,
  paused: 'Paused',
  notSharing: 'Not sharing',
  starting: 'Starting…',
  refused: {
    unsupported: 'Not available on this phone.',
    'permission-denied': 'Location and notification permission are needed. Not sharing.',
    'location-denied': 'Location permission is needed. Not sharing.',
    'notifications-denied': 'Notifications must be allowed, so you can always see when sharing is on. Not sharing.',
    'server-off': 'Switched off by the server. Not sharing.',
    'no-group': 'The server has no Group with this code. Not sharing.',
    blocked: 'The Group Lead has removed you from this Group. Not sharing.',
    'not-member': 'You are not a member of this Group. Not sharing.',
    'not-signed-in': 'Sign in again, then try again. Not sharing.',
    busy: 'The server is busy. Try again in a minute. Not sharing.',
    network: 'The server could not be reached. Not sharing.',
    other: 'Could not start. Not sharing.',
  },
  // After it stopped by itself: why.
  stopped: {
    'group-gone': 'Your Group ended. Not sharing.',
    revoked: 'Your Group ended. Not sharing.',
    forbidden: 'You are no longer in this Group. Not sharing.',
    disabled: 'Switched off by the server. Not sharing.',
    'token-expired': 'Sharing ran out. Turn it on again. Not sharing.',
    'server-unreachable': 'The server could not be reached. Not sharing.',
    other: 'Stopped. Not sharing.',
  },
  // Asked once, before any permission request, the first time the switch is turned on. Changing
  // any word of it asks everyone again (utils/backgroundConsent.js).
  consent: {
    title: 'Share your location when LOCUS is closed?',
    body: 'LOCUS will share your live location with the members of your current Group, even when the app is closed or your screen is off. A notification stays visible while sharing is on. Your location goes only to your Group, and sharing ends when you leave the Group. You can pause it from the notification, or stop it at any time from the notification or from Settings. This can use more battery.',
    accept: 'Turn on',
    decline: 'Not now',
  },
};
