import React, { useState } from 'react';
import { CATCH_UP_M } from '../../../scripts/lib/floor7PhoneWalk.mjs';
import { chipFor, resultsSummary } from '../../utils/floor7Guided.js';
import AdvancedSection from './AdvancedSection';
import { DevButton, Note, Page, ResultChip } from './ui';

const m1 = (v) => `${v.toFixed(1)} m`;

function walkLine(w) {
  const head = `${w.from} to ${w.to}`;
  if (!w.shown) return `${head}: no position was shown during the walk, so the lag cannot be scored.`;
  if (w.lagM <= CATCH_UP_M) return `${head}: at the end the dot was only ${m1(w.lagM)} behind you. It kept up.`;
  if (w.catchUpS === null) return `${head}: at the end the dot was ${m1(w.lagM)} behind you and had not caught up when the recording ended.`;
  return `${head}: at the end the dot was ${m1(w.lagM)} behind you. It caught up ${Math.round(w.catchUpS)} s later.`;
}

/**
 * Screen C: the result, in words first, then one row per door. `report` is what the recorder
 * made on Stop (doorRows, walkRows); the numbers are the recorder's, only presented here.
 */
export default function ResultsScreen({ id, report, trail = [], onShare, onDownloads, onAnother, onPrevious, onBack, backLabel = 'Back' }) {
  const [note, setNote] = useState('');
  const run = async (fn, ok) => {
    try { await fn(); setNote(ok); } catch (e) { setNote(`That did not work (${e?.code || e?.message || 'unknown'}).`); }
  };
  return (
    <Page
      title="Results"
      onBack={onBack}
      backLabel={backLabel}
      footer={onShare && (
        <>
          {note && <p role="status" data-testid="result-note">{note}</p>}
          <DevButton size="large" block onClick={() => run(onShare, 'The share sheet is open.')} data-testid="share-files">Share files</DevButton>
        </>
      )}
    >
      <p className="text-sm text-text-secondary break-words">{id}</p>
      <p className="text-xl font-semibold break-words" data-testid="summary">{resultsSummary(report.doorRows)}</p>

      <ul className="flex flex-col gap-2" aria-label="Result for each door" data-testid="result-rows">
        {report.doorRows.map((r) => {
          const chip = chipFor(r);
          return (
            <li key={`${r.door}-${r.from}`} className="rounded-xl border border-border bg-surface px-3 py-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold break-words min-w-0">{r.place.replace(/\s*\(.*\)\s*$/, '')}</span>
                <ResultChip tone={chip.tone}>{chip.label}</ResultChip>
              </div>
              {r.shown ? (
                <p className="text-sm break-words">Walking error <strong>{m1(r.walkM)}</strong>. Raw reading alone: {m1(r.rawWalkM)}.</p>
              ) : (
                <p className="text-sm break-words">No position was shown while you stood there.</p>
              )}
            </li>
          );
        })}
      </ul>

      {report.walkRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">The walk through the passage</h2>
          {report.walkRows.map((w) => <Note key={w.startAt}>{walkLine(w)}</Note>)}
        </section>
      )}

      <div className="flex flex-col gap-2">
        {onDownloads && <DevButton variant="secondary" block onClick={() => run(onDownloads, 'Saved to Downloads/LOCUS.')}>Save to Downloads</DevButton>}
        {onAnother && <DevButton variant="secondary" block onClick={onAnother} data-testid="another-walk">Start another walk</DevButton>}
        {onPrevious && <DevButton variant="secondary" block onClick={onPrevious}>Previous recordings</DevButton>}
      </div>
      <Note>These files hold the Wi-Fi names and hardware addresses of campus access points. Nothing is uploaded and there is no account data in them. Share them only with the team.</Note>
      <AdvancedSection trail={trail} />
    </Page>
  );
}
