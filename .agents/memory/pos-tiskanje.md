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

Chromiumovi robni bloki `@page` za glavo/nogo so v preverjenem PDF-ju delovali; Firefox 140 jih v WebDriver PDF-ju ni izrisal. Številčenje strani zato preveri v PDF-ju ciljnega brskalnika, ne le v DOM-u ali CSS-ju.

**Why:** CSS `@page` robne vsebine nimajo enake podpore v vseh brskalnikih, različica Firefox 140 pa v testu ni ustvarila vsebine robnega bloka.

**How to apply:** Pri številkah strani ali drugih glavi/nogi uporabi dejanski brskalniški PDF; Chromiumov uspeh ne dokazuje enakega izpisa v Firefoxu ali Safariju.

## Besedilno preverjanje PDF-jev z ovitimi celicami

`pdftotext -layout` lahko besedilo iz ovite celice tabele razporedi med besedilo sosednjih stolpcev. Odsotnost ene strnjene podnizne vrednosti zato sama po sebi ne dokazuje, da je tiskani PDF vsebino odrezal.

**Why:** Chromium lahko prelomljeni dobaviteljev šifrant izpiše v besedilnem vrstnem redu med vrednostjo sosednjega stolpca, čeprav so vse besede vidne v PDF-ju.

**How to apply:** Za ovite celice primerjaj besede iz PDF-geometrije, filtrirane po vrstici in stolpcu; strnjena besedilna preverjanja uporabljaj le za vrednosti, katerih vrstni red izluščeno besedilo zanesljivo ohrani.

Firefox lahko pri izluščanju PDF-ja zaporedje »fi« predstavi kot Unicode ligaturo U+FB01, čeprav je vsebina PDF-ja pravilna.

**Why:** Različni brskalniki in pisave lahko enako besedilo kodirajo z združenimi glifi, zato natančna primerjava navadnega besedila po brskalnikih lahko napačno odpove.

**How to apply:** Pred primerjavo PDF-besedila uporabi Unicode NFKC normalizacijo ali preveri ustrezne besede in geometrijo; ne sklepaj, da je besedilo manjkajoče samo zaradi ligature.

`pdftotext -layout` lahko prelomi tudi dolg identifikator v glavi med več vrstic, ne da bi bil v PDF-ju odrezan.

**Why:** Večstranski PDF lahko pravilno izriše številko prejemnice, razdeljeno na dve vrstici; navaden `includes` nad izluščenim besedilom jo zato zgreši.

**How to apply:** Za identifikatorje in nazive, ki se lahko ovijejo, najprej primerjaj besedilo brez presledkov; za celovitost postavk preverjaj besede znotraj geometrije njihove vrstice.
## Vsebina celice, razdeljena med strani

Pri dokazovanju popolnosti zelo dolge tiskane celice primerjaj geometrijske besede po stolpcu in po vrstnem redu strani; izloči ponovljene glave/noge, ne pa besed, ki jih je brskalnik razdelil na mejah strani. Pred primerjavo normaliziraj tipografske ligature, kot sta `ﬁ` in `ﬂ`.

**Why:** Chromium in Firefox lahko prelomita dobaviteljevo šifro med strani, Firefoxov PDF pa lahko vsebuje ligaturne znake namesto zaporedja črk. Preprosto iskanje podniza zato lažno označi vidno besedilo kot manjkajoče.

**How to apply:** Za večstranske celice sestavi besede iz posamezne stolpčne geometrije v vrstnem redu strani in posebej preveri, da se noben besedni okvir ne prekriva z drugim.
