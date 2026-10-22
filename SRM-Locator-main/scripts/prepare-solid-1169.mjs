import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from './lib/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalZip = fs.readFileSync(path.join(root, '.release-base-1168/locus-bundle.zip'));
assert.equal(createHash('sha256').update(originalZip).digest('hex'), '4d85dbc1dd22f4b50a5c424387c6c73c7a716976d5b78bec7692e31792196aec');
const input = path.join(root, '.release-base-1168/dist');
const output = path.join(root, 'dist-release/solid-1169/dist');
fs.mkdirSync(output, { recursive: true });
const renames = new Map([
  ['index-0EpydAU1.js', 'index-solid-1169.js'],
  ['TacticalLeafletMap-Bk_bQPTh.js', 'TacticalLeafletMap-solid-1169.js'],
]);
const replacements = new Map([
  ['assets/index-0EpydAU1.js', [
    ['strokeColor:r,strokeOpacity:0,zIndex:1,icons:rI(r,cee,n)', 'strokeColor:r,strokeOpacity:1,strokeWeight:cee,zIndex:1'],
    ['strokeColor:s,strokeOpacity:0,zIndex:2,icons:rI(s,lee,n)', 'strokeColor:s,strokeOpacity:1,strokeWeight:lee,zIndex:2'],
  ]],
  ['assets/TacticalLeafletMap-Bk_bQPTh.js', [
    ['color:Oe,weight:vs,dashArray:nt.isRealRoute?kn:On,lineCap:', 'color:Oe,weight:vs,lineCap:'],
    ['color:ht,weight:ys,dashArray:nt.isRealRoute?kn:On,lineCap:', 'color:ht,weight:ys,lineCap:'],
  ]],
]);
const report = [];
for (const entry of fs.readdirSync(input, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const absolute = path.join(entry.parentPath ?? entry.path, entry.name);
  const relative = path.relative(input, absolute).replaceAll('\\', '/');
  const original = fs.readFileSync(absolute);
  let bytes = original;
  const changes = replacements.get(relative) ?? [];
  let originalText;
  if (relative.endsWith('.js') || relative.endsWith('.html')) {
    originalText = original.toString('utf8');
    let updated = originalText;
    for (const [before, after] of changes) {
      assert.equal(updated.split(before).length - 1, 1, `unique renderer match: ${relative}`);
      updated = updated.replace(before, after);
    }
    for (const [before, after] of renames) updated = updated.replaceAll(before, after);
    let reversed = updated;
    for (const [before, after] of renames) reversed = reversed.replaceAll(after, before);
    for (const [before, after] of changes) reversed = reversed.replace(after, before);
    assert.equal(reversed, originalText, `No unrelated changes: ${relative}`);
    if (relative.endsWith('.js')) {
      const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: updated, encoding: 'utf8' });
      assert.equal(check.status, 0, `JavaScript syntax check: ${relative}: ${check.stderr}`);
    }
    bytes = Buffer.from(updated);
  }
  const newRelative = relative.split('/').map(part => renames.get(part) ?? part).join('/');
  const destination = path.join(output, newRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  if (!bytes.equals(original)) report.push({ file: relative, rendererChanges: changes.length, referencesUpdated: true });
}
const bytes = zipDirectory(output, new Date(1980, 1, 1));
const checksum = createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(root, 'dist-release/solid-1169/locus-bundle.zip'), bytes);
fs.writeFileSync(path.join(root, 'dist-release/solid-1169/BUNDLE_NOTES.md'), `- Navigation routes are solid blue lines with a white outline in both map engines and both themes.\n- Based directly on the published 1.1.68 bundle; satellite-only Google Maps, shared routing cache, navigation smoothing and all other features are preserved.\n\nMIN_NATIVE: 1.1.61\nSHA256: ${checksum}\n`);
fs.writeFileSync(path.join(root, 'dist-release/solid-1169/verification.json'), JSON.stringify({ baseVersion: '1.1.68', version: '1.1.69', checksum, bytes: bytes.length, rendererReplacements: 4, exactReversalVerified: true, modifiedFiles: report }, null, 2));
console.log(JSON.stringify({ checksum, bytes: bytes.length, rendererReplacements: 4, exactReversalVerified: true, modifiedFiles: report }));

