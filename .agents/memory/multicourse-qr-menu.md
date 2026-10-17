---
name: Večhodni POS in QR meni
description: Trajna pravila za konfiguracijo, cene, izbire, zalogo in KDS zaporedje pri 2–20-hodnih menijih.
---

Večhodni meni je prvovrsten poslovni objekt, ne skupek običajnih dodatkov. Vsaka prodajna menijska vrstica mora imeti natanko eno strežniško preverjeno izbiro zahtevanih hodov ter natanko eno dovoljeno jed in eno dovoljeno vino pri vsakem izbranem hodu.

**Why:** Navadna menijska vrstica brez izbire bi obšla obvezna vina, zalogo in KDS. Menijska ovojnica nosi celotno ceno; izbrane jedi in vina po 1 dl so ničelne notranje vrstice, da ni dvojnega zaračunavanja. Isto vino ostane samostojno prodajljivo po redni ceni.

**How to apply:** Pravilo velja enako za osebno POS in QR naročilo. Konfiguracija ima 2–20 zaporednih, poimenovanih hodov ter način vsi hodi ali izbira N od M; stara 4-hodna načina sta le združljivostna aliasa. Hod lahko ponuja več jedi in vin, vino je lahko neobvezno, informativni hod pa je samodejno vključen. Zahtevek vedno vsebuje dovoljeno jed in, kadar je zahtevano, vino iz strežniškega allowlista. Cena ovojnice se po nastavljenem bruto deležu materializira v plačljivo vrstico hrane in plačljivo vrstico vina; izbira vina pri 100 % deležu hrane mora biti zavrnjena, ne tiho obdavčena kot hrana. Ovojnice ne preverjaj kot pripravljeno porcijo in je ne pošiljaj v KDS. Notranje jedi niso samostojno prodajne; notranje jedi in vina se ne pokažejo na računu, vendar porabijo zalogo in gredo v KDS. Prvi hod je aktiven, naslednji so zadržani do izrecnega FIRE; časomer teče od aktivacije. KDS napredovanje loči po `pairingGroupId` in sledi `courseSequence`; `courseNumber` je zaporedna oznaka, ime hoda pa je uporabniško določeno.

Kuhinjski in barski KDS delita isti FIRE dogodek, vendar uporabljata različne operativne izraze: kuhinja `V pripravi/HOLD`, bar `READY TO POUR/PENDING/SERVED`. Bar vedno pokaže tudi jed, h kateri sodi izbrano vino.

Glasovna ali druga naknadna sprememba hoda mora uporabljati isti transakcijski zaklep naročila kot KDS FIRE/bump/predaja. Atomska enota je celoten `pairingGroupId`: navadna postavka skupaj z modifikatorji oziroma celoten meni; komercialna menijska vrstica brez hoda vedno ostane brez hoda in ne sme postati KDS nalog. Paket več skupin mora naročilo zakleniti enkrat, razrešiti in preveriti vse skupine ter šele nato zapisati katerokoli spremembo.

**Why:** Posamičen zapis vrstice raztrga povezavo s KDS projekcijo, enohodni meni pa je še vedno menijska skupina in ga ni varno prepoznati samo po številu različnih hodov.

**How to apply:** Materializirane KDS naloge je dovoljeno uskladiti le v varnih aktivnih/zadržanih stanjih. Po sprostitvi, bumpu, potrditvi ali predaji je treba celoten paket zavrniti brez delnih zapisov; ista skupina ne sme v istem paketu dobiti različnih hodov. Po commitu auditiraj in obvesti naročilo ter KDS prek SSE samo enkrat.

Ista atomskost velja pri delnem računu: izbor kateregakoli starša, modifikatorja, menijske ovojnice ali notranjega hoda se pred izračunom in rezervacijo razširi na celotno povezano komercialno skupino. Dve sočasni blagajni ne smeta dobiti različnih članov iste skupine.

**Why:** Enosmerna razširitev samo od starša navzdol dovoli, da zahtevek za otroka ali notranji hod zmaga samostojno, drugi račun pa nato pusti komercialno skupino razcepljeno.

**How to apply:** Pred payload hashom, finalization planom in CAS vezavo izračunaj tranzitivno parent/child komponento ter vse vrstice istega `pairingGroupId`. CAS poraženec mora pred FURS/provider učinkom dobiti varen konflikt in sprostiti neuporabljene rezervacije.

Glasovna izbira po imenu hoda sme uporabiti samo aktivno konfiguracijo menija, ki je dejansko prisoten v tenant-scoped naročilu. Prosto besedilo se mora pred mutacijo deterministično razrešiti v eno številko hoda.

**Why:** Generično krajšanje končnic ali fuzzy ujemanje lahko dve različni imeni izenači in spremeni napačen hod; trenutna konfiguracija druge enote ali menija pa ne pripada naročilu.

**How to apply:** Najprej preveri polno normalizirano ime, nato samo ozko naštete slovenske sklanjatvene oblike, izpeljane iz konfiguriranega kandidata. Brez substring/edit-distance ujemanja. Pri paketnem ukazu mora biti pred mutacijo enolično razrešena vsaka jed in vsak hod; ena napaka zavrne celoten načrt z natančnim imenom konflikta. Več različnih številk pomeni dvoumnost in nobene spremembe; številčni ukazi ostanejo ločena združljiva pot.

Zaporedna razjasnitev je en sam paket: vsaka ponovno podpisana izbira mora ohraniti prvotno identiteto pojasnila in prvotni rok veljavnosti. Vmesna izbira ni delna dodelitev.

**Why:** Nova identiteta ob vsakem koraku bi dovolila izvedbo različnih vej istega prvotnega ukaza; podaljševanje veljavnosti bi dovolilo neomejeno ohranjanje zastarelega načrta.

**How to apply:** Ohrani izvirne cilje in ločene dovoljene možnosti, dodajaj samo izbire. Pri vsakem koraku preveri tudi že izbrane in še prihodnje možnosti. Vse končne veje morajo deliti isti transakcijski zaklep in dokazilo enkratne porabe.

Ime hoda na odprtem naročilu je nullable, nespremenljiv posnetek na notranji operativni vrstici; številka hoda, zaporedje in ime so ločene vrednosti. KDS, zgodovinski prikaz in audit uporabljajo isti posnetek.

**Why:** Aktivno konfiguracijo je dovoljeno pozneje preimenovati. Če bi odprto naročilo ali KDS znova brala mutable ime, bi se zgodovina spremenila za nazaj; backfill starih vrstic pa bi izmišljal podatek, ki ob naročilu ni bil shranjen.

**How to apply:** Posnetek zapiši ob POS ali QR materializaciji na notranjo food/wine vrstico in ga kopiraj na KDS nalog; komercialna ovojnica ga nima. Naknadna numerična prerazporeditev ga ne spreminja. Glasovni resolver najprej uporabi enoličen neprazen posnetek. Live konfiguracija je dovoljena samo za dejansko prisotno legacy številko brez posnetka in samo prek komercialne envelope vrstice istega tenant-scoped naročila. Konflikt shranjenih imen ni legacy; manjkajoč ali dvoumen vir vedno postane deterministični `N. hod`.