package com.locus.app.sharing;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Seals bytes with an AES-256-GCM key that lives in the Android Keystore and never leaves it.
 * Layout of what it returns: one byte of IV length, the IV, then the encrypted bytes. If the
 * Keystore is unavailable or fails for any reason this throws, and TokenStore then stores
 * nothing: there is no fallback to anything weaker.
 */
public final class KeystoreSecretBox implements TokenStore.SecretBox {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS = "locus_background_sharing_v1";
    private static final String TRANSFORM = "AES/GCM/NoPadding";

    private SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(PROVIDER);
        keyStore.load(null);
        if (keyStore.containsAlias(ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    @Override
    public byte[] seal(byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plain);
        byte[] out = new byte[1 + iv.length + encrypted.length];
        out[0] = (byte) iv.length;
        System.arraycopy(iv, 0, out, 1, iv.length);
        System.arraycopy(encrypted, 0, out, 1 + iv.length, encrypted.length);
        return out;
    }

    @Override
    public byte[] open(byte[] sealed) throws Exception {
        int ivLength = sealed[0] & 0xff;
        if (ivLength < 12 || sealed.length <= 1 + ivLength) throw new IllegalArgumentException("not sealed by us");
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(sealed, 1, 1 + ivLength)));
        return cipher.doFinal(sealed, 1 + ivLength, sealed.length - 1 - ivLength);
    }
}
