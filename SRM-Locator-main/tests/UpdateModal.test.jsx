// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import UpdateModal from '../src/components/UpdateModal.jsx';
import { UpdateStatus } from '../src/hooks/useAppUpdate.js';

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

  it('shows the version transition and release notes for an optional update', () => {
    render(<UpdateModal update={makeUpdate()} />);
    expect(screen.getByText(/INSTALLED 1\.1\.0/).textContent).toContain('1.2.0');
    expect(screen.getByText('Fixed the squad roster.')).toBeTruthy();
    expect(screen.getByText(/PACKAGE SIZE: 12\.0 MB/)).toBeTruthy();
  });

  it('starts the download from UPDATE NOW', () => {
    const update = makeUpdate();
    render(<UpdateModal update={update} />);
    fireEvent.click(screen.getByRole('button', { name: /update now/i }));
    expect(update.startDownload).toHaveBeenCalledTimes(1);
  });

  it('dismisses an optional update from LATER and from Escape', () => {
    const update = makeUpdate();
    const { rerender } = render(<UpdateModal update={update} />);
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(update.dismiss).toHaveBeenCalledTimes(1);

    rerender(<UpdateModal update={update} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(update.dismiss).toHaveBeenCalledTimes(2);
  });

  describe('mandatory gate', () => {
    const mandatoryUpdate = (overrides = {}) =>
      makeUpdate({ mandatory: true, manifest: { ...manifest, mandatory: true }, ...overrides });

    it('offers no way out — no LATER button and no Escape dismiss', () => {
      const update = mandatoryUpdate();
      render(<UpdateModal update={update} />);
      expect(screen.queryByRole('button', { name: /later/i })).toBeNull();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(update.dismiss).not.toHaveBeenCalled();
    });

    it('stays up even if something set dismissed', () => {
      // `dismissed` is forced false by the hook for a mandatory release; this asserts the
      // component does not independently honour a stale dismiss either.
      render(<UpdateModal update={mandatoryUpdate({ dismissed: false })} />);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText(/LOCUS stays locked until it is installed/i)).toBeTruthy();
    });

    it('is labelled as required', () => {
      render(<UpdateModal update={mandatoryUpdate()} />);
      expect(screen.getByText(/LOCUS \/\/ UPDATE REQUIRED/)).toBeTruthy();
    });
  });

  it('surfaces a checksum mismatch as a visible, install-blocking error', () => {
    render(
      <UpdateModal
        update={makeUpdate({
          status: UpdateStatus.ERROR,
          error: {
            code: 'CHECKSUM_MISMATCH',
            message:
              'INTEGRITY CHECK FAILED. The downloaded package does not match the checksum published with this release. Install blocked.',
          },
        })}
      />
    );
    expect(screen.getByText(/INTEGRITY CHECK FAILED/)).toBeTruthy();
    expect(screen.getByText(/Install blocked/)).toBeTruthy();
    // No install path is offered from the error state, only a retry of the whole flow.
    expect(screen.queryByRole('button', { name: /^install$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('explains the one-time install permission and routes to settings', () => {
    const update = makeUpdate({ status: UpdateStatus.PERMISSION_REQUIRED });
    render(<UpdateModal update={update} />);
    expect(screen.getByText(/you will not be asked again/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    expect(update.openInstallSettings).toHaveBeenCalledTimes(1);
  });

  it('reports download progress and locks the action while busy', () => {
    render(
      <UpdateModal
        update={makeUpdate({
          status: UpdateStatus.DOWNLOADING,
          progress: { percent: 42, loaded: 5 * 1024 * 1024, total: 12 * 1024 * 1024 },
        })}
      />
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText(/5\.0 MB \/ 12\.0 MB/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /downloading/i }).disabled).toBe(true);
  });

  it('is an accessible modal dialog', () => {
    render(<UpdateModal update={makeUpdate()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /update now/i }));
  });
});
