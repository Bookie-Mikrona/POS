# ZCS Tiskalni Most — Android APK

Lokalni HTTP strežnik na ZCS Z92 (port **8090**), ki prejme zahtevo za tisk od POS
spletne aplikacije in jo posreduje vgrajenemu tiskalniku prek ZCS AIDL SDK.

## Fiskalna osnova

Projekt deli izvorno kodo `../bookie-fiscal-android-core` z mostom NYX. Jedro
uporablja transakcijski SQLite dnevnik: pred izdajo rezervira unikaten PP-B
zaporedni zapis, shrani nespremenjeni kanonični ovojnici in ji doda preverljivo
SHA-256 verigo. Ovojnica je v zbirki šifrirana z AES-GCM ključem Android
Keystore; stanje tiska in stanje sinhronizacije sta ločena.

Normativni API posluša izključno na `http://127.0.0.1:17831/v1`; tiskalni API na
8090 je ločen in ostaja združljiv. Contract določa `furs-v1`,
OfflineAuthorityBundle in izpeljavo; jedro preveri zaupanja vreden ključ, podpis,
hash, scope, različico, preklic, veljavnost in attestation. Celotni furs-v1 golden
vektorji se izvajajo kot JVM testi. Produkcijska izdaja ostane fail-closed, dokler
lokalni dinamični XMLDSig generator, tiskalnik in cilj sinhronizacije niso
provisioned in health-checked; do takrat `/capabilities` vrne `ready:false`.

## Arhitektura

```
Chrome (POS app) ──POST /print-text──▶ localhost:8090 ──▶ ZCS AIDL SDK ──▶ vgrajen tiskalnik
```

---

## ⚠️ Nativne knjižnice (OBVEZNO pred gradnjo)

APK **ne deluje** brez nativnih `.so` knjižnic — brez njih se ob zagonu sesuje z napako:
> `java.lang.UnsatisfiedLinkError: libSmartPosJni.so not found`

Knjižnici, ki ju moraš pridobiti ročno in ju shraniti v projekt:

```
app/src/main/jniLibs/armeabi-v7a/
├── libSmartPosJni.so   (~374 KB)   ← obvezna; vsebuje 16 tiskalniških JNI metod
└── libEmvCoreJni.so    (~162 KB)   ← potrebna za inicializacijo SDK
```

### Kako pridobiti `.so` datoteki

Vir: prednameščena aplikacija na ZCS terminalu (`SmartPosTest`):

```bash
# 1. Poišči APK na terminalu
adb shell ls /system/pre_install/

# 2. Prenesi na PC
adb pull /system/pre_install/SmartPosTest-release_V2.0.6_2025-04-09.apk .

# 3. Izlušči .so (APK je ZIP)
unzip SmartPosTest-*.apk "lib/armeabi-v7a/libSmartPosJni.so" -d extracted
unzip SmartPosTest-*.apk "lib/armeabi-v7a/libEmvCoreJni.so" -d extracted

# 4. Kopiraj v projekt
cp extracted/lib/armeabi-v7a/*.so \
   artifacts/zcs-printer-bridge/app/src/main/jniLibs/armeabi-v7a/
```

Alternativno: pridobi iz uradnega ZCS SDK paketa (od distributerja).

> **Opomba:** `.so` datoteke niso v git repozitoriju (binarke). `.gitkeep` označuje
> mapo — preden gradiš, moraš ročno dodati obe datoteki.

### Združljivost (preverjeno 9. 8. 2026)

| Komponenta | Verzija |
|---|---|
| `SmartPos_1.8.1_R231213.jar` | SDK 1.8.1 |
| `libSmartPosJni.so` iz SmartPosTest v2.0.6 | 308 JNI metod (SDK potrebuje 302) |
| Tiskalniške metode (`sdkPrn*`) | ✅ vseh 16 prisotnih |
| Plačilne metode (`blePay`, `Usb`) | ⚠️ 11 manjka (ni potrebno za tisk) |
| Naprava | ZCS Z92, armeabi-v7a (32-bit) |

---

## Gradnja APK

### Zahteve

- Android Studio (Ladybug ali novejši) ali JDK 17 + Android SDK 34
- `.so` knjižnici v `app/src/main/jniLibs/armeabi-v7a/` (glej zgoraj)

### Postopek

```bash
# V mapi artifacts/zcs-printer-bridge/
./gradlew assembleRelease
# ali v Android Studio: Build → Build APK(s)
```

APK je v `app/build/outputs/apk/release/app-release.apk`

> **Gradle konfiguracija:** `ndk { abiFilters += "armeabi-v7a" }` — APK vsebuje samo
> 32-bitne knjižnice (ustrezno za ZCS Z92). Ne odstranjaj tega filtra.

### Verzije

| versionCode | versionName | Datum | Opomba |
|---|---|---|---|
| 1 | 1.0.0 | — | Brez `.so` → ob zagonu sesuje |
| 2 | 1.1.0 | 9. 8. 2026 | Prva delujoča verzija (`.so` iz SmartPosTest APK) |

---

## Namestitev na ZCS Z92

```bash
adb install app/build/outputs/apk/release/app-release.apk
```

Ali prenesi APK na napravo in ga namestitvi ročno (dovoli neznane vire v Nastavitvah).

## Zagon

1. Odpri aplikacijo **ZCS Tiskalni Most** na Z92
2. Zaslon prikaže: `HTTP strežnik: aktiven` + `Tiskalnik: AIDL povezan ✓`
3. Minimiziraj — **NE zapiraj**
4. V POS aplikaciji izberi **ZCS Android most** v meniju tiskanja

---

## API

### GET /status
```json
{ "ok": true, "status": "AIDL povezan ✓", "port": 8090 }
```

### POST /print-text
Telo: JSON z vrsticami in opcijskimi ZOI/QR podatki.

```json
// Uspeh
{ "ok": true }

// Napaka
{ "ok": false, "error": "Papir zmanjka" }
```

CORS je omogočen za vse izvore (zahtevano za Chrome → localhost).

---

## Odpravljanje težav

| Problem | Rešitev |
|---|---|
| `libSmartPosJni.so not found` ob zagonu | Dodaj `.so` datoteki v `jniLibs/armeabi-v7a/` in znova zgradi APK |
| `Tiskalnik NEDOSTOPEN` | Preveri, da je APK verzija ≥ 1.1.0 (z `.so`) |
| `AIDL bind napaka` | Preveri paket ZCS storitve: `adb shell pm list packages \| grep zcs` |
| Most "ni dosegljiv" kljub aktivnemu APK | Star proces drži port — restart aplikacije na napravi |
| Chrome blokira zahtevo | Preveri CORS glave; URL mora biti `http://localhost:8090` |
| Strežnik se ustavi | Omogoči "Teči v ozadju" v Nastavitvah baterije |

## Preveritev delovanja (iz PC)

```bash
# Stanje
adb shell curl http://localhost:8090/status

# Testni tisk (JSON format)
adb shell curl -X POST http://localhost:8090/print-text \
  -H "Content-Type: application/json" \
  -d '{"lines":["Testni tisk","===================="],"formati":["B","N"]}'
```
