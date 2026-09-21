---
name: Knjiženje POS nabavnih listin
description: Računovodska razmejitev dobavnice, dobavnice-fakture in neposredne porabe.
---

Konto 109 je namenjen izključno denarju na poti in se ne uporablja za nabavo. Pri dobavnici-fakturi se prejeti račun knjiži neposredno: zaloga 310 ali poraba 400 ter vhodni DDV na 7-mestno analitiko skupine 160 v breme, obveznost do dobavitelja 220 v dobro. Če je listina že plačana z gotovino, se obveznost še vedno pripozna na 220, nato pa zapre z D 220 / C 100. Če podjetje uporablja obračun nabave, je prehodni konto v skupini 300, razknjiženje na zalogo pa je D 310 / C 300.

**Why:** Uporabnik je izrecno potrdil veljavno razmejitev enotnega kontnega načrta: 109 je denar na poti, ne obračun nabave. Dobavnica-faktura je hkrati prevzem in prejeti račun ter mora ustvariti dobaviteljevo obveznost.

**How to apply:** Pred knjiženjem vedno razloči samo dobavnico od dobavnice-fakture. Dobavnica-faktura gre neposredno skozi prejeti račun; za KPR in veljavnost vhodne DDV kode uporabi datum prejema povezane POS listine, datum fakture pa ohrani kot datum dokumenta in temeljnice. Če OCR plačilni način vsebuje obliko »gotovin…« ali »cash«, ustvari C 220 za račun ter ločeno D 220 / C 100 za gotovinsko poravnavo; ne preskoči obveznosti. Vhodni DDV izberi po stopnji iz podjetniških nastavitev in vedno uporabi aktivno 7-mestno analitiko, ki dovoljuje knjiženje; nikoli ne knjiži na sintetični `160`. Prehod skupine 300 uporabi le, ko ga zahteva izbrana metoda obračuna nabave. Nikoli ne ustvarjaj nabavne analitike v skupini 109. Plačilni TRR, BIC, model, sklic, namen in rok shrani kot posnetek konkretnega prejetega računa; pri SEPA izvozu ima ta posnetek prednost pred trenutnimi privzetimi podatki partnerja.

Vsaka prejemnica ima izrecno kljukico »Plačano z gotovino«. OCR jo samo začetno označi pri nedvoumnem zapisu gotovine; uporabnikova shranjena izbira vedno preglasi besedilo listine.

**Why:** gotovinsko plačilo je lahko dokazano z ločenim blagajniškim prejemkom, OCR pa lahko zapis na listini napačno prepozna.

**How to apply:** kljukico je dovoljeno spreminjati le na osnutku. Označena pomeni C 220 za račun in nato D 220 / C 100 za plačilo; neoznačena pri računu pomeni samo C 220, tudi če staro besedilo vsebuje »gotovina«.

Originalne listine so že označene kot faktura-dobavnica, zato uporabnik vrste dokumenta ne določa ročno. OCR mora oznako obravnavati kot račun ter zajeti datum zapadlosti, plačilni TRR/IBAN, BIC, način, model, sklic in namen plačila.

V temeljnici POS prejemnice je vsak konto samo ena vrstica; zalogovni opisi so »Surovina«, »Blago« in »Embalaža«. Podrobni DDV razrez se ob knjiženju bere iz nespremenljive potrjene prejemnice, ne iz združene GL vrstice.

**Why:** združevanje po kontu izboljša preglednost, vendar ena vrstica ne more nositi več različnih DDV kod. Izvorna prejemnica ohrani pravilen razrez za KPR.

**How to apply:** GL vrstice združuj po kontu, strani, partnerju in stroškovnem mestu. Pri knjiženju prejemnice sestavi DDV evidenco iz njenih postavk in odvisnih stroškov.

Posamezna vrstica prejemnice ima stabilno obravnavo: zaloga, neposredna poraba surovin ali prevozna storitev pri nabavi. Neposredni vrsti ne zahtevata artikla in nikoli ne ustvarita zalogovnega ali embalažnega prometa.

**Why:** storitev in takoj porabljenih surovin ni smiselno vnašati v šifrant ali fizično zalogo, njihov znesek in DDV pa morata ostati v nabavni temeljnici in KPR.

**How to apply:** obravnave ne ugibaj iz naziva OCR vrstice. Uporabnik jo izbere pred potrditvijo; strošek surovin in prevoz uporabljata vsak svoj nastavljeni konto razreda 4.

Računovodski osnutek se pripravi ročno iz potrjene prejemnice; potrditev zaloge mora odpreti predogled, ne pa samodejno knjižiti. Pri zgodovinski listini datum dokumenta določa temeljnico in odprto obdobje, datum prejema pa ostane ločen in določa veljavnost vhodne FURS DDV kode.

**Why:** Potrditev zaloge in računovodska odobritev sta ločena koraka. Stara faktura je lahko v odprtem zgodovinskem obdobju, prejeta pa pozneje, zato en sam datum napačno blokira bodisi glavno knjigo bodisi DDV evidenco.

**How to apply:** Potrjene prejemnice ostanejo vsebinsko nespremenljive, vendar smejo prek uskladitvenega zaklepa ustvariti ali osvežiti lasten ERP osnutek. Potrjene ERP temeljnice so vedno nespremenljive.

Vidni sklic nabavne temeljnice je dobaviteljeva številka dokumenta. Tehnična identiteta POS prejemnice se vodi izključno prek neposredne povezovalne tabele, ne prek uporabniškega polja reference.

**Why:** Računovodji je številka izvirnega dokumenta najpomembnejši podatek za pregled in iskanje, medtem ko interni ID nima poslovnega pomena. Poslovne številke tudi niso globalno enolične med dobavitelji.

**How to apply:** V referenco temeljnice zapiši `st_dokumenta`, v opis pa interno številko prejemnice in številko dokumenta. Podvajanje preprečuj z lastništvom vira in zaklepom prejemnice, nikoli z globalno enoličnostjo vidnega sklica.