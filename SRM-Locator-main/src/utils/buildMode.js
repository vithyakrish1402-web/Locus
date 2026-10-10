// The side-by-side test build (npm run sidetest:install): the real app under its own app ID,
// "LOCUS Test", installed next to LOCUS. It must never offer an update: a live bundle would
// swap its JavaScript for the published one, and a full update would offer the release APK.
// Vite replaces import.meta.env.MODE with the build's mode as a constant, so in every other
// build this is `false` and the checks that read it are compiled out.
export const UPDATES_OFF = import.meta.env.MODE === 'sidetest';
