/*
 * Regenerates the `footprint` (and marker lat/lng) fields in src/srmDatabase.js from
 * OpenStreetMap building outlines.
 *
 *   node scripts/rebuild_footprints.cjs
 *
 * Replaces the earlier process_footprints.cjs + inject_footprints.cjs pair, which
 * matched each database entry to the *nearest* OSM polygon regardless of its name.
 * That is why buildings ended up wearing their neighbour's outline — SRM Central
 * Library and the University Building shared one polygon, Senbagam Hostel wore
 * Adhiyaman's, and the Mechanical block was given the Hi-Tech block's shape — and
 * why markers sat 10-75m away from the outline they belonged to.
 *
 * Matching rules here, strictest first:
 *   1. NAME_MATCH below pins a database id to a specific OSM way id, verified by name.
 *   2. Otherwise, an *unnamed* OSM building that geometrically contains the marker is
 *      accepted, but only if exactly one does and no name match already claimed it.
 *   3. Otherwise the footprint is dropped and the building renders as a pin.
 *
 * Rule 3 is deliberate: OSM genuinely has no outline for the auditorium, the medical
 * sector or a few hostels, and the nearest candidates are 90-140m away (i.e. entirely
 * different buildings). A pin is honest about "we don't know the shape"; a confidently
 * drawn wrong outline is not.
 *
 * Every matched building also has its lat/lng snapped to a point inside its polygon so
 * the marker and the outline agree.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '..', 'src', 'srmDatabase.js');
const BBOX = '12.810,80.028,12.832,80.054'; // SRM KTR campus
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// database id -> OSM way id, each confirmed by comparing building names.
// null = OSM has no feature for it; drop the footprint rather than invent one.
const NAME_MATCH = {
  1: 718914045,   // UNIVERSITY BUILDING        -> "SRM University Building"
  2: 188582618,   // TECH PARK                  -> "SRM Tech Park"
  4: null,        // SRM CENTRAL LIBRARY        -> sits inside the University Building
  5: 188582623,   // ELECTRICAL SCIENCES BLOCK  -> "Electrical Sciences Block"
  6: 188582614,   // MECHANICAL ENGINEERING BLK -> "Mechanical Block" (larger of the two, 810m2)
  7: 1216056974,  // BASIC ENGINEERING LAB      -> "BEL Lab"
  8: 188582615,   // SCHOOL OF ARCHITECTURE     -> "Architecture Block"
  9: 188582621,   // HI-TECH BLOCK              -> "High Tech Block"
  10: 64400114,   // BIO-TECH BLOCK             -> "biotech block"
  11: 188582626,  // AEROSPACE BLOCK (HANGAR)   -> "Aerospace Hanger"
  12: null,       // SRM MEDICAL COLLEGE        -> nearest OSM building is 109m away
  13: null,       // SRM GLOBAL HOSPITALS       -> nothing mapped within 140m
  14: null,       // SRM DENTAL COLLEGE         -> resolved by containment (rule 2)
  15: null,       // SCHOOL OF PUBLIC HEALTH    -> nearest OSM building is 139m away
  16: null,       // T.P. GANESAN AUDITORIUM    -> not mapped; nearest is "Tech Park 2" at 90m
  17: 188582617,  // JAVA GREEN (FOOD COURT)    -> "Canteen"
  19: null,       // SRM HOTEL                  -> resolved by containment (rule 2)
  22: 1216059333, // PAARI HOSTEL               -> "Paari Hostel"
  23: 241765449,  // KAARI HOSTEL               -> "Kaari Hostel"
  25: 1443234347, // ADHIYAMAN HOSTEL           -> "Adhyaman Hostel"
  27: 64399874,   // MEENAKSHI HOSTEL           -> "Menakshi Hostel Block"
  28: null,       // SENBAGAM HOSTEL            -> not mapped; nearest is Adhyaman's own outline
  29: 1428764545, // KALPANA CHAWLA HOSTEL      -> "Kalpana Chawla Hostel"
  30: null,       // SISTER NIVEDITA HOSTEL     -> resolved by containment (rule 2)
};

const fetchOsm = () => new Promise((resolve, reject) => {
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:90];(way["building"](${BBOX}););out geom;`);
  const req = https.request(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      // Overpass answers 406 Not Acceptable to requests with no User-Agent, which is
      // what Node's https module sends by default.
      'User-Agent': 'locus-srm-locator/1.0 (footprint rebuild script)',
    },
  }, res => {
    let d = '';
    res.on('data', c => (d += c));
    res.on('end', () => {
      try { resolve(JSON.parse(d)); }
      catch (e) { reject(new Error('Overpass returned non-JSON (server busy?): ' + d.slice(0, 200))); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

const ringOf = w => {
  const r = w.geometry.map(p => [p.lat, p.lon]);
  const f = r[0], l = r[r.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]);
  return r;
};
const centroid = r => {
  const p = r.slice(0, -1);
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
};
const inPoly = (lat, lng, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [yi, xi] = r[i], [yj, xj] = r[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};
const distM = (aLat, aLng, bLat, bLng) => {
  const R = 6371000, tr = d => (d * Math.PI) / 180;
  const dLat = tr(bLat - aLat), dLng = tr(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(tr(aLat)) * Math.cos(tr(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Concave outlines can put the plain centroid outside the shape; scan for a point in it.
const pointInside = r => {
  const c = centroid(r);
  if (inPoly(c[0], c[1], r)) return c;
  const lats = r.map(p => p[0]), lngs = r.map(p => p[1]);
  const [loLat, hiLat, loLng, hiLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  for (let i = 1; i < 40; i++) {
    for (let j = 1; j < 40; j++) {
      const lat = loLat + ((hiLat - loLat) * i) / 40, lng = loLng + ((hiLng - loLng) * j) / 40;
      if (inPoly(lat, lng, r)) return [lat, lng];
    }
  }
  return c;
};

(async () => {
  console.log('fetching OSM buildings for', BBOX, '...');
  const osm = await fetchOsm();
  const ways = osm.elements.filter(e => e.type === 'way' && e.geometry && e.geometry.length >= 4);
  const byId = Object.fromEntries(ways.map(w => [w.id, w]));
  console.log('building ways:', ways.length);

  const claimed = new Set(Object.values(NAME_MATCH).filter(Boolean));
  const report = [];
  const src = fs.readFileSync(DB_PATH, 'utf8');

  const out = src.replace(/\{ id: (\d+),([\s\S]*?)info: "([^"]*)" \}/g, (whole, idStr, mid, info) => {
    const id = Number(idStr);
    const name = (mid.match(/name: "([^"]+)"/) || [])[1];
    const category = (mid.match(/category: "([^"]+)"/) || [])[1];
    const oldLat = Number((mid.match(/lat: ([\d.]+)/) || [])[1]);
    const oldLng = Number((mid.match(/lng: ([\d.]+)/) || [])[1]);

    let wayId = NAME_MATCH[id];
    let how = wayId ? 'name' : null;

    if (!wayId) {
      const hits = ways.filter(w => !claimed.has(w.id)
        && !(w.tags && (w.tags.name || w.tags['name:en']))
        && inPoly(oldLat, oldLng, ringOf(w)));
      if (hits.length === 1) { wayId = hits[0].id; how = 'contains'; claimed.add(wayId); }
    }

    let lat = oldLat, lng = oldLng, fp = null, moved = 0;
    if (wayId && byId[wayId]) {
      const r = ringOf(byId[wayId]);
      const p = pointInside(r);
      moved = distM(oldLat, oldLng, p[0], p[1]);
      lat = +p[0].toFixed(7); lng = +p[1].toFixed(7); fp = r;
    }

    report.push({ id, name, how: how || 'DROPPED', wayId: wayId || '-', moved: Math.round(moved) });
    const fpStr = fp ? `footprint: [${fp.map(([a, b]) => `[${a},${b}]`).join(',')}], ` : '';
    return `{ id: ${id}, name: "${name}", category: "${category}", lat: ${lat}, lng: ${lng}, ${fpStr}info: "${info}" }`;
  });

  fs.writeFileSync(DB_PATH, out);
  console.log('\nid  how        wayId        movedM  name');
  report.forEach(r => console.log(
    String(r.id).padStart(2), String(r.how).padEnd(10), String(r.wayId).padStart(11),
    String(r.moved).padStart(7), ' ' + r.name));

  const used = report.filter(r => r.wayId !== '-').map(r => r.wayId);
  const dupes = used.length - new Set(used).size;
  console.log('\nmatched:', used.length, '| dropped:', report.length - used.length, '| duplicate polygons:', dupes);
  if (dupes) { console.error('FAIL: two buildings share an outline'); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
