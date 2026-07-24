---
name: POS plačilni zneski — mešana plačila
description: Kako so shranjeni in kako jih brati za realizacijo in statistike
---

## Pravilo

Račun ima `placilna_nacin` (primarni način) in ločene `znesek_*` stolpce za vsak način:
- `znesek_gotovina`, `znesek_kartica`, `znesek_bon`, `znesek_bon_pica`, `znesek_negotovinsko`

Pri mešanem plačilu (npr. bon + TRR) je `placilna_nacin = "negotovinsko"` (ali kateri koli drugi),
`znesek_bon = 14.00` in `znesek_negotovinsko = 4.50` — oba stolpca sta izpolnjena.

## Kako brati

Vedno preberi VSE `znesek_*` stolpce eksplicitno. Fallback na `placilna_nacin` samo kadar so VSI `znesek_*` enaki 0 (starejši zapisi brez razčlenjenih zneskov).

```typescript
let gotovina     = r.znesekGotovina     != null ? Number(r.znesekGotovina)     : 0;
let kartica      = r.znesekKartica      != null ? Number(r.znesekKartica)      : 0;
let bon          = r.znesekBon          != null ? Number(r.znesekBon)          : 0;
let bonPica      = r.znesekBonPica      != null ? Number(r.znesekBonPica)      : 0;
let negotovinsko = r.znesekNegotovinsko != null ? Number(r.znesekNegotovinsko) : 0;
if (gotovina === 0 && kartica === 0 && bon === 0 && bonPica === 0 && negotovinsko === 0) {
  // fallback po placilna_nacin
}
```

## Posebnost: reprezentanca in lastna_poraba

Ti dve vrsti imata `racuni.skupaj = 0` (brezplačni). Pravi znesek je face value iz `postavke`:
```sql
SELECT COALESCE(SUM(skupaj::numeric), 0) AS face FROM postavke WHERE racun_id = ANY(...)
```
Uporablja se `db.execute(sql\`...\`).rows[0]`, ne destrukturiranje `[fv]`.

**Why:** `db.execute` vrne `{ rows: [...] }`, ne array — destrukturiranje da vedno `undefined`.
