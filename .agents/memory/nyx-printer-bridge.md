---
name: NYX printer bridge
description: Android APK most za Noryox NB80 tiskalnik prek com.incar.printerservice AIDL — enak protokol kot ZCS most
---

## Lokacija
`artifacts/nyx-printer-bridge/` — samostojen Android Studio projekt (Kotlin, compileSdk 34)

## Protokol (ENAK ZcsPrinterBridge — POS ne potrebuje sprememb)
- Port: **8090**
- Endpointi: GET /status, GET /diagnostics, POST /print, POST /print-text

## NYX AIDL
- Package: `com.incar.printerservice`
- Action: `com.incar.printerservice.IPrinterService`
- Interface: `net.nyx.printerservice.print.IPrinterService`
- AIDL paket se NIKOLI ne sme spremeniti
- 3 SDK datoteke: IPrinterService.aidl, PrintTextFormat.aidl, PrintTextFormat.java

## Tiskanje
- besedilo → `printText(String, PrintTextFormat)`
- QR (FURS) → `printQrCode(url, 200, 200, ALIGN_CENTER)`
- ZOI črtna koda → **NE tiskaj** (odstranjena — samo QR zadostuje)
- ESC/POS (POST /print) → `printEscposData(byte[])`
- ob zagonu: `setPaperWidth(576)` za 80mm
- konec izpisa: `printEndAutoOut()` nato `paperOut(144)` = 20 mm praznega prostora

## /status vrne model:"nyx"
POS frontend prebere model iz /status in samodejno kliče `/api/print/racun/:id/nb80` (40 kolon)
namesto `/zcs` (30 kolon). Logika v `zcsAndroidPrinter.ts`: `_bridgeModel === "nyx"` → endpoint `nb80`.

**Why:** Na NB80 je SDK AIDL-based (brez JAR), PrintTextFormat je Parcelable Java bean, Bitmap v AIDL je parcelable. Ni CP1250 problema (Java UTF-16).

## Gradnja
```bash
cd artifacts/nyx-printer-bridge
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
