import { useRef, useState, useEffect } from 'react';
import { calculateBearing } from '../utils/bearing';
import { GPS_HEADING_SPEED_MPS } from '../LiveLocationMarker';

// Blends two heading sources for the live location marker, mirroring how
// Google Maps does it: compass (deviceorientation) is unreliable indoors and
// near structural steel — exactly this app's environment — so once the user
// is actually walking (speed above GPS_HEADING_SPEED_MPS), GPS course
// (bearing between the last two fixes) takes over as the more trustworthy
// source. Below that speed there's no reliable GPS course to compute, so it
// falls back to the compass.
export function useLiveHeading({ lat, lng, speedMps = 0, compassHeading = 0 }) {
  const prevFixRef = useRef(null);
  const [gpsHeading, setGpsHeading] = useState(null);

  useEffect(() => {
    if (lat == null || lng == null) return;
    const prev = prevFixRef.current;
    if (prev && (prev.lat !== lat || prev.lng !== lng)) {
      setGpsHeading(calculateBearing(prev.lat, prev.lng, lat, lng));
    }
    prevFixRef.current = { lat, lng };
  }, [lat, lng]);

  if (speedMps > GPS_HEADING_SPEED_MPS && gpsHeading != null) return gpsHeading;
  return compassHeading;
}
