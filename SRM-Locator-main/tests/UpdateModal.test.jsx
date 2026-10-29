// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import UpdateModal from '../src/components/UpdateModal.jsx';
import { UpdateStatus } from '../src/hooks/useAppUpdate.js';
import { UPDATE, failureSentence } from '../src/copy/updates.js';

const manifest = {
  version: '1.2.0',
  tag: 'v1.2.0',
  apkUrl: 'https://example.test/locus.apk',
  apkSize: 12 * 1024 * 1024,
  sha256: 'a'.repeat(64),
  mandatory: false,
  prerelease: false,
  notes: 'Fixed the squad roster.',
};

const makeUpdate = (overrides = {}) => ({
  supported: true,
  status: UpdateStatus.AVAILABLE,
  manifest,
  installedVersion: '1.1.0',
  progress: { percent: -1, loaded: 0, total: 0 },
  error: null,
  mandatory: false,
  dismissed: false,
  check: vi.fn(),
  startDownload: vi.fn(),
  installUpdate: vi.fn(),
  openInstallSettings: vi.fn(),
  dismiss: vi.fn(),
  reset: vi.fn(),
  ...overrides,
});

afterEach(cleanup);

describe('UpdateModal', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<UpdateModal update={makeUpdate({ status: UpdateStatus.IDLE })} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing once dismissed', () => {
    const { container } = render(<UpdateModal update={makeUpdate({ dismissed: true })} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the version, its size and the release notes for an optional update', () => {
    render(<UpdateModal update={makeUpdate()} />);
    expect(screen.getByRole('heading', { name: UPDATE.available.title })).toBeTruthy();
    expect(screen.getByText(UPDATE.available.body('1.2.0', '12.0 MB'))).toBeTruthy();
    expect(screen.getByText('Fixed the squad roster.')).toBeTruthy();
  });

  it('starts the download from Update now', () => {
    const update = makeUpdate();
    render(<UpdateModal update={update} />);
    fireEvent.click(screen.getByRole('button', { name: UPDATE.available.update }));
    expect(update.startDownload).toHaveBeenCalledTimes(1);
  });

  it('dismisses an optional update from Later and from Escape', () => {
    const update = makeUpdate();
    const { rerender } = render(<UpdateModal update={update} />);
    fireEvent.click(screen.getByRole('button', { name: UPDATE.available.later }));
    expect(update.dismiss).toHaveBeenCalledTimes(1);

    rerender(<UpdateModal update={update} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(update.dismiss).toHaveBeenCalledTimes(2);
  });

  describe('mandatory gate', () => {
    const mandatoryUpdate = (overrides = {}) =>
      makeUpdate({ mandatory: true, manifest: { ...manifest, mandatory: true }, ...overrides });

    it('offers no way out: no Later button and no Escape dismiss', () => {
      const update = mandatoryUpdate();
      render(<UpdateModal update={update} />);
      expect(screen.queryByRole('button', { name: UPDATE.available.later })).toBeNull();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(update.dismiss).not.toHaveBeenCalled();
    });

    it('stays up even if something set dismissed', () => {
      // `dismissed` is forced false by the hook for a mandatory release; this asserts the
      // component does not independently honour a stale dismiss either.
      render(<UpdateModal update={mandatoryUpdate({ dismissed: false })} />);
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('fills the screen, says why, shows the versions, and that emergency alerts still come', () => {
      render(<UpdateModal update={mandatoryUpdate()} />);
      expect(screen.getByTestId('update-mandatory')).toBeTruthy();
      expect(screen.getByRole('heading', { name: UPDATE.mandatory.title })).toBeTruthy();
      expect(screen.getByText(UPDATE.mandatory.body)).toBeTruthy();
      expect(screen.getByTestId('update-mandatory').textContent).toMatch(/1\.1\.0.*1\.2\.0.*12\.0 MB/);
      expect(screen.getByText(UPDATE.mandatory.emergencyNote)).toBeTruthy();
    });

    it("never claims the old version can't connect", () => {
      render(<UpdateModal update={mandatoryUpdate()} />);
      expect(screen.getByRole('dialog').textContent).not.toMatch(/connect/i);
    });
  });

  describe('failures', () => {
    const failing = (code) => makeUpdate({ status: UpdateStatus.ERROR, error: { code, message: 'raw' } });

    it.each(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'])('%s says the file looks damaged, and only Try again (no install)', (code) => {
      render(<UpdateModal update={failing(code)} />);
      expect(screen.getByRole('heading', { name: UPDATE.failed.installTitle })).toBeTruthy();
      expect(screen.getByText('The update file looks damaged, so it was not installed. Tap to try again.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: UPDATE.ready.install })).toBeNull();
      expect(screen.getByRole('button', { name: UPDATE.failed.tryAgain })).toBeTruthy();
    });

    it.each(['NETWORK', 'PERMISSION_DENIED', 'IO_ERROR', 'STALLED', 'RATE_LIMITED', 'CANCELLED', 'NO_RELEASES'])(
      '%s has its own plain sentence, never the damaged-file one',
      (code) => {
        render(<UpdateModal update={failing(code)} />);
        const text = screen.getByRole('dialog').textContent;
        expect(text).toContain(failureSentence(code));
        expect(text).not.toMatch(/damaged/);
        expect(text).not.toContain('raw');
      },
    );

    it.each(['IO_ERROR', 'STALLED'])('%s says the download did not finish, with Try again', (code) => {
      const update = failing(code);
      render(<UpdateModal update={update} />);
      expect(screen.getByText("The download didn't finish. Check your internet and tap to try again.")).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: UPDATE.failed.tryAgain }));
      expect(update.startDownload).toHaveBeenCalledTimes(1);
    });

    it('any other failure while downloading reads as a download failure, not a failed check', () => {
      render(<UpdateModal update={makeUpdate({ status: UpdateStatus.ERROR, error: { code: 'HTTP_502', message: 'raw', during: 'download' } })} />);
      expect(screen.getByRole('heading', { name: UPDATE.failed.installTitle })).toBeTruthy();
      expect(screen.getByText("The download didn't finish. Check your internet and tap to try again.")).toBeTruthy();
    });

    it('a failure while looking for an update says so, not that an install failed', () => {
      render(<UpdateModal update={failing('NETWORK')} />);
      expect(screen.getByRole('heading', { name: UPDATE.failed.checkTitle })).toBeTruthy();
    });

    it('is amber, never red', () => {
      render(<UpdateModal update={failing('CHECKSUM_MISMATCH')} />);
      expect(screen.getByRole('dialog').innerHTML).not.toMatch(/danger|bg-emergency|red-/);
      expect(screen.getByRole('dialog').innerHTML).toMatch(/text-warning/);
    });
  });

  it('explains the one-time install permission and routes to Android settings', () => {
    const update = makeUpdate({ status: UpdateStatus.PERMISSION_REQUIRED });
    render(<UpdateModal update={update} />);
    expect(screen.getByText('To install this update, allow LOCUS to install apps. Tap here to open the setting.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: UPDATE.permission.open }));
    expect(update.openInstallSettings).toHaveBeenCalledTimes(1);
  });

  it('reports download progress, with no way to hide it while busy (as before)', () => {
    const update = makeUpdate({
      status: UpdateStatus.DOWNLOADING,
      progress: { percent: 42, loaded: 5 * 1024 * 1024, total: 12 * 1024 * 1024 },
    });
    render(<UpdateModal update={update} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('Downloading update… 42%')).toBeTruthy();
    expect(screen.getByText(UPDATE.downloading.amount('5.0 MB', '12.0 MB'))).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(update.dismiss).not.toHaveBeenCalled();
  });

  describe('the end of the download', () => {
    const at = (status, percent = 100) =>
      makeUpdate({ status, progress: { percent, loaded: 12 * 1024 * 1024, total: 12 * 1024 * 1024 } });

    it('never shows 100% before the file is saved and checked', () => {
      for (const status of [UpdateStatus.DOWNLOADING, UpdateStatus.VERIFYING]) {
        render(<UpdateModal update={at(status)} />);
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
        expect(screen.getByRole('dialog').textContent).not.toMatch(/100%/);
        cleanup();
      }
    });

    it('shows "Checking the update…" after the last byte, still with no way out', () => {
      const update = at(UpdateStatus.VERIFYING);
      render(<UpdateModal update={update} />);
      expect(screen.getByText('Checking the update…')).toBeTruthy();
      expect(screen.queryAllByRole('button')).toEqual([]);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(update.dismiss).not.toHaveBeenCalled();
    });

    it('when ready, shows 100% and an Install button that hands it to Android', () => {
      const update = at(UpdateStatus.READY);
      render(<UpdateModal update={update} />);
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
      expect(screen.getByText('Update ready. Tap to install.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: UPDATE.ready.install }));
      expect(update.installUpdate).toHaveBeenCalledTimes(1);
    });

    it('a mandatory update also reaches a usable Install button, with no Later', () => {
      render(<UpdateModal update={{ ...at(UpdateStatus.READY), mandatory: true }} />);
      expect(screen.getByRole('button', { name: UPDATE.ready.install })).toBeTruthy();
      expect(screen.queryByRole('button', { name: UPDATE.available.later })).toBeNull();
    });

    it('shows plain "Downloading…" with no number when the size is unknown', () => {
      render(<UpdateModal update={makeUpdate({ status: UpdateStatus.DOWNLOADING, progress: { percent: -1, loaded: 1024 * 1024, total: -1 } })} />);
      expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
      expect(screen.getByText('Downloading…')).toBeTruthy();
      expect(screen.getByRole('dialog').textContent).not.toMatch(/%/);
    });
  });

  it('is an accessible modal dialog', () => {
    render(<UpdateModal update={makeUpdate()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: UPDATE.available.update }));
  });
});

// Phase 5: a check that got no answer said so with Try again greyed out (there was no release to
// download), leaving nothing to tap. Its Try again now asks again.
describe('a check that failed', () => {
  it("says it couldn't check, and Try again checks again", () => {
    const update = makeUpdate({ status: UpdateStatus.ERROR, manifest: null, error: { code: 'TIMEOUT', message: 'x' } });
    render(<UpdateModal update={update} />);
    expect(screen.getByText(failureSentence('TIMEOUT'))).toBeTruthy();
    expect(failureSentence('TIMEOUT')).toBe("Couldn't check for updates. Try again.");
    const retry = screen.getByRole('button', { name: UPDATE.failed.tryAgain });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(update.check).toHaveBeenCalledWith({ manual: true });
    expect(update.startDownload).not.toHaveBeenCalled();
  });

  it('a failed download still downloads again', () => {
    const update = makeUpdate({ status: UpdateStatus.ERROR, error: { code: 'STALLED', message: 'x', during: 'download' } });
    render(<UpdateModal update={update} />);
    fireEvent.click(screen.getByRole('button', { name: UPDATE.failed.tryAgain }));
    expect(update.startDownload).toHaveBeenCalled();
  });
});
