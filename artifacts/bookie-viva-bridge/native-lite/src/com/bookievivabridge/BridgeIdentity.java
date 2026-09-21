package com.bookievivabridge;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;

final class BridgeIdentity {
  private static final String ALIAS = "bookie-payten-p256-v1";
  private BridgeIdentity() {}
  static synchronized PublicKey publicKey() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(ALIAS,
          KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
          .setDigests(KeyProperties.DIGEST_SHA256).setAlgorithmParameterSpec(
              new java.security.spec.ECGenParameterSpec("secp256r1")).build());
      generator.generateKeyPair();
    }
    return store.getCertificate(ALIAS).getPublicKey();
  }
  static String keyId() throws Exception { return b64(MessageDigest.getInstance("SHA-256").digest(publicKey().getEncoded())); }
  static String publicKeyBase64Url() throws Exception { return b64(publicKey().getEncoded()); }
  static String sign(byte[] payload) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); publicKey();
    PrivateKey key = (PrivateKey) store.getKey(ALIAS, null);
    Signature signature = Signature.getInstance("SHA256withECDSA"); signature.initSign(key); signature.update(payload);
    return b64(signature.sign());
  }
  static String b64(byte[] bytes) { return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
}