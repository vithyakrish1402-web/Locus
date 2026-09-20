import React, { useEffect, useId, useRef } from 'react';
import { UpdateStatus } from '../hooks/useAppUpdate';

// HUD panel for the full-APK self-updater. Two shapes, one component:
//
//   - optional update -> a dismissable panel over whatever screen you are on
//   - [MANDATORY]     -> a full-viewport takeover with no LATER and no Escape, the same
//                        "there is exactly one way out" posture as SosOverlay
//
// z-[10000]: above everything in App.jsx and level with LocusGuide's top layer, but
// deliberately below SosOverlay (10002) - a distress beacon outranks a version bump.

const CornerBrackets = () => (
  <>
    <div className="absolute top-0 left-0 w-2 h-2 bg-white" />
    <div className="absolute top-0 right-0 w-2 h-2 bg-white" />
    <div className="absolute bottom-0 left-0 w-2 h-2 bg-white" />
    <div className="absolute bottom-0 right-0 w-2 h-2 bg-white" />
  </>
);

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const HudButton = ({ variant = 'ghost', className = '', ...props }) => {
  const base =
    'font-dot text-xs tracking-widest uppercase px-5 py-3 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const skins = {
    primary: 'border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20',
    ghost: 'border-white/20 text-zinc-400 hover:border-white/40 hover:text-white',
  };
  return <button type="button" className={`${base} ${skins[variant]} ${className}`} {...props} />;
};

const ProgressBar = ({ percent }) => {
  const indeterminate = typeof percent !== 'number' || percent < 0;
  return (
    <div
      className="h-2 w-full border border-white/20 bg-black overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': percent })}
    >
      <div
        className="h-full bg-red-500 transition-[width] duration-200"
        style={{ width: indeterminate ? '100%' : `${Math.min(100, Math.max(0, percent))}%`, opacity: indeterminate ? 0.4 : 1 }}
      />
    </div>
  );
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

  // Focus the primary action on open and hand focus back on close, mirroring
  // SosOverlay. Without this a keyboard/screen-reader user can Tab straight past a
  // mandatory gate into the app underneath, which is exactly what it exists to prevent.
  useEffect(() => {
    if (!visible) return undefined;
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [visible]);

  // Re-focus on every status change too: each state renders a different primary button,
  // so the previously focused node has been unmounted and focus would fall back to
  // <body>, silently dropping the keyboard user out of the dialog.
  useEffect(() => {
    if (visible) primaryRef.current?.focus();
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

  const renderBody = () => {
    if (status === UpdateStatus.ERROR) {
      return (
        <p id={bodyId} className="font-inter text-[13px] leading-relaxed text-red-400">
          {error?.message}
        </p>
      );
    }
    if (status === UpdateStatus.PERMISSION_REQUIRED) {
      return (
        <p id={bodyId} className="font-inter text-[13px] leading-relaxed text-zinc-400">
          Android needs one-time permission to let LOCUS install its own updates. Enable
          &ldquo;Allow from this source&rdquo; on the next screen, then return here — the
          download resumes by itself, and you will not be asked again.
        </p>
      );
    }
    if (busy) {
      const loaded = formatBytes(progress.loaded);
      const total = formatBytes(progress.total);
      return (
        <div id={bodyId} className="space-y-3">
          <ProgressBar percent={status === UpdateStatus.READY ? 100 : progress.percent} />
          <p className="font-inter text-[12px] text-zinc-500">
            {status === UpdateStatus.READY
              ? 'INTEGRITY VERIFIED — handing off to the Android installer...'
              : `DOWNLOADING${loaded && total ? ` — ${loaded} / ${total}` : '...'}`}
          </p>
        </div>
      );
    }
    return (
      <div id={bodyId} className="space-y-3">
        {manifest?.notes ? (
          <pre className="font-inter text-[13px] leading-relaxed text-zinc-400 whitespace-pre-wrap max-h-52 overflow-y-auto">
            {manifest.notes}
          </pre>
        ) : (
          <p className="font-inter text-[13px] text-zinc-500">No release notes provided.</p>
        )}
        {size && <p className="font-dot text-[10px] tracking-widest text-zinc-600">PACKAGE SIZE: {size}</p>}
      </div>
    );
  };

  const renderActions = () => {
    if (status === UpdateStatus.ERROR) {
      return (
        <>
          <HudButton ref={primaryRef} variant="primary" onClick={update.startDownload} disabled={!manifest}>
            Retry
          </HudButton>
          {!mandatory && <HudButton onClick={update.dismiss}>Later</HudButton>}
        </>
      );
    }
    if (status === UpdateStatus.PERMISSION_REQUIRED) {
      return (
        <>
          <HudButton ref={primaryRef} variant="primary" onClick={update.openInstallSettings}>
            Grant access
          </HudButton>
          {!mandatory && <HudButton onClick={update.dismiss}>Later</HudButton>}
        </>
      );
    }
    if (busy) {
      return (
        <HudButton ref={primaryRef} variant="primary" disabled>
          {status === UpdateStatus.READY ? 'Installing' : 'Downloading'}
        </HudButton>
      );
    }
    return (
      <>
        <HudButton ref={primaryRef} variant="primary" onClick={update.startDownload}>
          Update now
        </HudButton>
        {!mandatory && <HudButton onClick={update.dismiss}>Later</HudButton>}
      </>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{ background: mandatory ? '#000000' : 'rgba(0,0,0,0.88)' }}
    >
      <div ref={panelRef} className="relative w-full max-w-lg border border-white/20 bg-black px-8 py-8">
        <CornerBrackets />
        <p className="absolute -top-2.5 left-5 bg-black px-2 font-dot text-[10px] tracking-widest text-red-500">
          {mandatory ? 'LOCUS // UPDATE REQUIRED' : 'LOCUS // UPDATE AVAILABLE'}
        </p>

        <h2 id={titleId} className="font-dot text-xl uppercase tracking-widest text-white">
          {mandatory ? 'Mandatory update' : 'New build available'}
        </h2>

        <p className="mt-2 font-dot text-[10px] tracking-widest text-zinc-600">
          {installedVersion ? `INSTALLED ${installedVersion}` : 'INSTALLED —'}
          {manifest?.version ? `  →  ${manifest.version}` : ''}
        </p>

        {mandatory && (
          <p className="mt-4 border border-red-500/40 bg-red-500/5 px-3 py-2 font-inter text-[12px] text-red-400">
            This release is required. LOCUS stays locked until it is installed.
          </p>
        )}

        <div className="mt-5 h-px bg-white/10" />
        <div className="mt-5">{renderBody()}</div>
        <div className="mt-7 flex flex-wrap gap-3">{renderActions()}</div>
      </div>
    </div>
  );
};

export default UpdateModal;
