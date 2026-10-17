---
name: POS obnovljivost operacij
description: Varnostno pravilo za FURS, kartična plačila, offline replay, tiskanje in poslovno finalizacijo.
---

Ročna razrešitev terminalskega vračila v »paid« vedno zahteva dva različna Clerk uporabnika, tudi pod zneskovnim pragom. Že zahtevanega drugega soglasja poznejši dvig praga ne odpravi.

**Why:** Prag omejuje dodatne kontrole pri neuspelem vračilu, ne dovoljuje samostojne potrditve odtoka denarja. Sprememba nastavitev ne sme naknadno obiti že začetega postopka štirih oči.

**How to apply:** Med odobritvama obravnavaj vračilo kot nejasno, nikoli kot izvedeno ali varno za ponovitev.

Vsako operacijo z zunanjim ali nepovratnim učinkom je treba trajno rezervirati pred izvedbo. Potrjen rezultat se ob ponovitvi vrne nespremenjen; nejasen rezultat ostane `unknown` oziroma `needs_review` in se ne izvede samodejno znova.

**Why:** Padec procesa ali timeout lahko nastopi po tem, ko je ponudnik, FURS, tiskalnik ali poslovna transakcija učinek že izvedla. Samodejna ponovitev bi lahko ustvarila dvojno bremenitev, račun, izpis ali zalogovni gib.

**How to apply:** Uporabi stabilen idempotency ključ, immutable payload/plan, claim ali lease z CAS preverjanjem in append-only audit. Pri kartičnem callbacku strežnik pri ponudniku preveri transakcijo, znesek in merchant/client referenco; callback odjemalca sam ni dokaz plačila. Payten Android callback brez neodvisnega ponudnikovega status API-ja mora ostati `unknown` in zahtevati ročno uskladitev. Kartično vračilo trajno rezerviraj pod zaklepom računa pred provider klicem; `pending/unknown` se replaya brez novega klica, `paid/failed` sta terminalna in ne smeta nazadovati. Znesek vračila pretvori z exact-cent helperjem in ponudniku pošlji le kanonični shranjeni kartični total. Read-only preverjanje obnovljivosti ne sme posedovati plačilnega zaklepa; klicatelj po vsakem `await` ponovno preveri trenutno naročilo in točen znesek, šele nato sinhrono pridobi zaklep za poslovni učinek. Pri toku z vrstičnim zaklepom ključ preveri tudi po pridobitvi zaklepa, ker je lahko sočasni zahtevek med čakanjem že shranil rezultat. Poslovne učinke dokončaj transakcijsko za potrjen rezultat; pri dvomu zahtevaj ročno uskladitev. Pri legacy računu brez immutable načrta nikoli ne ponovi stranskih učinkov: najprej dokaži, da so postavke, zaloga in naročilo že zaključeni, nato smeš strogo pogojeno dopolniti le manjkajoči marker.