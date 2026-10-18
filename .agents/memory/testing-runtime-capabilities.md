---
name: Orodja testerja
description: Različni nabori podprtih callbackov pri glavnem agentu in brskalniškem testerju.
---

Če tester nima podprtega orodja za upravljanje okolja, preveri njegovo razpoložljivost tudi v glavnem agentu, preden preizkus razglasiš za blokiran.

**Why:** Brskalniški tester ni imel callbackov za okoljske spremenljivke, glavni agent pa je imel podprte viewEnvVars, setEnvVars in deleteEnvVars. Preizkus je bilo mogoče nadaljevati brez uporabnikovega posega ali obvoda prijave.

**How to apply:** Glavni agent po ustrezni veščini izvede začasno spremembo in hrani prvotno stanje za natančno obnovo. S testerjem izmenja le nujne neobčutljive identifikatorje; skrivnosti ne zapisuje v datoteke ali pogovor. Nadaljuj istega testerja, ne zaganjaj drugega preizkusa.
