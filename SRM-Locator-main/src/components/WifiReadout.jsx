import { useEffect, useState } from 'react';
import { floorLabel } from '../utils/indoorView';

// WiFi Arc field test: the owner's live view of what WiFi positioning is doing, one scan
// cycle at a time, so the estimates can be judged on the spot (walking TECH PARK) rather
// than only when they clear the confidence threshold and the floor picker appears.
// Owner-only (isAdmin in App.jsx) and gated on WIFI_POSITIONING_ENABLED there.

/** Plain words for each cycle outcome wifiFusion.js can report. */
const OUTCOME_TEXT = {
  unavailable: 'SCANNER UNAVAILABLE (NOT THE APP BUILD?)',
  budget: 'SKIPPED - OS SCAN LIMIT',
  'scan-error': 'SCAN FAILED',
  throttled: 'SCAN THROTTLED BY OS',
  stale: 'OS RETURNED OLD RESULTS',
  timeout: 'SCAN TIMED OUT',
  empty: 'NO WIFI HEARD',
  'no-aps': 'NO WIFI HEARD',
  'estimate-error': 'SURVEY TABLE FAILED TO LOAD',
};

function useSecondsSince(at) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return at ? Math.max(0, Math.round((now - at) / 1000)) : null;
}

/**
 * @param {{ lastCycle: object|null, active: boolean }} props lastCycle from useWifiFusion;
 *   active = in a squad and approved, the only time scanning runs
 */
export default function WifiReadout({ lastCycle, active }) {
  const ago = useSecondsSince(lastCycle?.at);
  const e = lastCycle?.estimate;

  let lines;
  if (!active) {
    lines = [['PAUSED', 'JOIN A SQUAD TO SCAN', 'text-zinc-400']];
  } else if (!lastCycle) {
    lines = [['SCAN', 'FIRST SCAN RUNNING...', 'text-zinc-400']];
  } else if (lastCycle.outcome !== 'estimate') {
    const text = OUTCOME_TEXT[lastCycle.outcome] ?? lastCycle.outcome.toUpperCase();
    lines = [['SCAN', lastCycle.error ? `${text}: ${lastCycle.error}` : text, 'text-yellow-400'], ['USING', 'GPS', 'text-zinc-300']];
  } else {
    const where = e.building ? `${e.building} ${Number.isInteger(e.floor) ? floorLabel(e.floor) : '?'}` : 'OUTDOORS / UNTAGGED';
    lines = [
      ['HEARD', `${lastCycle.apsInScan} APS THIS SCAN`, 'text-zinc-300'],
      ['MATCHED', `${e.matchedApCount} OF ${e.totalApsSeen} (LAST 3 SCANS)`, e.matchedApCount ? 'text-zinc-300' : 'text-yellow-400'],
      ...(e.matchedApCount ? [['VOTE', where, 'text-white']] : []),
      ['CONF', `${e.confidence.toFixed(2)} ${lastCycle.usedWifi ? '>=' : '<'} ${lastCycle.threshold.toFixed(2)}`, lastCycle.usedWifi ? 'text-emerald-400' : 'text-yellow-400'],
      ['USING', lastCycle.usedWifi ? 'WIFI' : 'GPS', lastCycle.usedWifi ? 'text-emerald-400' : 'text-zinc-300'],
    ];
  }

  return (
    <div
      data-testid="wifi-readout"
      className="absolute left-4 z-40 w-52 px-2.5 py-2 bg-black/80 backdrop-blur-md border border-white/15 font-dot text-[9px] uppercase tracking-widest pointer-events-none"
      style={{ top: 'calc(33.333% + 11rem)' }}
    >
      <p className="flex justify-between text-zinc-500 mb-1">
        <span>WIFI TEST</span>
        <span>{ago === null ? '' : `${ago}S AGO`}</span>
      </p>
      {lines.map(([label, value, tone]) => (
        <p key={label} className="flex gap-2 leading-snug">
          <span className="w-14 shrink-0 text-zinc-500">{label}</span>
          <span className={tone}>{value}</span>
        </p>
      ))}
    </div>
  );
}
