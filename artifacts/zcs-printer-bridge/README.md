# ZCS Tiskalni Most — Android APK

Lokalni HTTP strežnik na ZCS Z92 (port **8090**), ki prejme ESC/POS bajte od POS
spletne aplikacije in jih posreduje vgrajenemu tiskalniku prek ZCS AIDL SDK.

## Arhitektura

```
Chrome (POS app) ──POST /print──▶ localhost:8090 ──▶ ZCS AIDL ──▶ vgrajen tiskalnik
```

## Gradnja APK (Android Studio)

1. **Namestite Android Studio** (Ladybug ali novejši): https://developer.android.com/studio
2. Odprite mapo `artifacts/zcs-printer-bridge/` kot projekt
3. **ZCS SDK** (zahtevano za AIDL pot):
   - Pridobite `sdk.jar` od ZCS (https://www.zcsmart.com / vaš ZCS distributer)
   - Kopirajte ga v `app/libs/sdk.jar`
   - V `app/build.gradle.kts` odkomentirajte vrstico `implementation(fileTree(...))`
4. Kliknite **Build → Build Bundle(s)/APK(s) → Build APK(s)**
5. APK je v `app/build/outputs/apk/debug/app-debug.apk`

### Brez ZCS SDK (datotečni dostop)

Aplikacija deluje tudi brez SDK — samodejno poskusi pisati na `/dev/stprinter`,
`/dev/thermal_printer` itd. Deluje na nekaterih modelih brez dodatnih dovoljenj.

## Namestitev na ZCS Z92

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Ali prenesite APK na napravo in ga namestite ročno (dovolite neznane vire v Nastavitvah).

## Zagon

1. Odprite aplikacijo **ZCS Tiskalni Most** na Z92
2. Zaslon prikaže: `HTTP strežnik: aktiven` + `Tiskalnik: AIDL povezan ✓`
3. Minimizirajte — NE zapirajte
4. V POS aplikaciji izberite **ZCS Android most** v meniju tiskanja

## API

### GET /status
```json
{ "ok": true, "status": "AIDL povezan ✓", "port": 8090 }
```

### POST /print
Telo zahteve: surovi ESC/POS bajti (`Content-Type: application/octet-stream`)

```json
// Uspeh
{ "ok": true }

// Napaka
{ "ok": false, "error": "Papir zmanjka" }
```

CORS je omogočen za vse izvore (zahtevano za Chrome → localhost).

## Odpravljanje težav

| Problem | Rešitev |
|---|---|
| `Tiskalnik NEDOSTOPEN` | Preverite ZCS SDK ali datotečna dovoljenja |
| `AIDL bind napaka` | Preverite paket ZCS storitve z `adb shell pm list packages \| grep zcs` |
| Chrome blokira zahtevo | Preverite CORS glave; preverite, da je URL `http://localhost:8090` |
| Strežnik se ustavi | Omogočite "Teči v ozadju" za aplikacijo v Nastavitvah baterije |

## Preveritev delovanja (iz PC)

```bash
# Stanje
adb shell curl http://localhost:8090/status

# Testni tisk (ESC/POS: inicializacija + besedilo + odrez)
adb shell 'printf "\x1B\x40Testni tisk\n\n\n\x1D\x56\x00" | curl -X POST http://localhost:8090/print --data-binary @- -H "Content-Type: application/octet-stream"'
```
