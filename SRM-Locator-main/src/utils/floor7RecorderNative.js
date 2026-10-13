// JS side of the native Recorder plugin (android/app/src/sidetest/java/com/locus/app/RecorderPlugin.java).
// The plugin exists only in the LOCUS Test APK (the `sidetest` build type), like everything
// that imports this file. Outside the app (a browser, tests) every call rejects UNAVAILABLE
// and `available` is false.

import { registerPlugin, Capacitor } from '@capacitor/core';

const unavailable = () => Promise.reject(Object.assign(new Error('The recorder only works in the LOCUS Test app'), { code: 'UNAVAILABLE' }));
const Recorder = registerPlugin('Recorder', {
  web: {
    writeFile: unavailable, readFile: unavailable, listRecordings: unavailable, deleteRecording: unavailable,
    shareRecording: unavailable, saveToDownloads: unavailable, keepScreenOn: unavailable,
  },
});

export const recorderNative = {
  available: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  write: (dir, name, content) => Recorder.writeFile({ dir, name, content }),
  read: async (dir, name) => (await Recorder.readFile({ dir, name })).content,
  list: async () => (await Recorder.listRecordings()).recordings,
  remove: (dir) => Recorder.deleteRecording({ dir }),
  share: (dir, names) => Recorder.shareRecording({ dir, names }),
  saveToDownloads: (dir, names) => Recorder.saveToDownloads({ dir, names }),
  keepScreenOn: (on) => Recorder.keepScreenOn({ on }),
};
