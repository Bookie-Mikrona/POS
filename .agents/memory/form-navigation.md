---
name: Navigacija po formah
description: Pravila za navigacijo s tipkovnico po vseh vnosnih poljih v POS aplikaciji
---

## Pravilo (velja za VSE forme — obstoječe in nove)

### Tabelarne forme (več vrstic, več stolpcev)
Vzorec: `navFoo(rowIdx, col, dir)` helper z `Map<number, HTMLInputElement>` refi za vsak stolpec.

**Puščice:**
- ArrowRight / Enter → naslednji stolpec (ista vrstica); na zadnjem stolpcu → fokus na gumb Dodaj
- ArrowLeft → prejšnji stolpec (ista vrstica)
- ArrowDown → isti stolpec, naslednja vrstica
- ArrowUp → isti stolpec, prejšnja vrstica

**Artikel polje** (text input z dropdownom):
- ArrowDown/Up ko je dropdown zaprt → navigacija po vrsticah
- ArrowDown/Up ko je dropdown odprt → navigacija po seznamu (obstoječe obnašanje)
- ArrowRight → naslednji stolpec
- ArrowLeft → se ne prepiše (premik kurzorja v tekstu)

**Enter na polju artikla** → fokus na prvi vnos vrstice (enot/pak ali količina)

### Enostavne forme (enkratna polja, ne tabela)
- Enter → fokus na naslednje polje v formi
- ArrowDown → naslednje polje
- ArrowUp → prejšnje polje

### Implementirani dialogi (Zaloge.tsx)
- Nova prejemnica: ✅ navPrej() + Arrow + Enter (vse 4 stolpce)
- EditPrejemnicaDialog: ✅ navEdit() + Arrow + Enter (vse 4 stolpce)
- Nova inventura: ✅ invNajdenoRefs + Arrow Up/Down/Enter po vrsticah
- EditInventuraDialog: ✅ invEditNajdenoRefs + Arrow Up/Down/Enter po vrsticah
- Nova začetna zaloga: ✅ zzKoliRefs + zzCenaRefs + Arrow Left/Right/Up/Down/Enter
- EditZacetnaZalogaDialog: ✅ zzEditKoliRefs + zzEditCenaRefs + navZZEdit() + Arrow

**Why:** Uporabnik želi hitro tipkovnično navigacijo po vnosnih poljih brez miške, posebej pri masovnem vnosu postavk na prejemnicah/inventurah.

**How to apply:** Vsakič ko kreiraš novo formo z vnosnimi polji, dodaj navFoo helper in onKeyDown na vsa polja.
