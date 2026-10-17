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

V tem Replitovem Linux okolju Safari ni na voljo. WebKitGTK WebDriver lahko ustvari sejo MiniBrowser, vendar njegov ukaz WebDriver `/print` vrne `unknown command`; seja ali uspešno odprta stran zato še ne pomeni, da je PDF tiskanje preverjeno. Nekatere headless nastavitve lahko še vedno naletijo na `EGL_BAD_PARAMETER`.

**Why:** Razpoložljivi WebKitGTK runner ne izpiše PDF-ja prek WebDriverja, Safari pa ni nameščen; Chromium in Firefox ne dokazujeta Safari-jevega izpisa.

**How to apply:** Safari/WebKit tiskanje potrdi na macOS z resničnim Safarijem ali drugim WebKit runnerjem, ki zna izpisati PDF, in preveri dejanski PDF. Pri WebKit diagnostiki uporabi allowlist okolja in ne izpisuj surovih dnevnikov procesa, saj lahko vsebujejo podedovane spremenljivke okolja.

## Besedilno preverjanje PDF-jev z ovitimi celicami

`pdftotext -layout` lahko besedilo iz ovite celice tabele razporedi med besedilo sosednjih stolpcev. Odsotnost ene strnjene podnizne vrednosti zato sama po sebi ne dokazuje, da je tiskani PDF vsebino odrezal.

**Why:** Chromium lahko prelomljeni dobaviteljev šifrant izpiše v besedilnem vrstnem redu med vrednostjo sosednjega stolpca, čeprav so vse besede vidne v PDF-ju.

**How to apply:** Za ovite celice primerjaj besede iz PDF-geometrije, filtrirane po vrstici in stolpcu; strnjena besedilna preverjanja uporabljaj le za vrednosti, katerih vrstni red izluščeno besedilo zanesljivo ohrani.