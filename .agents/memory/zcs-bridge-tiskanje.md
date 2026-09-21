---
name: ZCS bridge tiskanje
description: ZCS Z92 tiskanje — vzrok napake, rešitev z nativnimi .so, SDK metode, chunking strategija
---

## ✅ REŠENO (9. 8. 2026) — Vzrok in rešitev

### Vzrok napake (delujoč APK ni tisal)

APK je ob zagonu padel z:
> `java.lang.UnsatisfiedLinkError: libSmartPosJni.so not found`

Vzrok: `app/libs/` je vseboval samo `SmartPos_1.8.1_R231213.jar` (Java del SDK),
**manjkali pa sta nativni knjižnici**, ki ju JAR zahteva:
- `libSmartPosJni.so` (~374 KB) — 308 JNI metod; vse 16 tiskalniških (`sdkPrn*`) prisotne
- `libEmvCoreJni.so` (~162 KB) — potrebna za SDK inicializacijo

Brez `.so` je vsak zgrajen APK takoj ob zagonu sesuje. Tiskanje ni delovalo nikoli.

### Rešitev

Knjižnici pridobiti iz prednameščene aplikacije na ZCS terminalu:
```bash
adb pull /system/pre_install/SmartPosTest-release_V2.0.6_2025-04-09.apk .
unzip SmartPosTest-*.apk "lib/armeabi-v7a/*.so" -d extracted
cp extracted/lib/armeabi-v7a/*.so \
   artifacts/zcs-printer-bridge/app/src/main/jniLibs/armeabi-v7a/
```

Vgrajeni v delujoči APK **versionCode=2 / versionName=1.1.0** (zgrajeno izven Replita, 9. 8. 2026).

**Why:** `.so` datoteke niso v git repozitoriju (binarke). Vsak razvijalec/CI jih mora
pridobiti ročno pred gradnjo. `.gitkeep` ohranja mapo.

**How to apply:** Preden kdajkoli gradiš ZCS bridge APK, preveri, da sta obe `.so`
datoteki prisotni v `app/src/main/jniLibs/armeabi-v7a/`.

**Avtostart:** Oba mostu (ZcsPrinterBridge in NoryoxNB80Bridge) se samodejno zaženeta ob ponovnem zagonu naprave.

---

## SDK metode (preverjeno na Z92, SDK 1.8.1)

### Tiskanje besedila

Chunking strategija (MAX_CHARS=800 na klic, en sam `setPrintStart()`):
- Kratki računi (< ~27 vrstic) = 1 klic, brez pavz
- Daljši računi = 2+ klicev, en `setPrintStart()` → tiskalnik ne dela vmesnih pavz
- Prazne vrstice `""` → zamenjaj s `" "` pred SDK klicom (sicer "width/height must be > 0")

**Zavrnjen pristop — `setPrintAppendStrings(String[], int[], PrnStrFormat[])`:**
- Metoda obstaja v JAR (podpis: `([Ljava/lang/String;[I[Lcom/zcs/sdk/print/PrnStrFormat;)V`)
- `int[]` semantika ni dokumentirana; vrednost 0 sproži "width/height must be > 0"
- **Ne uporabi** — ni dokumentirana, nestabilna

### QR koda in Code 128

```
setPrintAppendQRCode(String, int width, int height, Layout.Alignment)
setPrintAppendBarCode(Context, String, int w, int h, Boolean, Layout.Alignment, BarcodeFormat)
```
- QR: `setPrintAppendQRCode(qrUrl, 200, 200, ALIGN_CENTER)`
- Code 128: `setPrintAppendBarCode(ctx, zoi.uppercase(), 400, 80, false, ALIGN_CENTER, BarcodeFormat.CODE_128)`
- `BarcodeFormat` iz `core-3.2.1.jar` (ZXing, že v projektu)

**Ne uporabi** `setPrintBitmap(ByteArray)` za QR/barcode — vrže "width/height must be > 0".

### Razmiki (preverjeno na Z92)

