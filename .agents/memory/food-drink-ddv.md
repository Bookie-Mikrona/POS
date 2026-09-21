---
name: DDV kategorija Pijača-jed
description: Davčna obravnava pripravljenih napitkov, ki se klasificirajo kot jed.
---

Kategorija `food_drink` pomeni pripravljeno jed in ima vedno 9,5 % DDV pri mizi in za s seboj. Oznaka dodanega sladkorja pri tej kategoriji nima davčnega pomena in se mora pri shranjevanju normalizirati na `false`.

**Why:** Če bi zastarela oznaka sladkorja vplivala na razreševanje ali ostala shranjena, bi enaka pripravljena jed lahko dobila napačnih 22 % oziroma zavajajoče podatke v šifrantu.

**How to apply:** V vsakem obrazcu za ustvarjanje ali urejanje artikla ob izbiri `food_drink` počisti sladkor in prikaži pojasnilo; API mora isto pravilo uveljaviti neodvisno od odjemalca.