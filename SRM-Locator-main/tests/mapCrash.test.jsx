// @vitest-environment jsdom
//
// The "Cannot read properties of undefined (reading '_leaflet_pos')" crash (phone, 2026-10-25):
// something drove a Leaflet map that had already been removed. Leaflet's remove() deletes the
// map's panes but leaves the object usable-looking, and every move reads the deleted pane's
// position. Rendered for real (react-leaflet and Leaflet in jsdom), nothing about Leaflet mocked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act, renderHook } from '@testing-library/react';
import L from 'leaflet';
import TacticalLeafletMap from '../src/components/TacticalLeafletMap.jsx';
import { focusMapOn, cancelMapFocus } from '../src/utils/mapFocus.js';
import { useNavigationController } from '../src/hooks/useNavigationController.js';

// No network: the route request never answers.
vi.mock('../src/utils/routingProviders.js', () => ({ fetchPedestrianRoute: () => new Promise(() => {}) }));

afterEach(() => {
  cancelMapFocus();
  cleanup();
});

// Records what a crash below the map would have shown, without taking the test down.
class Catch extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError(error); }
  render() { return this.state.error ? null : this.props.children; }
}

const mapProps = {
  center: { lat: 12.8231, lng: 80.0442 }, zoom: 17,
  onZoomChange: () => {}, onMapClick: () => {}, onFocus: () => {},
  liveLocation: null, liveIsNavigating: false, liveHeading: 0, currentZoom: 17,
  users: [], blockedUserIds: [], ghostMembers: [], activeTab: 'users',
  activeWaypoint: null, walkingRoute: null, onArTrack: () => {},
  isSatellite: false, highlightBuildingId: null,
};

describe('closing the Leaflet map while it is gliding', () => {
  it('does not crash (the glide is stopped while the map is still alive)', () => {
    const errors = [];
    const Screen = ({ showMap }) => (
      <Catch onError={(e) => errors.push(e)}>
        {showMap && <div style={{ width: 400, height: 400 }}><TacticalLeafletMap {...mapProps} /></div>}
      </Catch>
    );
    const { rerender } = render(<Screen showMap />);
    // A building tap, a rally notice or an SOS sender: the 1.8 s glide.
    act(() => { expect(focusMapOn({ lat: 12.8245, lng: 80.0455, zoom: 19 })).toBe(true); });
    // The map screen goes away mid-glide (leaving the group, the update gate, signing out).
    rerender(<Screen showMap={false} />);
    expect(errors.map(String)).toEqual([]);
  });

  it('tells App.jsx the map is gone, so nothing keeps a removed map', () => {
    const onMapInstance = vi.fn();
    const { unmount } = render(<div style={{ width: 400, height: 400 }}><TacticalLeafletMap {...mapProps} onMapInstance={onMapInstance} /></div>);
    expect(onMapInstance).toHaveBeenLastCalledWith(expect.any(L.Map));
    unmount();
    expect(onMapInstance).toHaveBeenLastCalledWith(null);
  });
});

// App.jsx hands navigation the visible map. One that has been removed (its engine unmounted, and
// App.jsx still holding it for a render) must be left alone, not panned, flown or turned.
describe('navigation with a map that has been removed', () => {
  const removedLeafletMap = () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const map = L.map(el, { rotate: true, touchRotate: false }).setView([12.8231, 80.0442], 17);
    map.remove();
    el.remove(); // React takes the container off the page when the engine unmounts
    return map;
  };

  it('does not crash starting navigation, following the walker, or ending it', () => {
    const map = removedLeafletMap();
    const props = {
      isNavigating: true, destination: { lat: 12.8245, lng: 80.0455, name: 'Tech Park' },
      liveLocation: { lat: 12.8231, lng: 80.0442 }, liveHeading: 90, speedMps: 1.2,
      mapEngine: 'leaflet', mapInstance: map,
    };
    const { result, rerender } = renderHook((p) => useNavigationController(p), { initialProps: props });
    act(() => { result.current.handleRecenter(); });
    rerender({ ...props, liveLocation: { lat: 12.8233, lng: 80.0444 } });
    rerender({ ...props, isNavigating: false });
  });

  it('stops following the walker once the map it was following is removed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const map = L.map(el, { rotate: true, touchRotate: false }).setView([12.8231, 80.0442], 17);
    const props = {
      isNavigating: true, destination: { lat: 12.8245, lng: 80.0455, name: 'Tech Park' },
      liveLocation: { lat: 12.8231, lng: 80.0442 }, liveHeading: 90, speedMps: 1.2,
      mapEngine: 'leaflet', mapInstance: map,
    };
    const { result, rerender } = renderHook((p) => useNavigationController(p), { initialProps: props });
    act(() => { result.current.handleRecenter(); }); // following
    map.stop();
    map.remove();
    el.remove();
    rerender({ ...props, liveLocation: { lat: 12.8233, lng: 80.0444 } });
  });
});
