---
name: POS tiskanje
description: Kazalo potrjenih posebnosti tiskalnikov, kodnih strani in oblikovanja računov.
---

Pri tiskanju uporabi potrjena pravila za konkretno napravo, ne splošnega privzetega profila.

**Why:** Različne naprave imajo različne omejitve pisave, kodnih strani in širine izpisa. Namestitveni paket lahko odstopa od trenutno prikazane izvorne različice.

**How to apply:** Preberi ustrezni obstoječi podrobni zapis:

- [ZCS most in preverjanje konkretnega APK](zcs-bridge-tiskanje.md).
- [Bluetooth tiskalniki in kodne strani po napravi](bt-tiskalniki-kodna-stran.md).
- [Potrjeni format postavk in širine izpisa](tiskanje-format-tabele.md).

## Brskalniki za tiskane PDF-je

V tem Replitovem Linux okolju se WebKitGTK WebDriver lahko zažene, vendar MiniBrowser ob prvi navigaciji pade z `EGL_BAD_PARAMETER`, tudi pod Xvfb. Ustvarjena WebDriver seja zato še ne pomeni, da je WebKit izris preverjen; Safari/WebKit preveri na delujočem WebKit okolju, najbolje v Safariju na macOS.

**Why:** Headless WebKitGTK v razpoložljivem okolju ni uspel prikazati strani, zato njegovega PDF izpisa ni bilo mogoče zanesljivo preveriti.

**How to apply:** Če je treba potrditi Safari/WebKit tiskanje, uporabi resničen Safari ali drug delujoč WebKit runner; Chromium in Firefox ne štejeta kot dokaz za WebKit.