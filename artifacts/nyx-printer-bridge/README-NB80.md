# NYX Tiskalni Most (NB80) — README

Android APK, ki deluje kot lokalni HTTP most med POS aplikacijo in vgrajenim
termičnim tiskalnikom na terminalu **Noryox NB80** (Android 13, 80 mm).

## Fiskalna osnova

Skupni vir `../bookie-fiscal-android-core` je vključen tudi v ta APK. V njem je
transakcijski SQLite dnevnik za rezervacijo PP-B zaporedja, idempotentno
hranjenje točne kanonične ovojnice, ločen status tiska/sinhronizacije in
preverljivo SHA-256 hash-verigo. Občutljiva ovojnica se v SQLite shrani šifrirana
z AES-GCM ključem Android Keystore.

Normativni API posluša samo na `http://127.0.0.1:17831/v1`; port 8090 ostaja
združljiv tiskalni API. Contract določa `furs-v1`, OfflineAuthorityBundle in
izpeljavo; jedro preveri zaupanja vreden podpis, hash, scope, različico, preklic,
veljavnost in attestation, celotni furs-v1 vektorji pa se izvajajo v JVM testih.
Produkcijska izdaja ostane fail-closed, dokler lokalni dinamični XMLDSig
generator, tiskalnik in cilj sinhronizacije niso provisioned in health-checked.
Pairing uporablja lokalno enkratno kodo, točen HTTPS Origin in HMAC z enkratnim
nonce. Starejši `nb80-printer-bridge` Java projekt je označen kot obsolete; ta
Kotlin NYX projekt je edina podprta NB80 izvedba.

---

## Arhitektura

```
POS brskalnik
  │  POST http://localhost:8090/print-text  (JSON)
  │  GET  http://localhost:8090/status
  ▼
NyxPrinterBridge APK  (foreground service, port 8090)
  │  AIDL bindService
  ▼
com.incar.printerservice  (sistemski servis na NB80)
  │  IPrinterService (net.nyx.printerservice.print)
  ▼
Vgrajen 80mm termični tiskalnik
```

**Protokol je identičen ZcsPrinterBridge** — POS frontend ne potrebuje
nobenih sprememb. Na NB80 enostavno namestite ta APK namesto ZCS APK.

---

## HTTP API (port 8090)

| Metoda | Pot | Opis |
|--------|-----|------|
| GET | `/status` | `{"ok":true/false,"status":"...","port":8090}` |
| GET | `/diagnostics` | NYX paketi, stanje, širina papirja |
| POST | `/print` | Surovi ESC/POS bajti → `printEscposData(byte[])` |
| POST | `/print-text` | JSON z besedilnimi vrsticami (glejte spodaj) |
| OPTIONS | `*` | CORS preflight |

### POST /print-text — format zahteve

```json
{
  "linee":    ["Vrstica 1", "Vrstica 2", "..."],
  "formati":  ["B", "N", "C"],
  "qrUrl":    "https://blagajne.fu.gov.si/...",
  "qrBase64": null,
  "zoi":      "abc123..."
}
```

Kode formatov: `B` = krepko levo, `N` = normalno levo, `C` = sredina,
`R` = desno, `H` = krepki naslov (večji font), `S` = separator.

### NYX preslikava

| POS zahteva | NYX klic |
|-------------|----------|
| besedilne vrstice | `printText(vrstica, PrintTextFormat)` |
| `qrUrl` | `printQrCode(url, 200, 200, ALIGN_CENTER)` |
| `zoi` | `printBarcode(zoi, 400, 80, CODE128, ALIGN_CENTER)` |
| zaključek | `printEndAutoOut()` |
| POST `/print` (ESC/POS) | `printEscposData(byte[])` |

Ob zagonu: `setPaperWidth(576)` za 80 mm papir.

---

## NYX SDK — AIDL datoteke

Projekt vsebuje tri SDK datoteke z **nedotaknjenimi paketi** (`net.nyx.printerservice.print`):

```
app/src/main/aidl/net/nyx/printerservice/print/
    IPrinterService.aidl
    PrintTextFormat.aidl

app/src/main/java/net/nyx/printerservice/print/
    PrintTextFormat.java
```

