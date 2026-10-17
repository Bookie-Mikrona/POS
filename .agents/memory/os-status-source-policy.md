---
name: Viri statusa osnovnega sredstva
description: Zakaj status upošteva tako uvožene vrednosti kot shranjene obračune, brez spreminjanja začetnega odpisa.
---

Status osnovnega sredstva mora izhajati iz uvoženih vrednosti ter veljavnih shranjenih amortizacijskih obračunov in oslabitev. Shranjeni status glave ni nadomestilo za ta izračun.

**Why:** Odpis doknjižbe je izhodišče ob uvozu, ne sproti posodobljen kumulativ. Samo branje tega odpisa po zaključku leta še vedno pokaže sredstvo v uporabi, čeprav ga je obračun že v celoti odpisal. Prepisovanje izhodišča bi pri ponovnem obračunu odpis upoštevalo dvakrat.

**How to apply:** Ob spremembah statusa uskladi zaključevanje obračuna, filtriranje registra in kartico sredstva. Ohrani izločitve, neaktivirana sredstva in neamortizljivi del; pri zgodovinskem registru ne vključuj prihodnjih obračunov.

Pri zgodovinskem registru velja odtujitev šele na njen datum. Če je poznejša od konca izbranega obdobja, prezri tudi današnji shranjeni status »izločeno« in izračunaj tedanji status iz vrednosti. Izločitev brez znanega datuma ostane izločitev.

**Why:** Poznejša odtujitev ne sme odstraniti sredstva iz poročila za čas, ko je bilo še v uporabi. Predhodni SQL filter po današnjem statusu ga lahko skrije, še preden se zgodovinski status sploh izračuna.

**How to apply:** Status in filtre uporabi na isti presečni datum v prikazu ter izvozih; upoštevaj tudi mesečni zaključek, ne samo leta. Poznejša odtujitev tudi ne sme predčasno ničiti končnega stanja.
