// The app's stacking order for its full-screen and floating layers, in one place, so a
// layer's height is chosen by name rather than by a number picked to beat another number.
// Higher draws on top. The order, top first:
//
//   emergency  an incoming SOS (SosOverlay): over everything, a mandatory update included
//   emergencyButton  the Emergency button (SosTrigger), with its hold card: over every other
//              screen (sheets, Settings, the guide, the update dialog, AR Scan, notices), below
//              an incoming alert (Emergency batch, E1). Nothing may cover it; each screen keeps
//              its bottom content clear of it instead (--emergency-clearance in index.css). It
//              isn't drawn at all on the mandatory update screen, which replaces the whole app.
//   update     the APK update modal, optional and mandatory (UpdateModal)
//   toast      in-app notices (CommsFeed): over AR Scan, so a notice posted there is seen
//   arScan     AR Scan, its permission screen included (ARCompass)
//   ...        the open group panel on a phone (z 900), then
//   underGroupPanel  in-app notices while that panel is open: under it, letting taps
//              through, so they never cover the Group Lead's Refresh locations and Join
//              requests buttons (see CommsFeed)
//   sheet      bottom sheets and their backdrop (components/ui/Sheet): over the map's chrome
//
// Everything else still uses its own z-[n] class, all of them below arScan.
export const LAYER = {
  underGroupPanel: 850,
  sheet: 2000,
  arScan: 9500,
  // AR Scan's own sheets (the target picker): over AR Scan.
  arScanSheet: 9520,
  toast: 9600,
  update: 10000,
  emergencyButton: 10001,
  emergency: 10002,
};
