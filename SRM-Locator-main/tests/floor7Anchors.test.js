import { describe, expect, it } from 'vitest';
import {
  LAB_F_RULE, TIE_DB, assignSessions, buildAnchors, campusOnly, fileShort, guessReasons, parseCsv, placeReadings,
  radioOf, readMapping, readSurvey, shortScan,
} from '../scripts/lib/floor7Anchors.mjs';

const HEADER = 'point_id,timestamp,lat,lng,accuracy_m,bssid,ssid,rssi,frequency_mhz,building,floor,spot';
const csvRow = (id, bssid, ssid, rssi, spot, time = '2026-10-13T06:20:00Z') => `${id},${time},1,2,3,${bssid},${ssid},${rssi},5180,TECH PARK,7,${spot}`;

const MAP_HEADER = 'raw_name,place_id,plan_name,corridor,distance_m,plan_x,plan_y,confidence,note';
const MAPPING = readMapping([
  MAP_HEADER,
  'Room 701,r701,Room 701,west_spine,23.75,-9.0,11.75,estimated,',
  'Typo 701,r701,Room 701,west_spine,23.75,-9.0,11.75,estimated,typo',
  'Room 702,r702,Room 702,west_spine,17.25,-9.0,5.25,guess,',
  'Room 703,r703,Room 703,west_spine,10.75,-9.0,-1.25,estimated,',
  'Computing Lab C,labC,Computing Lab C,passage,26.0,17.0,0.0,estimated,',
  'Computing Lab D,labD,Computing Lab D,passage,20.0,11.0,0.0,estimated,',
  'Computing Lab F,labC,Computing Lab C,passage,26.0,17.0,0.0,estimated,"RULE: point 69 or higher was really Lab E"',
  'Comouting Lab F,labC,Computing Lab C,passage,26.0,17.0,0.0,estimated,typo',
  'Near The New Restroom L,rW,New ladies restroom,west_back,15.0,6.0,7.9,guess,',
  'Near the New Restroom,rNew,New restroom (disabled),west_back,3.2,-5.8,7.9,guess,',
  'tp 707,DROP,(no such room),,,,,,"Room 707 does not exist"',
  'Staff Room 703A,r703A,Room 703A,west_spine,4.25,-9.0,-7.75,hold,"HOLD: left out"',
].join('\n'));

const reading = (scan, bssid, ssid, rssi, place, x, y, extra = {}) => ({ scan, bssid, ssid, rssi, place, x, y, ...extra });
const PLAN = {
  places: [
    { id: 'r701', name: 'Room 701', corridor: 'west_spine', confidence: 'estimated' },
    { id: 'r702', name: 'Room 702', corridor: 'west_spine', confidence: 'guess' },
    { id: 'r703', name: 'Room 703', corridor: 'west_spine', confidence: 'estimated' },
    { id: 'r704', name: 'Room 704', corridor: 'east_spine', confidence: 'estimated' },
    { id: 'r706', name: 'Room 706', corridor: 'east_spine', confidence: 'estimated' },
    { id: 'rW', name: "New ladies restroom ('W')", corridor: 'west_back', confidence: 'guess' },
    { id: 'rM', name: 'Restroom M', corridor: 'east_back', confidence: 'guess' },
    { id: 'lobbyB', name: 'Lift lobby B', corridor: 'passage', confidence: 'guess' },
    { id: 'labC', name: 'Computing Lab C', corridor: 'passage', confidence: 'estimated' },
  ],
};

