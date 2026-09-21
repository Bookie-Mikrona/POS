Ta mapa vsebuje datoteke za prenos iz POS nastavitev.

════════════════════════════════════════════════════
ScannerBridge.exe  (Windows optični čitalnik)
════════════════════════════════════════════════════
1. Na Windows PC:  cd scanner-bridge && pip install -r requirements.txt && build.bat
2. Kopirajte  scanner-bridge/dist/ScannerBridge.exe  sem (preimenujte v ScannerBridge.exe)
3. Ponovno zgradite API strežnik:  pnpm --filter @workspace/api-server build

Dostopno prek: GET /api/downloads/ScannerBridge.exe

════════════════════════════════════════════════════
ZcsPrinterBridge.apk  (Android most za ZCS Z92)
════════════════════════════════════════════════════
Zahteva nativne knjižnice pred gradnjo — gl. artifacts/zcs-printer-bridge/README.md

1. Dodajte libSmartPosJni.so in libEmvCoreJni.so v
   artifacts/zcs-printer-bridge/app/src/main/jniLibs/armeabi-v7a/
   (pridobite iz SmartPosTest APK na terminalu — gl. README)
2. Zgradite APK:  cd artifacts/zcs-printer-bridge && ./gradlew assembleRelease
   (ali Android Studio: Build → Build APK(s))
3. Kopirajte app/build/outputs/apk/release/app-release.apk sem kot ZcsPrinterBridge.apk
4. Ponovno zgradite API strežnik:  pnpm --filter @workspace/api-server build

Dostopno prek: GET /api/downloads/ZcsPrinterBridge.apk

════════════════════════════════════════════════════
NoryoxNB80Bridge.apk  (Android most za NoryoxNB80)
════════════════════════════════════════════════════
1. Zgradite APK:  cd artifacts/nyx-printer-bridge && ./gradlew assembleRelease
   (ali Android Studio: Build → Build APK(s))
2. Kopirajte app/build/outputs/apk/release/app-release.apk sem kot NoryoxNB80Bridge.apk
3. Ponovno zgradite API strežnik:  pnpm --filter @workspace/api-server build

Dostopno prek: GET /api/downloads/NoryoxNB80Bridge.apk

════════════════════════════════════════════════════
BtTiskalniMost.apk  (Android most za BT POS tiskalnike)
════════════════════════════════════════════════════
Za tiskanje iz Android naprave na klasičen Bluetooth POS tiskalnik (58mm/32 stolpcev).
Podpira šumnike in € prek slikovnega (bitmap) izpisa — brez CP1250 težav.
Port: localhost:8090 (isti protokol kot ZcsPrinterBridge: GET /status → bridge:"q10", POST /print-text)

Gradnja:
1. Odprite projekt artifacts/bt-tiskalnik-most/ v Android Studiu
2. Build → Build APK(s)
3. Kopirajte app/build/outputs/apk/release/app-release.apk sem kot BtTiskalniMost.apk
4. Ponovno zgradite API strežnik: pnpm --filter @workspace/api-server build

Dostopno prek: GET /api/downloads/BtTiskalniMost.apk
