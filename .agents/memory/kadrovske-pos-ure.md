---
name: Kadrovske POS ure
description: Poslovna pravila za odmore, nadure, potrditve, popravke in povezavo napitnin z izmenami.
---

Efektivne ure so dejanska prisotnost, zmanjšana samo za neplačane odmore. Plačani odmori se evidentirajo, vendar se od efektivnih ur ne odštejejo. Nadure se računajo po posameznem lokalnem koledarskem dnevu v časovnem pasu Europe/Ljubljana, ne po celotni izmeni.

**Why:** Izmene lahko prečkajo polnoč ali premik ure; seštevanje celotne izmene bi nadure pripisalo napačnemu dnevu. Vrsta odmora neposredno vpliva na plačni rezultat.

**How to apply:** Vsako izmeno najprej razdeli po lokalnih dnevih, nato na vsakem segmentu odštej prekrivajoče neplačane odmore in šele zatem izračunaj presežek nad osmimi urami.

Poprave časa mora ohraniti staro in novo vrednost z obveznim razlogom ter ponastaviti potrditev. Kadrovski audit je append-only. Napitnine se povezujejo prek obstoječe poti račun → izmena → alokacija, ne prek vzporedne evidence.

**Why:** Plačni popravki morajo biti razložljivi in nespremenljivo sledljivi, napitnine pa morajo ostati usklajene z dejansko knjigo računov.

**How to apply:** Ne prepisuj zgodovine popravkov ali audita. Pri poročilih agregiraj napitnine iz alokacij računov, ki pripadajo isti izmeni.