---
name: Izolacija finančnih integracijskih testov
description: Kako preverjati dejanske ERP knjižbe brez trajnih testnih revizijskih sledi v skupni razvojni bazi.
---

Integracijske teste, ki ustvarijo knjižbe in zapiranja partnerjev, izvedi v zunanji transakciji z razveljavitvijo celotnega testnega nabora. Vsi klici aplikacijske baze morajo uporabljati isto povezavo, transakcije poti pa notranje savepointe.

**Why:** Dejanska plačila ustvarijo append-only revizijske dogodke. Običajno brisanje testnih knjižb nato zadene zaščitene reference; popuščanje sprožilcev samo zaradi čiščenja bi obšlo finančno integriteto, ohranjanje vsakega testnega podjetja pa onesnaži skupno razvojno bazo.

**How to apply:** Transakcijo razveljavi tudi ob neuspelem preverjanju. Ne onemogočaj zaščit in ne spreminjaj trajnih uporabniških knjižb. Za brskalniški preizkus uporabljaj prestrežene sintetične finančne odgovore; resnično knjiženje preveri v izoliranem integracijskem testu.

Pri brskalniških preizkusih nad sintetičnimi podatki preveri prestrezanje mutacije pred prvim klikom in neodvisno blokiraj vse neprestrežene aplikacijske zapise. Uspešno prestrezanje GET ne dokazuje, da je varen tudi PUT ali POST.

**Why:** Prejšnji POS preizkus je prestregel testni seznam podjetij, ne pa spremembe paketa; zahtevek je prišel do dejanskega strežnika in bil šele tam zavrnjen z 403. Tudi stran nastavitev lahko ob odprtju samodejno registrira napravo.

**How to apply:** Kadar prestrezanje omrežnih zahtev ni zanesljivo, uporabi lokalni fetch stub v brskalniku, preverjen s poskusnim zahtevkom, in dodatno neodvisno omrežno varovalo brez fallbacka za neprestrežene zapise. Preveri tudi samodejne zagonske POST zahteve; ne oslabi dejanske avtorizacije.
