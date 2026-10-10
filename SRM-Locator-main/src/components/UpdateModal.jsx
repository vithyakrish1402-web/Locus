import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle, ArrowRight, Download, ShieldCheck } from 'lucide-react';
import { UpdateStatus } from '../hooks/useAppUpdate';
import { LAYER } from '../utils/layers';
import { Button } from './ui';
import { INSTALL_FAILURES, UPDATE, failureSentence } from '../copy/updates';

// The full app update (redesign P10). Two shapes, one component:
//
//   - optional update -> a sheet over whatever screen you are on, with Later
//   - [MANDATORY]     -> the whole screen, with no Later and no Escape: the same "there is
//                        exactly one way out" posture as the Emergency alert
//
// While downloading or installing there is no way to dismiss either shape (no Later, Escape
// blocked), as before. The design's Hide on the download sheet is on the Later list.
//
// LAYER.update (utils/layers.js): above everything in App.jsx, but deliberately below a
// received Emergency alert (LAYER.emergency) - a distress beacon outranks a version bump.

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const ProgressBar = ({ percent }) => {
  const indeterminate = typeof percent !== 'number' || percent < 0;
  return (
    <div
      className="h-2 w-full rounded-full bg-sunken overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': percent })}
    >
      {/* Full width, scaled from the left edge: a transform, not a width animation. */}
      <div
        className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-200"
        style={{ transform: `scaleX(${indeterminate ? 1 : Math.min(100, Math.max(0, percent)) / 100})`, opacity: indeterminate ? 0.4 : 1 }}
      />
    </div>
  );
};

const TONE = {
  accent: 'bg-accent-soft text-accent',
  warning: 'bg-warning-soft text-warning',
};