describe('reading the survey CSV', () => {
  it('parses quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,"b,c","d ""e""",f\r\n"x\ny",2\n')).toEqual([['a', 'b,c', 'd "e"', 'f'], ['x\ny', '2']]);
  });

  it('skips blank and all-comma rows, and keys scans by file so restarted ids do not collide', () => {
    const text = [HEADER, csvRow(1, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701'), ',,,,,,,,,,,', '', ',,,,,,,,,,,'].join('\r\n');
    const a = readSurvey(text, 'one.csv');
    const b = readSurvey(text, 'two.csv');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ bssid: 'aa:aa:aa:aa:aa:01', rssi: -50, spot: 'Room 701', point: 1, file: 'one.csv' });
    expect(a[0].scan).not.toBe(b[0].scan);
  });

  it('never reads GPS: the readings carry no position', () => {
    const [r] = readSurvey([HEADER, csvRow(1, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701')].join('\n'), 'x.csv');
    expect(Object.keys(r).filter((k) => /lat|lng|accuracy/i.test(k))).toEqual([]);
  });

  it('skips a row that has no BSSID even when other fields are filled in', () => {
    const text = [HEADER, csvRow(1, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701'), '2,t,1,2,3,,,,,TECH PARK,7,Room 701'].join('\n');
    expect(readSurvey(text, 'x.csv').map((r) => r.bssid)).toEqual(['aa:aa:aa:aa:aa:01']);
  });

  it('refuses a file without the columns it needs', () => {
    expect(() => readSurvey('foo,bar\n1,2\n', 'x.csv')).toThrow(/no "point_id" column/);
  });

  it('names a scan briefly: 170507#56', () => {
    expect(shortScan('wifi_survey_20261013_170507.csv#56')).toBe('170507#56');
    expect(fileShort('wifi_survey_20261013_115710.csv')).toBe('115710');
  });
});

describe('sessions', () => {
  const rows = [
    csvRow(19, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701', '2026-10-13T06:19:31Z'),
    csvRow(31, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701', '2026-10-13T06:30:15Z'),
    csvRow(32, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'Room 701', '2026-10-13T10:36:46Z'),
  ];
  const sessions = (file) => assignSessions(readSurvey([HEADER, ...rows].join('\n'), file)).map((r) => [r.point, r.session, r.part, r.phone]);

  it('splits a file at a long gap into its morning and afternoon scans, one phone throughout', () => {
    expect(sessions('wifi_survey_20261013_170507.csv')).toEqual([
      [19, '170507 morning', 'morning', '170507'],
      [31, '170507 morning', 'morning', '170507'],
      [32, '170507 afternoon', 'afternoon', '170507'],
    ]);
  });

  it('leaves a file without a gap as one session', () => {
    const text = [HEADER, rows[0], rows[1]].join('\n');
    const r = assignSessions(readSurvey(text, 'wifi_survey_20261013_115710.csv'));
    expect(new Set(r.map((x) => x.session))).toEqual(new Set(['115710']));
    expect(r[0].part).toBe('morning');
  });
});

describe('the name table and placing readings', () => {
  const survey = (spot, point = 1, file = 'wifi_survey_20261013_115710.csv') => readSurvey([HEADER, csvRow(point, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, spot)].join('\n'), file);

  it('puts a typed name at its plan spot', () => {
    const { placed } = placeReadings(survey('Typo 701'), MAPPING);
    expect(placed[0]).toMatchObject({ place: 'r701', x: -9, y: 11.75 });
  });

  it('anchors the new ladies restroom at rW, not at the disabled restroom', () => {
    expect(placeReadings(survey('Near The New Restroom L'), MAPPING).placed[0]).toMatchObject({ place: 'rW', x: 6, y: 7.9 });
    expect(placeReadings(survey('Near the New Restroom'), MAPPING).placed[0]).toMatchObject({ place: 'rNew', x: -5.8 });
  });

  it('drops tp 707 and holds the staff-room scans back', () => {
    const r = placeReadings([...survey('tp 707', 6), ...survey('Staff Room 703A', 7), ...survey('Room 701', 8)], MAPPING);
    expect(r.placed.map((x) => x.spot)).toEqual(['Room 701']);
    expect(r.dropped).toEqual(['wifi_survey_20261013_115710.csv#6']);
    expect(r.held).toEqual(['wifi_survey_20261013_115710.csv#7']);
  });

  it('refuses a name the table does not know, naming it and its scan', () => {
    expect(() => placeReadings(survey('Room 7O1'), MAPPING)).toThrow(/Room 7O1 \(wifi_survey_20261013_115710.csv#1\)/);
  });

  it('treats Computing Lab F from point 69 of the newest file as Lab E (Lab D/E), and earlier ones as Lab C/F', () => {
    const newest = LAB_F_RULE.file;
    const placeOf = (spot, point, file = newest) => placeReadings(survey(spot, point, file), MAPPING).placed[0].place;
    expect(placeOf('Computing Lab F', 68)).toBe('labC');
    expect(placeOf('Computing Lab F', 69)).toBe('labD');
    expect(placeOf('Computing Lab F', 100)).toBe('labD');
    expect(placeOf('Comouting Lab F', 70)).toBe('labD'); // the typo of it
    expect(placeOf('Computing Lab F', 100, 'wifi_survey_20261013_120055.csv')).toBe('labC'); // another file: not the rule
    expect(placeOf('Computing Lab C', 100)).toBe('labC'); // only the Lab F names
  });

  it('puts the Lab E position at Lab D\'s plan coordinates', () => {
    expect(placeReadings(survey('Computing Lab F', 90, LAB_F_RULE.file), MAPPING).placed[0]).toMatchObject({ x: 11, y: 0 });
  });
});

describe('campus filter', () => {
  const rs = [
    reading('s#1', 'aa:bb:cc:dd:ee:01', 'SRMIST', -50, 'r701', 0, 0),
    reading('s#1', 'aa:bb:cc:dd:ee:02', '', -52, 'r701', 0, 0), // hidden name, same radio as a named one
    reading('s#1', 'aa:bb:cc:dd:ee:03', 'SRMIST-UA', -53, 'r701', 0, 0),
    reading('s#1', '11:22:33:44:55:01', 'Priya iPhone', -40, 'r701', 0, 0),
    reading('s#1', '99:88:77:66:55:01', '', -45, 'r701', 0, 0), // hidden, nothing campus alongside it
  ];

  it('keeps allowlisted names and the hidden-name radios that share their first five bytes', () => {
    expect(campusOnly(rs).map((r) => r.bssid)).toEqual(['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:03']);
  });

  it('drops phones and hidden networks that belong to no campus radio', () => {
    expect(campusOnly(rs).some((r) => r.ssid === 'Priya iPhone' || r.bssid.startsWith('99:'))).toBe(false);
  });

  it('groups a radio by its first five bytes', () => {
    expect(radioOf('AA:BB:CC:DD:EE:0F')).toBe('aa:bb:cc:dd:ee');
  });
});

describe('placing radios', () => {
  const R = 'aa:bb:cc:dd:ee';
  const at701 = (rssi, extra = {}) => reading('s#1', `${R}:01`, 'SRMIST', rssi, 'r701', -9, 11.75, extra);
  const at703 = (rssi, extra = {}) => reading('s#2', `${R}:01`, 'SRMIST', rssi, 'r703', -9, -1.25, extra);

  it('puts a radio at the spot where it was heard strongest', () => {
    const [r] = buildAnchors([at701(-60), at703(-52)]);
    expect(r).toMatchObject({ radio: R, place: 'r703', x: -9, y: -1.25, basis: 'best', single_spot: false });
  });

  it('judges a radio by its strongest BSSID, not by one BSSID', () => {
    const rs = [
      reading('s#1', `${R}:01`, 'SRMIST', -80, 'r701', -9, 11.75),
      reading('s#1', `${R}:04`, 'SRMIST-UA', -50, 'r701', -9, 11.75),
      reading('s#2', `${R}:01`, 'SRMIST', -60, 'r703', -9, -1.25),
    ];
    expect(buildAnchors(rs)[0].place).toBe('r701');
    expect(buildAnchors(rs)[0].bssids.map((b) => b.bssid)).toEqual([`${R}:01`, `${R}:04`]);
  });

  it('puts a radio at the midpoint of two spots when they are within the tie margin', () => {
    const [r] = buildAnchors([at701(-55), at703(-55 - (TIE_DB - 0.5))]);
    expect(r).toMatchObject({ basis: 'tie', x: -9, y: 5.25, place: null, tie: ['r701', 'r703'] });
  });

  it('does not tie at exactly the margin: the margin is "closer than"', () => {
    expect(buildAnchors([at701(-55), at703(-55 - TIE_DB)])[0].basis).toBe('best');
  });

  it('flags a radio heard at one spot only', () => {
    const [r] = buildAnchors([at701(-60), at701(-70, { scan: 's#3' })]);
    expect(r.single_spot).toBe(true);
    expect(r.basis).toBe('best');
  });

  it('keeps the strongest reading per spot over repeated scans', () => {
    const [r] = buildAnchors([at701(-70, { scan: 'a' }), at701(-50, { scan: 'b' }), at703(-60)]);
    expect(r.place).toBe('r701');
    expect(r.heard[0]).toEqual(['r701', -50]);
  });

  it('lets an override win over what was measured, by place or by coordinates', () => {
    expect(buildAnchors([at701(-40), at703(-80)], { overrides: { [R]: { place: 'r703' } } })[0]).toMatchObject({ x: -9, y: -1.25, basis: 'override' });
    expect(buildAnchors([at701(-40)], { overrides: { [R]: { x: 1.5, y: -2 } } })[0]).toMatchObject({ x: 1.5, y: -2, basis: 'override' });
    expect(() => buildAnchors([at701(-40)], { overrides: { [R]: { place: 'nowhere' } } })).toThrow(/nowhere/);
  });

  it('can leave one scan, or a whole session, out', () => {
    const rs = [at701(-40, { scan: 's#1', part: 'morning' }), at703(-60, { scan: 's#2', part: 'afternoon' })];
    expect(buildAnchors(rs)[0].place).toBe('r701');
    expect(buildAnchors(rs, { use: (r) => r.scan !== 's#1' })[0].place).toBe('r703');
    expect(buildAnchors(rs, { use: (r) => r.part === 'afternoon' })[0].single_spot).toBe(true);
    expect(buildAnchors(rs, { use: () => false })).toEqual([]);
  });

  it('rounds positions to a centimetre and sorts radios', () => {
    const rs = [
      reading('s#1', 'bb:bb:bb:bb:bb:01', 'SRMIST', -50, 'x', 1 / 3, 2 / 3),
      reading('s#1', 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'x', 1 / 3, 2 / 3),
    ];
    const out = buildAnchors(rs);
    expect(out.map((r) => r.radio)).toEqual(['aa:aa:aa:aa:aa', 'bb:bb:bb:bb:bb']);
    expect(out[0]).toMatchObject({ x: 0.33, y: 0.67 });
  });
});

describe('anchors that rest on a guess', () => {
  it('names the guess items: Room 702, Room 704, the restrooms and the east wing', () => {
    expect(guessReasons('r702', PLAN)).toEqual(['Room 702 position is a guess']);
    expect(guessReasons('r704', PLAN)).toEqual(['Room 704 position is a mirror guess', 'east wing is a mirror of the west wing']);
    for (const id of ['rW', 'rM']) expect(guessReasons(id, PLAN).join()).toContain('restroom position is a guess');
    expect(guessReasons('rM', PLAN)).toContain('east wing is a mirror of the west wing'); // east back path
    expect(guessReasons('r706', PLAN)).toEqual(['east wing is a mirror of the west wing']);
  });

  it('flags anything else the plan itself marks as a guess, by its name', () => {
    expect(guessReasons('lobbyB', PLAN)).toEqual(['Lift lobby B is marked as a guess in the plan']);
  });

  it('has nothing to say about spots the plan is sure of', () => {
    expect(guessReasons('r701', PLAN)).toEqual([]);
    expect(guessReasons('r703', PLAN)).toEqual([]);
    expect(guessReasons('labC', PLAN)).toEqual([]);
  });

  it('judges a midpoint by both of its spots', () => {
    expect(guessReasons('between:r701,r702', PLAN)).toEqual(['Room 702 position is a guess']);
    expect(guessReasons('between:r701,r703', PLAN)).toEqual([]);
  });

  it('marks an anchor that sits on a guess spot, either of a tie\'s spots, and not a sure one', () => {
    const R = 'aa:bb:cc:dd:ee';
    const opts = { planDoc: PLAN, mapping: MAPPING };
    const on = (place, x, y, rssi = -50, radio = R) => reading(`s#${place}`, `${radio}:01`, 'SRMIST', rssi, place, x, y);
    expect(buildAnchors([on('r702', -9, 5.25)], opts)[0].guess).toEqual(['Room 702 position is a guess']);
    expect(buildAnchors([on('r701', -9, 11.75)], opts)[0].guess).toEqual([]);
    expect(buildAnchors([on('r701', -9, 11.75, -50), on('r702', -9, 5.25, -51)], opts)[0].guess).toEqual(['Room 702 position is a guess']);
    expect(buildAnchors([on('r701', -9, 11.75)])[0].guess).toEqual([]); // no plan given: nothing to judge by
  });
});
