import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipDirectory } from '../scripts/lib/zip.mjs';

// Guards the Phase 2 bundle writer. The failure it exists to prevent - backslash entry
// names, which Android's unzip reads as flat filenames instead of paths - produces a
// white screen that only reproduces on a device, so it has to be caught here.

let dir;
const NESTED = 'assets/app-abc123.js';
const NESTED_BODY = 'console.log("locus");'.repeat(200); // compressible
const ROOT_BODY = '<!doctype html><html></html>';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'locus-zip-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), ROOT_BODY);
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), NESTED_BODY);
  writeFileSync(join(dir, 'assets', 'tiny.txt'), 'x'); // incompressible at this size
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Minimal central-directory reader, independent of the writer's own bookkeeping. */
const readCentralDirectory = (buffer) => {
  const entries = [];
  const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let i = 0;
  while ((i = buffer.indexOf(sig, i)) !== -1) {
    const method = buffer.readUInt16LE(i + 10);
    const crc = buffer.readUInt32LE(i + 16);
    const compressedSize = buffer.readUInt32LE(i + 20);
    const uncompressedSize = buffer.readUInt32LE(i + 24);
    const nameLength = buffer.readUInt16LE(i + 28);
    const offset = buffer.readUInt32LE(i + 42);
    entries.push({
      name: buffer.toString('utf8', i + 46, i + 46 + nameLength),
      method,
      crc,
      compressedSize,
      uncompressedSize,
      offset,
    });
    i += 46 + nameLength;
  }
  return entries;
};

const readEntryData = (buffer, entry) => {
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  return entry.method === 8 ? inflateRawSync(raw) : raw;
};

describe('zipDirectory', () => {
  it('writes forward-slash entry names, never backslashes', () => {
    const entries = readCentralDirectory(zipDirectory(dir));
    const names = entries.map((e) => e.name);
    expect(names).toContain(NESTED);
    expect(names.some((n) => n.includes(String.fromCharCode(92)))).toBe(false);
  });

  it('puts the directory contents at the archive root, with no wrapping folder', () => {
    const names = readCentralDirectory(zipDirectory(dir)).map((e) => e.name);
    expect(names).toContain('index.html');
    expect(names.every((n) => !n.startsWith('dist/'))).toBe(true);
  });

  it('round-trips every file byte-for-byte', () => {
    const zip = zipDirectory(dir);
    const entries = readCentralDirectory(zip);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

    expect(readEntryData(zip, byName['index.html']).toString()).toBe(ROOT_BODY);
    expect(readEntryData(zip, byName[NESTED]).toString()).toBe(NESTED_BODY);
    expect(readEntryData(zip, byName['assets/tiny.txt']).toString()).toBe('x');
  });

  it('records the real uncompressed size alongside the compressed one', () => {
    const entries = readCentralDirectory(zipDirectory(dir));
    const nested = entries.find((e) => e.name === NESTED);
    expect(nested.uncompressedSize).toBe(Buffer.byteLength(NESTED_BODY));
    expect(nested.method).toBe(8); // deflate: this content compresses well
    expect(nested.compressedSize).toBeLessThan(nested.uncompressedSize);
  });

  it('stores rather than deflates when deflating would make the file bigger', () => {
    const tiny = readCentralDirectory(zipDirectory(dir)).find((e) => e.name === 'assets/tiny.txt');
    expect(tiny.method).toBe(0);
    expect(tiny.compressedSize).toBe(1);
  });

  it('emits a well-formed end-of-central-directory record', () => {
    const zip = zipDirectory(dir);
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(-1);
    expect(zip.readUInt16LE(eocd + 8)).toBe(3); // entries on this disk
    expect(zip.readUInt16LE(eocd + 10)).toBe(3); // entries total
    expect(eocd + 22).toBe(zip.length); // no trailing comment or junk
  });

  it('is byte-reproducible for a fixed timestamp', () => {
    // Same input + same mtime must give the same digest, or the checksum in a release
    // body would drift from a rebuild of identical source.
    const fixed = new Date('2026-01-01T00:00:00Z');
    expect(zipDirectory(dir, fixed).equals(zipDirectory(dir, fixed))).toBe(true);
  });
});
