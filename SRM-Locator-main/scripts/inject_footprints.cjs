const fs = require('fs');
const path = require('path');

const matches = JSON.parse(fs.readFileSync(path.join(__dirname, 'footprint_matches.json'), 'utf8'));
const srmDbPath = path.join(__dirname, '..', 'src', 'srmDatabase.js');
let src = fs.readFileSync(srmDbPath, 'utf8');

const lineRegex = /\{ id: (\d+), name: "[^"]+".*?lng: [\d.]+, info: "[^"]*" \}/g;

src = src.replace(lineRegex, (line, id) => {
  const m = matches[id];
  if (!m) return line;
  const footprintStr = `[${m.ring.map(([lat, lng]) => `[${lat},${lng}]`).join(',')}]`;
  return line.replace(/, info: "/, `, footprint: ${footprintStr}, info: "`);
});

fs.writeFileSync(srmDbPath, src);
console.log('injected footprints into srmDatabase.js');
