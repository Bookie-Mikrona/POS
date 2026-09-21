---
name: QR gostujoči AI
description: Varnostna in zasebnostna pravila za javnega pomočnika, zgodovino naročil ter ocenjevanje.
---

Gostujoči AI sme odgovarjati samo iz javnega, tenant-scoped operativnega posnetka aktivirane QR seje. Vprašanja o cenah, ponudbi, zalogi, KDS in čakanju so deterministična; kadar podatka ni, mora to izrecno povedati.

**Why:** Prosto modelno besedilo lahko zamenja pomen številke (ceno opiše kot minute) ali trdi, da je izvedlo dejanje.

**How to apply:** Model sme za priporočilo izbrati le zaprt tip priporočila in dovoljene fact-ID-je. Celotno besedilo, imena, cene, količine in ETA vedno sestavi strežnik iz tipiziranih dejstev. Gostujoči model nima akcij.

Zgodovina gosta je psevdonimna in privzeto izključena. Vključi se samo z izrecno lokalno privolitvijo ter ostane omejena na isto anonimno QR napravo, enoto, mizo in podpisano aktivacijsko sejo.

**Why:** Stabilni ID brskalnika ni osebni račun in različnih naprav ali gostov ni dovoljeno združevati z ugibanjem.

**How to apply:** Brez opt-in ne kliči zgodovinskega endpointa in zgodovine ne pošiljaj svetovalcu. Izklop odstrani privolitev in pogovor, ne pa osnovnega QR ID-ja, ki varuje lastništvo naročila.

Anonimna ocena je dovoljena samo za zaključeno naročilo vira QR gost, ki pripada isti aktivirani napravi. Na naročilo je mogoča ena nespremenljiva ocena.

**Why:** Sprejeto naročilo še ne dokazuje izvedene storitve; vezava na zaključek preprečuje predčasne in podvojene ocene.

**How to apply:** Preveri enoto, mizo, napravo, vir, zaključeni status in pripadnost ocenjenih postavk. Ne beleži komentarja ali ID-ja naprave v loge in ne zbiraj imena, kontakta, IP-ja ali prstnega odtisa.