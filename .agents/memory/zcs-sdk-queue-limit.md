---
name: ZCS SDK queue limit in besedilni chunking
description: ZCS setPrintAppendString() strategije za tiskanje daljših računov brez odrezavin in pavz
---

## Pravilo

ZCS SDK `setPrintAppendString()` dodaja vsak klic kot POSTAVKO v interno vrsto — meja je ~32 postavk.
Ko vrsta prepolni, SDK tiho zavrže preostale vrstice. Prav tako en ogromen joined string z `\n` pri
daljših računih (~49+ vrstic) sporadično povzroči OOM pri renderiranju bitmapa.

**Why:** Ugotovljeno empirično. Byte-level razlaga ni ustrezala — batch po 25 vrstic ni pomagal.

## SDK metode (iz SmartPos_1.8.1_R231213.jar bytecode)

- `setPrintAppendString(String, PrnStrFormat): void` — doda ENO vrstico (ali joined string)
- `setPrintAppendStrings(String[], int[], PrnStrFormat[]): void` — **NE DELUJE**: int[]=0 sproži "width/height must be > 0"; semantika int[] ni dokumentirana
- `setPrintStart(): int` — sproži tisk buffra, vrne kodo
- `setPrintString(String): void` — neposreden tisk brez formatiranja

## Rešitev (končna, potrjena v1.1.0)

**Chunki po 800 znakov, en sam `setPrintStart()`:**

```kotlin
val MAX_CHARS = 800
var chunkStart = 0
while (chunkStart < lines.size) {
    val sb = StringBuilder()
    var j = chunkStart
    while (j < lines.size && sb.length < MAX_CHARS) {
        val line = if (lines[j].isBlank()) " " else lines[j]
        if (sb.isNotEmpty()) sb.append("\n")
        sb.append(line)
        j++
    }
    val isBold = formati != null && chunkStart < formati.size && formati[chunkStart] == "B"
    if (j >= lines.size) sb.append("\n \n ")  // odmik samo na zadnjem chunku
    printer.setPrintAppendString(sb.toString(), if (isBold) boldFormat else format)
    chunkStart = j
}
printer.setPrintStart()
```

- Kratki računi (< ~27 vrstic = ~810 znakov) = **1 klic**, brez pavz
- Daljši računi = 2+ klicev, **EN** `setPrintStart()` → tiskalnik ne dela vmesnih pavz
- Prazne vrstice `""` → zamenjaj s `" "` (sicer "width/height must be > 0")

**Why:** En `setPrintStart()` = en tiskalni job = tiskalnik tiska neprekinjeno.
Chunki po 800 znakov = majhni bitmappe (~25 vrstic × 384px) → ni OOM.

## Zavrnjeni pristopi

| Pristop | Problem |
|---|---|
| `setPrintAppendString` ena vrstica na klic | Prepolni vrsto pri >32 vrsticah → tiha odrezava |
| Grupiraj po formatu (4–6 klicev) | Opazne pavze med segmenti med tiskanjem |
| En joined string z `\n` (1 klic) | Sporadična odrezava pri ~49+ vrsticah (OOM bitmap) |
| `setPrintAppendStrings([], int[], [])` | int[]=0 → "width/height must be > 0"; nedokumentirana API |
| Batch + vmesni `setPrintStart()` | Drugi batch ignoriran (printer busy) |
