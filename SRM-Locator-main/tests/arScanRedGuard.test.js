// Red is for the emergency and destructive actions only (the redesign's rule). After the AR
// Scan batch nothing in AR Scan is red: not the arrow (CSS or three.js), the road line (SVG or
// three.js), the labels, the controls, the picker, the notices, the readout or the debug
// overlay. The Emergency button above AR Scan is SosTrigger's own, outside these files.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const src = (path) => readFileSync(`${process.cwd()}/src/${path}`, 'utf8');
const RED = /red-\d|#EF4444|#DC2626|#F87171|#FCA5A5|#7F1D1D|#450A0A|rgba\(239,\s*68,\s*68|\bdanger\b/i;
// three.js colours as hex numbers, and the road's [r, g, b] fractions: red-dominant is out.
const redHex = (text) => [...text.matchAll(/0x([0-9a-f]{6})\b/gi)]
  .map((m) => parseInt(m[1], 16))
  .filter((c) => c !== 0 && c !== 0xffffff)
  .filter((c) => ((c >> 16) & 0xff) > 2 * Math.max((c >> 8) & 0xff, c & 0xff));

const AR_FILES = [
  'ARCompass.jsx',
  'arLandmarks.js',
  'components/ARArrow3D.jsx',
  'components/ARArrowGL.jsx',
  'components/ARLandmarkLayer.jsx',
  'components/ARRoadGL.jsx',
  'components/ARRoadLine.jsx',
  'components/ARTag.jsx',
  ...readdirSync(`${process.cwd()}/src/components/ar`).map((f) => `components/ar/${f}`),
  'utils/arArrowScene.js',
  'utils/arRoadScene.js',
  'copy/arScan.js',
];

describe('AR Scan', () => {
  it('has no red anywhere', () => {
    for (const file of AR_FILES) {
      expect(src(file), file).not.toMatch(RED);
      expect(redHex(src(file)), file).toEqual([]);
    }
  });

  it('has no old tactical look: dot font, zinc and yellow, SYS_ tags on screen', () => {
    for (const file of AR_FILES) {
      expect(src(file), file).not.toMatch(/font-dot|zinc-|yellow-|SYS_DEBUG|TARGET_LOCK|PROXIMITY|CALIBRATE SENSOR/);
    }
  });

  it("the road's three.js colour is blue, not red", () => {
    const [r, g, b] = /ROAD_COLOR = \[0x([0-9a-f]{2}) \/ 255, 0x([0-9a-f]{2}) \/ 255, 0x([0-9a-f]{2}) \/ 255\]/i
      .exec(src('utils/arRoadScene.js')).slice(1).map((h) => parseInt(h, 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
