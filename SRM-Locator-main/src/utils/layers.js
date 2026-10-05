// The app's stacking order for its full-screen and floating layers, in one place, so a
// layer's height is chosen by name rather than by a number picked to beat another number.
// Higher draws on top. The order, top first:
//
//   emergency  an incoming SOS (SosOverlay): over everything, a mandatory update included
//   update     the APK update modal, optional and mandatory (UpdateModal)
//   toast      in-app notices (CommsFeed): over AR Scan, so a notice posted there is seen
//   arScan     AR Scan, its permission screen included (ARCompass)
//
// Everything else still uses its own z-[n] class, all of them below arScan. The redesign's
// layering piece moves those onto names here too.
export const LAYER = {
  arScan: 9500,
  toast: 9600,
  update: 10000,
  emergency: 10002,
};
