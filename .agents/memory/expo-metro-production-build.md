---
name: Expo Metro produkcijski build
description: Nezdružljivost Expo CLI 54 in Metro 0.83 pri dogodkih opazovalca datotek med produkcijskim bundlanjem
---

# Expo Metro produkcijski build

Če produkcijska skripta še uporablja dolgoročno zagnan `expo start`, vmesnih bundle-ov ne sme zapisovati znotraj projektnega drevesa, ki ga Metro opazuje. Gradi naj v začasnem imeniku zunaj projekta, Metro naj teče v CI načinu brez TypeScript setupa, končni rezultat pa naj se v projekt premakne šele po bundlanju.

**Why:** Expo CLI 54 pričakuje stare dogodke z `eventsQueue`, Metro 0.83 pa lahko pošlje nov objekt `changes`. Zapis prvega platformskega bundle-a v opazovani projekt zato sproži izjemo `eventsQueue is not iterable` še pred drugim platformskim bundlom; Node 24 jo zanesljivo razkrije.

**How to apply:** Velja za lastne večplatformske Expo build skripte, ki prek HTTP zahtev berejo bundle in manifest iz istega Metro procesa. Dolgoročno daj prednost `expo export`, kadar ni potreben poseben Expo Go manifest.