// What the Commander's telemetry matrix ('request-telemetry') gets for one member.
//
// The server used to send its location cache entries as they were. An entry is written
// by two events with different field names: the heartbeat ('safety-ping': latitude,
// longitude, timestamp, batteryLevel) and GPS reports ('update-location': lat, lng,
// lastSeen, battery). A member whose only fix so far came from a GPS report, the first
// seconds after a fix and until their next heartbeat, had no `latitude`, and the
// matrix's `latitude.toFixed()` threw during render and took the whole app down.
//
// So the entry is normalised here, into the heartbeat's shape, which is what the matrix
// has always read (and what every installed build still reads). The heartbeat's values
// win when there are both, as they always did. A member whose coordinates aren't finite
// numbers gets no record at all: installed builds call toFixed() on whatever arrives, and
// a missing record already reads as NO_CACHE_DATA there.
//
// Returns { latitude, longitude, timestamp, batteryLevel }, or null.
export function toTelemetryRecord(entry) {
  if (!entry) return null;
  const heartbeat = Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude);
  const latitude = heartbeat ? entry.latitude : entry.lat;
  const longitude = heartbeat ? entry.longitude : entry.lng;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const timestamp = heartbeat && entry.timestamp
    ? entry.timestamp
    : (Number.isFinite(entry.lastSeen) ? new Date(entry.lastSeen).toISOString() : null);
  // The heartbeat's reading only if it is one: 'safety-ping' stores the placeholder
  // 'Unknown' when a phone sends no battery, and that used to be sent on even when the
  // member's update-location carried a real `battery` number.
  const heartbeatLevel = heartbeat && Number.isFinite(parseInt(entry.batteryLevel, 10)) ? entry.batteryLevel : null;
  const batteryLevel = heartbeatLevel ?? (Number.isFinite(entry.battery) ? `${entry.battery}%` : null);

  return { latitude, longitude, timestamp, batteryLevel };
}
