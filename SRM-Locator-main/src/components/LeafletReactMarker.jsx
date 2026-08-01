import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

/**
 * Renders arbitrary React content (e.g. LocationMarker, WaypointMarker) as a
 * Leaflet marker, WITHOUT losing CSS transitions across updates.
 *
 * The naive approach — rebuilding an L.divIcon's `html` string from
 * ReactDOMServer on every prop change — replaces the marker's DOM node each
 * time, which kills LocationMarker's heading/pulse CSS transitions (there's
 * no "from" state left in the DOM to animate from). Instead this mounts a
 * single persistent React root onto the marker's own icon element once, then
 * just re-renders into it — the marker's DOM node (and therefore any CSS
 * transitions running on it) survives every update. Leaflet still owns
 * positioning that node on pan/zoom; we only call setLatLng when the
 * lat/lng actually changes.
 */
const LeafletReactMarker = ({ lat, lng, zIndexOffset, onClick, children }) => {
  const map = useMap();
  const markerRef = useRef(null);
  const rootRef = useRef(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const icon = L.divIcon({ className: 'leaflet-div-icon', html: '', iconSize: [0, 0] });
    const marker = L.marker([lat, lng], { icon, zIndexOffset, interactive: true }).addTo(map);
    marker.on('click', () => onClickRef.current && onClickRef.current());

    const el = marker.getElement();
    if (el) el.style.cursor = 'pointer';

    markerRef.current = marker;
    rootRef.current = el ? createRoot(el) : null;

    return () => {
      rootRef.current?.unmount();
      marker.remove();
    };
    // Marker is created once per mount; lat/lng/children updates are handled
    // by the effects below instead of tearing this down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    markerRef.current?.setLatLng([lat, lng]);
  }, [lat, lng]);

  // No dependency array on purpose: this must re-sync the persistent React
  // root with the latest `children` after every render of this component.
  useEffect(() => {
    rootRef.current?.render(children);
  });

  return null;
};

export default LeafletReactMarker;
