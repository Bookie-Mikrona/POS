---
name: Razvojni 502 in glavni Run
description: Posebnost razvojnega predogleda, ko posamezni workflowi delujejo, uporabniški dostop pa zaradi ustavljenega glavnega app stanja vrača 502.
---

Pri HTTP 502 na razvojni domeni preveri tudi, ali je glavni app v Replitu ustavljen, četudi so posamezni artifact workflowi prikazani kot aktivni. Ponovni klik **Run** lahko obnovi dejanski uporabniški dostop.

**Why:** Zunanji in notranji pregledi so lahko vračali 200, uporabnikov brskalnik pa je vztrajno dobival 502, dokler uporabnik ni ročno zagnal glavnega app procesa.

**How to apply:** Pri neskladju med zelenimi workflowi in uporabniškim 502 ne sklepaj, da gre nujno za brskalnik ali DNS; preveri glavno Run stanje delovnega prostora.