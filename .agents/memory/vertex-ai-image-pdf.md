---
name: Vertex AI image/base64 omejitev
description: Replit Anthropic integration (Vertex AI proxy) ne sprejema image/base64 blokov — samo PDF dokumente.
---

# Vertex AI image/base64 omejitev

## Pravilo
Replit Anthropic AI integration gre prek Vertex AI proxy, ki zavrne `type: 'image'` bloke z `source.type: 'base64'` (tako PNG kot JPEG):
```
"messages.0.content.0.image.source.base64.data: Image format image/png not supported"
```

## Rešitev
PNG/JPEG sliko pred pošiljanjem Claudu zavij v enostranski PDF z `pdfkit`:
```typescript
const doc = new PDFDocument({ autoFirstPage: false, compress: true });
const img = doc.openImage(imgBuf);
doc.addPage({ size: [img.width, img.height], margin: 0 });
doc.image(imgBuf, 0, 0, { width: img.width, height: img.height });
```
Pošlji kot `type: 'document'`, `media_type: 'application/pdf'`.

**Why:** Vertex AI proxy podpira PDF dokumente (32MB limit, 100 strani), ne pa image/base64 blokov. Claude interno renderira PDF strani kot slike in naredi vizualni OCR — enaka kakovost.

## Ključne podrobnosti (po Claudovi konzultaciji)
- `compress: true` — manjši PDF, enaka OCR kakovost (image compress je neodvisen od tega flaga)
- Ne skaliraj slike v `doc.image()` — uporabi originalne piksle 1:1
- 300 DPI je varen (32MB PDF limit >> 5MB image limit)
- PDF limit: 32MB skupaj, 100 strani
