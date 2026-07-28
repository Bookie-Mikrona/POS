---
name: ZCS bridge tiskanje
description: ZCS Z92 tiskanje — SDK buffer limiti, Code 128 ZOI, Strategy A/B
---

## Ugotovitve

### Text batching
- `setPrintAppendString` + `setPrintStart()` ima interni buffer ~45 vnosov
- Rešitev: zanke zamenjati s sklopi po 40 vrstic, vsak s svojim `setPrintStart()`

### setPrintBitmap format
- `setPrintBitmap(ByteArray)` v ZCS SDK **ne** sprejme surovih pikslov
- Pričakuje 1bpp **BMP datoteko z glavo** (BITMAPFILEHEADER + BITMAPINFOHEADER + color table)
- Napaka brez BMP glave: `"width and height must be > 0"`
- Buffer limit: ~960 B → ~20 vrstic pri 384-dot tiskalniku (48 B/vrstica)
- Rešitev: pasovi po 15 vrstic, vsak ovit s `wrapAsBmp()`, vsak `setPrintBitmap` + `setPrintStart`

**Why:** SDK interno dekodira ByteArray kot BMP sliko, bere širino/višino iz BMP glave.

**How to apply:** Za vsak bitmap klic → `printer.setPrintBitmap(wrapAsBmp(rawStrip, PRINTER_DOTS, stripHeight))`.

### Code 128 ZOI namesto QR
- ZCS Z92 ne podpira ESC/POS `GS(k` hardware QR kode
- Zakon (ZDavPR) dopušča Code 128 namesto QR
- ZOI (32 hex znakov) razrezan na 3 dele po ~11 znakov, vsak del = ločena Code 128B črtna koda
- Code 128B: vsak modul = 2 pike (boljša čitljivost), checksum = (104 + Σ(i × sym)) mod 103

### Strategy A vs B
- Strategy A (device file): ESC/POS direktno → `GS V 0` odrez, brez 21cm limite
- Strategy B (ZCS SDK): `setPrintStart()` = 21cm fiksna dolžina
- Device datoteka postane dostopna šele po SDK inicializaciji → re-check ob vsakem `printText()` klicu
- Ko je terminal v Strategy B, Code 128 prek `setPrintBitmap(BMP)` + pasovi

### ZOI prenos
- API strežnik `/print/racun/:id/zcs` zdaj vrne `zoi` polje v JSON
- `PrintServerService.kt` bere `zoi` iz JSON in ga pošlje `bridge.printText(..., zoi)`
