// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The native plugin does not exist here: the app's own recorder gets a memory store.
const memory = vi.hoisted(() => ({ dirs: new Map() }));
vi.mock('../src/utils/floor7RecorderNative.js', () => ({
  recorderNative: {
    available: true,
    write: async (d, n, c) => { if (!memory.dirs.has(d)) memory.dirs.set(d, new Map()); memory.dirs.get(d).set(n, c); },
    read: async (d, n) => { const c = memory.dirs.get(d)?.get(n); if (c === undefined) throw new Error('NOT_FOUND'); return c; },
    list: async () => [...memory.dirs].map(([id]) => ({ id })),
    remove: async (d) => { memory.dirs.delete(d); },
    share: async () => {},
    saveToDownloads: async () => ({ saved: 0 }),
    keepScreenOn: async () => {},
  },
}));

const { createMemoryStore, createRecorder } = await import('../src/utils/floor7Recorder.js');
const { createFloor7Tracker } = await import('../src/utils/floor7Demo.js');
const { toGeo } = await import('../src/utils/floor7Frame.js');
const { default: ReadyCheck } = await import('../src/components/devmode/ReadyCheck.jsx');
const { default: WalkTest } = await import('../src/components/devmode/WalkTest.jsx');
const { default: DeveloperScreen } = await import('../src/components/devmode/DeveloperScreen.jsx');
const { default: AdvancedSection } = await import('../src/components/devmode/AdvancedSection.jsx');
const { TOUR_PLACES } = await import('../src/utils/floor7Guided.js');

const OK_CYCLE = { outcome: 'estimate', at: Date.now() };
const shownNow = () => [{ at: Date.now() - 5000, filtered: { x: 0, y: 0 }, status: 'tracking', uncertaintyM: 4 }];

/** A recorder over a memory store, with the lifecycle and timers kept out of the test's way. */
function makeRec() {
  const store = createMemoryStore();
  const rec = createRecorder({ store, attachLifecycle: () => () => {}, setTimer: () => 0, clearTimer: () => {} });
  return { rec, store };
}

/** Gives the live trail a shown position, as the tracker does after two agreeing estimates. */
function feedTrail() {
  const tracker = createFloor7Tracker({ staleMs: 70_000 });
  tracker.reset();
  const p = toGeo(-9, 11.75);
  const estimate = { ...p, building: 'TECH PARK', floor: 7, confidence: 0.9 };
  tracker.apply(estimate, Date.now() - 1000);
  tracker.apply(estimate, Date.now());
}

const est = (at, filtered = { x: -9, y: 11.75 }) => ({
  at, raw: { x: -9, y: 11 }, snapped: { x: -9, y: 11, edge: 0, offset: 1 }, filtered, status: 'tracking',
  unc: 4, confidence: 0.8, matched: 4, total: 9, walkFromLastM: null, scans: [],
});
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => memory.dirs.clear());
afterEach(cleanup);

describe('Screen A: the ready check', () => {
  const props = { inGroup: true, lastCycle: OK_CYCLE, trail: [], onStart: () => {}, onBack: () => {}, onPrevious: () => {} };

  it('keeps Start disabled until every item is ticked, and says what it is waiting for', () => {
    render(<ReadyCheck {...props} />);
    const start = screen.getByTestId('start-walk');
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId('why-disabled').textContent).toBe('Still needed before Start: first position.');
    expect(screen.getByTestId('waiting-line').textContent).toMatch(/Waiting… \d+ s\. This can take up to 70 seconds\. Stay on Floor 7 with the screen on\./);
    expect(screen.getAllByRole('listitem').filter((li) => li.dataset.ready === 'no')).toHaveLength(1);
  });

  it('names each missing item with its one-line fix', () => {
    render(<ReadyCheck {...props} inGroup={false} lastCycle={null} />);
    expect(screen.getByText(/Create a group, or join one/)).toBeTruthy();
    expect(screen.getByTestId('why-disabled').textContent).toMatch(/in a group/);
    expect(screen.getByTestId('start-walk').disabled).toBe(true);
  });

  it('enables Start when all six are ticked, and starts with the doors in the route', () => {
    const onStart = vi.fn();
    render(<ReadyCheck {...props} trail={shownNow()} onStart={onStart} />);
    expect(screen.queryByTestId('why-disabled')).toBeNull();
    expect(screen.getAllByRole('listitem').filter((li) => li.dataset.ready).every((li) => li.dataset.ready === 'yes')).toBe(true);
    fireEvent.click(screen.getByTestId('start-walk'));
    expect(onStart).toHaveBeenCalledOnce();
    const doors = onStart.mock.calls[0][0];
    expect(doors[0]).toBe('r701');
    expect([...doors].sort()).toEqual([...TOUR_PLACES].sort());
  });

  it('shows the route up front, lets a door move or be skipped, and starts with that', () => {
    const onStart = vi.fn();
    render(<ReadyCheck {...props} trail={shownNow()} onStart={onStart} />);
    const rows = () => within(screen.getByTestId('route-list')).getAllByRole('listitem');
    expect(rows()).toHaveLength(TOUR_PLACES.length);
    expect(rows()[0].textContent).toContain('Room 701');
    click('Move Room 701 down');
    expect(rows()[1].textContent).toContain('Room 701');
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /^Skip / }));
    expect(rows()[0].textContent).toContain('(skipped)');
    fireEvent.click(screen.getByTestId('start-walk'));
    expect(onStart.mock.calls[0][0]).toHaveLength(TOUR_PLACES.length - 1);
  });
});

