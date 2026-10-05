// The app's stacking order for its full-screen and floating layers, in one place, so a
// layer's height is chosen by name rather than by a number picked to beat another number.
// Higher draws on top. The order, top first:
//
//   emergency  an incoming SOS (SosOverlay): over everything, a mandatory update included
//   update     the APK update modal, optional and mandatory (UpdateModal)
//   toast      in-app notices (CommsFeed): over AR Scan, so a notice posted there is seen
//   arScan     AR Scan, its permission screen included (ARCompass)
//   ...        the open group panel on a phone (z 900), then
//   underGroupPanel  in-app notices while that panel is open: under it, letting taps
//              through, so they never cover the Group Lead's Refresh locations and Join
//              requests buttons (see CommsFeed)
//   sheet      bottom sheets and their backdrop (components/ui/Sheet): over the map's
//              chrome and, like today's modals, over the SOS button (z 1150). Whether the SOS
//              button should stay above sheets is an open decision (docs/step0-followups.md).
//
// Everything else still uses its own z-[n] class, all of them below arScan. The redesign's
// layering piece moves those onto names here too.
export const LAYER = {
  underGroupPanel: 850,
  sheet: 2000,
  arScan: 9500,
  toast: 9600,
  update: 10000,
  emergency: 10002,
};
