# NB80 Tiskalni Most (NB80PrinterBridge)

> **OBSOLETE / NE NAMEŠČAJTE:** podprta NB80 izvedba je Kotlin projekt
> `../nyx-printer-bridge`, ki ohranja isti NYX AIDL tiskalni adapter in edini
> vključuje normativni Bookie Fiscal Service na `127.0.0.1:17831/v1`.
> Ta starejši Java/NanoHTTPD variant ostaja samo za zgodovinsko primerjavo in
> nima fiskalnega API-ja, zato se ne sme distribuirati na produkcijske terminale.

Lokalni HTTP most med POS spletno aplikacijo in vgrajenim termičnim tiskalnikom na Android POS terminalu (NB80, 80 mm papir).

## Arhitektura

```
POS brskalnik
  └─ GET /api/print/racun/:id/nb80   ← strežnik vrne JSON (40 stolpcev, UTF-8)
  └─ POST http://localhost:8091/print-text  ← APK sprejme JSON
       └─ com.incar.printerservice (AIDL Binder)
            └─ IPrinterService.printText()
            └─ IPrinterService.printQrCode()
            └─ IPrinterService.printBarcode()   ← CODE128 za ZOI
            └─ IPrinterService.printEndAutoOut() ← pomik + rez
```

## Predpogoji

- Android Studio **Hedgehog** ali novejši
- Android SDK 34
- NB80 terminal z nameščenim `com.incar.printerservice` (sistemski APK — je že na terminalu)

## Gradnja

```bash
# V Android Studio: File → Open → artifacts/nb80-printer-bridge
# Nato: Build → Build Bundle(s) / APK(s) → Build APK(s)
```

ali z ukazno vrstico (če je `ANDROID_HOME` nastavljen):

```bash
cd artifacts/nb80-printer-bridge
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

## Namestitev

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

ali prenesite APK neposredno na terminal prek USB in ga namestite ročno.

## Zagon

1. Zaženite APK na NB80 terminalu — aktivnost se takoj pomakne v ozadje
2. V obvestilni vrstici se pojavi: **"NB80 Tiskalni Most · port 8091"**
3. POS aplikacija v brskalniku samodejno zazna most v 6 sekundah
4. Gumb "Natisni" postane aktiven brez dropdowna

## SDK

| Lastnost | Vrednost |
|---|---|
| Package | `com.incar.printerservice` |
| Action | `com.incar.printerservice.IPrinterService` |
| AIDL | `net.nyx.printerservice.print` |
| Vir | [SZNoryox/PrinterClient @ a13](https://github.com/SZNoryox/PrinterClient/tree/a13) |

## Datoteke SDK (ne spremenite paketa/poti)

```
aidl/net/nyx/printerservice/print/IPrinterService.aidl
aidl/net/nyx/printerservice/print/PrintTextFormat.aidl
java/net/nyx/printerservice/print/PrintTextFormat.java
```

## HTTP API (port 8091)

### `GET /status`
```json
{ "ok": true, "status": "NB80 PrinterService je inicializiran in pripravljen" }
```

### `POST /print-text`
```json
{
  "linee":   ["RESTAVRACIJA XY", "Račun: 2024-0001", "..."],
  "formati": ["BC",              "N",                 "..."],
  "qrUrl":   "https://blagajne.fu.gov.si/...",
  "zoi":     "aabbcc..."
}
```
Formati (en znak na vrstico): `B`=bold, `N`=normal, `C`=center, `R`=right, `L`=left

**Odgovor:** `{ "ok": true }` ali `{ "error": "..." }`

## Encoding

NB80 PrinterService sprejema UTF-8 nativno. Java `String` je Unicode — č, š, ž
se tiskajo pravilno brez pretvorbe charset-a (ni iconv/Windows-1250).

## Odpravljanje težav

| Težava | Rešitev |
|---|---|
| `bindService` vrne false | `com.incar.printerservice` ni nameščen — kontaktirajte dobavitelja terminala |
| POS ne zazna mosta | Preverite, da APK teče (obvestilna vrstica) — preverite firewall/SELinux |
| `printText` vrne ≠ 0 | Tiskalnik ni pripravljen — preverite papir in pokrov |
| APK se ugasne | Zahteva foreground service — preverite dovoljenja v sistemskih nastavitvah |
