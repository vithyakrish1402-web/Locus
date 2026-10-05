// Words for the permission explainers and AR Scan's start screen. Provisional: from the
// design where it shows them, otherwise from the Step 0 wording inventory, until the wording
// review.

export const CAMERA_EXPLAINER = {
  title: 'Allow the camera for AR Scan',
  body: 'AR Scan places labels over the camera view to point you to places and people. The camera picture stays on your phone.',
  continue: 'Continue',
  notNow: 'Not now',
};

// AR Scan's own start screen: its tap is what starts the camera and the compass.
export const AR_START = {
  title: 'AR Scan',
  body: (target) => `Finding ${target}. Hold your phone up: AR Scan uses the camera and compass to point the way.`,
  start: 'Start AR Scan',
  cancel: 'Cancel',
};
