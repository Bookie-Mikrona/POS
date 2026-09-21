---
name: Vitest ESM mock lekcije
description: Pogosti vzroki napak pri Vitest mockanju v ESM + TypeScript monorepu
---

## Lekcija 1: vi.mock + importOriginal je nestabilen za tranzitivne uvoze

**Pravilo**: Ko moraš mockat modul, ki ga uvažaš tranzitivno (test → router → lib → modul), NIKOLI ne uporabi `importOriginal`.

**Vzrok**: `importOriginal` med inicializacijo kliče pravi modul, kar povzroči, da se mocked modul v nekaterih primerih ne naloži pravilno za vse porabnike.

**Pravilno**:
```typescript
vi.mock("../../lib/pos-email", () => ({
  posljiEmailZacasnoGeslo: vi.fn(),
  posljiEmailRacun: vi.fn(),
  posljiEslogEmail: mockPosljiEslogEmail,
  posljiTestnoEmail: vi.fn(),
}));
```

**Nepravilno**:
```typescript
vi.mock("../../lib/pos-email", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return { ...original, posljiEslogEmail: mockPosljiEslogEmail };
});
```

## Lekcija 2: CHECK constraint mora biti sinhroniziran z Drizzle enumom

**Pravilo**: Ko Drizzle shema doda novo vrednost v `text` enum (npr. `eRacunStatus`), mora ustrezna migracija POSODOBITI tudi PostgreSQL CHECK constraint.

**Vzrok**: PostgreSQL CHECK constraint je neodvisen od Drizzle sheme. Brez posodobitve DB zavrne `INSERT`/`UPDATE` z novo vrednostjo — runtime 500, ki je ni videti v testih, dokler ne potrdiš z diagnostičnim logom.

**Vzorec migracije**:
```sql
ALTER TABLE racuni DROP CONSTRAINT IF EXISTS racuni_e_racun_status_check;
ALTER TABLE racuni ADD CONSTRAINT racuni_e_racun_status_check
  CHECK (e_racun_status = ANY (ARRAY['vrednost1'::text, 'nova_vrednost'::text, ...]));
```

**Kako odkriti**: Diagnostični log res.body za 500 odgovore — vsebuje `Failed query: update ... set ... = $1 \nparams: nova_vrednost`.

## Lekcija 3: narocilo_id je NOT NULL v tabeli racuni

**Pravilo**: Vsak direktni `db.insert(racuniTable)` v testih MORA najprej vstaviti vrstico v `narocilaTable` in ID podati kot `narociloId`.

**Vzrok**: `racuni.narocilo_id` je NOT NULL brez default vrednosti (foreign key na `narocila`).

**Vzorec**:
```typescript
const [narocilo] = await db.insert(narocilaTable).values({ enotaId }).returning({ id: narocilaTable.id });
const [r] = await db.insert(racuniTable).values({ narociloId: narocilo!.id, ... }).returning({ id: racuniTable.id });
```

## Lekcija 4: nodemailer mock v tranzitivni verigi ne prime zanesljivo

**Pravilo**: Za endpoint integracijne teste, ki vsebujejo e-poštno logiko, mocaj visokoravni modul (`pos-email.ts`) — ne nodemailer neposredno.

Za unit teste `posljiEslogEmail` (direktni uvoz) nodemailer mock z `vi.hoisted` + `vi.mock("nodemailer")` deluje zanesljivo.
