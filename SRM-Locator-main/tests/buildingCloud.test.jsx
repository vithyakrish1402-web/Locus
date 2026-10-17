// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import BuildingCloud from '../src/components/BuildingCloud';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase';
import { runBackHandler } from '../src/utils/backHandlers';

afterEach(cleanup);
const [A, B] = SRM_MASTER_DATABASE;
const cardProps = { me: null, expanded: false, onToggleExpanded() {}, onNavigate() {}, onArScan() {}, onSetMeetingPoint: null, onShowOnMap() {} };
const mount = (place, extra = {}) => <BuildingCloud place={place} onDismiss={extra.onDismiss || (() => {})} cardProps={cardProps} {...extra} />;
const tapCloud = (name) => {
  const c = screen.getByRole('button', { name: `Open details for ${name}` });
  fireEvent.pointerDown(c); fireEvent.pointerUp(c); fireEvent.click(c); fireEvent.doubleClick(c);
};

describe('BuildingCloud', () => {
  it('shows a cloud first, never the sheet', () => {
    render(mount(A));
    expect(screen.getByTestId('building-cloud')).toBeTruthy();
    expect(screen.queryByTestId('location-card')).toBeNull();
  });
  it('a double-tap opens the sheet and does not reach the map', () => {
    const onMapDbl = vi.fn();
    render(<div onDoubleClick={onMapDbl}>{mount(A)}</div>);
    fireEvent.doubleClick(screen.getByTestId('building-cloud'));
    expect(onMapDbl).not.toHaveBeenCalled();
    return waitFor(() => expect(screen.getByTestId('location-card')).toBeTruthy());
  });
  it('Android Back collapses the sheet to the cloud; Close dismisses', async () => {
    const onDismiss = vi.fn();
    render(mount(A, { startOpen: true, onDismiss }));
    await waitFor(() => expect(screen.getByTestId('location-card')).toBeTruthy());
    act(() => { expect(runBackHandler()).toBe(true); });
    await waitFor(() => expect(screen.queryByTestId('location-card')).toBeNull());
    expect(screen.getByTestId('building-cloud')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByTestId('building-cloud'));
    await waitFor(() => screen.getByTestId('location-card'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it('a different building swaps the cloud, never two at once', async () => {
    const { rerender } = render(mount(A));
    rerender(mount(B));
    expect(screen.getAllByTestId('building-cloud')).toHaveLength(1);
    await screen.findByRole('button', { name: `Open details for ${B.name}` });
    expect(screen.getAllByTestId('building-cloud')).toHaveLength(1);
  });
});

describe('the cloud stays on its building', () => {
  it('moves with the map camera, and returns when the camera does', async () => {
    const { registerMapDriver } = await import('../src/utils/mapFocus');
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 });
    let view = { lat: A.lat, lng: A.lng, zoom: 19 };
    const off = registerMapDriver({ element: el, getView: () => view, setView() {} });
    try {
      render(mount(A));
      const node = () => screen.getByTestId('building-cloud').closest('div[style*="translate3d"]');
      await waitFor(() => expect(node()).toBeTruthy());
      const at = () => node().style.transform;
      const first = at();
      view = { ...view, lng: view.lng + 0.0005 }; // the map pans east: the building moves left on screen
      await waitFor(() => expect(at()).not.toBe(first));
      const x = (t) => Number(/translate3d\((-?\d+)px/.exec(t)[1]);
      expect(x(at())).toBeLessThan(x(first));
      view = { ...view, lng: A.lng };
      await waitFor(() => expect(at()).toBe(first));
    } finally { off(); }
  });
});

describe('the sheet', () => {
  it('has one scroller and one drag header, so scrolling and dragging never compete', async () => {
    render(mount(A, { startOpen: true }));
    const sheet = await screen.findByTestId('location-card');
    expect(sheet.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
    expect(sheet.querySelectorAll('.cursor-grab')).toHaveLength(1);
  });
});

describe('the sheet and the top chrome', () => {
  it('stays below the top bar and the stack under it, however tall that stack is', async () => {
    const bar = document.createElement('div'); bar.dataset.testid = 'top-bar';
    bar.getBoundingClientRect = () => ({ bottom: 70 });
    const stack = document.createElement('div'); stack.dataset.testid = 'map-top-stack';
    stack.getBoundingClientRect = () => ({ bottom: 182 });
    document.body.append(bar, stack);
    try {
      render(mount(A, { startOpen: true }));
      const sheet = await screen.findByTestId('location-card');
      await waitFor(() => expect(sheet.style.getPropertyValue('--sheet-h-sm')).toContain('192px'));
    } finally { bar.remove(); stack.remove(); }
  });
  it('has no bookmark control, only Back and Close', async () => {
    render(mount(A, { startOpen: true }));
    await screen.findByTestId('location-card');
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
