#!/usr/bin/env bash
# Zgradi podpisana APK-ja Bookie ERP in Bookie POS (WebView, brez native kode, deluje na vseh ABI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/web-launcher"
OUT="$P/build"
SDK="/nix/store/gljmmnghx1zdxdmxfk219mfl3cn3wrbg-androidsdk/libexec/android-sdk"
TOOLS="$SDK/build-tools/36.0.0"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
for v in BOOKIE_ANDROID_KEYSTORE_B64 BOOKIE_ANDROID_KEYSTORE_PASSWORD BOOKIE_ANDROID_KEY_ALIAS BOOKIE_ANDROID_KEY_PASSWORD; do
  [[ -n "${!v:-}" ]] || { echo "Missing signing secret: $v" >&2; exit 1; }
done
KEYSTORE="$(mktemp "${TMPDIR:-/tmp}/bookie-launcher-ks.XXXXXX.p12")"
trap 'rm -f "$KEYSTORE"' EXIT
printf '%s' "$BOOKIE_ANDROID_KEYSTORE_B64" | base64 --decode > "$KEYSTORE"
chmod 600 "$KEYSTORE"
rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex" "$ROOT/dist"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" "$P/src/com/bookie/launcher/MainActivity.java"
"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 23 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

build_one() { # pkg label url file
  local pkg="$1" label="$2" url="$3" file="$4" dir="$OUT/$4"
  mkdir -p "$dir"
  cat > "$dir/AndroidManifest.xml" <<M
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$pkg" android:versionCode="2" android:versionName="1.0.1">
  <uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35" />
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:allowBackup="false" android:label="$label" android:icon="@mipmap/ic_launcher"
      android:usesCleartextTraffic="false" android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity android:name="com.bookie.launcher.MainActivity" android:exported="true"
        android:configChanges="keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize"
        android:launchMode="singleTask">
      <meta-data android:name="START_URL" android:value="$url" />
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
M
  "$TOOLS/aapt" package -f -M "$dir/AndroidManifest.xml" -S "$P/res" -I "$ANDROID_JAR" -F "$dir/unsigned.apk"
  (cd "$OUT/dex" && zip -q -j "$dir/unsigned.apk" classes.dex)
  "$TOOLS/zipalign" -f 4 "$dir/unsigned.apk" "$dir/aligned.apk"
  "$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-type PKCS12 --ks-key-alias "$BOOKIE_ANDROID_KEY_ALIAS" \
    --ks-pass env:BOOKIE_ANDROID_KEYSTORE_PASSWORD --key-pass env:BOOKIE_ANDROID_KEY_PASSWORD \
    --out "$ROOT/dist/$file.apk" "$dir/aligned.apk"
  "$TOOLS/apksigner" verify "$ROOT/dist/$file.apk"
}
build_one com.bookie.launcher.erp "Bookie ERP" "https://Bookie-ERP.replit.app/" BookieERP
build_one com.bookie.launcher.pos "Bookie POS" "https://Bookie-ERP.replit.app/pos/" BookiePOS
