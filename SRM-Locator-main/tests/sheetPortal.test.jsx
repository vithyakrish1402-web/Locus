// @vitest-environment jsdom
//
// A bottom sheet is drawn into document.body, not inside whatever opened it. Opened from within
// Settings (a scrolling screen whose sections carry a transform), a sheet that stayed inside
// was placed against that section and scrolled away with the content instead of rising from
// the bottom of the screen.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Sheet from '../src/components/ui/Sheet.jsx';

afterEach(cleanup);

describe('Sheet', () => {
  it('is drawn into document.body, outside the scrolling, transformed section that opened it', () => {
    const { container } = render(
      <div data-testid="section" style={{ transform: 'translateY(0)', overflowY: 'auto' }}>
        <Sheet open onClose={() => {}} label="Share your location">
          <p>Body</p>
        </Sheet>
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Share your location' });
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    // Its fixed layer hangs straight off the body.
    expect(dialog.closest('.fixed').parentElement).toBe(document.body);
  });

  it('leaves nothing behind in the body once closed', () => {
    const { rerender } = render(<Sheet open onClose={() => {}} label="Hello"><p>Body</p></Sheet>);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    rerender(<Sheet open={false} onClose={() => {}} label="Hello"><p>Body</p></Sheet>);
    cleanup();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
