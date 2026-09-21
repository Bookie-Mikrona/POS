---
name: NB80 Printer Bridge
description: NB80 Android terminal tiskalna pot — arhitektura, port, stolpci, PrinterService identifikatorji
---

## NB80 tiskalni most — implementacija

**Terminal:** NB80 z vgrajenim termičnim tiskalnikom, 80 mm papir → **40 stolpcev**

**PrinterService (AIDL Binder) — vir: https://github.com/SZNoryox/PrinterClient/tree/a13**
- Package: `com.incar.printerservice`
- Action: `com.incar.printerservice.IPrinterService`
- AIDL package: `net.nyx.printerservice.print`
- API: `printText(String, PrintTextFormat)`, `printBarcode(content, w, h, textPos, align, symbology)`, `printQrCode(content, w, h, align)`, `printEndAutoOut()`, `paperOut(px)`
- Ni `initPrinter()`/`setFontSize()`/`feedLine()` — stil gre v `PrintTextFormat` (textSize, ali, style)
- AndroidManifest: `<queries><package android:name="com.incar.printerservice"/></queries>` — obvezno Android 11+
- build.gradle: `buildFeatures { aidl = true }` — obvezno AGP 8.0+
- Barcode symbology: 0=CODE128; QR je ločena metoda printQrCode()

**Port:** `8091` (ZCS most je na `8090`)

**Implementirane komponente:**

| Datoteka | Namen |
|---|---|
| `artifacts/nb80-printer-bridge/` | Android APK projekt |
| `…/app/src/main/aidl/com/noryox/printer/IPrinterService.aidl` | AIDL vmesnik |
| `…/java/si/pos/nb80printer/PrinterBridge.java` | AIDL Binder upravljalec, singleton |
| `…/java/si/pos/nb80printer/BridgeHttpServer.java` | NanoHTTPD HTTP strežnik, port 8091 |
| `…/java/si/pos/nb80printer/MainActivity.java` + `BridgeForegroundService.java` | APK vstopna točka + foreground service |
| `artifacts/pos/src/lib/nb80AndroidPrinter.ts` | Browser HTTP klient, port 8091 |
| `artifacts/api-server/src/routes/pos/racuni.ts` | GET `/print/racun/:id/nb80` endpoint, 40 kol |
| `artifacts/pos/src/components/PrintReceiptButton.tsx` | NB80 state + handler + dropdown + auto-prioriteta |

**Prednostni vrstni red v handleBrowserPrint:** NB80 → ZCS → Sunmi → Serial → BT → QZ → Network → HTML

**Why:** NB80 pride pred ZCS ker sta to različna hardware-a; na terminalu bo aktiven samo eden od njiju.

**APK odvisnost:** NanoHTTPD `org.nanohttpd:nanohttpd:2.3.1` — lahek embedded HTTP server za Android.

**Življenjski cikel mostu:** HTTP strežnik mora biti last `BridgeForegroundService`, ne `MainActivity`. Trajno obvestilo pomeni le, da storitev živi; če je strežnik v aktivnosti, jo Android lahko uniči in pusti navidezno aktiven most z zaprtim portom 8091.

**Why:** Na napravi se je pojavilo stanje »most aktiven«, POS pa je javil »most ni dosegljiv«, ker je foreground storitev preživela aktivnost, ki je bila lastnik NanoHTTPD.

**How to apply:** Zagon iz aktivnosti in `BOOT_COMPLETED` morata oba voditi v isto storitev. Storitev mora najprej poklicati `startForeground()`, nato ob vsakem `onStartCommand()` zagotoviti zagon NanoHTTPD in ga ob `onDestroy` ustaviti. Tako se port znova vzpostavi tudi po delni obnovi storitve ali neuspelem prvem zagonu. CORS naj dovoljuje tudi Chrome Private Network Access.

**AIDL je binarno zaporedje, ne samo seznam metod:** NB80 mora uporabljati popoln, preverjen Noryox `IPrinterService` in identičen `PrintTextFormat` Parcelable; metod ni dovoljeno izpuščati, premikati ali dodajati na napačno mesto.

**Why:** Skrajšan AIDL se je prevedel, vendar je premaknil Binder transaction kode, zato so poznejši klici zadeli napačne metode. Napačen Parcelable zapis lahko enako pokvari že `printText`.

**How to apply:** Kot kanonično referenco uporabi isti AIDL in Parcelable kot preverjeni NYX most. `/status` naj vrne neuspešen HTTP status, dokler Binder ni pripravljen; vsak neničelni tiskalniški rezultat mora postati vidna napaka, ne lažen uspeh.

**Stabilna izbira:** paket `si.pos.nb80bridge` 1.5 pravilno tiska č/š/ž/€ in cel QR; uporablja port 8091. QR je centriran za 58 mm, na 80 mm pa ostane levo.

**Why:** Poskus z novim paketom, drugim portom in `setPaperWidth(384|576)` je na fizičnem NB80 ponovno pokvaril Unicode in QR. Uporabnik je izrecno izbral stabilnost.

**How to apply:** Ne spreminjaj NB80 APK-ja, AIDL-a, porta ali QR centriranja brez izrecne nove zahteve. Distribuiraj nespremenjeni original 1.5 in usmeri POS na 8091.
