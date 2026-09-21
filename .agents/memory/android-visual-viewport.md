---
name: Android zaslonska tipkovnica
description: Globalno pravilo za obrazce in dialoge POS-a nad Androidovo zaslonsko tipkovnico.
---

POS mora pri prikazu obrazcev na Androidu uporabljati dejansko vidno območje iz `VisualViewport`, ne samo statične višine zaslona. Ob odprtju dialoga ali prekrivnega obrazca naj prvo vidno vnosno polje samodejno dobi fokus.

**Why:** Android Chrome in PWA lahko tipkovnico narišeta čez fiksne dialoge, zato spodnja vnosna polja in gumbi ostanejo skriti tudi pri uporabi `100dvh`. Tipkovnica se zanesljivo odpre le, če polje dobi fokus v istem uporabniškem dejanju. Če se globalna ročica za skrivanje tipkovnice prikaže med še trajajočim dotikom, lahko prejme zaključek dotika in takoj zamegli novo polje.

**How to apply:** Višino in odmik vidnega območja objavi kot globalni CSS spremenljivki, mobilne dialoge omeji na to višino, ob odprtju fokusiraj prvo vidno vnosno polje, ob `focusin` oziroma spremembi viewporta pa aktivno polje pomakni na sredino. Pri prekrivnih hitrih vnosih izključi globalno ročico, če bi njen pojav lahko sovpadel z odpiralnim dotikom; njena funkcija za skrivanje mora isto izključitev preveriti tudi ob morebitnem zaostalem kliku.

Pri kritičnem enopoljnem PIN toku naj izguba fokusa brez cilja ali s ciljem `body` takoj povrne fokus istemu polju. Prenos fokusa dovoli le na dejanski element znotraj dialoga. Ta pristop je potrjeno odpravil zapiranje tipkovnice v Android Chromu.

Ročica za skrivanje je lahko tik nad tipkovnico, vendar mora ob `pointerdown` zamrzniti izračunano lego; spremembe višine `VisualViewport` je med dotikom ne smejo premakniti. Med animacijo dodatno uporabi ščit in `inert`. Vsaka taka poteza mora obdelati tudi `pointercancel` in imeti varovalni časovnik od samega `pointerdown`, ki vedno odstrani ščit ter povrne prejšnji `inert`; Android lahko ob zapiranju tipkovnice izpusti `pointerup`.

Vsi POS vnosi trenutno uporabljajo izbrano Androidovo sistemsko tipkovnico; namenska Bookie tipkovnica je izključena tudi pri specializiranih vnosih.

**Why:** Uporabnik želi celoten POS preizkusiti s HeliBoardom kot trenutno izbranim sistemskim IME.

**How to apply:** Vnosov na zaslonu na dotik ne nastavljaj na `readOnly` ali `inputMode="none"` in jih ne prestrezaj z lastnim prekrivnim prikazom. Ohrani podporo `VisualViewport`, vendar ne prikazuj Bookiejeve ročice; HeliBoard se skrije z lastno gesto navzdol.

Operativna POS polja morajo privzeto imeti `autocomplete="off"`; eksplicitne oznake za prijavo, gesla, e-pošto in telefon imajo prednost.

**Why:** Androidov Autofill nad sistemsko tipkovnico sicer prikazuje nepotreben pas za gesla, plačilna sredstva in naslove tudi pri količinah, cenah ter drugih internih vnosih.

**How to apply:** Skupni Input in Textarea naj uporabljata varen privzeti način, DOM politika pa naj pokrije neposredne stare elemente brez oznake. Nikoli ne prepiši že nastavljenega semantičnega `autocomplete`.