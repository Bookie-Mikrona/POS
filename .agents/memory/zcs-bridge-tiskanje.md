---
name: ZCS bridge tiskanje
description: ZCS Z92 tiskanje — SDK metode, QR koda, Code 128, Strategy A/B, razmiki
---

## Ugotovitve

### Text batching
- `setPrintAppendString` + `setPrintStart()` ima interni buffer ~45 vnosov
- Rešitev: sklopi po 40 vrstic, vsak s svojim `setPrintStart()`

### setPrintBitmap — NAPAČNA METODA za QR/barcode
- `setPrintBitmap(ByteArray)` je za logotipe/glave, NE za QR ali črtne kode
- Vsak format (raw 1bpp, BMP z glavo, PNG) vrže `"width and height must be > 0"`
- **Ne poskušaj je znova použiti za QR/barcode**

**Why:** SDK ima ločene specializirane metode za QR in barcode.

### Pravilne SDK metode za QR in barcode (potrjeno delujoče na Z92)
```
setPrintAppendQRCode(String, int width, int height, Layout.Alignment)  → void
setPrintAppendBarCode(Context, String, int w, int h, Boolean, Layout.Alignment, BarcodeFormat)  → void
printEpson(byte[])  → int   // surovi ESC/POS bajti
setPrintAppendBitmap(Bitmap, Layout.Alignment)  → void  // za slike (ne QR)
```
- `BarcodeFormat` iz `core-3.2.1.jar` (ZXing, že v projektu) → `import com.google.zxing.BarcodeFormat`
- QR koda: `setPrintAppendQRCode(qrUrl, 200, 200, ALIGN_CENTER)`
- Code 128: `setPrintAppendBarCode(ctx, zoi.uppercase(), 400, 80, false, ALIGN_CENTER, BarcodeFormat.CODE_128)`

**How to apply:** Vedno te metode v Strategy B. Ne `setPrintBitmap`.

### Razmiki na računu (potrjeno na Z92, ~7 mm/vrstica pri textSize 24)
- Med koncem teksta in QR kodo: **2 prazni vrstici** (~14 mm) ✓
- Po QR kodi (pred odtrganjem): **2 prazni vrstici** (~14 mm) ✓
- Manj kot 2 vrstici po QR → trak odreže kodo pri trganju

**Why:** Odtrgalni rob Z92 je ~10 mm nad glavo tiskalnika; brez dovolj prostora je koda odrezana.

### Strategy A vs B
- Strategy A (device file): ESC/POS direktno → `GS V 0` odrez, brez 21cm limite
- Strategy B (ZCS SDK): `setPrintStart()` = 21cm fiksna dolžina
- Device datoteka postane dostopna šele po SDK inicializaciji → re-check ob vsakem `printText()` klicu

### ZOI prenos
- API strežnik `/print/racun/:id/zcs` vrne `zoi` polje v JSON
- `PrintServerService.kt` bere `zoi` iz JSON in ga pošlje `bridge.printText(..., zoi=...)`
