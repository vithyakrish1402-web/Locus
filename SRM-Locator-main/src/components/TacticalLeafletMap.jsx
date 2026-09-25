import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { SRM_MASTER_DATABASE } from '../srmDatabase';
import LiveLocationMarker, { NAVIGATING_SPEED_MPS } from '../LiveLocationMarker';
import { ConfidenceHalo, FloorTag } from './IndoorMarkers';
import { SHOW_INDOOR_POSITION_TO_SQUAD, WIFI_POSITIONING_ENABLED } from '../utils/positionSource';
import { isOnOtherFloor, memberFloorTag } from '../utils/indoorView';
import GhostMemberMarker from '../GhostMemberMarker';
import WaypointMarker from './WaypointMarker';
import BuildingMarker from './BuildingMarker';
import LeafletReactMarker from './LeafletReactMarker';
import { getProjectionSegments, GHOST_FADE_MS } from '../utils/ghostProjection';

// This engine exists precisely because there is no Google Maps key (see App.jsx's
// mapEngineFailed / the "keyless Leaflet/OSM engine" warning), so its own basemap must
// not need a key either. It used to pull CARTO's dark basemap from
// basemaps.cartocdn.com, which CARTO now stamps with an "API KEY REQUIRED" watermark
// diagonally across every tile served to an unregistered caller — so the fallback
// advertised as keyless was quietly rendering a watermarked map.
//
// OpenStreetMap's standard raster tiles need no key and go to z19, but they're light.
// The `locus-dark-tiles` filter in index.css inverts them into the dark tactical palette
// client-side, so the look survives without a paid basemap account.
const OSM_DARK_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  className: 'locus-dark-tiles',
  maxNativeZoom: 19,
};

// Escape hatch for a keyed provider (CARTO, Stadia, Mapbox, a self-hosted server…):
// set VITE_MAP_TILE_URL to that provider's full {z}/{x}/{y} template, key and all. No
// provider's key parameter is hardcoded here, because they all differ — paste whichever
// URL your account gives you. A real dark basemap needs no inversion, so the filter
// class is dropped automatically when an override is in play.
const CUSTOM_TILE_URL = import.meta.env.VITE_MAP_TILE_URL || '';

const DARK_TILES = CUSTOM_TILE_URL
  ? {
      url: CUSTOM_TILE_URL,
      attribution: import.meta.env.VITE_MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors',
      className: undefined,
      maxNativeZoom: undefined,
    }
  : OSM_DARK_TILES;

const SATELLITE_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri',
  className: undefined,
  maxNativeZoom: 19,
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
  liveIndoor,
  indoorView,
  liveIsNavigating,
  liveHeading,
  currentZoom,
  users,
  blockedUserIds,
  ghostMembers,
  activeTab,
  activeWaypoint,
  walkingRoute,
  canClearWaypoint,
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
      <TileLayer
        key={tiles.url}
        url={tiles.url}
        attribution={tiles.attribution}
        className={tiles.className}
        maxNativeZoom={tiles.maxNativeZoom}
        maxZoom={21}
      />
      <ViewController center={center} zoom={zoom} />
      <ClickHandler onMapClick={onMapClick} />
      <ZoomTracker onZoomChange={onZoomChange} />

      {liveLocation && (
        <LeafletReactMarker
          lat={liveLocation.lat}
          lng={liveLocation.lng}
          onClick={() => onFocus(liveLocation, null)}
        >
          {/* The wrapper gives the halo a positioned parent at the anchor; see IndoorMarkers. */}
          <div style={{ position: 'relative' }}>
            {WIFI_POSITIONING_ENABLED && liveIndoor && <ConfidenceHalo confidence={liveIndoor.confidence} color="#10B981" />}
            <LiveLocationMarker zoom={currentZoom} isNavigating={liveIsNavigating} heading={liveHeading} color="#10B981" />
          </div>
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
            canClear={canClearWaypoint}
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

      {/* Same filter as the Google engine — see App.jsx's matching comment for why
          `permission` is not part of it and why this isn't gated on activeTab. */}
      {users
        .filter((u) => !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.hasFix)
        .map((u) => (
          <LeafletReactMarker key={u.id} lat={u.lat} lng={u.lng} onClick={() => onFocus({ lat: u.lat, lng: u.lng }, null)}>
            <div
              style={{
                position: 'relative',
                animation: 'locus-member-fade-in 0.6s ease',
                ...(SHOW_INDOOR_POSITION_TO_SQUAD && isOnOtherFloor(u, indoorView) ? { opacity: 0.35 } : {}),
              }}
            >
              <LiveLocationMarker
                zoom={currentZoom}
                isNavigating={Boolean(activeWaypoint) || (u.speed / 3.6) > NAVIGATING_SPEED_MPS}
                heading={u.heading}
                color="#EF4444"
              />
              {SHOW_INDOOR_POSITION_TO_SQUAD && memberFloorTag(u) && <FloorTag text={memberFloorTag(u)} color="#EF4444" />}
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
