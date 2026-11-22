// @vitest-environment jsdom
//
// The UI audit fix pass (2026-10-25), part by part:
// A4  the Emergency button's words are one short word each, and the button keeps one width,
// A6  a building's card shows its name once, in Title Case, from data left as stored,
// A7c "SOS alerts when the app is closed" is greyed out with its reason while sharing is off,
// A8  the Google map's place names reach 4.5:1 over every colour of both map styles,
// A9  the folded sharing chip keeps a word beside its dot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import SosTrigger from '../src/components/SosTrigger.jsx';
import BuildingRow from '../src/components/map/BuildingRow.jsx';
import BackgroundSharingSection from '../src/components/settings/BackgroundSharingSection.jsx';
import { SharingChip, STATUS_PILL_EXPAND_HOLD_MS } from '../src/components/map/TopBar.jsx';
import { SOS_BUTTON } from '../src/copy/emergency.js';
import { BACKGROUND_SHARING as COPY } from '../src/copy/settings.js';
import { SHARING_CHIP, SHARING_CHIP_SHORT } from '../src/copy/map.js';
import { displayPlaceName } from '../src/utils/placeName.js';
import {
  DARK_MAP_STYLES, LIGHT_MAP_STYLES, MAP_LABEL_FILL, MAP_LABEL_HALO, MAP_LABEL_HALO_WIDTH_PX,
} from '../src/utils/mapStyles.js';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('A6: place names in Title Case, for display only', () => {
  it.each([
    ['TECH PARK 2', 'Tech Park 2'],
    ['C V RAMAN BLOCK', 'C V Raman Block'],
    ['N BLOCK', 'N Block'],
    ['MBA BLOCK', 'MBA Block'],
    ['TP2', 'TP2'],
    ['SRM CENTRAL LIBRARY', 'SRM Central Library'],
    ['ELECTRICAL SCIENCES BLOCK (ESB)', 'Electrical Sciences Block (ESB)'],
    ['T.P. GANESAN AUDITORIUM', 'T.P. Ganesan Auditorium'],
    ['JAVA GREEN (FOOD COURT)', 'Java Green (Food Court)'],
    ['HI-TECH BLOCK', 'Hi-Tech Block'],
    ['SCHOOL OF ARCHITECTURE', 'School of Architecture'],
    ['M BLOCK (GIRLS HOSTEL)', 'M Block (Girls Hostel)'],
    // From the live campus list (Firestore and the tour import), 2026-10-25.
    ['ASRL LAB', 'ASRL Lab'],
    ['SCHOOL OF BIOENGINEERING (SOBE)', 'School of Bioengineering (SOBE)'],
    ['SRMIST KTR ACM SIGKDD STUDENT CHAPTER', 'SRMIST KTR ACM SIGKDD Student Chapter'],
    ['PADMAM HALL BY SRM HOTEL', 'Padmam Hall by SRM Hotel'],
    ['IMAC LAB', 'iMac Lab'],
    ['SRM FABLAB', 'SRM FabLab'],
    ['DR. B. C. ROY GIRLS HOSTEL', 'Dr. B. C. Roy Girls Hostel'],
    ['SRM NEW GENTS MEDICAL HOSTEL UG AND OG', 'SRM New Gents Medical Hostel UG and OG'],
  ])('%s → %s', (stored, shown) => {
    expect(displayPlaceName(stored)).toBe(shown);
  });

  it('leaves a name already in mixed case as it was written', () => {
    expect(displayPlaceName('Java Green')).toBe('Java Green');
    expect(displayPlaceName('iMac lab')).toBe('iMac lab');
  });

  it('never changes the stored data', () => {
    const before = SRM_MASTER_DATABASE.map((b) => b.name);
    SRM_MASTER_DATABASE.forEach((b) => displayPlaceName(b.name));
    expect(SRM_MASTER_DATABASE.map((b) => b.name)).toEqual(before);
  });

  it('a card says the name once, and not its description', () => {
    const building = SRM_MASTER_DATABASE.find((b) => b.name === 'TECH PARK');
    render(<BuildingRow building={building} me={null} onOpen={() => {}} onArScan={() => {}} onNavigate={() => {}} />);
    const row = screen.getByTestId('building-row');
    expect(row.querySelector('h4').textContent).toBe('Tech Park');
    expect(row.querySelector('h4').className).not.toMatch(/\btruncate\b/);
    expect(row.textContent.match(/Tech Park/gi)).toHaveLength(1);
  });
});

