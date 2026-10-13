import React, { useCallback, useEffect, useState } from 'react';
import { recorder } from '../../utils/floor7Recorder.js';
import { DevButton, Note, Page } from './ui';
import ResultsScreen from './ResultsScreen';

/** Earlier walks: see the result again, share, delete; and recover one the app was closed in. */
export default function PreviousRecordings({ rec = recorder, trail, onBack }) {
  const [list, setList] = useState(null);
  const [viewing, setViewing] = useState(null); // { id, report }
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(null);
  const [note, setNote] = useState('');
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    rec.recordings().then((all) => { if (live) setList(all.filter((r) => !r.active)); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [rec, reload]);

  if (viewing) {
    return (
      <ResultsScreen
        id={viewing.id}
        report={viewing.report}
        trail={trail}
        onBack={() => setViewing(null)}
        backLabel="Back to the list"
        onShare={() => rec.share(viewing.id)}
        onDownloads={() => rec.saveToDownloads(viewing.id)}
      />
    );
  }

  const guard = async (fn) => { try { await fn(); } catch (e) { setNote(`That did not work (${e?.code || e?.message || 'unknown'}).`); } };
  return (
    <Page title="Previous recordings" onBack={onBack}>
      {note && <Note role="status">{note}</Note>}
      {list === null && <p>Loading…</p>}
      {list?.length === 0 && <p data-testid="no-recordings">No earlier recordings on this phone.</p>}
      <ul className="flex flex-col gap-3" data-testid="recordings-list">
        {(list ?? []).map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-surface px-3 py-3 flex flex-col gap-2">
            <p className="font-semibold break-words">{new Date(r.startedAt).toLocaleString()}</p>
            <p className="text-sm text-text-secondary break-words">{r.id} · {r.estimates} estimates{r.status === 'recording' ? ' · the app was closed during this walk' : ''}</p>
            {confirming === r.id ? (
              <div className="flex flex-col gap-2">
                <p>Delete this recording from the phone?</p>
                <div className="flex flex-wrap gap-2">
                  <DevButton variant="secondary" onClick={() => guard(async () => { await rec.remove(r.id); setConfirming(null); refresh(); })}>Delete it</DevButton>
                  <DevButton variant="secondary" onClick={() => setConfirming(null)}>Keep it</DevButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {r.status === 'recording' ? (
                  <DevButton onClick={() => guard(async () => { const out = await rec.recover(r.id); refresh(); setViewing({ id: out.id, report: out.report }); })}>Recover it</DevButton>
                ) : (
                  <DevButton onClick={() => guard(async () => setViewing({ id: r.id, report: await rec.report(r.id) }))}>See result</DevButton>
                )}
                <DevButton variant="secondary" onClick={() => guard(() => rec.share(r.id))}>Share</DevButton>
                <DevButton variant="secondary" onClick={() => setConfirming(r.id)}>Delete</DevButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
