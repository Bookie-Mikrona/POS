---
name: Radix izbirniki v jsdom
description: Omejitve sintetičnih pointer dogodkov pri komponentnih preizkusih izbirnikov.
---

Če test zamenja PointerEvent z MouseEvent, sintetični dogodek ne ohrani nujno pointerType. Radix Select se zato ob pointerDown lahko ne odpre, čeprav aplikacija deluje.

**Why:** Neuspešno odpiranje v takem okolju je lahko omejitev dogodkov v jsdom, ne napaka uporabniškega vmesnika.

**How to apply:** Za teste, katerih namen ni preverjanje kazalca, uporabi dejansko podprto tipkovnično odpiranje izbirnika. Testi samega pointer obnašanja pa potrebujejo ustrezen PointerEvent ali pravi brskalnik; ne zamenjuj jih s tipkovničnimi preverjanji.