const UpdateModal = ({ update }) => {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef(null);
  const primaryRef = useRef(null);
  const { status, manifest, installedVersion, progress, error, mandatory, dismissed } = update;
  const busy = status === UpdateStatus.DOWNLOADING || status === UpdateStatus.READY;

  const visible =
    !dismissed &&
    Boolean(manifest || error) &&
    [
      UpdateStatus.AVAILABLE,
      UpdateStatus.PERMISSION_REQUIRED,
      UpdateStatus.DOWNLOADING,
      UpdateStatus.READY,
      UpdateStatus.ERROR,
    ].includes(status);

  // Focus the primary action on open and hand focus back on close, mirroring the Emergency
  // alert. Without this a keyboard or screen-reader user can Tab straight past a mandatory
  // gate into the app underneath, which is exactly what it exists to prevent.
  useEffect(() => {
    if (!visible) return undefined;
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [visible]);

  // Re-focus on every status change too: each state renders a different primary button (or
  // none while busy), so the previously focused node has been unmounted.
  useEffect(() => {
    if (visible) (primaryRef.current ?? panelRef.current)?.focus();
  }, [visible, status]);

  if (!visible) return null;

  const handleKeyDown = (event) => {
    // Escape closes an optional update only. A mandatory one has no dismiss path at
    // all - not Escape, not Back (see useBackButtonGuard in App.jsx), not tap-outside.
    if (event.key === 'Escape' && !mandatory && !busy) {
      event.stopPropagation();
      update.dismiss();
      return;
    }
    if (event.key !== 'Tab' || !mandatory) return;
    // Keep Tab inside the gate.
    const focusable = panelRef.current?.querySelectorAll('button:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const size = formatBytes(manifest?.apkSize);
  const failed = status === UpdateStatus.ERROR;
  const installFailure = failed && INSTALL_FAILURES.has(error?.code);

  // What this state shows: icon, title, sentence, and the actions under them.
  let icon = Download;
  let tone = 'accent';
  let title;
  let body;
  let actions = null;
  const later = !mandatory ? <Button variant="plain" block onClick={update.dismiss}>{UPDATE.available.later}</Button> : null;

  if (failed) {
    icon = AlertCircle;
    tone = 'warning';
    title = installFailure ? UPDATE.failed.installTitle : UPDATE.failed.checkTitle;
    body = failureSentence(error?.code);
    actions = (
      <>
        <Button ref={primaryRef} block size="large" onClick={update.startDownload} disabled={!manifest}>{UPDATE.failed.tryAgain}</Button>
        {!mandatory && <Button variant="plain" block onClick={update.dismiss}>{UPDATE.failed.later}</Button>}
      </>
    );
  } else if (status === UpdateStatus.PERMISSION_REQUIRED) {
    icon = ShieldCheck;
    title = UPDATE.permission.title;
    body = UPDATE.permission.body;
    actions = (
      <>
        <Button ref={primaryRef} block size="large" onClick={update.openInstallSettings}>{UPDATE.permission.open}</Button>
        {!mandatory && <Button variant="plain" block onClick={update.dismiss}>{UPDATE.permission.notNow}</Button>}
      </>
    );
  } else if (busy) {
    const ready = status === UpdateStatus.READY;
    title = mandatory ? UPDATE.mandatory.downloadingTitle : ready ? UPDATE.installing.title : UPDATE.downloading.title;
    body = mandatory ? UPDATE.mandatory.downloadingBody : ready ? UPDATE.installing.body : UPDATE.downloading.body;
  } else if (mandatory) {
    title = UPDATE.mandatory.title;
    body = UPDATE.mandatory.body;
    actions = <Button ref={primaryRef} block size="large" onClick={update.startDownload}>{UPDATE.available.update}</Button>;
  } else {
    title = UPDATE.available.title;
    body = UPDATE.available.body(manifest?.version, size);
    actions = (
      <>
        <Button ref={primaryRef} block size="large" onClick={update.startDownload}>{UPDATE.available.update}</Button>
        {later}
      </>
    );
  }

  const Icon = icon;
  const loaded = formatBytes(progress?.loaded);
  const total = formatBytes(progress?.total);
  const progressBlock = busy && (
    <div className="flex flex-col gap-2 w-full">
      <ProgressBar percent={status === UpdateStatus.READY ? 100 : progress.percent} />
      <div className="flex justify-between gap-3 text-secondary text-text-secondary">
        <span>
          {status === UpdateStatus.READY ? UPDATE.installing.progress : mandatory ? UPDATE.mandatory.progress : UPDATE.downloading.progress}
        </span>
        {status !== UpdateStatus.READY && loaded && total && <span>{UPDATE.downloading.amount(loaded, total)}</span>}
      </div>
    </div>
  );

  if (mandatory) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        data-testid="update-mandatory"
        className="fixed inset-0 flex flex-col bg-bg text-text font-ui px-5"
        style={{ zIndex: LAYER.update, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div ref={panelRef} tabIndex={-1} className="flex-1 flex flex-col max-w-md w-full mx-auto outline-none">
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <span className={`flex items-center justify-center w-22 h-22 rounded-full ${TONE[tone]}`} aria-hidden="true"><Icon size={40} /></span>
            <h2 id={titleId} className="text-display">{title}</h2>
            <p id={bodyId} className="text-body text-text-secondary">{body}</p>
            {manifest?.version && (
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 min-h-10 text-label text-text-secondary">
                {installedVersion && <>{installedVersion} <ArrowRight size={16} aria-hidden="true" /></>}
                <span className="text-text">{manifest.version}</span>
                {size && <span className="font-normal">· {size}</span>}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3 items-center">
            {progressBlock}
            {actions}
            <p className="text-secondary text-text-secondary text-center">{UPDATE.mandatory.emergencyNote}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={handleKeyDown}
      data-testid="update-sheet"
      className="fixed inset-0 flex items-end justify-center bg-backdrop"
      style={{ zIndex: LAYER.update }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-xl rounded-t-sheet bg-surface text-text font-ui shadow-[var(--shadow-3)] px-5 pt-3 flex flex-col gap-4 outline-none max-h-[90dvh] [@media(max-height:699px)]:max-h-[94dvh] overflow-y-auto"
        // Its buttons end above the Emergency button, which stands over this dialog.
        style={{ paddingBottom: 'var(--emergency-clearance)' }}
      >
        <span className="self-center w-9 h-1 rounded-full bg-border" aria-hidden="true" />
        <span className={`flex items-center justify-center w-14 h-14 rounded-full ${TONE[tone]}`} aria-hidden="true"><Icon size={26} /></span>
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-title">{title}</h2>
          <p id={bodyId} className="text-body text-text-secondary">{body}</p>
        </div>
        {status === UpdateStatus.AVAILABLE && manifest?.notes && (
          <pre className="font-ui text-body text-text whitespace-pre-wrap rounded-input bg-sunken px-4 py-3 max-h-52 overflow-y-auto">{manifest.notes}</pre>
        )}
        {progressBlock}
        {actions && <div className="flex flex-col gap-2">{actions}</div>}
      </div>
    </div>
  );
};

export default UpdateModal;
