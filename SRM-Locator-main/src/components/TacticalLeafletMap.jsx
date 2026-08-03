import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { SRM_MASTER_DATABASE } from '../srmDatabase';
import LiveLocationMarker, { NAVIGATING_SPEED_MPS } from '../LiveLocationMarker';
import GhostMemberMarker from '../GhostMemberMarker';
import WaypointMarker from './WaypointMarker';
import BuildingMarker from './BuildingMarker';
import LeafletReactMarker from './LeafletReactMarker';
import { getProjectionSegments, GHOST_FADE_MS } from '../utils/ghostProjection';

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

// Reports the map's actual live zoom back up so LiveLocationMarker's
// near/far state tracks real pinch/scroll zoom, not just the last zoom we
// programmatically requested.
const ZoomTracker = ({ onZoomChange }) => {
  useMapEvents({
    zoomend(e) {
      onZoomChange?.(e.target.getZoom());
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
  onZoomChange,
  onMapClick,
  onFocus,
  liveLocation,
  liveIsNavigating,
  liveHeading,
  currentZoom,
  users,
  blockedUserIds,
  ghostMembers,
  activeTab,
  activeWaypoint,
  walkingRoute,
  squadRole,
  onClearWaypoint,
  onArTrack,
  isSatellite,
  highlightBuildingId,
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
      <ZoomTracker onZoomChange={onZoomChange} />

      {liveLocation && (
        <LeafletReactMarker
          lat={liveLocation.lat}
          lng={liveLocation.lng}
          onClick={() => onFocus(liveLocation, null)}
        >
          <LiveLocationMarker zoom={currentZoom} isNavigating={liveIsNavigating} heading={liveHeading} color="#10B981" />
        </LeafletReactMarker>
      )}

      {activeTab === 'buildings' && SRM_MASTER_DATABASE.map((b) => (
        <LeafletReactMarker key={b.id} lat={b.lat} lng={b.lng} onClick={() => onFocus({ lat: b.lat, lng: b.lng }, b)}>
          <BuildingMarker highlighted={highlightBuildingId === b.id} />
        </LeafletReactMarker>
      ))}

      {activeWaypoint && (
        <LeafletReactMarker lat={activeWaypoint.lat} lng={activeWaypoint.lng}>
          <WaypointMarker
            name={activeWaypoint.name}
            onClick={() => onFocus(activeWaypoint, null)}
            canClear={squadRole === 'OWNER'}
            onClear={onClearWaypoint}
            onTrack={() => onArTrack({ lat: activeWaypoint.lat, lng: activeWaypoint.lng, name: activeWaypoint.name })}
          />
        </LeafletReactMarker>
      )}

      {/* Live walking route to the active waypoint — react-leaflet renders this
          declaratively, unlike the Google engine which needs an imperative
          Polyline (see App.jsx's useWaypointNavigationLine). walkingRoute is
          computed once in App.jsx (useWalkingRoute) and shared with the
          Google engine so there's a single throttling clock, not two.
          Sparser/lighter dash when it's the straight-line "best effort"
          fallback rather than a real routed path, so it visually reads as
          less certain. */}
      {walkingRoute && (
        <Polyline
          positions={walkingRoute.path.map((p) => [p.lat, p.lng])}
          pathOptions={
            walkingRoute.isRealRoute
              ? { color: '#EF4444', dashArray: '6 8', weight: 2, opacity: 0.8 }
              : { color: '#EF4444', dashArray: '2 12', weight: 2, opacity: 0.45 }
          }
        />
      )}

      {/* Not gated on activeTab — see App.jsx's matching comment on the Google engine. */}
      {users
        .filter((u) => u.permission === 'accepted' && !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.lat && u.lng)
        .map((u) => (
          <LeafletReactMarker key={u.id} lat={u.lat} lng={u.lng} onClick={() => onFocus({ lat: u.lat, lng: u.lng }, null)}>
            <div style={{ animation: 'locus-member-fade-in 0.6s ease' }}>
              <LiveLocationMarker
                zoom={currentZoom}
                isNavigating={Boolean(activeWaypoint) || (u.speed / 3.6) > NAVIGATING_SPEED_MPS}
                heading={u.heading}
                color="#EF4444"
              />
            </div>
          </LeafletReactMarker>
        ))}

      {ghostMembers.flatMap((ghost) => {
        if (ghost.phase === 'expired') return [];
        return getProjectionSegments(ghost.lastKnownLocation, ghost.position).map((segment, i) => (
          <Polyline
            key={`ghost-line-${ghost.id}-${i}`}
            positions={[[segment.from.lat, segment.from.lng], [segment.to.lat, segment.to.lng]]}
            pathOptions={{ color: '#A1A1AA', opacity: segment.opacity, weight: 2, dashArray: '4 6' }}
          />
        ));
      })}

      {ghostMembers.map((ghost) => (
        <LeafletReactMarker
          key={`ghost-${ghost.id}`}
          lat={ghost.position.lat}
          lng={ghost.position.lng}
          onClick={() => onFocus(ghost.position, { name: `${ghost.phase === 'expired' ? 'LAST KNOWN' : 'SIGNAL LOST'}: ${ghost.name}`, info: `Last seen with ${ghost.battery ?? 0}% battery.` })}
        >
          <div style={{ opacity: ghost.fading ? 0 : 1, transition: `opacity ${GHOST_FADE_MS}ms ease` }}>
            <GhostMemberMarker phase={ghost.phase} elapsedLabel={ghost.elapsedLabel} color="#A1A1AA" />
          </div>
        </LeafletReactMarker>
      ))}
    </MapContainer>
  );
};

export default TacticalLeafletMap;
