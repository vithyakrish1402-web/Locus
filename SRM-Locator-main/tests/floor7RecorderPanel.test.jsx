// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import Floor7DebugOverlay from '../src/components/Floor7DebugOverlay.jsx';
import Floor7RecorderPanel from '../src/components/Floor7RecorderPanel.jsx';
import { createMemoryStore, createRecorder, recorder } from '../src/utils/floor7Recorder.js';

afterEach(async () => {
  cleanup();
  if (recorder.recording) await recorder.stop();
  vi.restoreAllMocks();
});

const T0 = Date.UTC(2026, 9, 14, 11, 0, 0);
const make = (store = createMemoryStore()) => {
  let clock = T0;
  const rec = createRecorder({ now: () => clock, store, attachLifecycle: () => () => {}, setTimer: () => 0, clearTimer: () => {} });
  return { rec, store, tick: (ms) => { clock += ms; } };
};
const est = (at) => ({
  at, raw: { x: -9, y: 11 }, snapped: { x: -9, y: 11, edge: 0, offset: 1 }, filtered: { x: -9, y: 11.75 }, status: 'tracking',
  unc: 4, confidence: 0.8, matched: 4, total: 9, walkFromLastM: null, scans: [],
});
const click = (id) => fireEvent.click(screen.getByTestId(id));

describe('the recorder panel', () => {
  it('offers Start and says nothing is stored until it is pressed', () => {
    const { rec } = make();
    render(<Floor7RecorderPanel rec={rec} />);
    expect(screen.getByTestId('rec-start')).toBeTruthy();
    expect(screen.getByText(/Nothing is stored until you press Start/)).toBeTruthy();
    expect(screen.queryByTestId('rec-stop')).toBeNull();
    expect(rec.recording).toBe(false);
  });

  it('shows the red Recording label, elapsed time, estimate count and the current door', () => {
    const { rec, tick } = make();
    render(<Floor7RecorderPanel rec={rec} />);
    click('rec-start');
    expect(screen.getByTestId('rec-status').textContent).toContain('Recording');
    expect(screen.getByTestId('rec-status').className).toContain('text-red');
    act(() => { rec.recordEstimate(est(T0 + 1000)); rec.recordEstimate(est(T0 + 2000)); });
    expect(screen.getByTestId('rec-status').textContent).toContain('2 estimates logged');
    fireEvent.change(screen.getByTestId('rec-search'), { target: { value: 'TP706A' } });
    expect(screen.getByTestId('rec-here').disabled).toBe(true); // choose a place first
    fireEvent.click(screen.getByTestId('rec-places').querySelector('[data-place="r706A"]'));
    tick(5000);
    click('rec-here');
    expect(screen.getByTestId('rec-current').textContent).toContain('Room 706A');
    expect(screen.getByTestId('rec-current').textContent).toContain('75 s of 75');
    click('rec-done');
    expect(screen.getByTestId('rec-current').textContent).toContain('No door being measured');
  });

  it('Stop shows the error report on screen, with the plain-language lines, and the privacy note is there', async () => {
    const { rec } = make();
    render(<Floor7RecorderPanel rec={rec} />);
    click('rec-start');
    act(() => { rec.recordEstimate(est(T0 + 20_000)); });
    fireEvent.click(screen.getByTestId('rec-places').querySelector('[data-place="r701"]'));
    click('rec-here');
    click('rec-stop');
    const report = await screen.findByTestId('rec-report');
    expect(report.textContent).toContain('Room 701');
    expect(report.textContent).toContain('What this means');
    expect(screen.getByText(/Wi-Fi names and hardware addresses/)).toBeTruthy();
    expect(screen.queryByTestId('rec-stop')).toBeNull();
    expect(screen.getByTestId('rec-start')).toBeTruthy(); // a new, separate recording can begin
  });

  it('Share sends every file through the share sheet; Save to Downloads copies them', async () => {
    const { rec, store } = make();
    render(<Floor7RecorderPanel rec={rec} />);
    click('rec-start');
    click('rec-stop');
    await screen.findByTestId('rec-report');
    click('rec-share');
    await waitFor(() => expect(store.state.shared).toHaveLength(1));
    expect(store.state.shared[0].names.map((n) => n.replace(/^floor7_\d{8}_\d{6}/, ''))).toEqual(['_estimates.csv', '_scans.csv', '_doors.csv', '_events.csv', '_summary.txt']);
    click('rec-downloads');
    await waitFor(() => expect(store.state.downloads).toHaveLength(1));
  });

  it('lists previous recordings, shares one again, deletes one after asking', async () => {
    const { rec, store, tick } = make();
    const a = rec.start();
    await rec.stop();
    tick(60_000);
    const b = rec.start();
    await rec.stop();
    render(<Floor7RecorderPanel rec={rec} />);
    const list = await screen.findByTestId('rec-previous');
    await waitFor(() => expect(list.textContent).toContain(a));
    expect(list.textContent).toContain(b);
    const shareButtons = [...list.querySelectorAll('button')].filter((x) => x.textContent === 'Share');
    fireEvent.click(shareButtons[0]);
    await waitFor(() => expect(store.state.shared).toHaveLength(1));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const del = () => [...list.querySelectorAll('button')].filter((x) => x.textContent === 'Delete')[0];
    fireEvent.click(del());
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect((await rec.recordings())).toHaveLength(2); // declined
    fireEvent.click(del());
    await waitFor(async () => expect(await rec.recordings()).toHaveLength(1));
  });

  it('warns when the app left the foreground, and offers to recover a recording the app was killed in', async () => {
    const store = createMemoryStore();
    const { rec: killed } = make(store);
    const id = killed.start();
    await new Promise((r) => setTimeout(r, 5));
    const { rec } = make(store);
    render(<Floor7RecorderPanel rec={rec} />);
    const recover = await screen.findByTestId('rec-recover');
    expect(recover.textContent).toContain(id);
    fireEvent.click(recover.querySelector('button'));
    await screen.findByTestId('rec-report');
    await waitFor(() => expect(screen.queryByTestId('rec-recover')).toBeNull());

    click('rec-start');
    act(() => { rec.onForeground(false); });
    act(() => { rec.onForeground(true); });
    expect(screen.getByTestId('rec-warning').textContent).toContain('left the foreground');
    fireEvent.click(screen.getByText('OK'));
    expect(screen.queryByTestId('rec-warning')).toBeNull();
  });
});

