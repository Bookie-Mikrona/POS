---
name: Mobilni UI popravki
description: Zbirka mobile-layout popravkov na POS aplikaciji (UparjanjeDialog, Zaloge, Izmene, "Več" plošča, navigacija)
---

## Izvedeni popravki (seja avg 2026)

### UparjanjeDialog — duplikati kandidatov
- SQL UPDATE deduplicira `uparjanje_kandidati` pri nevparjenih postavkah (obdrži višjo ceno)
- `/neuparjeno` endpoint deduplicira pri vračanju
- `UparjanjeDialog` deduplicira v `useMemo`
- Datoteka: `artifacts/api-server/src/routes/pos/uvoz-prejemnic.ts`, `artifacts/pos/src/pages/uvoz/UparjanjeDialog.tsx`

### UparjanjeDialog — prikaz kandidatov na mobilnem
- Pod 640px: `text-xs`, `line-clamp-2`, `items-start`
- Na sm+: `text-sm` + `truncate` (nespremenjeno)

### Zaloge — iskalna vrstica na mobilnem
- `space-y-1.5` wrapper; iskalno polje polna širina (sm: max-w-sm)
- "Popravi zaloge" gumb: na mobilnem samo ikona; namig tekst `hidden sm:block`
- Datoteka: `artifacts/pos/src/pages/Zaloge.tsx`

### "Več" plošča — zapiranje na mobilnem
- Dodan `max-h-[85dvh]`, `overflow-y-auto flex-1`, drag indicator ročaj, fiksen "Zapri" gumb na dnu
- Datoteka: `artifacts/pos/src/App.tsx` (SheetContent)

### "Več" plošča — odjava
- Odjava gumb (ikona + ime) premaknjen na vrh, v isto vrstico kot naslov "Meni" (desno)
- Naziv restavracije ostaja v vsebini

### Primarna mobilna navigacija — vrstni red
- Primarna vrstica (vedno vidno): Mize · Blagajna · Izmene · Računi · Partnerji
- "Več" plošča začne z: Kuhinja · Točilnica · Meni · ...
- Datoteka: `artifacts/pos/src/App.tsx` — `primaryNav` in `mobileSecondaryNav`

### Izmene — "Odpri novo izmeno" kartica na mobilnem
- Vzrok: `flex gap-3 items-center` razpel vsebino čez rob kartice
- Popravek: `flex-col sm:flex-row`; Select `w-full sm:max-w-xs`; Button `w-full sm:w-auto`
- Datoteka: `artifacts/pos/src/pages/Izmene.tsx` (~vrstica 534)

## Splošno pravilo
Na mobilnem vedno preveriti, ali `flex-row` layout ne preseže širine kartice/containerja.
Obrazec z dvema elementoma (Select + Button) → `flex-col sm:flex-row` + polna širina elementov na mobilnem.
