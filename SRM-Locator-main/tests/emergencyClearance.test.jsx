// @vitest-environment jsdom
//
// One layer for the Emergency button, and room for it on every screen (Emergency batch, E1).
// The button stands over every screen but an incoming alert; nothing may cover it. Each screen
// that can reach its corner ends its content above it, through one shared clearance
// (--emergency-clearance in index.css), which applies only while the button is on screen.
// Layout itself (that the bottom buttons really end above it at 360 and 412 px wide, at 100 %
// and 130 % text) is measured in the browser; see the batch report.
import React from 'react';
import fs from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { LAYER } from '../src/utils/layers.js';
import SosTrigger from '../src/components/SosTrigger.jsx';
import Sheet from '../src/components/ui/Sheet.jsx';
import StatusScreen from '../src/components/access/StatusScreen.jsx';
import Guide from '../src/components/guide/Guide.jsx';
import SettingsScreen from '../src/components/settings/SettingsScreen.jsx';
import UpdateModal from '../src/components/UpdateModal.jsx';
import { UpdateStatus } from '../src/hooks/useAppUpdate.js';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

const src = (path) => fs.readFileSync(`${process.cwd()}/src/${path}`, 'utf8');
const css = src('index.css');
const CLEARANCE = 'var(--emergency-clearance)';

const optionalUpdate = () => ({
  supported: true,
  status: UpdateStatus.AVAILABLE,
  manifest: { version: '1.2.0', notes: 'Fixes', size: 1000000 },
  installedVersion: '1.1.0',
  progress: { percent: -1, loaded: 0, total: 0 },
  error: null,
  mandatory: false,
  dismissed: false,
  check: vi.fn(),
  startDownload: vi.fn(),
  openInstallSettings: vi.fn(),
  dismiss: vi.fn(),
});

describe('one layer for the button', () => {
  it('stands above every other layer the app names, and below only an incoming alert', () => {
    for (const [name, z] of Object.entries(LAYER)) {
      if (name === 'emergencyButton') continue;
      if (name === 'emergency') expect(LAYER.emergencyButton).toBeLessThan(z);
      else expect(LAYER.emergencyButton, name).toBeGreaterThan(z);
    }
  });

  it('nothing else in the app is drawn above it: every other stacking number is lower', () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { if (entry.name !== 'devtools') walk(path); } else if (/\.(jsx?|css)$/.test(entry.name)) files.push(path);
      }
    };
    walk(`${process.cwd()}/src`);
    const numbers = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/z-\[(\d+)\]|zIndex:\s*(\d+)|z-index:\s*(\d+)|_Z\s*=\s*(\d+)/g)) {
        numbers.push([file.replace(/.*\/src\//, ''), Number(m[1] ?? m[2] ?? m[3] ?? m[4])]);
      }
    }
    expect(numbers.length).toBeGreaterThan(5);
    // The one exception: the tap ping (.locus-ping in index.css), a ring that takes no touches
    // and lasts half a second.
    for (const [file, z] of numbers) {
      if (file === 'index.css' && z === 20000) continue;
      expect(z, `${file}: z ${z}`).toBeLessThan(LAYER.emergencyButton);
    }
  });

  it('the button, its hold card and its dimmed screen all stand on it', () => {
    render(<SosTrigger socket={{ emit: vi.fn() }} />);
    expect(Number(screen.getByTestId('sos-button').style.zIndex)).toBe(LAYER.emergencyButton);
  });
});

describe('the clearance', () => {
  it('11 rem plus the gesture bar while the button is on screen (its top is 10 rem up), 7.5 rem from md up, 1 rem otherwise', () => {
    expect(css).toContain(':root { --emergency-clearance: calc(1rem + env(safe-area-inset-bottom)); }');
    expect(css).toContain(':root[data-emergency-button] { --emergency-clearance: calc(11rem + env(safe-area-inset-bottom)); }');
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*:root\[data-emergency-button\] \{ --emergency-clearance: calc\(7\.5rem \+ env\(safe-area-inset-bottom\)\); \}/);
    // The button: 5 rem up, 5 rem tall (md: 1.5 rem up), on the gesture bar's inset.
    const trigger = src('components/SosTrigger.jsx');
    expect(trigger).toMatch(/fixed bottom-20 left-4 md:bottom-6 md:left-\[23rem\] w-20 h-20/);
    expect(trigger).toContain("marginBottom: 'env(safe-area-inset-bottom)'");
  });

  it('applies only while the button is on screen', () => {
    expect(document.documentElement.dataset.emergencyButton).toBeUndefined();
    const { unmount } = render(<SosTrigger socket={{ emit: vi.fn() }} />);
    expect(document.documentElement.dataset.emergencyButton).toBe('on');
    unmount();
    expect(document.documentElement.dataset.emergencyButton).toBeUndefined();
  });

  it('with the keyboard open, a focused field stops clear of the button', () => {
    expect(css).toContain('input, textarea, select, [contenteditable="true"] { scroll-margin-bottom: var(--emergency-clearance); }');
  });
});

describe('every screen that reaches its corner ends above it', () => {
  it('sheets (join requests, member options, Remove and block, Leave group, the explainers, the meeting point, the AR picker)', () => {
    render(<Sheet open onClose={() => {}} title="A sheet"><button type="button">Confirm</button></Sheet>);
    const panel = screen.getByRole('button', { name: 'Confirm' }).parentElement;
    expect(panel.style.paddingBottom).toBe(CLEARANCE);
  });

  it("status screens (You're in)", () => {
    render(<StatusScreen icon={null} title="You're in" action={<button type="button">Open the map</button>} />);
    expect(screen.getByRole('dialog').style.paddingBottom).toBe(CLEARANCE);
  });

  it('the guide (opened from Settings)', () => {
    render(<Guide onDone={() => {}} zIndex={5001} initialStep={4} />);
    expect(document.querySelector('[style*="emergency-clearance"]')).toBeTruthy();
    expect(src('components/guide/Guide.jsx')).toContain("paddingBottom: 'var(--emergency-clearance)'");
  });

  it('Settings', () => {
    expect(src('components/settings/SettingsScreen.jsx')).toContain("paddingBottom: 'calc(var(--emergency-clearance) + 1rem)'");
  });

  it('the optional update dialog', () => {
    render(<UpdateModal update={optionalUpdate()} />);
    const panel = screen.getByTestId('update-sheet').firstElementChild;
    expect(panel.style.paddingBottom).toBe(CLEARANCE);
  });

  it("the Group Lead's Refresh locations table and the admin tools", () => {
    const app = src('App.jsx');
    for (const z of ['z-[4000]', 'z-[6000]']) {
      const at = app.indexOf(`backdrop-blur-md ${z}`);
      expect(at, z).toBeGreaterThan(0);
      expect(app.slice(at, at + 400), z).toContain("style={{ paddingBottom: 'var(--emergency-clearance)' }}");
    }
  });

  it('AR Scan, its start screen and its readout', () => {
    expect(src('ARCompass.jsx')).toContain("export const CLEAR_OF_EMERGENCY_BUTTON = 'var(--emergency-clearance)';");
  });

  it('the mandatory update screen has no button, so no room for one', () => {
    const app = src('App.jsx');
    const gate = app.slice(app.indexOf('if (appUpdate.mandatory) {'), app.indexOf('if (appUpdate.mandatory) {') + 300);
    expect(gate).not.toContain('SosTrigger');
  });
});
