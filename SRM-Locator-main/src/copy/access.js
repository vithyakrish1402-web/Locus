// Every word on the way into LOCUS (redesign P3): the loading screen, sign in and create
// account, the group lobby, waiting for approval, not approved, and "You're in". In one
// place so wording corrections are a change to this file only.
//
// Sources: the designer's screen exports (docs/screens/01-access) where they show the text;
// otherwise docs/step0-report.md's wording inventory. Owner's decision: groups have no names,
// so "{group}" is "your group" in sentences and the code where a label is needed.
// PROVISIONAL until the owner's review of the wording inventory.

/** "K7M2QX" -> "K7M 2QX": a six-character code read in two halves; anything else as is. */
export const spacedCode = (code) => {
  const c = String(code ?? '').trim().toUpperCase();
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
};

/**
 * The first name for a greeting. Names are stored in capitals ("MEERA IYER", every account
 * so far), so an all-capitals one is shown with only its first letter capital ("Meera").
 * Display only; nothing stored changes.
 */
export const firstNameOf = (displayName) => {
  const first = String(displayName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first) return '';
  return first === first.toUpperCase() ? first[0] + first.slice(1).toLowerCase() : first;
};

export const BOOT = {
  title: 'LOCUS',
  tagline: 'Find your group on campus',
  loading: 'Loading LOCUS',
};

export const SIGN_IN = {
  title: 'Welcome to LOCUS',
  intro: 'Share your location with your group and find each other on the SRM KTR campus.',
  email: 'Email',
  emailPlaceholder: 'you@srmist.edu.in',
  password: 'Password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  forgotPassword: 'Forgot password?',
  submit: 'Sign in',
  submitting: 'Signing in…',
  newHere: 'New to LOCUS?',
  toCreate: 'Create an account',
  connection: (ms) => `Connection · ${ms} ms`,
};

export const CREATE_ACCOUNT = {
  title: 'Create your account',
  intro: 'Use your SRM email so your group can recognise you.',
  name: 'Your name',
  nameHint: 'Shown to people in your group.',
  passwordHint: 'At least 6 characters.',
  submit: 'Create account',
  submitting: 'Creating your account…',
  haveAccount: 'Already have an account?',
  toSignIn: 'Sign in',
};

export const RESET = {
  title: 'Reset your password',
  intro: 'Follow the link in the email, then sign in with your new password.',
  sent: (email) => ['We sent a password reset link to ', email, '. Check your inbox.'],
  back: 'Back to sign in',
};

// Problems on the sign-in and create-account screens, shown in an amber card, never red.
export const AUTH_PROBLEMS = {
  missingEmailAndPassword: 'Enter your email and password.',
  missingName: 'Enter your name.',
  missingEmailForReset: 'Enter your email first, then tap "Forgot password?".',
  wrongCredentials: "That email and password don't match. Check them and try again.",
  noAccount: 'No account uses this email.',
  badEmail: "That email address doesn't look right.",
  emailInUse: 'An account already uses this email. Sign in instead.',
  weakPassword: 'Use at least 6 characters for your password.',
  tooManyTries: 'Too many tries. Wait a minute, then try again.',
  offline: "You're offline. Check your connection and try again.",
  unknown: 'Something went wrong. Please try again.',
};

