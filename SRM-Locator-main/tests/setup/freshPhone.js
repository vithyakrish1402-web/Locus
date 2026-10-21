// Every test starts as a phone that remembers no Group and no background sharing from an earlier
// run (src/utils/rememberedGroup.js, src/utils/backgroundSharing.js). The tests of coming back to
// a Group (tests/resumeGroup.test.jsx) store one themselves.
import { beforeEach } from 'vitest';

beforeEach(() => {
  try {
    globalThis.localStorage?.removeItem('locus.group');
    globalThis.localStorage?.removeItem('locus.backgroundSharing.room');
  } catch {
    // No storage in this environment (node tests).
  }
});
