// Whether this phone has been through the guide ("How LOCUS works") once, so it shows only on
// first run. Skip and Get started both count. Settings › About › How LOCUS works opens it
// any time, whatever this says.

export const GUIDE_SEEN_KEY = 'locus.guideSeen';

const storage = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/** True once the guide has been finished or skipped on this phone. */
export function guideSeen() {
  try {
    return storage()?.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberGuideSeen() {
  try {
    storage()?.setItem(GUIDE_SEEN_KEY, '1');
  } catch {
    // Not saved (private window, blocked storage): the guide shows again next time.
  }
}