export const LOBBY = {
  hello: (firstName) => (firstName ? `Hello, ${firstName}` : 'Hello'),
  title: 'Join or start a group',
  modes: 'Create or join',
  createTab: 'Create a group',
  joinTab: 'Join a group',
  yourCode: 'Your group code',
  generating: 'Making a code…',
  codeLabel: (code) => `Group code ${String(code ?? '').split('').join(' ')}. Tap to copy.`,
  share: 'Share code',
  copy: 'Copy code',
  copied: 'Copied',
  newCode: 'New code',
  createHelp: 'You will be the Group Lead. You approve each person who asks to join.',
  joinCode: 'Group code',
  joinPlaceholder: 'e.g. KTR7X9',
  joinHelp: 'Ask your Group Lead for the 6-character code. Letters and numbers only.',
  createButton: 'Create group',
  joinButton: 'Join group',
  signOut: 'Sign out',
  shareTitle: 'LOCUS group',
  shareText: (code) => `Join my LOCUS group with code ${code}`,
  copyFailed: "Couldn't copy. Read the code out instead.",
  // Why the lobby is showing again after the server turned a request down.
  notFound: 'No group uses this code right now. Check it with your Group Lead and try again.',
  ended: (code) => `Group ${spacedCode(code)} has ended. Ask your Group Lead to create it again, or start a new group.`,
  codeTaken: "That code is already in use, so here's a new one to share.",
  // The server couldn't confirm who this is (its sign-in check failed twice).
  signInUnproven: "We couldn't confirm your sign-in. Sign out, sign back in, and try again.",
  tooManyGroups: "You've started a lot of groups in the last hour. Wait a while, or join an existing one.",
  // Opening the app after background sharing ended because the server lost the Group.
  groupEndedRestart: 'Your Group ended (the server restarted). Rejoin with the code.',
};

// Opening LOCUS again (after a swipe, or from the sharing notification) while this phone still
// remembers the Group it was in. Nothing is joined until the person chooses.
export const RESUME = {
  title: 'Back to your Group?',
  body: (code, role) => (role === 'OWNER'
    ? `You are the Group Lead of ${spacedCode(code)}.`
    : `You were in Group ${spacedCode(code)}.`),
  freshHelp: 'Start fresh takes you to the lobby. You can still rejoin later with the code.',
  sharingNote: 'Starting fresh also stops sharing your location while LOCUS is closed.',
  returnButton: (code) => `Return to ${spacedCode(code)}`,
  freshButton: 'Start fresh',
  returningTitle: 'Returning to your Group',
  returningBody: (code) => `Getting you back into ${spacedCode(code)}.`,
};

export const WAITING = {
  title: 'Waiting for approval',
  body: (code) => `We asked the Group Lead of ${spacedCode(code)} to let you in. You will join as soon as they approve.`,
  cancel: 'Cancel request',
  // In the Emergency button's place while waiting (D3): the server drops an alert from
  // someone not yet let in.
  emergency: "Emergency alerts work once you're in a group.",
};

export const NOT_APPROVED = {
  title: 'Request not approved',
  body: (code) => `The Group Lead of ${spacedCode(code)} didn't let you in this time. You can ask them directly or try another code.`,
  tryAnother: 'Try another code',
};

// "You're in": what it says depends on the sharing mode the person already has (it is kept
// from their last group), so it never claims "live" when it isn't.
export const YOURE_IN = {
  title: "You're in",
  body: {
    ACTIVE: 'Welcome to your group. Your location is shared live with the group. You can pause or hide it any time in the Group panel.',
    FROZEN: 'Welcome to your group. Your sharing is paused: the group sees where you were when you paused. Change it any time in the Group panel.',
    GHOST: "Welcome to your group. You're hidden: other members won't see you on their map. Change it any time in the Group panel.",
    // Live, before the first fix: nothing has been shared yet.
    waiting: "Welcome to your group. Your location will be shared live once it's found. You can pause or hide it any time in the Group panel.",
    // Paused, and the pause took no spot: the group sees nothing of you.
    pausedNoSpot: "Welcome to your group. Your sharing is paused and no spot has been shared yet, so the group won't see you on their map. Change it any time in the Group panel.",
  },
  chip: {
    ACTIVE: 'Sharing live with your group',
    FROZEN: 'Sharing paused',
    GHOST: "Other members won't see you on their map",
    waiting: 'Waiting for your location',
    pausedNoSpot: 'Sharing paused · no spot shared yet',
  },
  openMap: 'Open the map',
};
