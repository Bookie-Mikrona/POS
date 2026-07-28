---
name: ZCS bridge tiskanje
description: ZCS Z92 tiskanje — SDK metode, QR koda, Code 128, Strategy A/B
---

## Ugotovitve

### Text batching
- `setPrintAppendString` + `setPrintStart()` ima interni buffer ~45 vnosov
- Rešitev: zanke zamenjati s sklopi po 40 vrstic, vsak s svojim `setPrintStart()`

### setPrintBitmap — NAPAČNA METODA za QR/barcode
- `setPrintBitmap(ByteArray)` je namenjena logotipom/glavam, NE za QR ali črtne kode
- Vsak format (raw 1bpp, BMP z glavo, PNG) vrže `"width and height must be > 0"`
- **Ne poskušaj je znova použiti za QR/barcode**

**Why:** SDK ima ločene specializirane metode za QR in barcode.

### Pravilne SDK metode za QR in barcode
```
setPrintAppendQRCode(String, int width, int height, Layout.Alignment)  → void
setPrintAppendBarCode(Context, String, int w, int h, Boolean, Layout.Alignment, BarcodeFormat)  → void
printEpson(byte[])  → int   // surovi ESC/POS bajti
```
- `BarcodeFormat` iz `core-3.2.1.jar` (ZXing, že v projektu)
- QR koda: `setPrintAppendQRCode(qrUrl, 200, 200, ALIGN_CENTER)`
- Code 128: `setPrintAppendBarCode(ctx, zoi.uppercase(), 400, 80, false, ALIGN_CENTER, BarcodeFormat.CODE_128)`

**How to apply:** Vedno uporabi te metode v Strategy B. Za surove ESC/POS bajte je na voljo `printEpson(byte[])`.

### Trailing feed po QR/barcode
- Po `setPrintStart()` za QR/barcode je treba dodati 4 prazne vrstice pred finish `setPrintStart()`
- Brez tega pri odtrganju traku manjka ~5mm — koda je odrezana

### Strategy A vs B
- Strategy A (device file): ESC/POS direktno → `GS V 0` odrez, brez 21cm limite
- Strategy B (ZCS SDK): `setPrintStart()` = 21cm fiksna dolžina
- Device datoteka postane dostopna šele po SDK inicializaciji → re-check ob vsakem `printText()` klicu

### ZOI prenos
- API strežnik `/print/racun/:id/zcs` vrne `zoi` polje v JSON
- `PrintServerService.kt` bere `zoi` iz JSON in ga pošlje `bridge.printText(..., zoi)`
