---
name: KIR/KPR izvoz
description: Pravila za obseg obdobja, popolnost davčne sledi in mejo med XML izvozom ter eDavki oddajo.
---

Predogled, predizvozna kontrola in XML morajo uporabljati isti eksplicitno izbrani mesečni ali trimesečni datumski obseg. Izvoz odpove zaprto, če DDV-vrstica nima kode, aktivne evidence ali smerno ustrezne KIR/KPR preslikave.

**Why:** Koda obdobja sama ne razlikuje mesečnega marca od prvega trimesečja, tiho izpuščena preslikava pa lahko ustvari navidezno popoln davčni izvoz.

**How to apply:** Vsaka sprememba KIR/KPR mora skupaj preveriti predogled, strežniško kontrolo in generator. Prenos XML je ločen od potrjene oddaje; neposredne oddaje na eDavke ne predstavljaj kot implementirane brez odziva eDavkov.

Podpora eDavkom mora vključevati samostojna sklopa RP-O in PD-O z izračunom, kontrolami, izvozom, popravki ter sledjo oddaje.

**Why:** Uporabnik je pri nadaljnjem osnutku izrecno zahteval: »pri edavkih ne pozabi na poročila rpo in pdo.« Pogojna zavezanost posameznega podjetja ne pomeni, da sta obrazca izbirna ali izpuščena iz zahtevanega razvojnega obsega.

**How to apply:** RP-O loči od EU nabav, PD-O od prejetih samoobdavčenih nabav in drugih obrnjenih obveznosti. Oba uskladi z ustreznimi deli DDV-O in uporabi njuno lastno mesečno obdobje, pravila popravkov ter roke.

RP-O storitve gredo v tekoče polje A6, tristranske dobave v A5; starejša oznaka »B3« pri storitvah v šifrantu ni popravek preteklega obdobja. RP-O novo skupno vrednost prejemnika izkaže nenegativno; PD-O dopušča tudi negativno vrednost. Popravek B je nova **celotna** vrednost za prejšnji mesec in prejemnika, ne razlika.

**Why:** Trenutna uradna shema RP-O loči tekoče stolpce A3–A7 od popravkov B3–B7 ter za RP-O uporablja nenegativni Decimal14_0Type. Zgodovinska preslikava storitve v B3 bi brez izrecne pretvorbe pomenila lažni popravek.

**How to apply:** Ob spremembi oblik/popravljanju seedov preveri aktualne uradne XSD in pravila označevanja transakcij. Negativno neto vrednost RP-O blokiraj za pregled dobropisov oziroma preteklih obdobij; ne prenesi je potiho v B kot razliko.