// Minimal, dependency-free ZIP writer for the Phase 2 bundle.
//
// Why not shell out? `Compress-Archive` on Windows writes entry names with BACKSLASH
// separators ("assets\index.js"). The ZIP spec (APPNOTE 4.4.17.1) requires forward
// slashes, and a strict unzip - including Android's java.util.zip, which is what ends up
// extracting this bundle on device - reads "assets\index.js" as one flat filename rather
// than a path. The bundle would unpack with no assets/ directory and index.html's script
// tags would 404: a white screen, only reproducible on a real device. Node's zlib gives
// us full control over the bytes, so we write them correctly on every platform.
//
// Scope: no zip64, no encryption, no data descriptors. A web bundle is a few hundred KB
// of small files, so none of that applies.

import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** Recursively list files under `dir`, as ZIP-style forward-slash relative paths. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** DOS date/time, which is all a ZIP local header can carry. */
function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * Zip the CONTENTS of `sourceDir` (not the directory itself) into a Buffer.
 *
 * The plugin expects index.html at the archive root, so entries are relative to
 * sourceDir with no wrapping folder.
 *
 * @param {string} sourceDir
 * @param {Date} [mtime] fixed timestamp; pass one for byte-reproducible archives
 * @returns {Buffer}
 */
export function zipDirectory(sourceDir, mtime = new Date()) {
  const names = listFiles(sourceDir).sort();
  const { time, day } = dosDateTime(mtime);

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const contents = readFileSync(join(sourceDir, name.split('/').join(sep)));
    const crc = crc32(contents);

    // Deflate unless it makes the entry bigger (already-compressed assets, tiny files).
    const deflated = deflateRawSync(contents, { level: 9 });
    const useDeflate = deflated.length < contents.length;
    const payload = useDeflate ? deflated : contents;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // version made by: UNIX, spec 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    // External attrs: UNIX mode 0100644 (regular file, rw-r--r--) in the high word.
    // >>> 0 because JS bit-shifts are signed 32-bit and this value overflows into
    // negative territory, which writeUInt32LE rejects outright.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, end]);
}
