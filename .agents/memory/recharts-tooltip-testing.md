---
name: Recharts tooltip testiranje
description: Omejitve simulacije premika miške nad odzivnim Recharts grafikonom v jsdom.
---

Pri grafu z datumi mora kategorijska os izrecno uporabljati datum; brez nje Recharts tooltip kot oznako vrne številčni indeks točke.

**Why:** Pretvorba indeksa v datum ob premiku miške povzroči napako. V jsdom tudi ročno nastavljeni ResizeObserver, dimenzije elementa in dogodek mouseenter/mousemove niso zanesljivo aktivirali pravega Recharts tooltipa.

**How to apply:** Za regresijski test vezave oznake preveri pogodbo med osjo in tooltipom z majhnim nadomestkom grafa, ki ob hoverju posreduje vrednost kategorijske osi (ali indeks, če osi ni). Za preverjanje dejanskega prikaza in interakcije uporabi brskalniški test z resnično postavitvijo.

Pri preverjanju končnih SVG vzorcev črt v jsdom ohrani dejanske Recharts komponente, določi fiksno velikost grafa in izključi animacijo samo v testu.

**Why:** jsdom ne izmeri dolžine SVG poti; animacija zato lahko izpiše prehodni `stroke-dasharray="0px 0px"` namesto nastavljenega vzorca. Čakanje na animacijo ni zanesljiv nadomestek za geometrijo brskalnika.

**How to apply:** Testni ovoj odzivnega vsebnika naj dejanskemu grafu poda velikost in njegovim serijam izključi animacijo. Nato preveri izrisane poti in ikone legende, ne le vhodnih lastnosti.