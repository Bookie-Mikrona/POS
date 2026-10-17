---
name: KIR/KPR izvoz
description: Pravila za obseg obdobja, popolnost davčne sledi in mejo med XML izvozom ter eDavki oddajo.
---

Predogled, predizvozna kontrola in XML morajo uporabljati isti eksplicitno izbrani mesečni ali trimesečni datumski obseg. Izvoz odpove zaprto, če DDV-vrstica nima kode, aktivne evidence ali smerno ustrezne KIR/KPR preslikave.

**Why:** Koda obdobja sama ne razlikuje mesečnega marca od prvega trimesečja, tiho izpuščena preslikava pa lahko ustvari navidezno popoln davčni izvoz.

**How to apply:** Vsaka sprememba KIR/KPR mora skupaj preveriti predogled, strežniško kontrolo in generator. Prenos XML je ločen od potrjene oddaje; neposredne oddaje na eDavke ne predstavljaj kot implementirane brez odziva eDavkov.

Ročna potrditev sme za kratek čas ustaviti vse zapise v DDV evidenco. Tega ne nadomesti samo z zaklepanjem obstoječih vrstic ali s ponovljivim branjem.

**Why:** Zaklepi vrstic ne preprečijo novih vpisov v isto obdobje, ponovljivo branje pa skrije tudi vpis, ki se potrdi med čakanjem na zaklep. Kratek globalni zapisni zaklep je nameren kompromis za redko ročno opravilo, dokler vsi pisci ne delijo enotnega protokola po podjetju in obdobju.

**How to apply:** Morebitna optimizacija mora uskladiti vse poti zapisovanja, ne le potrditve. Svoje jamstvo preveri z dejanskima ločenima povezavama v bazo, tudi ko pisec začne pred potrditvijo.

Ročno oddajo je treba omogočiti za točno izbrani arhivirani XML tudi po vrnitvi iz eDavkov ali ponovnem odprtju programa; nov izvoz ne nadomesti potrditve že oddanega zapisa.

**Why:** Računovodja oddajo opravi zunaj aplikacije. Potrditev, vezana samo na trenutno odprti zaslon, izgubi povezavo z dejansko oddanim izvozom.

**How to apply:** Preveri tok ponovnega obiska, ponovnega prenosa arhiviranega XML in potrditve istega zapisa, ne le neposrednega izvoza in potrditve brez navigacije.

Podpora eDavkom mora vključevati samostojna sklopa RP-O in PD-O z izračunom, kontrolami, izvozom, popravki ter sledjo oddaje.

**Why:** Uporabnik je pri nadaljnjem osnutku izrecno zahteval: »pri edavkih ne pozabi na poročila rpo in pdo.« Pogojna zavezanost posameznega podjetja ne pomeni, da sta obrazca izbirna ali izpuščena iz zahtevanega razvojnega obsega.

**How to apply:** RP-O loči od EU nabav, PD-O od prejetih samoobdavčenih nabav in drugih obrnjenih obveznosti. Oba uskladi z ustreznimi deli DDV-O in uporabi njuno lastno mesečno obdobje, pravila popravkov ter roke.

RP-O storitve gredo v tekoče polje A6, tristranske dobave v A5; starejša oznaka »B3« pri storitvah v šifrantu ni popravek preteklega obdobja. RP-O novo skupno vrednost prejemnika izkaže nenegativno; PD-O dopušča tudi negativno vrednost. Popravek B je nova **celotna** vrednost za prejšnji mesec in prejemnika, ne razlika.

**Why:** Trenutna uradna shema RP-O loči tekoče stolpce A3–A7 od popravkov B3–B7 ter za RP-O uporablja nenegativni Decimal14_0Type. Zgodovinska preslikava storitve v B3 bi brez izrecne pretvorbe pomenila lažni popravek.

**How to apply:** Ob spremembi oblik/popravljanju seedov preveri aktualne uradne XSD in pravila označevanja transakcij. Negativno neto vrednost RP-O blokiraj za pregled dobropisov oziroma preteklih obdobij; ne prenesi je potiho v B kot razliko.