describe('A4: the Emergency button keeps one short word', () => {
  const HOLD = 1200;
  let button;
  const press = () => fireEvent.pointerDown(button, { button: 0 });
  const release = () => fireEvent.pointerUp(button);
  const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });
  beforeEach(() => {
    vi.useFakeTimers();
    render(<SosTrigger socket={{ emit: vi.fn() }} getLocation={() => ({ lat: 12.82, lng: 80.04 })} roomCode="K7M2QX" senderName="Meera" />);
    button = screen.getByTestId('sos-button');
  });

  it('SOS, Hold, Armed, Hold, Sent: no "..." and no long word', () => {
    const seen = [button.textContent];
    press(); wait(HOLD / 2); seen.push(button.textContent);
    wait(HOLD / 2); release(); seen.push(button.textContent);
    press(); wait(HOLD / 2); seen.push(button.textContent);
    wait(HOLD / 2); release(); seen.push(button.textContent);
    expect(seen).toEqual([SOS_BUTTON.sos, SOS_BUTTON.hold, SOS_BUTTON.armed, SOS_BUTTON.hold, 'SENT']);
    seen.forEach((word) => expect(word).not.toMatch(/\.\.\.|…/));
  });

  it('is one fixed width in the tab bar, whatever it says', () => {
    expect(button.className).toMatch(/\bw-28\b/);
    press(); wait(HOLD / 2);
    expect(button.className).toMatch(/\bw-28\b/);
    expect(button.querySelector('span.whitespace-nowrap').textContent).toBe(SOS_BUTTON.hold);
  });
});

describe('A7c: SOS alerts when the app is closed, while sharing is off', () => {
  const section = (on) => render(
    <BackgroundSharingSection
      group="K7M2QX"
      layer={10}
      backgroundSharing={{
        available: true, on, status: { state: on ? 'sharing' : 'off' }, consentOpen: false,
        requestChange: vi.fn(), acceptConsent: vi.fn(), declineConsent: vi.fn(), refresh: vi.fn(),
        sosAlerts: { on: true, setOn: vi.fn(), audible: true, fullScreen: true },
      }}
    />,
  );

  it('greyed out, takes no taps, and says why in one line', () => {
    section(false);
    const row = screen.getByTestId('sos-alerts');
    expect(row.dataset.unavailable).toBe('true');
    expect(row.className).toMatch(/\bopacity-50\b/);
    expect(row.className).toMatch(/\bpointer-events-none\b/);
    expect(row.textContent).toContain(COPY.sos.offReason);
    expect(screen.getByRole('switch', { name: new RegExp(COPY.sos.label) }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByTestId('sos-alerts-note')).toBeNull();
  });

  it('with sharing on: usable, its own line, and the note that it stops with sharing', () => {
    section(true);
    const row = screen.getByTestId('sos-alerts');
    expect(row.dataset.unavailable).toBeUndefined();
    expect(row.textContent).toContain(COPY.sos.description);
    expect(screen.getByTestId('sos-alerts-note').textContent).toBe(COPY.sos.needsSharing);
  });
});

describe('A8: place names on the Google map', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const areas = (styles) => styles.filter((s) => /geometry/.test(s.elementType ?? '')).flatMap((s) => s.stylers.map((x) => x.color).filter(Boolean));

  it.each([['light', LIGHT_MAP_STYLES], ['dark', DARK_MAP_STYLES]])('%s: at least 4.5:1 over every map colour, with a halo', (theme, styles) => {
    for (const area of areas(styles)) expect(ratio(MAP_LABEL_FILL[theme], area)).toBeGreaterThanOrEqual(4.5);
    const fill = styles.find((s) => s.featureType === 'poi' && s.elementType === 'labels.text.fill');
    const halo = styles.find((s) => s.featureType === 'poi' && s.elementType === 'labels.text.stroke');
    expect(fill.stylers).toEqual([{ color: MAP_LABEL_FILL[theme] }]);
    expect(halo.stylers).toEqual([{ color: MAP_LABEL_HALO[theme] }, { weight: MAP_LABEL_HALO_WIDTH_PX }]);
  });
});

describe('A9: the sharing chip is never a bare dot', () => {
  it('folded, it keeps one word beside the dot; open, only the full line', () => {
    vi.useFakeTimers();
    render(<SharingChip mode="ACTIVE" />);
    const chip = screen.getByTestId('sharing-chip');
    expect(chip.textContent).toBe(SHARING_CHIP.ACTIVE);
    act(() => { vi.advanceTimersByTime(STATUS_PILL_EXPAND_HOLD_MS + 500); });
    expect(chip.dataset.expanded).toBe('false');
    // Not while the long line is still fading out: the chip never holds both.
    expect(screen.queryByTestId('sharing-chip-short')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('sharing-chip-short').textContent).toBe(SHARING_CHIP_SHORT.ACTIVE);
    fireEvent.click(chip);
    expect(screen.queryByTestId('sharing-chip-short')).toBeNull();
  });
});
