---
name: POS booking analitika
description: Razširjen pos_booking_settings za analitično knjiženje po vrsti artikla × DDV stopnji
---

## Shema pos_booking_settings (od julij 2026)

24 stolpcev. Novi stolpci (nullable):
- `voucher_account_id` — darilni boni (2300110)
- `revenue_material_95_account_id` — prihodki material 9,5% (7620110)
- `revenue_material_22_account_id` — prihodki material 22% (7620210)
- `revenue_goods_22_account_id` — prihodki blago 22% (7620310)
- `revenue_goods_95_account_id` — prihodki blago 9,5% (7620320)
- `revenue_service_account_id` — prihodki storitev (7600110)
- `vat_95_account_id` — DDV 9,5% (2600195)
- `vat_22_account_id` — DDV 22% (2600122)
- `inventory_material_account_id` — zaloga materiala razr. 3
- `inventory_goods_account_id` — zaloga blaga razr. 6
- `cogs_material_account_id` — stroški materiala (4000110)
- `cogs_goods_account_id` — NVPB blaga (7020110)

Stari stolpci ostanejo kot fallback (revenue_account_id, vat_liability_account_id, inventory_account_id, cogs_account_id).

## Vir podatkov za analitiko

`postavke` tabela ima `vrsta_artikla` (material/blago/storitev) in `davek` (0/9.5/22).
- T1 PRODAJA: GROUP BY vrsta×davek iz postavke; plačila iz glave računa (znesek_gotovina, znesek_kartica, znesek_bon+znesek_bon_pica, znesek_negotovinsko)
- T2 PREJEMNICA: JOIN prejemnice_postavke→artikli za vrsta; material→razr3, blago→razr6
- T3 PORABA: GROUP BY artikli.vrstaArtikla iz zaloga_gibi

## Fallback logika

Če analitični konto ni nastavljen, se uporabi zastareli splošni konto (revenueAccountId, vatLiabilityAccountId itd.).
Funkcija `mergeLines()` sešteje vrstice z istim accountId+side v eno vrstico.

**Why:** Gostilna Križišče zahteva ločevanje: hrana kuhinja (9,5%) / točene alkoholne (22%) / točene brezalkoholne (9,5%) / steklenice alkohol (22%) / steklenice brezalkohol (9,5%) / storitev (22%).

**How to apply:** Ko dodaš novo gostilno, nastavi vsaj cash+card+revenue_material_95+vat_22+payables. Ostalo je neobvezno (fallback na general konte).
