/**
 * Integracijski test: nespremenljivost snapshota dobavitelja.
 *
 * Preverja, da se snapshot dobavitelja na prejemnici NE posodablja,
 * ko se živi partner (counterparty) v bazi pozneje posodobi.
 * Prav tako preverja, da generirani e-SLOG XML vsebuje stare snapshot
 * podatke, ne novih podatkov živega partnerja.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  prejemnicePostavkeTable,
  prejemniceTable,
} from "@workspace/db";
import {
  generirajPrejetiEracunXml,
  validateReceivedInvoiceForEslog,
} from "../../lib/received-invoice-eslog";
import { loadReceivedInvoice } from "../../lib/received-invoice-loader";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let counterpartyId: string;
let prejemnicaId: number;

const PRVOTNI_NAZIV = `Prvotni Dobavitelj ${RUN_ID}`;
const PRVOTNI_IBAN = `SI56040002410000${RUN_ID.slice(0, 3)}`;
const PRVOTNA_DAVCNA = `SI12345${RUN_ID.slice(0, 3)}`;

const NOVI_NAZIV = `SPREMENJEN Dobavitelj ${RUN_ID}`;
const NOVI_IBAN = `SI56040002419999${RUN_ID.slice(0, 3)}`;

beforeAll(async () => {
  // Ustvari podjetje
  const [c] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `SI_SNAP_${RUN_ID}`, naziv: `Test Snapshot ${RUN_ID}` })
    .returning({ id: companiesTable.id });
  companyId = c!.id;

  // Ustvari enoto
  const [e] = await db
    .insert(enoteTable)
    .values({ companyId, ime: `Enota SNAP ${RUN_ID}` })
    .returning({ id: enoteTable.id });
  enotaId = e!.id;

  // Ustvari partnerja z začetnimi podatki
  const [cp] = await db
    .insert(counterpartiesTable)
    .values({
      companyId,
      name: PRVOTNI_NAZIV,
      type: "supplier" as const,
      taxId: PRVOTNA_DAVCNA,
      iban: PRVOTNI_IBAN,
    })
    .returning({ id: counterpartiesTable.id });
  counterpartyId = cp!.id;

  // Ustvari prejemnico s SNAPSHOTOM ob nastanku
  const [p] = await db
    .insert(prejemniceTable)
    .values({
      enotaId,
      dobaviteljId: counterpartyId,
      stDokumenta: `SNAP-${RUN_ID}`,
      datumDokumenta: `2026-08-20`,
      vrstaDokumenta: `RACUN`,
      ddvOsnova: `100.00`,
      ddvZnesek: `22.00`,
      brutoSkupaj: `122.00`,
      placilniSklic: `SI00${RUN_ID}`,
      // Snapshot — zajet ob nastanku, NE bo posodobljen
      dobaviteljNaziv: PRVOTNI_NAZIV,
      dobaviteljDavcna: PRVOTNA_DAVCNA,
      dobaviteljIdDdv: PRVOTNA_DAVCNA,
      dobaviteljIban: PRVOTNI_IBAN,
      prejemnikNaziv: `Test Prejemnik ${RUN_ID}`,
      prejemnikDavcna: `SI99999${RUN_ID.slice(0, 3)}`,
      prejemnikIdDdv: `SI99999${RUN_ID.slice(0, 3)}`,
      snapshotZajet: new Date(),
    })
    .returning({ id: prejemniceTable.id });
  prejemnicaId = p!.id;

  // Kanonična vrstica za e-SLOG generiranje
  await db.insert(prejemnicePostavkeTable).values({
    prejemnicaId,
    kolicina: `10`,
    cenaKos: `10.0000`,
    skupaj: `100.00`,
    izvNaziv: `Test artikel ${RUN_ID}`,
    enotaMere: `KGM`,
    netoCena: `10.000000`,
    netoZnesek: `100.00`,
    ddvStopnja: `22`,
    ddvOsnova: `100.00`,
    ddvZnesek: `22.00`,
    ddvKategorija: `S`,
  });
});

afterAll(async () => {
  if (prejemnicaId) {
    await db.delete(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, prejemnicaId));
    await db.delete(prejemniceTable).where(eq(prejemniceTable.id, prejemnicaId));
  }
  if (counterpartyId) await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, counterpartyId));
  if (enotaId) await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("Snapshot nespremenljivost — partner posodobljen po nastanku prejemnice", () => {
  it("posodobi živega partnerja v bazi", async () => {
    await db
      .update(counterpartiesTable)
      .set({ name: NOVI_NAZIV, iban: NOVI_IBAN })
      .where(eq(counterpartiesTable.id, counterpartyId));

    const [live] = await db
      .select({ name: counterpartiesTable.name, iban: counterpartiesTable.iban })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, counterpartyId));
    expect(live!.name).toBe(NOVI_NAZIV);
    expect(live!.iban).toBe(NOVI_IBAN);
  });

  it("loadReceivedInvoice vrne STARE snapshot podatke, ne novega naziva/IBAN-a partnerja", async () => {
    const loaded = await loadReceivedInvoice(companyId, prejemnicaId);
    expect(loaded).not.toBeNull();

    // Snapshot mora vsebovati prvotne vrednosti
    expect(loaded!.data.header.supplier.name).toBe(PRVOTNI_NAZIV);
    expect(loaded!.data.header.supplier.iban).toBe(PRVOTNI_IBAN);
    expect(loaded!.data.header.supplier.taxId).toBe(PRVOTNA_DAVCNA);

    // Snapshot NE sme vsebovati novih vrednosti
    expect(loaded!.data.header.supplier.name).not.toContain("SPREMENJEN");
    expect(loaded!.data.header.supplier.iban).not.toBe(NOVI_IBAN);
  });

  it("generirajPrejetiEracunXml vsebuje snapshot podatke dobavitelja, ne živih", async () => {
    const loaded = await loadReceivedInvoice(companyId, prejemnicaId);
    expect(loaded).not.toBeNull();

    const validation = validateReceivedInvoiceForEslog(loaded!.data);
    expect(
      validation.valid,
      `Validacijske napake: ${validation.errors.join("; ")}`,
    ).toBe(true);

    const xml = generirajPrejetiEracunXml(loaded!.data);

    // XML mora vsebovati STARI naziv iz snapshota
    expect(xml).toContain(PRVOTNI_NAZIV);
    // XML NE sme vsebovati NOVEGA naziva živega partnerja
    expect(xml).not.toContain(NOVI_NAZIV);
  });

  it("loadReceivedInvoice zavrne dostop do napačnega podjetja", async () => {
    const drugoPodjetjeId = "00000000-0000-0000-0000-000000000000";
    const result = await loadReceivedInvoice(drugoPodjetjeId, prejemnicaId);
    expect(result).toBeNull();
  });
});
