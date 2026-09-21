---
name: Izbira elementov tlorisa
description: Pravila dogodkov za zanesljivo izbiro in vlečenje elementov v grafičnem urejevalniku tlorisa.
---

Označitev elementa in vlečenje morata biti ločena od klika praznega ozadja. Ozadje sme počistiti izbor samo, ko je `event.target === event.currentTarget`; `stopPropagation` na `pointerdown` ne ustavi poznejšega dogodka `click`.

**Why:** Element se je označil ob `pointerdown`, nato pa ga je bubbled `click` platna takoj odznačil. Dodatno je pointer capture sproščal napačen DOM element, kar je otežilo zaključek klika ali vlečenja.

**How to apply:** Element naj ostane izbran po navadnem kliku, vlečenje naj se začne šele po majhnem pragu premika, pointer capture pa naj vedno sprosti isti DOM element, ki ga je pridobil. Regresijski test naj pokrije odklenjen in zaklenjen element ter klik praznega ozadja.