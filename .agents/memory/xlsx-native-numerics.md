---
name: XLSX native numerics
description: Typed XLSX channel preserves locale-aware text parsing while using cached Excel numbers only for declared numeric fields.
---

**Rule:** Keep the default XLSX matrix and object adapters text-only. Consumers may opt into native ExcelJS values only through the typed channel and only for explicitly declared numeric columns; identifiers, headers, and other text fields always use rendered text.

**Why:** Slovenian text parsing correctly treats a dot as a thousands separator in values such as `5.476`. Excel formula results can have the same display text while their cached numeric value is 5.476, so parsing the display string causes a 1000× price error. A global switch to numbers would lose formatting-protected leading zeros in GTINs and other identifiers.

**How to apply:** For XLSX formulas use the cached numeric result when available, then pass it directly to the Decimal parser. Retain existing string parsing for CSV and text-entered XLSX values. Do not infer identifier semantics solely from an Excel cell type.