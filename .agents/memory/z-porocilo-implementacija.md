---
name: Z-poročilo implementacija
description: Formalni zaklenjeni dnevni zaključek blagajne — arhitektura in odločitve.
---

## Trajna pravila

- Grand Total in zaporedje Z sta ločena po blagajni; odklep razveljavi prejšnji prispevek pred ponovnim zaključkom.
- Za blagajno in poslovni datum sme obstajati samo en zaklenjen Z; vsak odklep mora pustiti neizbrisno revizijsko sled.
- Odklep mora razlog obrezati in zavrniti praznega pred mutacijo; stanje Z pa mora preveriti šele pod tenant-scoped vrstičnim zaklepom, da so audit, oznaka odklepa in obrat GT izvedeni največ enkrat.
- Namenski audit odklepa hrani triman razlog in Clerk izvajalca; generični actor audit v isti transakciji hrani enoto, izbranega natakarja in samo povezavo na Z, nikoli actor žetona ali podvojenega razloga.
- Z je dovoljen šele brez odprtih izmen, zasedenih miz, odprtih naročil in odprtih ali manjkajočih tekočih evidenc aktivnih pripravljenih jedi.
- Z-zaključek in vsi tokovi, ki lahko ustvarijo novo blokado, morajo uporabljati isti transakcijski advisory lock enote.
- Čas operacije in poslovni datum se določita šele po pridobitvi zaklepa in nato ostaneta enaka za preverjanje ter zapis.
- Javni QR tok sodeluje pri zaklepu in spoštuje že zaključen tekoči dan, ne uporablja pa POS-kontrole zaključenosti prejšnjega dne.
- Pred novim POS/telefonskim naročilom mora imeti zadnji pretekli dan z dejansko dejavnostjo zaklenjen Z; ko naročilo nima blagajne, so relevantne vse aktivne blagajne.
- Samo odprtje prazne izmene brez naročila, računa, blagajniškega premika ali dnevne evidence ni dejanska dejavnost in ne sme zahtevati praznega Z.
- Zgodovinski zaključek zahteva zaprtje obstoječih evidenc pripravljenih jedi, ne pa retroaktivnih evidenc za artikle, konfigurirane pozneje.
- Izpuščeni pretekli poslovni dan mora biti mogoče izbrati in zaključiti neposredno; današnje izmene, naročila in stanje miz ne smejo blokirati njegovega zgodovinskega Z.
- Naročila iz že Z-zaklenjenega izvornega dne se ne odpirajo znova; izvornega časa naročila se zaradi ponovnega odprtja ne prepisuje.

**Why:** Brez skupnega zaklepa bi lahko naročilo ali druga blokada nastala med zadnjim preverjanjem in Z-zapisom; dva sočasna odklepa pa bi lahko ustvarila podvojeno revizijo in dvakrat posegla v GT. Clerk uporabnik je odgovorni administrator, actor seja pa le operativni natakarski kontekst; njuna zamenjava ali podvajanje skrivnosti v metadata bi pokvarilo dokazljivost in zasebnost. Napačna časovna meja ob 04:00 bi dejavnost pripisala zaklenjenemu dnevu.
**How to apply:** Vsak nov tok, ki lahko odpre izmeno, zasede mizo, odpre naročilo ali evidenco pripravljene jedi, mora sodelovati pri istem zaklepu in določiti poslovni datum znotraj njega. Enkratni prehodi na istem Z-zapisu morajo vrstico zakleniti in nato ponovno preveriti trenutno stanje. Router mora pred občutljivo akcijo razrešiti podpisano actor sejo; poslovni in generični audit se zapišeta atomarno, vsak samo s podatki svojega namena.