describe('Screens B and C: the guided walk', () => {
  /** Opens the walk with just three doors chosen, by skipping the rest on Screen A. */
  async function begin(rec) {
    feedTrail();
    render(<WalkTest rec={rec} inGroup lastCycle={OK_CYCLE} onBack={() => {}} />);
    const rows = within(screen.getByTestId('route-list')).getAllByRole('listitem');
    rows.slice(3).forEach((row) => fireEvent.click(within(row).getByRole('button', { name: /^Skip / })));
    fireEvent.click(screen.getByTestId('start-walk'));
    await screen.findByTestId('walking-screen');
  }
  const instruction = () => screen.getByTestId('instruction').textContent;
  const main = () => screen.getByTestId('main-action');

  it('says what to do next, moves through the doors with skip and undo, and shows progress', async () => {
    const { rec } = makeRec();
    await begin(rec);
    expect(rec.recording).toBe(true);
    expect(screen.getByTestId('recording-label').textContent).toBe('● Recording');
    expect(screen.getByTestId('elapsed').textContent).toMatch(/^\d+:\d\d$/);
    expect(instruction()).toBe('Next: Room 701. Walk to the corridor in front of the door and stand still.');
    expect(screen.getByTestId('progress-text').textContent).toBe('Door 1 of 3');
    expect(main().textContent).toBe('I’m here');
    expect(screen.getByTestId('status-line').textContent).toBe('Position shown.');

    fireEvent.click(main()); // I'm here
    expect(instruction()).toBe('Stand still: 75 s');
    expect(main().textContent).toBe('Done, next door');
    expect(rec.snapshot().marks.map((m) => m.placeId)).toEqual(['r701']);

    fireEvent.click(main()); // Done
    expect(instruction()).toMatch(/^Next: /);
    expect(screen.getByTestId('progress-text').textContent).toBe('Door 2 of 3');
    const list = screen.getByTestId('door-list').querySelectorAll('li');
    expect([...list].map((li) => li.dataset.doorState)).toEqual(['done', 'next', 'later']);
    expect(list[1].getAttribute('aria-current')).toBe('step');

    fireEvent.click(screen.getByRole('button', { name: 'Skip this door' }));
    expect([...screen.getByTestId('door-list').querySelectorAll('li')].map((li) => li.dataset.doorState)).toEqual(['done', 'skipped', 'next']);
    expect(rec.snapshot().marks).toHaveLength(1); // nothing recorded for a skipped door

    click('Undo last'); // takes back the skip
    expect([...screen.getByTestId('door-list').querySelectorAll('li')].map((li) => li.dataset.doorState)).toEqual(['done', 'next', 'later']);
    fireEvent.click(main()); // I'm here at door 2
    expect(rec.snapshot().marks).toHaveLength(2);
    click('Undo last'); // takes back that I'm here and its mark
    expect(rec.snapshot().marks).toHaveLength(1);
    expect(main().textContent).toBe('I’m here');
  });

  it('after the last door asks for the passage walk with Start of walk and End of walk, then the stop screen', async () => {
    const { rec } = makeRec();
    await begin(rec);
    for (let i = 0; i < 3; i++) { fireEvent.click(main()); fireEvent.click(main()); }
    expect(instruction()).toMatch(/^Now walk the whole middle passage without stopping\./);
    expect(main().textContent).toBe('Start of walk');
    fireEvent.click(main());
    expect(instruction()).toMatch(/^Keep walking to Lift lobby B/);
    expect(main().textContent).toBe('End of walk');
    fireEvent.click(main());
    expect(main().textContent).toBe('Stop and see results');
    expect(rec.snapshot().marks.map((m) => m.kind)).toEqual(['door', 'door', 'door', 'walk_start', 'walk_end']);
  });

  it('Stop asks first; keeping on walking changes nothing; stopping shows the results with chips and plain words', async () => {
    const { rec, store } = makeRec();
    await begin(rec);
    fireEvent.click(main()); // I'm here at Room 701
    act(() => rec.recordEstimate(est(Date.now()))); // the position shown there: right on the door
    fireEvent.click(main()); // Done
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Stop recording?')).toBeTruthy();
    click('Keep walking');
    expect(rec.recording).toBe(true);
    expect(screen.queryByText('Stop recording?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByTestId('confirm-stop'));

    const summary = await screen.findByTestId('summary');
    expect(rec.recording).toBe(false);
    expect(summary.textContent).toBe('Typical error 0.0 m. 1 of 1 doors within 5 m. Worst: Room 701, 0.0 m.');
    const rows = within(screen.getByTestId('result-rows')).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Room 701');
    expect(rows[0].querySelector('[data-chip]').dataset.chip).toBe('good');
    expect(rows[0].textContent).toMatch(/Walking error 0\.0 m\. Raw reading alone: \d/);
    expect(screen.getByTestId('advanced').open).toBe(false);
    expect(screen.getByText(/Wi-Fi names and hardware addresses/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-files'));
    await waitFor(() => expect(store.state.shared).toHaveLength(1));
    expect(store.state.shared[0].names).toHaveLength(5);
    await screen.findByText('The share sheet is open.');

    fireEvent.click(screen.getByTestId('another-walk'));
    expect(screen.getByTestId('start-walk')).toBeTruthy(); // back at the ready check
  });

  it('marks a door that showed no position grey, and says so in words', async () => {
    const { rec } = makeRec();
    await begin(rec);
    fireEvent.click(main());
    fireEvent.click(main());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByTestId('confirm-stop'));
    const summary = await screen.findByTestId('summary');
    expect(summary.textContent).toBe('None of the 1 doors showed a position.');
    const row = within(screen.getByTestId('result-rows')).getAllByRole('listitem')[0];
    expect(row.querySelector('[data-chip]').dataset.chip).toBe('none');
    expect(row.textContent).toContain('No position was shown while you stood there.');
  });

  it('lists earlier walks: see the result, share, delete only after asking', async () => {
    const { rec, store } = makeRec();
    const a = rec.start();
    await rec.stop();
    feedTrail();
    render(<WalkTest rec={rec} inGroup lastCycle={OK_CYCLE} onBack={() => {}} />);
    click('Previous recordings');
    const list = await screen.findByTestId('recordings-list');
    expect(list.textContent).toContain(a);
    click('Share');
    await waitFor(() => expect(store.state.shared).toHaveLength(1));
    click('Delete');
    expect(screen.getByText('Delete this recording from the phone?')).toBeTruthy();
    click('Keep it');
    expect((await rec.recordings())).toHaveLength(1);
    click('Delete');
    click('Delete it');
    await screen.findByTestId('no-recordings');
    expect(await rec.recordings()).toHaveLength(0);
  });
});

describe('the Developer mode screen', () => {
  const props = { open: true, onClose: () => {}, overlayOn: false, onOverlay: () => {}, inGroup: true, lastCycle: OK_CYCLE };

  it('lists the Floor 7 walk test, and the map overlay as a collapsed card', () => {
    render(<DeveloperScreen {...props} />);
    const walk = document.querySelector('[data-option="walk-test"]');
    expect(walk.textContent).toContain('Check how accurate indoor positioning is on Floor 7.');
    const overlay = document.querySelector('[data-option="map-overlay"]');
    expect(overlay.tagName).toBe('DETAILS');
    expect(overlay.open).toBe(false);
    expect(screen.getByText(/never sends anything to the server/)).toBeTruthy();
  });

  it('turns the map overlay on and off from its card', () => {
    const onOverlay = vi.fn();
    render(<DeveloperScreen {...props} onOverlay={onOverlay} />);
    fireEvent.click(screen.getByRole('switch', { name: /Show the plan on the main map/ }));
    expect(onOverlay).toHaveBeenCalledWith(true);
  });

  it('stops and saves a walk still recording when Developer mode is switched off (the screen goes away)', async () => {
    const { recorder } = await import('../src/utils/floor7Recorder.js');
    recorder.start();
    const { unmount } = render(<DeveloperScreen {...props} />);
    expect(recorder.recording).toBe(true);
    unmount();
    await waitFor(() => expect(recorder.recording).toBe(false));
    expect((await recorder.recordings()).length).toBeGreaterThan(0);
  });

  it('opens the walk test, and is hidden (not unmounted) when closed so a walk survives', () => {
    const { rerender } = render(<DeveloperScreen {...props} />);
    fireEvent.click(screen.getByTestId('open-walk-test'));
    expect(screen.getByTestId('start-walk')).toBeTruthy();
    rerender(<DeveloperScreen {...props} open={false} />);
    expect(screen.getByTestId('developer-screen').hidden).toBe(true);
    expect(screen.getByTestId('start-walk')).toBeTruthy();
  });
});

describe('the result chips', () => {
  it('have a different colour for each of good, fair, far off and no position, with the words alongside', async () => {
    const { ResultChip } = await import('../src/components/devmode/ui.jsx');
    const tones = ['good', 'fair', 'far', 'none'];
    const classes = tones.map((tone) => render(<ResultChip tone={tone}>{tone}</ResultChip>).container.firstChild.className.match(/bg-\[#[0-9a-f]{6}\]/)[0]);
    expect(new Set(classes).size).toBe(4);
    expect(classes[0]).toBe('bg-[#1b7f3b]'); // green
    expect(classes[3]).toBe('bg-[#4b5563]'); // grey
  });
});

describe('Advanced details', () => {
  it('is closed by default and holds the technical parts: marks, constants, estimates, access points', () => {
    const { container } = render(<AdvancedSection trail={[{ at: 1_700_000_000_000, status: 'tracking', filtered: { x: 1, y: 1 }, uncertaintyM: 3 }]} />);
    expect(container.querySelector('details').open).toBe(false);
    const text = container.textContent;
    for (const t of ['walk_start', 'walk_end', 'MAX_JUMP_M', 'PLAN_SCALE', 'Latest estimates', 'Access points (38)']) expect(text, t).toContain(t);
  });
});

describe('readable on a phone', () => {
  it('has no text under 14 px, no monospaced text and no cramped caption sizes in any Developer mode screen', () => {
    const dir = join(process.cwd(), 'src', 'components', 'devmode');
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'));
    expect(files.length).toBeGreaterThan(8);
    for (const f of [...files.map((x) => join(dir, x)), join(process.cwd(), 'src', 'components', 'Floor7DebugOverlay.jsx')]) {
      const src = readFileSync(f, 'utf8');
      const sizes = [...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
      expect(sizes.filter((n) => n < 14), f).toEqual([]);
      expect(src, f).not.toMatch(/\btext-(xs|caption|micro)\b|font-mono|text-\[[0-9.]+rem\]/);
    }
  });

  it('every button and summary is at least 48 px tall (the shared Button, or min-h-12/14), on every screen', async () => {
    const { rec } = makeRec();
    feedTrail();
    const tokens = readFileSync(join(process.cwd(), 'src', 'theme', 'tokens.css'), 'utf8');
    expect(Number(/--size-button:\s*(\d+)px/.exec(tokens)[1])).toBeGreaterThanOrEqual(48);
    // tall enough, and no class that squeezes it back down
    const tall = (el) => {
      const classes = String(el.className).split(/\s+/);
      const ok = classes.some((c) => c === 'min-h-12' || c === 'min-h-14' || /^min-h-\[var\(--size-button(-large)?\)\]$/.test(c));
      const squeezed = classes.some((c) => /^!?min-h-(0|[1-9]|10|11)$/.test(c) || /^!?h-(\d|10|11)$/.test(c));
      return ok && !squeezed;
    };
    const audit = (label) => {
      const els = [...document.querySelectorAll('button, summary')];
      expect(els.length, label).toBeGreaterThan(0);
      expect(els.filter((el) => !tall(el)).map((el) => `${label}: ${el.textContent}`)).toEqual([]);
    };
    render(<DeveloperScreen open onClose={() => {}} overlayOn={false} onOverlay={() => {}} inGroup lastCycle={OK_CYCLE} />);
    audit('developer home');
    cleanup();
    render(<WalkTest rec={rec} inGroup lastCycle={OK_CYCLE} onBack={() => {}} />);
    audit('ready check');
    const rows = within(screen.getByTestId('route-list')).getAllByRole('listitem');
    rows.slice(2).forEach((row) => fireEvent.click(within(row).getByRole('button', { name: /^Skip / })));
    fireEvent.click(screen.getByTestId('start-walk'));
    await screen.findByTestId('walking-screen');
    audit('walking');
    fireEvent.click(screen.getByTestId('main-action'));
    audit('standing still');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    audit('confirm stop');
    fireEvent.click(screen.getByTestId('confirm-stop'));
    await screen.findByTestId('summary');
    audit('results');
  });
});
