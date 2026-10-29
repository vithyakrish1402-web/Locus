// The release scripts' refusals that need no network or build, kept here so tests can pin them.
// Each returns a sentence saying what is wrong, or null when there is nothing to refuse.

import { MANDATORY_MARKER, compareVersions, parseVersion } from '../../src/utils/updateManifest.js';

/**
 * The APK build number (versionCode) must be above the one already published: Android refuses
 * to install an APK over one with the same or a higher number. 1.1.36 shipped below the
 * published one (its branch's build.gradle had drifted) and no phone could install it.
 */
export function versionCodeProblem(nextCode, publishedCode, publishedTag = 'the newest APK') {
  if (!Number.isInteger(publishedCode)) {
    return `could not read the build number (versionCode) of ${publishedTag}, so this one can't be checked against it`;
  }
  if (!Number.isInteger(nextCode) || nextCode <= publishedCode) {
    return `this build would be versionCode ${nextCode}, but ${publishedTag} is already ${publishedCode}. ` +
      `Android would refuse it. Set versionCode in android/app/build.gradle to ${publishedCode} (the script adds one) and retry`;
  }
  return null;
}

// Lines the app reads out of a release body. Written by the scripts only, never in notes.
const MACHINE_LINE = /^[ \t]*(SHA-?256|MIN_NATIVE|MANDATORY|VERSION_CODE)[ \t]*[:=]/im;

/**
 * Release notes must not carry anything the app reads as an instruction. Apps up to js-1.1.83
 * treat "[MANDATORY]" anywhere in the notes as the mandatory gate, so notes that merely mention
 * it would lock those phones out; only --mandatory may write it.
 */
export function notesProblem(notes) {
  if (typeof notes !== 'string') return null;
  if (notes.includes(MANDATORY_MARKER)) {
    return `the notes contain "${MANDATORY_MARKER}", which older apps read as a mandatory update. Remove it; use --mandatory to make a release mandatory`;
  }
  const line = MACHINE_LINE.exec(notes);
  if (line) return `the notes contain a "${line[1]}:" line, which the app reads; the script writes those lines itself`;
  return null;
}

/**
 * A bundle's MIN_NATIVE must be the version of an APK that was really published: the oldest
 * shell the bundle may run on. Taken from whichever branch was built, it once named a shell
 * nobody had (the bundle reached no phone) or one too old for the bundle's native calls.
 */
export function minNativeProblem(minNative, publishedTags) {
  if (!parseVersion(minNative) || !/^\d+\.\d+\.\d+$/.test(minNative)) return `MIN_NATIVE "${minNative}" is not a three-part version`;
  const apks = (publishedTags ?? []).filter((tag) => /^v\d/i.test(tag));
  if (!apks.some((tag) => compareVersions(tag, minNative) === 0)) {
    return `MIN_NATIVE ${minNative} is not a published APK (v* release). ` +
      'Build from the branch of a published APK, or pass --min-native with the version of one';
  }
  return null;
}
