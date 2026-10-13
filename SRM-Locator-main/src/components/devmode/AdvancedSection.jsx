import React from 'react';
import floor7Aps from '../../data/floor7Aps.json';
import { CONSTANTS } from '../../utils/floor7Recorder.js';
import { radioFlags, radioLabel } from '../../utils/floor7RadioLayout.js';

/**
 * Everything technical, closed until asked for: the names of the marks, the access point list,
 * the constants in force, and the details of the latest estimates. Plain text, 14 px or more.
 */
export default function AdvancedSection({ trail = [] }) {
  const recent = trail.slice(-20).reverse();
  return (
    <details className="rounded-xl border border-border bg-surface" data-testid="advanced">
      <summary className="min-h-12 px-4 py-3 flex items-center cursor-pointer font-semibold text-base">Advanced details</summary>
      <div className="px-4 pb-4 flex flex-col gap-5 text-sm">
        <section>
          <h3 className="text-base font-semibold mb-1">What the marks are called in the files</h3>
          <ul className="list-disc pl-5">
            <li><strong>door</strong>: you tapped I&apos;m here at a door.</li>
            <li><strong>walk_start</strong> and <strong>walk_end</strong>: Start of walk and End of walk in the middle passage.</li>
          </ul>
        </section>
        <section>
          <h3 className="text-base font-semibold mb-1">Constants in force</h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            {Object.entries(CONSTANTS).map(([k, v]) => (
              <React.Fragment key={k}><dt className="break-words">{k}</dt><dd className="text-right">{String(v)}</dd></React.Fragment>
            ))}
          </dl>
        </section>
        <section>
          <h3 className="text-base font-semibold mb-1">Latest estimates</h3>
          {recent.length === 0 ? <p>None yet.</p> : (
            <ul className="flex flex-col gap-1">
              {recent.map((t) => (
                <li key={t.at} className="break-words">
                  {new Date(t.at).toLocaleTimeString()}: {t.status}{t.filtered ? '' : ', no position shown'}, about {t.uncertaintyM.toFixed(1)} m sure
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-base font-semibold mb-1">Access points ({floor7Aps.radios.length})</h3>
          <p className="mb-1">Each is named by the last two bytes of its address. They are the Wi-Fi hardware addresses of campus access points.</p>
          <ul className="flex flex-col gap-1">
            {floor7Aps.radios.map((r) => (
              <li key={r.radio} className="break-words">
                <strong>{radioLabel(r.radio)}</strong> {r.place ?? r.tie?.join(' + ') ?? 'by hand'}
                {radioFlags(r).length > 0 && <span> ({radioFlags(r).join(', ')})</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
