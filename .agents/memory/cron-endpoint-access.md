---
name: Dostop cron endpointov
description: Varno izpostavljanje scheduled API poti mimo uporabniške POS prijave.
---

Scheduled endpoint, ki ga kliče zunanji scheduler, se registrira pred globalnim POS
middlewareom `requireEnota` in uporablja izključno lasten cron guard. Guard zahteva
nastavljen `CRON_SECRET`, primerja prejeti `X-Cron-Secret` časovno varno in pri
manjkajoči ali neveljavni skrivnosti zahtevo zavrne.

**Why:** Scheduler nima Clerk uporabniške seje ali aktivne poslovne enote. Če je taka
pot montirana za `requireEnota`, cron klic do lastne zaščite sploh ne pride; če
manjkajoč `CRON_SECRET` dovoljuje razvojni dostop, se lahko endpoint nenamerno odpre.

**How to apply:** Izjema velja samo za točno določeno scheduled pot in samo s svojim
fail-closed guardom. Druge POS rute ostanejo za `requireEnota`; v testih preveri tako
veljaven cron klic brez Clerk glave kot zavrnitev običajne POS poti brez prijave.