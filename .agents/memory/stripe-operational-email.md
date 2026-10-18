---
name: Stripe operativna e-pošta
description: Ločitev obdelave Stripe webhookov od dostave operativnih obvestil.
---

Operativne e-pošte ne čakaj pred odgovorom Stripe webhooka. Pri ročnem preizkusu jasno loči SMTP sprejem od dejanske dostave v prejemnikov predal.

**Why:** SMTP ima neodvisne izpade in zakasnitve; čakanje na pošto bi povečalo čas odgovora webhooka in povzročalo nepotrebne Stripe ponovne prenose. SMTP sprejem ne zazna kasnejšega zavračanja ali uvrstitve med neželeno pošto.

**How to apply:** Morebitno prihodnje zanesljivo čakalno vrsto ali ponovne poskuse izvajaj neodvisno od webhook odgovora. Uspeha testnega pošiljanja ne poimenuj potrjena dostava v predal.
