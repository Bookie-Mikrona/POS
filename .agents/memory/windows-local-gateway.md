---
name: Windows lokalni POS gateway
description: Varnostne in operativne meje lokalnega Windows gatewaya za delovanje POS ob izpadu interneta.
---

Windows gateway je en sam lokalni fiskalni zapisovalec. Preklop fiskalne avtoritete je vedno izrecen in nikoli samodejen.

**Why:** Dve sočasni fiskalni avtoriteti lahko izdasta podvojene ali konfliktne številke računov in ustvarita nezdružljivo lokalno stanje.

**How to apply:** Če seznanjeni POS ne more preveriti avtoritete gatewaya, mora cloud pisanje odpovedati zaprto. V cloud se vrne šele po preverjeni sprostitvi avtoritete.

LAN način mora uporabljati HTTPS s certifikatom, ki mu odjemalčev operacijski sistem oziroma brskalnik zaupa, in z ujemajočim SAN imenom ali IP-jem. Samoporočani fingerprint ni certificate pin.

**Why:** HTTPS spletna aplikacija ne sme pošiljati skrivnosti ali fiskalnih zahtev na nezaščiten HTTP naslov v lokalnem omrežju.

**How to apply:** Seznanitev in upravljanje omeji na zaupanja vredno lokalno okolje ter izrecno pooblaščene osebe.

Avtoriteta LAN gatewaya je skupno strežniško stanje, ne odločitev posameznega brskalnika. Lokalne in cloud identitete ostanejo ločene.

**Why:** Brskalnik je lahko zaprt, ponastavljen ali začasno brez povezave; lokalne identitete pa niso zamenljive s cloud identitetami.

**How to apply:** Vsi zasloni uporabljajo isto avtoriteto; uskladitev mora biti obnovljiva, sledljiva in brez podvajanja fiskalnih ali finančnih učinkov.

Zgodovinska fiskalna dejstva offline računa se preverjajo proti podpisanemu authority snapshotu iz časa izdaje, ne proti trenutnemu ceniku.

**Why:** Poznejša sprememba cene, DDV, veljavnosti artikla ali modifikatorja ne sme razvrednotiti zakonito izdanega offline računa.

**How to apply:** Živo bazo uporabi za trenutno stanje uskladitve; cene, DDV in dovoljene kombinacije za izdani račun razreši iz preverjenega podpisanega snapshot-a.

FURS potrditev in poslovna finalizacija sta ločeni trajni fazi; račun je terminalno dostavljen šele po obeh.

**Why:** Prekinitev po prejemu EOR lahko pusti nepotrjene zalogovne, KDS in zaključne učinke, ponovni FURS transport pa bi podvojil fiskalni poskus.

**How to apply:** Po potrditvi ohrani EOR/ZOI nespremenjena, finalizacijo ponavljaj z lastnim trajnim backoffom in nikoli več ne pošiljaj istega računa na FURS.

Windows gateway za znane in upravljane stranke uporablja lasten Bookie interni produkcijski code-signing certifikat; javni Comodo OV USB-token ni zahteva.

**Why:** Omejena distribucija znanim strankam ne upraviči stroška javnega certifikata, zaupanje pa je mogoče nadzorovano vzpostaviti ob prvi namestitvi.

**How to apply:** Zasebni podpisni ključ ostane na pooblaščenem signing računalniku in nikoli v paketu; installer sprejme samo pričakovani fingerprint ter javni certifikat doda med Trusted Publishers.

Lokalna fiskalna izdaja je privzeto izključena, skrbniško kodo pa ustvari samo podpisano povišano Windows orodje, ki žeton prebere neposredno iz zaščitene datoteke.

**Why:** Blagajnik ne sme uporabljati sistemskih ukazov, kopirati skrbniškega žetona ali prejemati opozoril za lokalno storitev, ki v enoti ni namerno vključena.

**How to apply:** Orodje kliče samo loopback, prikaže le šestmestno enkratno kodo in njen rok ter podpira dejanska vrata/TLS način namestitve. POS ne preverja, izdaja ali sinhronizira lokalno, dokler skrbnik možnosti izrecno ne vključi.

Izbrani fiskalni URL je del povezovalnih poverilnic POS-a; vsi poznejši zahtevki morajo uporabljati isti naslov, storitev pa v capability odgovoru oglašuje naslov dejanskega zahtevka.

**Why:** Fiksni privzeti naslov po uspešni povezavi preusmeri nadaljnje zahtevke na napačna vrata ali napravo in onemogoči dokazni preizkus nestandardnih vrat.

**How to apply:** Dovoli HTTP samo za loopback, za LAN zahtevaj HTTPS, pot `/v1` normaliziraj ter cilj spremeni samo z odstranitvijo in novo povezavo.

Offline fiskalno delovanje je poslovna nastavitev posamezne enote in je privzeto izključeno; lokalna nastavitev brskalnika sama po sebi nikoli ni dovoljenje.

**Why:** Težava ali nedokončana uvedba lokalne storitve v eni enoti ne sme vplivati na druge enote ali omogočiti izdaje prek starih lokalnih podatkov.

**How to apply:** Strežnik mora pred registracijo, izdajo authority podatkov, sprejemom računov in sinhronizacijo preveriti nastavitev enote. Globalna okoljska zastavica ostane dodatna varovalka.
