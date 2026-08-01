import React, { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { SRM_MASTER_DATABASE } from '../srmDatabase';
import LocationMarker from './LocationMarker';
import WaypointMarker from './WaypointMarker';
import BuildingMarker from './BuildingMarker';
import LeafletReactMarker from './LeafletReactMarker';
import { deriveMarkerStatus } from '../utils/markerStatus';

const DARK_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
};

const SATELLITE_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri',
};

const SRM_KTR_COORDS = { lat: 12.8237, lng: 80.0444 };

// MapContainer only applies `center`/`zoom` on the initial mount — it won't
// re-pan the live map if those props change afterward (e.g. handleFocus
// centering on a tapped marker). This keeps the imperative map in sync.
const ViewController = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (center?.lat != null && center?.lng != null) {
      map.setView([center.lat, center.lng], zoom, { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng, zoom]);
  return null;
};

const ClickHandler = ({ onMapClick }) => {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
};

/**
 * Fallback map engine used only when Google Maps fails to load (see App.jsx's
 * `mapEngineFailed` timeout). Deliberately reduced scope compared to the
 * primary google-map-react view — this covers navigation, squad/building
 * markers, and the rally point, but not the admin-only tactical-zone drawing
 * or path-recording tools, since this is an emergency fallback rather than a
 * second fully-featured map.
 */
const TacticalLeafletMap = ({
  center,
  zoom,
  onMapClick,
  onFocus,
  liveLocation,
  heading,
  liveSpeed,
  users,
  blockedUserIds,
  offlineNodes,
  activeTab,
  activeWaypoint,
  squadRole,
  onClearWaypoint,
  isSatellite,
}) => {
  const tiles = isSatellite ? SATELLITE_TILES : DARK_TILES;

  return (
    <MapContainer
      center={[center?.lat || SRM_KTR_COORDS.lat, center?.lng || SRM_KTR_COORDS.lng]}
      zoom={zoom || 17}
      zoomControl={false}
      className="w-full h-full bg-black"
    >
      <TileLayer url={tiles.url} attribution={tiles.attribution} />
      <ViewController center={center} zoom={zoom} />
      <ClickHandler onMapClick={onMapClick} />

      {liveLocation && (
        <LeafletReactMarker
          lat={liveLocation.lat}
          lng={liveLocation.lng}
          onClick={() => onFocus(liveLocation, null)}
        >
          <LocationMarker heading={heading} status={deriveMarkerStatus(liveSpeed)} color="#10B981" />
        </LeafletReactMarker>
      )}

      {activeTab === 'buildings' && SRM_MASTER_DATABASE.map((b) => (
        <LeafletReactMarker key={b.id} lat={b.lat} lng={b.lng} onClick={() => onFocus({ lat: b.lat, lng: b.lng }, b)}>
          <BuildingMarker />
        </LeafletReactMarker>
      ))}

      {activeWaypoint && (
        <LeafletReactMarker lat={activeWaypoint.lat} lng={activeWaypoint.lng}>
          <WaypointMarker
            name={activeWaypoint.name}
            onClick={() => onFocus(activeWaypoint, null)}
            canClear={squadRole === 'OWNER'}
            onClear={onClearWaypoint}
          />
        </LeafletReactMarker>
      )}

      {activeTab === 'users' && users
        .filter((u) => u.permission === 'accepted' && !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.lat && u.lng)
        .map((u) => (
          <LeafletReactMarker key={u.id} lat={u.lat} lng={u.lng} onClick={() => onFocus({ lat: u.lat, lng: u.lng }, null)}>
            <LocationMarker heading={u.heading} status={deriveMarkerStatus(u.speed / 3.6)} color="#EF4444" />
          </LeafletReactMarker>
        ))}

      {Object.values(offlineNodes).map((ghost) => (
        <LeafletReactMarker
          key={`ghost-${ghost.id}`}
          lat={ghost.lat}
          lng={ghost.lng}
          onClick={() => onFocus({ lat: ghost.lat, lng: ghost.lng }, { name: `LOST: ${ghost.name}`, info: `Last seen with ${ghost.battery} battery.` })}
        >
          <LocationMarker status="signal-lost" color="#A1A1AA" />
        </LeafletReactMarker>
      ))}
    </MapContainer>
  );
};

export default TacticalLeafletMap;
