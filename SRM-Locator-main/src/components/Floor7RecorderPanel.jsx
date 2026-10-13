import { useCallback, useEffect, useState } from 'react';
import { useFloor7Recorder } from '../hooks/useFloor7Recorder.js';
import { DEFAULT_DWELL_S } from '../../scripts/lib/floor7PhoneWalk.mjs';
import { listPlaces, recorder as liveRecorder } from '../utils/floor7Recorder.js';

// The Floor 7 walk recorder's controls, inside the F7 debug panel (test build, owner only).
// Start, walk, mark each door with one tap, Stop: the files and the error report are made on
// the phone. It only observes; see src/utils/floor7Recorder.js.

const PLACES = listPlaces();
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const btn = 'px-2 py-1 rounded border border-white/30 uppercase tracking-wider disabled:opacity-40';

export default function Floor7RecorderPanel({ rec = liveRecorder }) {
  const snap = useFloor7Recorder(rec);
  const [query, setQuery] = useState('');
  const [placeId, setPlaceId] = useState(null);
  const [earlier, setEarlier] = useState([]);
  const [recoverable, setRecoverable] = useState([]);
  const [shown, setShown] = useState(null); // { id, text }
  const [note, setNote] = useState('');

  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [all, killed] = [await rec.recordings(), await rec.recoverable()];
        if (live) { setEarlier(all); setRecoverable(killed); }
      } catch {
        if (live) setEarlier([]);
      }
    })();
    return () => { live = false; };
  }, [rec, snap.recording, reload]);

  const q = query.trim().toLowerCase();
  const matches = (q ? PLACES.filter((p) => p.search.includes(q)) : PLACES).slice(0, 8);
  const chosen = PLACES.find((p) => p.id === placeId);
  const done = async (promise, ok) => {
    try { await promise; setNote(ok); } catch (e) { setNote(`That did not work (${e?.code || e?.message || 'unknown'}).`); }
  };
  const stop = async () => {
    const r = await rec.stop();
    setShown(r && { id: r.id, text: r.report.text });
    refresh();
  };

  return (
    <div className="mt-2 p-2 rounded border border-white/20" data-testid="floor7-recorder">
      {snap.warning && (
        <p className="mb-1 p-1 bg-amber-500/30 text-amber-200" data-testid="rec-warning">
          The app left the foreground{snap.warning.seconds === null ? '' : ` for about ${snap.warning.seconds} s`}. Android slows Wi-Fi scans then, so this walk may have gaps. Keep LOCUS Test on screen.
          <button type="button" className="ml-2 underline" onClick={() => rec.dismissWarning()}>OK</button>
        </p>
      )}

      {!snap.recording ? (
        <>
          <button type="button" data-testid="rec-start" className={`${btn} bg-neutral-700`} onClick={() => { setShown(null); rec.start(); }}>Start recording</button>
          <span className="ml-2 opacity-70">Nothing is stored until you press Start.</span>
        </>
      ) : (
        <>
          <p className="text-red-400 font-bold" data-testid="rec-status">
            ● Recording · {clock(snap.elapsedMs)} · {snap.count} estimates logged
          </p>
          <p data-testid="rec-current">
            {snap.current ? `At: ${snap.current.placeName} · stand still ${snap.current.secondsLeft} s of ${DEFAULT_DWELL_S}` : 'No door being measured'}
          </p>
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a place: 706A, TP701, lift..."
            className="mt-1 w-full px-1 py-0.5 bg-black text-white border border-white/30" aria-label="Search places" data-testid="rec-search"
          />
          <ul className="max-h-28 overflow-y-auto" data-testid="rec-places">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" data-place={p.id} className={`w-full text-left px-1 ${p.id === placeId ? 'bg-emerald-600/60' : ''}`} onClick={() => setPlaceId(p.id)}>
                  {p.name}{p.names.length > 1 ? <span className="opacity-60"> · {p.names.filter((n) => n !== p.name).join(', ')}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" data-testid="rec-here" className={`${btn} bg-emerald-700/80`} disabled={!chosen} onClick={() => rec.markDoor(placeId)}>I&apos;m here{chosen ? `: ${chosen.name}` : ''}</button>
            <button type="button" data-testid="rec-done" className={btn} disabled={!snap.current} onClick={() => rec.doneDoor()}>Done / next door</button>
            <button type="button" data-testid="rec-undo" className={btn} disabled={snap.marks.length === 0} onClick={() => rec.undoMark()}>Undo mark</button>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" data-testid="rec-walk-start" className={btn} disabled={!chosen || !!snap.openWalkStart} onClick={() => rec.markWalk('start', placeId)}>Start of walk</button>
            <button type="button" data-testid="rec-walk-end" className={btn} disabled={!chosen || !snap.openWalkStart} onClick={() => rec.markWalk('end', placeId)}>End of walk</button>
            <span className="opacity-70 self-center">{snap.openWalkStart ? `walking from ${snap.openWalkStart.placeName}` : `${snap.marks.length} marks`}</span>
          </div>
          <button type="button" data-testid="rec-stop" className={`${btn} mt-2 bg-neutral-700`} onClick={stop}>Stop recording</button>
        </>
      )}

      {shown && (
        <div className="mt-2" data-testid="rec-report-panel">
          <p className="font-bold">Result · {shown.id}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre text-[9px]" data-testid="rec-report">{shown.text}</pre>
          <div className="flex gap-1">
            <button type="button" data-testid="rec-share" className={`${btn} bg-sky-700/80`} onClick={() => done(rec.share(shown.id), 'Share sheet opened.')}>Share</button>
            <button type="button" data-testid="rec-downloads" className={btn} onClick={() => done(rec.saveToDownloads(shown.id), 'Saved to Downloads/LOCUS.')}>Save to Downloads</button>
          </div>
        </div>
      )}

      {recoverable.length > 0 && (
        <div className="mt-2 p-1 bg-amber-500/20" data-testid="rec-recover">
          The app was closed in the middle of a recording:
          {recoverable.map((r) => (
            <button key={r.id} type="button" className={`${btn} ml-1`} onClick={async () => { const out = await rec.recover(r.id); setShown({ id: out.id, text: out.report.text }); refresh(); }}>
              Recover {r.id} ({r.estimates} estimates)
            </button>
          ))}
        </div>
      )}

      <details className="mt-2" data-testid="rec-previous">
        <summary>Previous recordings ({earlier.filter((r) => !r.active).length})</summary>
        <ul>
          {earlier.filter((r) => !r.active).map((r) => (
            <li key={r.id} className="py-0.5">
              {r.id} · {r.estimates} estimates{r.status !== 'done' ? ` · ${r.status}` : ''}
              <button type="button" className={`${btn} ml-1`} onClick={async () => setShown({ id: r.id, text: (await rec.report(r.id)).text })}>Result</button>
              <button type="button" className={`${btn} ml-1`} onClick={() => done(rec.share(r.id), 'Share sheet opened.')}>Share</button>
              <button type="button" className={`${btn} ml-1`} onClick={async () => { if (window.confirm(`Delete ${r.id}?`)) { await rec.remove(r.id); refresh(); } }}>Delete</button>
            </li>
          ))}
        </ul>
      </details>

      {note && <p className="mt-1" data-testid="rec-note">{note}</p>}
      {!rec.store.available && <p className="mt-1 text-amber-300">Files are only kept and shared inside the LOCUS Test app, not in a browser.</p>}
      <p className="mt-1 opacity-70">
        The files hold the Wi-Fi names and hardware addresses of campus access points (no account data, nothing is uploaded). Share them only with the team.
      </p>
    </div>
  );
}
