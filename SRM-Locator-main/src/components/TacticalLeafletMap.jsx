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
import MemberMarker from './MemberMarker';
import { getProjectionSegments, GHOST_FADE_MS } from '../utils/ghostProjection';
import { registerMapDriver } from '../utils/mapFocus';
import { ROUTE_CASING_WIDTH, ROUTE_WIDTH, ROUTE_COLOR, ROUTE_CASING_COLOR } from '../hooks/useWaypointNavigationLine';

// This engine exists precisely because there is no Google Maps key (see App.jsx's
// mapEngineFailed / the "keyless Leaflet/OSM engine" warning), so its own basemap must
// not need a key either. It used to pull CARTO's dark basemap from
// basemaps.cartocdn.com, which CARTO now stamps with an "API KEY REQUIRED" watermark
// diagonally across every tile served to an unregistered caller — so the fallback
// advertised as keyless was quietly rendering a watermarked map.
//
// OpenStreetMap's standard raster tiles need no key and go to z19. The `locus-map-tiles`
// filter in index.css calms them in the light theme and inverts them into the app's dark
// map colours in the dark theme (it follows <html data-theme>), so both looks survive
// without a paid basemap account.
const OSM_DARK_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  className: 'locus-map-tiles',
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

// Hands the shared glide (utils/mapFocus.js) this map's own animated move.
const FocusDriver = ({ onMapInstance, onUserInteraction, active = true }) => {
  const map = useMap();
  useEffect(() => {
    onMapInstance?.(map);
  }, [map, onMapInstance]);
  // The camera driver belongs to the visible map: this one steps aside while Google shows.
  useEffect(() => {
    if (!active) return undefined;
    return registerMapDriver({
      element: map.getContainer(),
      getView: () => ({ ...map.getCenter(), zoom: map.getZoom() }),
      setView: ({ lat, lng, zoom }) => map.setView([lat, lng], zoom, { animate: false }),
      fly: ({ lat, lng, zoom }, ms, done) => {
        map.once('moveend', done);
        map.flyTo([lat, lng], zoom, { duration: ms / 1000 });
        return () => { map.off('moveend', done); map.stop(); };
      },
    });
  }, [map, active]);

  useMapEvents({
    dragstart() {
      onUserInteraction?.();
    },
    zoomstart() {
      onUserInteraction?.();
    },
  });

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
  // Every place to mark (the database plus the admin's additions), and the spot the admin
  // has just chosen for a new one.
  places = SRM_MASTER_DATABASE,
  draftPlace = null,
  activeWaypoint,
  walkingRoute,
  canClearWaypoint,
  onClearWaypoint,
  onArTrack,
  isSatellite,
  // False while the Google map is the one showing (App.jsx), so it owns the camera driver.
  driverActive = true,
  highlightBuildingId,
  onSelectMember,
  onMapInstance,
  onUserInteraction,
  currentRoadName = null,
  routeSteps = null,
  // The theme's line colours (App.jsx reads them; Leaflet's path options take literals), a
  // member's distance for their plate, and what a lost-connection member's card says.
  routeColor = ROUTE_COLOR,
  casingColor = ROUTE_CASING_COLOR,
  lastKnownColor = '#8A94A3',
  memberDistance = () => null,
  ghostFocusItem = (ghost) => ({ name: ghost.name }),
}) => {
  const tiles = isSatellite ? SATELLITE_TILES : DARK_TILES;

  return (
    <MapContainer
      center={[center?.lat || SRM_KTR_COORDS.lat, center?.lng || SRM_KTR_COORDS.lng]}
      zoom={zoom || 17}
      zoomControl={false}
      className="w-full h-full bg-[var(--color-map-land)]"
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
      <FocusDriver onMapInstance={onMapInstance} onUserInteraction={onUserInteraction} active={driverActive} />
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
            <LiveLocationMarker
              zoom={currentZoom}
              isNavigating={liveIsNavigating}
              heading={liveHeading}
              roadName={currentRoadName}
            />
          </div>
        </LeafletReactMarker>
      )}

      {activeTab === 'buildings' && places.map((b) => (
        <LeafletReactMarker key={b.id} lat={b.lat} lng={b.lng} onClick={() => onFocus({ lat: b.lat, lng: b.lng }, b)}>
          <BuildingMarker highlighted={highlightBuildingId === b.id} />
        </LeafletReactMarker>
      ))}

      {draftPlace && (
        <LeafletReactMarker lat={draftPlace.lat} lng={draftPlace.lng}>
          <BuildingMarker highlighted />
        </LeafletReactMarker>
      )}

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

      {/* Live walking route to the active waypoint — shared solid blue route and white outline in both themes */}
      {walkingRoute?.path?.length > 1 && (
        <Polyline
          positions={walkingRoute.path.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: casingColor,
            weight: ROUTE_CASING_WIDTH,
            lineCap: 'round',
            opacity: 1,
          }}
        />
      )}
      {walkingRoute?.path?.length > 1 && (
        <Polyline
          positions={walkingRoute.path.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: routeColor,
            weight: ROUTE_WIDTH,
            lineCap: 'round',
            opacity: 1,
          }}
        />
      )}

      {/* Turn maneuver badges along route in navigation mode (Image 2 Google Maps style) */}
      {liveIsNavigating && routeSteps?.filter((s) => s.startLocation && s.maneuver && !['straight', 'depart', 'arrive'].includes(s.maneuver)).map((s, idx) => (
        <LeafletReactMarker key={s.id || `step-badge-${idx}`} lat={s.startLocation.lat} lng={s.startLocation.lng}>
          <div className="px-2.5 py-1 rounded-full bg-[#1A73E8] text-white text-[11px] font-bold shadow-[0_4px_12px_rgba(0,0,0,0.35)] flex items-center gap-1.5 whitespace-nowrap border-2 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2">
            <span className="font-extrabold text-[12px]">{s.maneuver.includes('left') ? '↰' : s.maneuver.includes('right') ? '↱' : '↑'}</span>
            <span className="max-w-[120px] truncate">{s.instruction.replace(/^(turn left onto |turn right onto |turn |walk on |head towards )/i, '')}</span>
          </div>
        </LeafletReactMarker>
      ))}

      {/* Same filter as the Google engine — see App.jsx's matching comment for why
          `permission` is not part of it and why this isn't gated on activeTab. */}
      {users
        .filter((u) => !blockedUserIds.includes(u.id) && u.status !== 'GHOST' && u.hasFix)
        .map((u) => (
          <LeafletReactMarker
            key={u.id}
            lat={u.lat}
            lng={u.lng}
            onClick={() => {
              onFocus({ lat: u.lat, lng: u.lng }, null);
              onSelectMember?.(u.id);
            }}
          >
            <div
              style={{
                position: 'relative',
                animation: 'locus-member-fade-in 0.6s ease',
                ...(SHOW_INDOOR_POSITION_TO_SQUAD && isOnOtherFloor(u, indoorView) ? { opacity: 0.35 } : {}),
              }}
            >
              <MemberMarker
                name={u.name}
                paused={u.status === 'FROZEN'}
                isNavigating={Boolean(activeWaypoint) || (u.speed / 3.6) > NAVIGATING_SPEED_MPS}
                heading={u.heading}
                distance={memberDistance(u)}
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
            pathOptions={{ color: lastKnownColor, opacity: segment.opacity, weight: 2, dashArray: '4 6' }}
          />
        ));
      })}

      {ghostMembers.map((ghost) => (
        <LeafletReactMarker
          key={`ghost-${ghost.id}`}
          lat={ghost.position.lat}
          lng={ghost.position.lng}
          onClick={() => {
            onFocus(ghost.position, ghostFocusItem(ghost));
            onSelectMember?.(ghost.id);
          }}
        >
          <div style={{ opacity: ghost.fading ? 0 : 1, transition: `opacity ${GHOST_FADE_MS}ms ease` }}>
            <GhostMemberMarker name={ghost.name} phase={ghost.phase} elapsedLabel={ghost.elapsedLabel} />
          </div>
        </LeafletReactMarker>
      ))}
    </MapContainer>
  );
};

export default TacticalLeafletMap;