describe('inside the F7 overlay', () => {
  it('the recorder is in the overlay panel, and the toggle shows REC while a recording runs', async () => {
    render(<Floor7DebugOverlay />);
    expect(screen.queryByTestId('floor7-recorder')).toBeNull(); // panel closed
    fireEvent.click(screen.getByText(/F7/));
    expect(screen.getByTestId('floor7-recorder')).toBeTruthy();
    expect(screen.queryByTestId('rec-badge')).toBeNull();
    click('rec-start');
    expect(screen.getByTestId('rec-badge').textContent).toContain('REC');
    click('rec-stop');
    await waitFor(() => expect(screen.queryByTestId('rec-badge')).toBeNull());
  });
});

describe('owner-only, test-build-only: pinned in the real App.jsx', () => {
  const app = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8').replace(/\r\n/g, '\n');

  it('App.jsx reaches the recorder only through the overlay line that is behind FLOOR7_DEMO and isAdmin', () => {
    expect(app).toContain('{FLOOR7_DEMO && isAdmin && <Suspense fallback={null}><Floor7DebugOverlay /></Suspense>}');
    expect(app).not.toMatch(/Recorder|floor7Recorder/);
  });

  it('nothing but the overlay and the F7 tracker imports the recorder', () => {
    const importers = ['src/components/Floor7DebugOverlay.jsx', 'src/utils/floor7Demo.js'];
    for (const f of importers) expect(readFileSync(`${process.cwd()}/${f}`, 'utf8')).toMatch(/floor7Recorder|Floor7RecorderPanel/);
    const hooks = readFileSync(`${process.cwd()}/src/hooks/useWifiFusion.js`, 'utf8');
    expect(hooks).not.toMatch(/floor7Recorder/);
  });
});
