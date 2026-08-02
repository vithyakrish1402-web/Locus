const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync('C:/Users/Krish/AppData/Local/Temp/srm_buildings.json', 'utf8');
const data = JSON.parse(raw);

const nodes = {};
const ways = [];
for (const el of data.elements) {
  if (el.type === 'node') nodes[el.id] = [el.lat, el.lon];
  else if (el.type === 'way' && el.tags && el.tags.building) ways.push(el);
}

const buildingPolys = ways
  .filter(w => w.nodes && w.nodes.length >= 4 && nodes[w.nodes[0]])
  .map(w => ({
    id: w.id,
    name: (w.tags && (w.tags.name || w.tags['name:en'])) || null,
    ring: w.nodes.map(n => nodes[n]).filter(Boolean),
  }))
  .filter(p => p.ring.length >= 4);

console.log('nodes:', Object.keys(nodes).length, 'building ways total:', ways.length, 'usable polygons:', buildingPolys.length);

function centroid(ring) {
  let latSum = 0, lonSum = 0;
  for (const [lat, lon] of ring) { latSum += lat; lonSum += lon; }
  return [latSum / ring.length, lonSum / ring.length];
}

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointInPolygon(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const srmDbPath = path.join(__dirname, '..', 'src', 'srmDatabase.js');
const srmSrc = fs.readFileSync(srmDbPath, 'utf8');
const idRegex = /\{ id: (\d+), name: "([^"]+)"[^}]*lat: ([\d.]+), lng: ([\d.]+)/g;
const buildings = [];
let m;
while ((m = idRegex.exec(srmSrc))) {
  buildings.push({ id: Number(m[1]), name: m[2], lat: Number(m[3]), lng: Number(m[4]) });
}
console.log('DB buildings found:', buildings.length);

function rectFallback(lat, lng) {
  // ~39m N-S, ~49m E-W synthetic footprint when no trustworthy OSM match exists
  const dLat = 0.00035, dLng = 0.00045;
  return [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
    [lat - dLat, lng - dLng],
  ];
}

const matches = {};
for (const b of buildings) {
  // Prefer a polygon that actually contains the point
  let containing = buildingPolys.filter(p => pointInPolygon(b.lat, b.lng, p.ring));
  let best = null;
  let bestDist = Infinity;
  const candidates = containing.length ? containing : buildingPolys;
  for (const p of candidates) {
    const [clat, clon] = centroid(p.ring);
    const d = distMeters(b.lat, b.lng, clat, clon);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  const contained = containing.length > 0;
  const trustworthy = contained || bestDist < 50;
  matches[b.id] = {
    building: b,
    poly: trustworthy ? best : null,
    dist: bestDist,
    contained,
    synthetic: !trustworthy,
    ring: trustworthy ? best.ring : rectFallback(b.lat, b.lng),
  };
}

let containedCount = 0, nearCount = 0, farCount = 0;
for (const id in matches) {
  const mm = matches[id];
  if (mm.contained) containedCount++;
  else if (mm.dist < 60) nearCount++;
  else farCount++;
}
console.log('contained:', containedCount, 'near(<60m):', nearCount, 'far(>=60m):', farCount);

fs.writeFileSync(
  path.join(__dirname, 'footprint_matches.json'),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(matches).map(([id, mm]) => [
        id,
        {
          name: mm.building.name,
          lat: mm.building.lat,
          lng: mm.building.lng,
          dist: Math.round(mm.dist),
          contained: mm.contained,
          synthetic: mm.synthetic,
          osmId: mm.poly ? mm.poly.id : null,
          osmName: mm.poly ? mm.poly.name : null,
          ring: mm.ring,
        },
      ])
    ),
    null,
    2
  )
);
console.log('wrote footprint_matches.json');

const syntheticNames = Object.values(matches).filter(m => m.synthetic).map(m => m.building.name);
console.log('synthetic fallback used for:', syntheticNames.join(', '));