Vir: [github.com/SZNoryox/PrinterClient](https://github.com/SZNoryox/PrinterClient) (veja `a13`)

> **Nikoli ne spremenite paketa** `net.nyx.printerservice.print` — AIDL mora
> ujemati s sistemskim servisom na napravi.

---

## Gradnja APK

### Predpogoji

- Android Studio (priporočeno: Hedgehog / Iguana ali novejši)
- Android SDK: compileSdk 34, minSdk 26
- JDK 17

### Postopek

```bash
# 1. Odprite direktorij v Android Studio:
#    File → Open → artifacts/nyx-printer-bridge

# 2. Gradnja debug APK (za razvoj):
./gradlew assembleDebug

# APK je na:
# app/build/outputs/apk/debug/app-debug.apk

# 3. Gradnja release APK (za produkcijo):
./gradlew assembleRelease
# (zahteva podpisni ključ — glejte Android Studio dokumentacijo)
```

Alternativno v Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

---

## Namestitev na NB80

### 1. Prenesite APK na napravo

```bash
# Prek ADB (USB debug mora biti vklopljen):
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Ali: kopirajte APK v napravo prek USB in namestite ročno
```

### 2. Dovolite nameščanje neznanih virov

Na NB80: **Nastavitve → Varnost → Neznani viri → dovoli**

### 3. Zaženite aplikacijo

- Odprite **NYX Tiskalni Most** v meniju aplikacij
- Aplikacija samodejno zažene foreground servis
- V obvestilni vrstici se prikaže: *"HTTP strežnik aktiven na localhost:8090"*

### 4. Preverite stanje

```bash
# Na NB80 prek ADB ali iz POS:
curl http://localhost:8090/status
# → {"ok":true,"status":"Tiskalnik pripravljen (80mm)","port":8090}
```

### 5. Avtozagon ob vklopu naprave

Servis se samodejno zažene ob vklopu NB80 (BroadcastReceiver za
`BOOT_COMPLETED` in `LOCKED_BOOT_COMPLETED`). Ni potrebno ročno zaganjati.

---

## Razlike med ZCS in NYX mostom

| | ZcsPrinterBridge | NyxPrinterBridge |
|---|---|---|
| Port | 8090 | **8090 (enak)** |
| Endpointi | /status /print /print-text | **enaki** |
| SDK | ZCS SmartPos JAR + AIDL | NYX AIDL (brez JAR) |
| Package | com.zcs.android | **com.incar.printerservice** |
| Papir | brez setPaperWidth | `setPaperWidth(576)` ob zagonu |
| ESC/POS | strip → SDK | direktno `printEscposData` |
| Šumniki | CP1250 konverzija | UTF-16 Java String (nativno) |

---

## Odpravljanje težav

### "NYX servis ni povezan"

- Preverite, da je `com.incar.printerservice` nameščen: **Nastavitve → Aplikacije**
- Na NB80 sistemu mora biti prisoten printer service — to je vgrajen sistemski servis
- V `/diagnostics` preverite `nyxPackages`

### "bindService vrnil false"

- Naprava morda nima `com.incar.printerservice` — preverite z `adb shell pm list packages | grep incar`
- Preverite `<queries>` blok v manifestu (prisoten)

### "Papir manjka" (status 1)

- Naložite papir v tiskalnik NB80

### Port 8090 zaseden

- Ustavite ZcsPrinterBridge APK pred zagonom NyxPrinterBridge (ne moreta biti aktivna hkrati)
- Preverite z `adb shell ss -tlnp | grep 8090`

### Ponoven zagon ob sesutju

Servis je `START_STICKY` — Android ga samodejno znova zažene. Ob prekinitvi
AIDL vezave se most samodejno rebinda po 5 sekundah.

---

## Struktura projekta

```
artifacts/nyx-printer-bridge/
├── app/
│   ├── build.gradle.kts                      (compileSdk 34, minSdk 26)
│   └── src/main/
│       ├── AndroidManifest.xml               (queries: com.incar.printerservice)
│       ├── aidl/net/nyx/printerservice/print/
│       │   ├── IPrinterService.aidl          (NYX SDK — paket nedotaknjen)
│       │   └── PrintTextFormat.aidl
│       ├── java/net/nyx/printerservice/print/
│       │   └── PrintTextFormat.java          (Parcelable bean)
│       └── java/si/pos/nyxbridge/
│           ├── MainActivity.kt
│           ├── BootReceiver.kt
│           ├── PrintServerService.kt         (HTTP strežnik, port 8090)
│           └── NyxPrinterBridge.kt           (AIDL logika)
├── gradle/libs.versions.toml
├── build.gradle.kts
├── settings.gradle.kts
└── README-NB80.md                            (ta datoteka)
```
