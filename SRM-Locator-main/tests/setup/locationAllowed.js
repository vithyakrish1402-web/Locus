// Every test starts as a phone where location was allowed before, so the app asks for it on
// joining a group as it always did. The location explainer, which shows only until location
// is allowed, has its own tests (tests/locationExplainer.test.jsx), which clear this note.
import { beforeEach } from 'vitest';

beforeEach(() => {
  try {
    globalThis.localStorage?.setItem('locus.locationAllowed', '1');
  } catch {
    // No storage in this environment (node tests).
  }
});
