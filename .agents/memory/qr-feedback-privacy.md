---
name: Zasebnost QR ocen
description: Pravila za vodstvene preglede, komentarje in izvoz anonimnih QR ocen gostov.
---

Vodstveni trendi, ocene dimenzij in lestvice artiklov so vedno tenant-scoped agregati. Izvoz vsebuje samo agregate. Komentarji so ločen, paginiran in administrativno zaščiten tok, ki vrne le enoto, čas ter navadno besedilo.

**Why:** QR naprava je psevdonim, ne uporabniški račun. Združevanje ocene z naročilom, mizo, napravo ali postavko bi lahko osebju omogočilo razkritje posameznega gosta ali njegove zgodovine.

**How to apply:** Noben poročevalski ali izvozni odgovor ne sme vsebovati ID-ja ocene, naročila, mize, QR naprave ali postavke. Komentarjev nikoli ne vključuj v agregatni CSV/PDF. Obseg za `admin` in `admin_enote` vedno razreši po aktivnih enotah podjetja, poslovni interval pa izračunaj posebej za vsako enoto v `Europe/Ljubljana`.

Primerjava QR ocen uporablja neposredno predhodno vključujoče koledarsko obdobje z enakim številom dni, vendar obe obdobji pretvori v poslovne meje posebej za vsako enoto.

**Why:** Enote imajo različne začetke poslovnega dne, prehodi poletnega časa pa pomenijo, da enako število koledarskih dni ni vedno enako število UTC ur. En skupni UTC odmik bi napačno razvrstil ocene.

**How to apply:** Agregiraj trenutno in prejšnje obdobje brez komentarjev ali povezovalnih ID-jev. Vrni absolutno razliko v ocenjevalnih točkah in smer samo, ko imata obe obdobji ocene; sicer uporabi `unavailable`. Majhen vzorec označi ločeno za vsako obdobje.

QR psevdonim preveri lastništvo naročila samo pred oddajo ocene in se ne shranjuje v vrstico ocene. Enkratnost ostane DB-omejitev na naročilo; na terminalnem QR naročilu se psevdonim hrani največ 30 dni od zadnje spremembe zaradi izrecno vključene zgodovine gosta.

**Why:** Trajen psevdonim omogoča nepotrebno povezovanje obiskov, takojšnje brisanje pa bi pokvarilo svežo opt-in zgodovino in AI kontekst. Časovno omejena povezljivost ohrani namen brez neomejene hrambe.

**How to apply:** Javna in AI zgodovina takoj ob 30-dnevni meji izključita zapis. Urno čiščenje nato nulira psevdonim samo na zaključenih ali preklicanih QR naročilih; odprta naročila, aktivacijske seje in idempotency zapisi ostanejo. Pred oddajo ocene preveri podpisano aktivacijsko sejo ter ujemanje enote, mize, QR izvora in naprave. V oceni shrani le `narocilo_id` za enkratnost, nikoli `qr_naprava_id`.