#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/native-lite"
OUT="$PROJECT/build"
SDK="/nix/store/gljmmnghx1zdxdmxfk219mfl3cn3wrbg-androidsdk/libexec/android-sdk"
TOOLS="$SDK/build-tools/36.0.0"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"

for required_var in \
  BOOKIE_ANDROID_KEYSTORE_B64 \
  BOOKIE_ANDROID_KEYSTORE_PASSWORD \
  BOOKIE_ANDROID_KEY_ALIAS \
  BOOKIE_ANDROID_KEY_PASSWORD; do
  if [[ -z "${!required_var:-}" ]]; then
    echo "Missing required production signing secret: $required_var" >&2
    exit 1
  fi
done

KEYSTORE="$(mktemp "${TMPDIR:-/tmp}/bookie-terminal-bridge-keystore.XXXXXX.p12")"
cleanup() {
  rm -f "$KEYSTORE"
}
trap cleanup EXIT

if ! printf '%s' "$BOOKIE_ANDROID_KEYSTORE_B64" | base64 --decode > "$KEYSTORE"; then
  echo "BOOKIE_ANDROID_KEYSTORE_B64 is not valid Base64." >&2
  exit 1
fi
chmod 600 "$KEYSTORE"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

javac -source 8 -target 8 -d "$OUT/test-classes" \
  "$PROJECT/src/com/bookievivabridge/PaytenFraming.java" \
  "$PROJECT/test/com/bookievivabridge/PaytenFramingTest.java"
java -cp "$OUT/test-classes" com.bookievivabridge.PaytenFramingTest

javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  "$PROJECT/src/com/bookievivabridge/MainActivity.java" \
  "$PROJECT/src/com/bookievivabridge/CallbackActivity.java" \
   "$PROJECT/src/com/bookievivabridge/BridgeResultService.java" \
   "$PROJECT/src/com/bookievivabridge/PaytenFraming.java" \
   "$PROJECT/src/com/bookievivabridge/PaytenProtocol.java" \
   "$PROJECT/src/com/bookievivabridge/BridgeIdentity.java" \
   "$PROJECT/src/com/bookievivabridge/PaytenReceiver.java"

"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 23 --output "$OUT/dex" \
  $(find "$OUT/classes" -type f -name '*.class' | sort)

"$TOOLS/aapt" package -f -M "$PROJECT/AndroidManifest.xml" \
  -I "$ANDROID_JAR" -F "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)
"$TOOLS/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-type PKCS12 \
  --ks-key-alias "$BOOKIE_ANDROID_KEY_ALIAS" \
  --ks-pass env:BOOKIE_ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:BOOKIE_ANDROID_KEY_PASSWORD \
  --out "$OUT/BookieVivaBridge-1.2.0.apk" "$OUT/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$OUT/BookieVivaBridge-1.2.0.apk"

cp "$OUT/BookieVivaBridge-1.2.0.apk" "$ROOT/dist/bookie-viva-bridge-v1.2.0.apk"
cp "$OUT/BookieVivaBridge-1.2.0.apk" "$ROOT/dist/BookieVivaBridge.apk"
cp "$OUT/BookieVivaBridge-1.2.0.apk" "$ROOT/../api-server/src/assets/downloads/BookieVivaBridge.apk"