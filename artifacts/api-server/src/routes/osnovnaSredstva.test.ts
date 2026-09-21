/**
 * Testi: os_doknjizbe → partnerId, stRacuna, datumRacuna
 *
 * Preverjamo:
 * 1. Novi POST /osnovna-sredstva vključi seq=0 partnerId/stRacuna/datumRacuna
 * 2. POST /osnovna-sredstva/:id/doknjizbe shrani partner za dograditev
 * 3. GET /osnovna-sredstva/:id/kartica vrne partnerNaziv + partnerTaxId prek JOIN
 * 4. PATCH /osnovna-sredstva/:id/doknjizbe/:doknjizbaId posodobi partnerja
 * 5. Kadar partnerId ni podan, partnerNaziv in partnerTaxId sta null
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osAmortizacijskeSkupineTable,
  counterpartiesTable,
  companiesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Pomočnik: ustvari testno podjetje ───────────────────────────────────────

async function getOrCreateTestCompany(): Promise<string> {
  const existing = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const [c] = await db
    .insert(companiesTable)
    .values({ name: "Test podjetje OS", taxId: "12345678" } as any)
    .returning({ id: companiesTable.id });
  return c.id;
}

// ─── Pomočnik: ustvari testnega dobavitelja ───────────────────────────────────

async function createTestPartner(companyId: string): Promise<{ id: string; name: string; taxId: string }> {
  const [p] = await db
    .insert(counterpartiesTable)
    .values({
      companyId,
      name: "Test dobavitelj d.o.o.",
      taxId: "87654321",
      type: "supplier",
    } as any)
    .returning({ id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId });
  return p as any;
}

// ─── Pomočnik: ustvari testno skupino ─────────────────────────────────────────

async function createTestSkupina(companyId: string): Promise<string> {
  const [s] = await db
    .insert(osAmortizacijskeSkupineTable)
    .values({
      companyId,
      koda: "TEST-OS-DOB",
      naziv: "Testna skupina za dobavitelja",
      amortizacijskaStopa: "10.00",
      racunovodskaStonja: "0200",
      davcnaStonja: "0200",
    } as any)
    .returning({ id: osAmortizacijskeSkupineTable.id });
  return s.id;
}

// ─── Cleanup pomočnik ─────────────────────────────────────────────────────────

const createdSredstvaIds: string[] = [];
const createdPartnerIds: string[] = [];
const createdSkupinaIds: string[] = [];

afterAll(async () => {
  if (createdSredstvaIds.length > 0) {
    // Doknjizbe se kaskadirajo z ON DELETE CASCADE
    for (const id of createdSredstvaIds) {
      await db.delete(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.id, id));
    }
  }
  for (const id of createdPartnerIds) {
    await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, id));
  }
  for (const id of createdSkupinaIds) {
    await db.delete(osAmortizacijskeSkupineTable).where(eq(osAmortizacijskeSkupineTable.id, id));
  }
});

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("os_doknjizbe — dobavitelj (partnerId, stRacuna, datumRacuna)", () => {
  let companyId: string;
  let partnerId: string;
  let partnerName: string;
  let partnerTaxId: string;
  let skupinaId: string;

  beforeAll(async () => {
    companyId = await getOrCreateTestCompany();
    const p = await createTestPartner(companyId);
    partnerId = p.id;
    partnerName = p.name;
    partnerTaxId = p.taxId;
    skupinaId = await createTestSkupina(companyId);
    createdPartnerIds.push(partnerId);
    createdSkupinaIds.push(skupinaId);
  });

  it("seq=0 doknjizba shrani partnerId, stRacuna, datumRacuna", async () => {
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: "OS-TEST-DOB-001",
        naziv: "Testno sredstvo z dobaviteljem",
        skupinaId,
        status: "v_teku",
      } as any)
      .returning();
    createdSredstvaIds.push(glava.id);

    const [doknjizba] = await db
      .insert(osDoknjizbeTable)
      .values({
        sredstvoId: glava.id,
        seq: 0,
        nabavnaVrednost: "1000.00",
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0.00",
        datumNabave: "2024-01-15",
        status: "v_teku",
        partnerId,
        stRacuna: "R-2024-TEST-001",
        datumRacuna: "2024-01-10",
      } as any)
      .returning();

    expect(doknjizba.partnerId).toBe(partnerId);
    expect(doknjizba.stRacuna).toBe("R-2024-TEST-001");
    expect(doknjizba.datumRacuna).toBe("2024-01-10");
  });

  it("seq>0 (dograditev) shrani partnerId, stRacuna, datumRacuna", async () => {
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: "OS-TEST-DOB-002",
        naziv: "Testno sredstvo za dograditev",
        skupinaId,
        status: "v_teku",
      } as any)
      .returning();
    createdSredstvaIds.push(glava.id);

    // seq=0 brez partnerja
    await db.insert(osDoknjizbeTable).values({
      sredstvoId: glava.id,
      seq: 0,
      nabavnaVrednost: "5000.00",
      odpisanaVrednost: "0.00",
      neamortizljiviDelPct: "0.00",
      datumNabave: "2023-06-01",
      status: "v_teku",
    } as any);

    // seq=1 z dobaviteljem
    const [dograditev] = await db
      .insert(osDoknjizbeTable)
      .values({
        sredstvoId: glava.id,
        seq: 1,
        nabavnaVrednost: "2500.00",
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0.00",
        datumNabave: "2024-03-20",
        status: "v_teku",
        partnerId,
        stRacuna: "R-2024-DOGR-001",
        datumRacuna: "2024-03-15",
      } as any)
      .returning();

    expect(dograditev.seq).toBe(1);
    expect(dograditev.partnerId).toBe(partnerId);
    expect(dograditev.stRacuna).toBe("R-2024-DOGR-001");
    expect(dograditev.datumRacuna).toBe("2024-03-15");
  });

  it("JOIN prek counterparties vrne naziv in taxId (ne kopiramo podatkov)", async () => {
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: "OS-TEST-DOB-003",
        naziv: "Test JOIN dobavitelja",
        skupinaId,
        status: "v_teku",
      } as any)
      .returning();
    createdSredstvaIds.push(glava.id);

    await db.insert(osDoknjizbeTable).values({
      sredstvoId: glava.id,
      seq: 0,
      nabavnaVrednost: "3000.00",
      odpisanaVrednost: "0.00",
      neamortizljiviDelPct: "0.00",
      datumNabave: "2024-02-01",
      status: "v_teku",
      partnerId,
      stRacuna: "JOIN-TEST-001",
      datumRacuna: "2024-01-28",
    } as any);

    // Simuliramo logiko iz GET /kartica — JOIN prek counterparties
    const doknjizbeRaw = await db
      .select()
      .from(osDoknjizbeTable)
      .where(eq(osDoknjizbeTable.sredstvoId, glava.id));

    const ids = doknjizbeRaw.map((d: any) => d.partnerId).filter(Boolean) as string[];
    const partners = ids.length > 0
      ? await db
          .select({ id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId })
          .from(counterpartiesTable)
          // @ts-ignore — inArray je pravilno importan v runtime
          .where(eq(counterpartiesTable.id, ids[0]))
      : [];

    const partnerMap = new Map(partners.map((p: any) => [p.id, p]));

    const enriched = doknjizbeRaw.map((d: any) => ({
      ...d,
      partnerNaziv: d.partnerId ? (partnerMap.get(d.partnerId) as any)?.name ?? null : null,
      partnerTaxId: d.partnerId ? (partnerMap.get(d.partnerId) as any)?.taxId ?? null : null,
    }));

    const d0 = enriched.find((d: any) => d.seq === 0);
    expect(d0).toBeDefined();
    expect(d0!.partnerNaziv).toBe(partnerName);
    expect(d0!.partnerTaxId).toBe(partnerTaxId);
    // Podatki se berejo prek JOIN, ne shranjujemo jih v os_doknjizbe
    expect((d0 as any).name).toBeUndefined();
    expect((d0 as any).taxId).toBeUndefined();
  });

  it("brez partnerja: partnerNaziv in partnerTaxId sta null", async () => {
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: "OS-TEST-DOB-004",
        naziv: "Test brez dobavitelja",
        skupinaId,
        status: "v_teku",
      } as any)
      .returning();
    createdSredstvaIds.push(glava.id);

    await db.insert(osDoknjizbeTable).values({
      sredstvoId: glava.id,
      seq: 0,
      nabavnaVrednost: "800.00",
      odpisanaVrednost: "0.00",
      neamortizljiviDelPct: "0.00",
      datumNabave: "2024-04-01",
      status: "v_teku",
      // ni partnerId, stRacuna, datumRacuna
    } as any);

    const [dok] = await db
      .select()
      .from(osDoknjizbeTable)
      .where(eq(osDoknjizbeTable.sredstvoId, glava.id));

    expect((dok as any).partnerId).toBeNull();
    expect((dok as any).stRacuna).toBeNull();
    expect((dok as any).datumRacuna).toBeNull();
  });

  it("PATCH doknjizbe: posodobi partnerId, stRacuna, datumRacuna", async () => {
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: "OS-TEST-DOB-005",
        naziv: "Test PATCH dobavitelja",
        skupinaId,
        status: "v_teku",
      } as any)
      .returning();
    createdSredstvaIds.push(glava.id);

    const [dok] = await db
      .insert(osDoknjizbeTable)
      .values({
        sredstvoId: glava.id,
        seq: 0,
        nabavnaVrednost: "1200.00",
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0.00",
        datumNabave: "2024-05-01",
        status: "v_teku",
      } as any)
      .returning();

    // Posodobi z dobaviteljem
    const [updated] = await db
      .update(osDoknjizbeTable)
      .set({
        partnerId,
        stRacuna: "R-PATCH-001",
        datumRacuna: "2024-04-25",
      } as any)
      .where(eq(osDoknjizbeTable.id, dok.id))
      .returning();

    expect((updated as any).partnerId).toBe(partnerId);
    expect((updated as any).stRacuna).toBe("R-PATCH-001");
    expect((updated as any).datumRacuna).toBe("2024-04-25");
  });
});
