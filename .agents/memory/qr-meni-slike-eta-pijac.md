---
name: QR meni slike in ETA pijač
description: Dogovor za stabilen široki format slik in ločeno oceno samo za pijače.
---

QR meni uporablja širok slikovni format **2,5 : 1**, pri čemer mora javni prikaz ohraniti že pripravljeni izsek.

**Why:** Razmerje je uporabniško potrjen kompromis med širokim prikazom in dovolj višine za prepoznavo motiva na kartici menija.

**How to apply:** Pri novih slikovnih virih za QR meni ohrani 2,5 : 1 in prikaži celoten že pripravljeni izsek.

AI-generirane slike zahtevajo nativni panoramski 21 : 9 kader pri 2K in varni pas nad/pod artiklom; nato se sredinsko standardizirajo na 1500 × 600. Ročni upload ostane uporabniško izbran izrez.

**Why:** Gemini ne podpira natančnega 5 : 2 oziroma 1500 × 600 izvornega formata; 21 : 9 je najbližji podprti široki vir. Brez API nastavitve je model vračal kvadratne kompozicije, ki jih ni mogoče kakovostno pretvoriti v široko kartico.

**How to apply:** AI-generiran tok naj posreduje `imageConfig` z `aspectRatio: "21:9"` in `imageSize: "2K"`, poziv pa naj zahteva varen navpični rob. Končni WebP vedno ostane 1500 × 600; ročni upload uporablja privzeti `cover` po dialogu za izrez.

Čisto naročilo pijač uporablja ločeno barsko oceno; mešano naročilo ostane v kuhinjski oceni.
Pri ponovnem izračunu tip in trajanje določajo samo še nepripravljene postavke
istega naročila. Že pripravljena hrana ne sme nove pijače spremeniti v mešano
naročilo ali ji podaljšati roka.

**Why:** Pijače ne smejo čakati na delovno obremenitev kuhinje, medtem ko mešano naročilo gostu še vedno potrebuje enoten čas priprave.

**How to apply:** Pri spremembah ETA ohrani ločeni barski in kuhinjski delovni vrsti ter iz ciljnih postavk vedno izloči že pripravljene.