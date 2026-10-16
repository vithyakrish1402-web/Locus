package com.locus.app.sharing;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Bytes under a name, as small files in a folder. In the app the folder is the no-backup area,
 * so the sealed token is never copied into a cloud or device-transfer backup (where the
 * Keystore key that seals it would not come along anyway). Writes go to a temporary file first
 * and are renamed into place, so a crash never leaves half a file.
 *
 * Plain java.io on purpose: java.nio.file needs Android 8, and the app supports Android 7.
 */
public final class FileKeyValue implements TokenStore.KeyValue {
    private final File dir;

    public FileKeyValue(File dir) {
        this.dir = dir;
    }

    private File fileFor(String key) {
        // The keys are ours and fixed; refuse anything that could leave the folder (including "." and "..").
        if (!key.matches("[A-Za-z0-9_-][A-Za-z0-9._-]*")) throw new IllegalArgumentException("bad key");
        return new File(dir, key);
    }

    @Override
    public byte[] get(String key) {
        File file = fileFor(key);
        if (!file.isFile()) return null;
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int n;
            while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    public void put(String key, byte[] value) {
        File file = fileFor(key);
        File temp = new File(dir, key + ".tmp");
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no folder");
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(value);
                out.getFD().sync();
            }
            // rename() replaces an existing file on Android's filesystems; on others, clear the way.
            if (!temp.renameTo(file)) {
                file.delete();
                if (!temp.renameTo(file)) throw new IOException("could not move into place");
            }
        } catch (IOException e) {
            temp.delete();
            throw new IllegalStateException("could not store", e);
        }
    }

    @Override
    public void remove(String key) {
        fileFor(key).delete();
    }
}
