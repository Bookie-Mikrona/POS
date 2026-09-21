---
name: Clerk lokalizacija
description: Posebnosti lokalizacije Clerkovega vmesnika v trenutni ERP odvisnosti.
---

Pri tej različici `@clerk/react` uporabljaj podprte ključe iz `localization` tipov. Besedilo spodnje akcije prijave nastavi v `signIn.start.actionText` in `signIn.start.actionLink` (analogno za registracijo); globalna ključa `footerActionText` in `footerActionLink__signUp` nista tipovno podprta. Uradni paket `@clerk/localizations` nima slovenskega `slSI`, zato ERP uporablja lasten slovenski objekt nad angleško `enUS` osnovo. Nikoli ne uporabi `skSK`: manjkajoči slovenski ključi bi se prikazali v slovaščini. V podnaslovih prijavnih korakov ime aplikacije napiši neposredno, ker `{{applicationName}}` prihaja iz Clerk instance.

**Zakaj:** Clerkovi javni primeri in starejše različice omenjajo globalne footer ključe, trenutni paket pa jih zavrne pri TypeScript preverjanju. Razvojna oznaka `Development mode` je ločen razvojni/Replit element in ni del prevodov uporabniškega obrazca. Pri Replit-upravljanem Clerk uporabnikovo polje Users & Auth → App info → Name shranjuje samodejno in določa tudi ime, prikazano na Googlovem prijavnem zaslonu; to je bilo uporabniško potrjeno.

**Kako uporabiti:** Pri prevajanju prijave najprej preveri trenutne TypeScript ključe; prevedi skupne ključe in vse dejansko uporabljene podkorake `signIn`/`signUp`, neprevedeni rezervni tekst pa naj bo angleški. Razvojne značke ne spreminjaj s krhkim CSS-obvozom. Ime aplikacije spremeni v Users & Auth → App info → Name in preveri z dejanskim Google tokom.