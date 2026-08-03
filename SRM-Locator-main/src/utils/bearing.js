// Shared between ARCompass.jsx (AR targeting) and useLiveHeading.js (the live
// location marker's GPS-course heading) so both derive bearing the same way
// instead of duplicating the Haversine math.
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export const calculateBearing = (lat1, lng1, lat2, lng2) => {
  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);

  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
};
