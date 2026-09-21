---
name: Prejemnica in e-SLOG izvoz
description: Kdaj je iz prejetega dokumenta varno ustvariti e-SLOG in kdaj ne.
---

Prejemnice oziroma zalogovni prejem ni avtomatično e-SLOG `Invoice`. e-SLOG za prejeti račun se generira samo za vrsto `RACUN`, kadar ima nespremenljiv dokumentni posnetek strank, popolne kanonične postavke, usklajene DDV/zneske in uspešno validacijo.

**Why:** Ponarejen ali nepopoln e-SLOG račun bi bil za zunanji računovodski program zavajajoč in bi lahko povzročil napačno knjiženje ali davčno evidenco. Zgodovinski posnetek prepreči, da kasnejše urejanje partnerja ali podjetja spremeni že prejeti dokument.

**How to apply:** Ob prejemu shrani snapshot dobavitelja in prejemnika; ob izvozu uporabi izključno snapshot. Če validacija ne uspe ali dokument ni `RACUN`, izvozi izvirnik in jasno opozorilo, ne e-SLOG Invoice. Uradni XSD še ni v repozitoriju, zato je validacija trenutno strukturna in računovodsko-konsistenčna, ne XSD-validacija.