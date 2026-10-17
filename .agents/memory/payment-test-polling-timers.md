---
name: Časovniki v testih plačil
description: Zakaj test plačila lahko uspe samostojno in odpove v celotni zbirki zaradi nepreklicljivega polling stuba.
---

V testih plačil ohrani možnost preklica časovnikov; za pohitritev skrajšaj le znane intervale preverjanja ponudnika.

**Why:** Nadomestitev vseh časovnikov s Promise mikronalogami je povzročila prelivanje preverjanj med testi. Mikronaloge ni mogoče preklicati s clearTimeout, zato se že odstranjena komponenta lahko oglasi v naslednjem testu in navidezno podvoji izdajo računa. Posamičen uspešen test tega ne odkrije.

**How to apply:** Uporabi dejanske ročice časovnikov ali nadzorovane navidezne časovnike. Spremembo preveri tudi v celotni zbirki plačil, ne le z izbranim testom. Ne oslabi preverjanja enkratne izdaje, da bi prikril prelivanje.
