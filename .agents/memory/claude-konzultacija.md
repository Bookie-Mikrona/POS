---
name: Claude konzultacija za kompleksne probleme
description: Kdaj in kako poklicati Claude API pred implementacijo
---

# Claude konzultacija

## Odločitev
Za kompleksne izolirane tehnične probleme VEDNO najprej pokliči Claude za predlog, šele nato implementiraj.

**Why:** Claude je rešil ZCS Z92 printing problem v 2 minutah, Replit Agent v 3 urah — ker Claude nima overhead-a build/deploy ciklov in ima boljše znanje o specifičnih SDK/hardware API-jih.

## Kdaj poklicati Claude
- Neznani SDK API (hardware, tiskalniki, terminali, Android)
- Algoritmični problemi (optimizacija, matematika)
- Regulativna vprašanja (FURS, DDV, računovodski standardi)
- Kadar po 2 neuspešnih poskusih ni jasne rešitve

## Kako
Projekt ima `AI_INTEGRATIONS_ANTHROPIC_API_KEY` in `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — pokliči Claude API prek `ai-integrations-anthropic` skill, pošlji relevantno kodo/kontekst, implementiraj predlog.

## Omejitve
Claude ne dobi dostopa do okolja (datoteke, baza, procesi) — samo besedilni kontekst. Testiranje in implementacija ostaneta na Replit Agentu.