- Med besedilom in QR kodo: **2 prazni vrstici** (~14 mm) ✓
- Po QR kodi (pred odtrganjem): **2 prazni vrstici** ✓
- Manj kot 2 vrstici po QR → trak odreže kodo pri trganju

### Strategy A vs B

- **Strategy A** (device file `/dev/stprinter`): ESC/POS direktno → `GS V 0` odrez, brez 21 cm limite; dostopna šele po SDK inicializaciji
- **Strategy B** (ZCS SDK): `setPrintStart()` = 21 cm fiksna dolžina (dolgi računi se odrežejo)

**Trenutna implementacija:** Strategy B z chunki — ustrezno za večino računov.

### ZCS SDK: besedilo in QR morata biti eno opravilo

Pri izvornem ZCS Z92 mostu dva zaporedna `setPrintStart()` klica nista varna:
QR-opravilo lahko prekine še nedokončano besedilo približno po glavi računa.
Pravilni tok je: dodaj vse besedilne chunke, dodaj QR/Code128, dodaj zaključni
odmik in nato pokliči `setPrintStart()` natanko enkrat.

**Why:** Na dejanskem računu je baza vsebovala postavko in API celoten izpis, papir
pa je pokazal samo devet vrstic glave in nato QR. Dvofazni POS obvoz je natisnil
vse, vendar je povzročil približno 5 s premora in 2 cm odmika.

**How to apply:** Most 1.1.1+ oglašuje `singleJobQr:true`; POS tedaj pošlje en
HTTP klic brez čakanja. Stari most uporablja dvofazni obvoz samo zaradi združljivosti.
Ker prejšnji podpisni ključ ni bil na voljo, je uporabnik potrdil odstranitev starega
APK-ja in čisto namestitev nove podpisane različice.

**Preverjeno:** popravljena različica je bila na konkretni ZCS napravi uspešno
preizkušena z dvema računoma.

### Razlika med source verzijo in download assetom

APK, ki ga ponuja POS nastavitev kot `ZcsPrinterBridge.apk`, je lahko zamenjan
ločeno od izvorne kode. Njegove verzije ni varno sklepati iz datuma datoteke ali
iz trenutnega `versionName` v repozitoriju; preveriti je treba sam APK oziroma
potrjeno verzijo na napravi. Trenutni download asset je uporabnik potrdil kot
verzijo 1.2.0 (manifest APK-ja: `versionCode=3`, `versionName=1.2.0`),
čeprav izvorni projekt kaže 1.1.1.
APK, ki je trenutno nameščen na ZCS napravi, je uporabnik navedel kot 1.2.0
velikosti 11,85 MB; to ni nujno ista binarna datoteka kot približno 4-MB
download asset v delovnem okolju.

**Why:** Claude je pripravil delujočo verzijo 1.2.0 kot ločen APK asset, zato
lahko source metadata in dejanska datoteka za prenos kažeta različni verziji.

**How to apply:** Pred zamenjavo ali objavo ZCS APK-ja vedno preveri konkretni
APK, ki ga kliče download ruta, ne le Gradle konfiguracije.

### Gradnja ZCS APK-ja v Replitu

Replitov Nix Android SDK je samo za branje in vsebuje platformo 36 ter
build-tools 35/36, ne pa 34. ZCS projekt mora pri gradnji eksplicitno uporabiti
razpoložljivi `compileSdk` in `buildToolsVersion`; sicer Gradle neuspešno poskusi
namestiti manjkajoče komponente v read-only SDK.

**Why:** Gradnja se je večkrat ustavila pred prevajanjem, čeprav je bil SDK
prisoten, ker je AGP zahteval manjkajoča build-tools 34.

**How to apply:** Uporabi isto SDK pot kot Viva Bridge in preveri, da sta ZCS
`armeabi-v7a` JNI knjižnici prisotni pred `assembleDebug`.

### ZOI prenos

- API strežnik `/print/racun/:id/zcs` vrne `zoi` polje v JSON
- `PrintServerService.kt` bere `zoi` iz JSON in ga pošlje `bridge.printText(..., zoi=...)`
