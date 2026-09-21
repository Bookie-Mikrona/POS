---
name: Python PDF generator
description: Zanesljiv zagon ReportLab generatorja priročnika v tem Replit okolju.
---

Generator PDF-priročnika zaženi prek `uv run python`, ne neposredno prek `python3`.

**Why:** Neposredni `python3` lahko uporabi nezdružljivo kombinacijo Pythona in Pillow iz `.pythonlibs` ter odpove pri uvozu `PIL._imaging`, čeprav so paketi nameščeni.

**How to apply:** Za skripte, ki uporabljajo ReportLab ali Pillow, najprej uporabi `uv run python <skripta>`. Neposredni sistemski Python uporabi le, če je uvoz binarnih modulov posebej preverjen.