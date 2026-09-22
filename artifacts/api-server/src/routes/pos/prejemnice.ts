import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { artikliTable, companiesTable, counterpartiesTable, db, embalazniPrometiTable, enoteTable, goodsReceiptsTable, invoicesTable, nastavitveTable, prejemniceOdvisniStroskiTable, prejemnicePostavkeTable, prejemniceTable, purchaseSourceDocumentsTable, uvozSejaTable, vatCodeTable, zalogaGibiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { broadcastToUnit } from "../../lib/pos-sse";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { toUneceUnitCode } from "../../lib/received-invoice-eslog";
import { claimPurchaseSourceDocument } from "../../lib/purchaseSourceDocuments";
import {
  getPosReceiptBookingPreview,
  lockPosReceiptForEdit,
  lockPosReceiptForReconciliation,
  ReceiptBookingConflict,
  ReceiptEditConflict,
  invalidatePosReceiptBookingDraft,
  normalizeIncomingPaymentMethod,
  savePosReceiptBookingDraft,
} from "../../lib/posReceiptBooking";
import { razveljaviAlergeneNadrejenih } from "../../lib/alergeni-resolver";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";
import {
  alergenskiSnapshotBrezAlergenov,
  alergenskiSnapshotZaPovratnoEmbalazo,
  alergenskiSnapshotZaUrejanje,
  zahtevajPotrjenAlergenskiSnapshot,
} from "../../lib/prejemnica-alergeni";

const TESTNI_ALERGENSKI_NACIN = process.env.NODE_ENV !== "production";
import {
  oppositePackagingMovementKind,
} from "../../lib/packagingMovementKind";
import { knjizalogaGibiZaUvozPrejemnico } from "../../lib/uvoz/uvoz-service";
import {
  assertPosReceiptCanBeConfirmed,
  PosReceiptNotReady,
} from "../../lib/posReceiptLifecycle";

const router: IRouter = Router();

router.get("/prejemnice/:id/booking-preview", requireEnota, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const enotaId = (req as any).enotaId as number;
  const companyId = (req as any).companyId as string;
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Neveljaven ID prejemnice" });
    return;
  }
  const preview = await getPosReceiptBookingPreview(companyId, enotaId, id);
  if (!preview) {
    res.status(404).json({ error: "Prejemnica ni najdena" });
    return;
  }
  res.json(preview);
});

router.post("/prejemnice/:id/booking-draft", requireEnota, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const enotaId = (req as any).enotaId as number;
  const companyId = (req as any).companyId as string;
  const previewHash = typeof req.body?.previewHash === "string" ? req.body.previewHash : "";
  if (!Number.isInteger(id) || id <= 0 || !previewHash) {
    res.status(400).json({ error: "Neveljavna zahteva za računovodski osnutek" });
    return;
  }
  try {
    const preview = await savePosReceiptBookingDraft(companyId, enotaId, id, previewHash);
    if (!preview) {
      res.status(404).json({ error: "Prejemnica ni najdena" });
      return;
    }
    res.status(preview.blockingErrors.length ? 422 : 200).json(preview);
  } catch (error) {
    if (error instanceof ReceiptBookingConflict) {
      res.status(409).json({ code: error.code, error: error.message });
      return;
    }
    throw error;
  }
});

async function reversePackagingForLines(tx: any, lineIds: number[], actorSnapshot: string | null) {
  if (!lineIds.length) return;
  const rows = await tx.select().from(embalazniPrometiTable)
    .where(and(
      inArray(embalazniPrometiTable.prejemnicaPostavkaId, lineIds),
      sql`NOT EXISTS (
        SELECT 1 FROM embalazni_prometi reversal
        WHERE reversal.reversal_of_id = ${embalazniPrometiTable.id}
      )`,
    ));
  for (const row of rows) {
    await tx.insert(embalazniPrometiTable).values({
      enotaId: row.enotaId, artikelId: row.artikelId, dobaviteljId: row.dobaviteljId,
      kolicina: String(-Number(row.kolicina)), depozitnaVrednost: row.depozitnaVrednost,
      prejemnicaPostavkaId: row.prejemnicaPostavkaId,
      vrsta: oppositePackagingMovementKind(row.vrsta),
      opomba: "Samodejni storno embalaže prejemnice", reversalOfId: row.id, actorSnapshot,
    });
  }
}

async function transitionPackagingMovements(
  tx: any,
  receiptId: number,
  enotaId: number,
  supplierId: string | null,
  toCreditNote: boolean,
  actorSnapshot: string | null,
  effectiveDate: Date,
) {
  const lines = await tx.select({
    id: prejemnicePostavkeTable.id,
    articleId: prejemnicePostavkeTable.artikelId,
    quantity: prejemnicePostavkeTable.kolicina,
    unitPrice: prejemnicePostavkeTable.cenaKos,
    value: prejemnicePostavkeTable.skupaj,
    returnable: artikliTable.povratnaEmbalaza,
    deposit: artikliTable.depozitnaVrednost,
  }).from(prejemnicePostavkeTable)
    .leftJoin(artikliTable, eq(artikliTable.id, prejemnicePostavkeTable.artikelId))
    .where(eq(prejemnicePostavkeTable.prejemnicaId, receiptId));
  for (const line of lines as any[]) {
    if (!line.articleId || !line.returnable) continue;
    if (toCreditNote) {
      const stock = await tx.select().from(zalogaGibiTable).where(and(
        eq(zalogaGibiTable.referencaId, receiptId),
        eq(zalogaGibiTable.artikelId, line.articleId),
        eq(zalogaGibiTable.tip, "prejemnica"),
        isNull(zalogaGibiTable.reversalOfId),
      ));
      for (const movement of stock) {
        const existingReversal = await tx.select({ id: zalogaGibiTable.id }).from(zalogaGibiTable)
          .where(eq(zalogaGibiTable.reversalOfId, movement.id)).limit(1);
        if (existingReversal.length > 0) continue;
        await tx.insert(zalogaGibiTable).values({
          artikelId: movement.artikelId, tip: "storno", kolicina: String(-Number(movement.kolicina)),
          cenaKos: movement.cenaKos, vrednost: String(-Number(movement.vrednost ?? 0)),
          opomba: "Storno ob spremembi v DOBROPIS", referencaId: receiptId,
          reversalOfId: movement.id, actorSnapshot, sourceSnapshot: "prejemnica_reversal",
          effectiveAtSnapshot: effectiveDate,
        });
      }
      const packaging = await tx.select().from(embalazniPrometiTable).where(and(
        eq(embalazniPrometiTable.prejemnicaPostavkaId, line.id),
        eq(embalazniPrometiTable.vrsta, "prejem"),
        sql`NOT EXISTS (
          SELECT 1 FROM embalazni_prometi reversal
          WHERE reversal.reversal_of_id = ${embalazniPrometiTable.id}
        )`,
      ));
      for (const movement of packaging) {
        await tx.insert(embalazniPrometiTable).values({
          enotaId: movement.enotaId, artikelId: movement.artikelId, dobaviteljId: movement.dobaviteljId,
          kolicina: String(-Number(movement.kolicina)), depozitnaVrednost: movement.depozitnaVrednost,
          prejemnicaPostavkaId: line.id, vrsta: "vracilo", opomba: "Storno ob spremembi v DOBROPIS",
          reversalOfId: movement.id, actorSnapshot, datum: effectiveDate,
        });
      }
    } else {
      await tx.insert(zalogaGibiTable).values({
        artikelId: line.articleId, tip: "prejemnica", kolicina: line.quantity, cenaKos: line.unitPrice,
        vrednost: line.value, referencaId: receiptId, actorSnapshot, sourceSnapshot: "prejemnica",
        effectiveAtSnapshot: effectiveDate,
      });
      const activePackaging = await tx.select().from(embalazniPrometiTable).where(and(
        eq(embalazniPrometiTable.prejemnicaPostavkaId, line.id),
        sql`NOT EXISTS (
          SELECT 1 FROM embalazni_prometi reversal
          WHERE reversal.reversal_of_id = ${embalazniPrometiTable.id}
        )`,
      )).orderBy(sql`${embalazniPrometiTable.id} DESC`).limit(1);
      if (activePackaging[0]?.vrsta !== "prejem") {
        await tx.insert(embalazniPrometiTable).values({
          enotaId, artikelId: line.articleId, dobaviteljId: supplierId, kolicina: line.quantity,
          depozitnaVrednost: line.deposit, prejemnicaPostavkaId: line.id, vrsta: "prejem",
          reversalOfId: activePackaging[0]?.id ?? null, datum: effectiveDate, actorSnapshot,
        });
      }
    }
  }
}

router.post("/prejemnice/:id/confirm", requireEnota, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const enotaId = (req as any).enotaId as number;
  const actor = (req as any).clerkUserId as string | null;
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Neveljaven ID prejemnice" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM prejemnice WHERE id = ${id} AND enota_id = ${enotaId} FOR UPDATE`);
      const [receipt] = await tx.select().from(prejemniceTable)
        .where(and(eq(prejemniceTable.id, id), eq(prejemniceTable.enotaId, enotaId)));
      if (!receipt) return null;
      if (receipt.status === "confirmed") return receipt;
      const lines = await tx.select({
        articleId: prejemnicePostavkeTable.artikelId,
        lineType: prejemnicePostavkeTable.vrsticaTip,
      }).from(prejemnicePostavkeTable)
        .where(eq(prejemnicePostavkeTable.prejemnicaId, id));
      assertPosReceiptCanBeConfirmed(
        receipt.status,
        lines,
      );
      await knjizalogaGibiZaUvozPrejemnico(tx as any, id, actor);
      const [confirmed] = await tx.update(prejemniceTable)
        .set({ status: "confirmed" })
        .where(eq(prejemniceTable.id, id)).returning();
      return confirmed;
    });
    if (!result) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
    broadcastToUnit(enotaId, "update", { type: "zaloge" });
    res.json({ id: result.id, status: result.status });
  } catch (error) {
    if (error instanceof PosReceiptNotReady) {
      res.status(409).json({ code: "RECEIPT_NOT_READY", error: error.message });
      return;
    }
    throw error;
  }
});

function denarAliNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
}

function datumAliNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function valutaAliEur(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : "EUR";
}

export function odvisniStroskiVnos(value: unknown): Array<{
  naziv: string; znesek: string; ddvStopnja: string | null; obravnava: "zaloga" | "strosek";
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const naziv = typeof item.naziv === "string" ? item.naziv.trim() : "";
    const znesek = denarAliNull(item.znesek);
    if (!naziv || znesek === null) return [];
    return [{
      naziv,
      znesek,
      ddvStopnja: denarAliNull(item.ddvStopnja),
      obravnava: item.obravnava === "strosek" ? "strosek" : "zaloga",
    }];
  });
}

/**
 * Ročni vnos ne sme referencirati prodajne, neveljavne ali z napačno stopnjo
 * povezane FURS kode. Uvozni servis ima ločeno preslikavo iz dobaviteljevih
 * oznak; ta varovalka ščiti neposredni POS API.
 */
async function preveriVhodneDdvKode(
  postavke: unknown[],
  datum: string,
  executor: any = db,
): Promise<string | null> {
  const supplied = postavke.filter((p): p is Record<string, unknown> =>
    !!p && typeof p === "object" && typeof (p as Record<string, unknown>).vatCodeId === "string",
  );
  const ids = [...new Set(supplied.map((p) => p.vatCodeId as string))];
  if (!ids.length) return null;
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return "Izbrana DDV koda ni veljaven identifikator.";
  }

  const found = await executor.select({
    id: vatCodeTable.id,
    rate: vatCodeTable.rate,
  })
    .from(vatCodeTable)
    .where(and(
      inArray(vatCodeTable.id, ids),
      eq(vatCodeTable.direction, "IN"),
      lte(vatCodeTable.validFrom, datum),
      or(isNull(vatCodeTable.validTo), gte(vatCodeTable.validTo, datum)),
    ));
  const byId = new Map<string, { id: string; rate: string }>(
    found.map((code: { id: string; rate: string }) => [code.id, code]),
  );

  for (const postavka of supplied) {
    const code = byId.get(postavka.vatCodeId as string);
    if (!code) return "Izbrana DDV koda ni veljavna vhodna FURS koda za datum dokumenta.";
    const rate = denarAliNull(postavka.ddvStopnja);
    if (rate !== null && Math.abs(Number(code.rate) - Number(rate)) > 0.000001) {
      return "Izbrana DDV koda se ne ujema z DDV stopnjo postavke.";
    }
  }
  return null;
}

async function nextStevilkaPrejemnica(year: number, _davcna: string, tenotaId: number): Promise<string> {
  const yy = String(year).slice(-2);
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next FROM prejemnice WHERE stevilka LIKE ${`${yy}%`} AND LENGTH(stevilka) = 8 AND enota_id = ${tenotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${yy}${String(nextSeq).padStart(6, "0")}`;
}

router.get("/prejemnice", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const rows = await db
    .select({
      id: prejemniceTable.id,
      stevilka: prejemniceTable.stevilka,
      datum: prejemniceTable.datum,
      opomba: prejemniceTable.opomba,
      skupajVrednost: prejemniceTable.skupajVrednost,
      ustvarjeno: prejemniceTable.ustvarjeno,
      dobaviteljId: prejemniceTable.dobaviteljId,
      dobaviteljNaziv: counterpartiesTable.name,
      valuta: prejemniceTable.valuta,
      datumZapadlosti: prejemniceTable.datumZapadlosti,
      ddvOsnova: prejemniceTable.ddvOsnova,
      ddvZnesek: prejemniceTable.ddvZnesek,
      status: prejemniceTable.status,
      placanoZGotovino: prejemniceTable.placanoZGotovino,
      steviloPostavk: count(prejemnicePostavkeTable.id)})
    .from(prejemniceTable)
    .leftJoin(prejemnicePostavkeTable, eq(prejemnicePostavkeTable.prejemnicaId, prejemniceTable.id))
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, prejemniceTable.dobaviteljId))
    .where(and(eq(prejemniceTable.enotaId, tenotaId)))
    .groupBy(prejemniceTable.id, counterpartiesTable.name)
    .orderBy(desc(prejemniceTable.datum));

  res.json(rows.map(r => ({
    ...r,
    skupajVrednost: Number(r.skupajVrednost),
    ddvOsnova: r.ddvOsnova != null ? Number(r.ddvOsnova) : null,
    ddvZnesek: r.ddvZnesek != null ? Number(r.ddvZnesek) : null,
  })));
});

router.post("/prejemnice", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const actorSnapshot = (req as any).clerkUserId as string;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const {
    datum, opomba, postavke, dobaviteljId, vrstaCen, stDokumenta, datumDokumenta,
    valuta, datumZapadlosti, ddvOsnova, ddvZnesek, odvisniStroski,
    vrstaDokumenta, datumDobave, datumOpravljeneStoritve, brutoSkupaj, placilniNacin, placilniSklic,
      placanoZGotovino,
  } = parsed.data;
  if (!postavke || postavke.length === 0) {
    res.status(400).json({ error: "Prejemnica mora imeti vsaj eno postavko" }); return;
  }

  const skupajVrednost = postavke.reduce((acc: number, p: any) => acc + (p.kolicina ?? 0) * (p.cenaKos ?? 0), 0);

  const artikelIds = postavke.map((p: any) => p.artikelId);
  const artikliRows = await db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere, povratnaEmbalaza: artikliTable.povratnaEmbalaza, depozitnaVrednost: artikliTable.depozitnaVrednost })
    .from(artikliTable)
    .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  const foundIds = new Set(artikliRows.map(a => a.id));
  const missingIds = artikelIds.filter((id: any) => !foundIds.has(id));
  if (missingIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));

  const docDatum = datum ? new Date(datum) : new Date();
  const year = docDatum.getFullYear();
  const vatCodeNapaka = await preveriVhodneDdvKode(
    postavke,
    datumAliNull(datumDokumenta) ?? docDatum.toISOString().slice(0, 10),
  );
  if (vatCodeNapaka) { res.status(400).json({ error: vatCodeNapaka }); return; }
  const stevilka = await nextStevilkaPrejemnica(year, "", tenotaId);
  const [company] = await db.select({
    naziv: companiesTable.naziv, davcna: companiesTable.podjetjeDavcna, idZaDdv: companiesTable.idZaDdv,
    naslov: companiesTable.naslov, ulica: companiesTable.ulica, drzava: companiesTable.kodaDrzave,
  }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Podjetje prejemnice ni najdeno" }); return; }
  const [supplier] = dobaviteljId
    ? await db.select({
      naziv: counterpartiesTable.name, davcna: counterpartiesTable.taxId, idZaDdv: counterpartiesTable.idZaDdv,
      maticna: counterpartiesTable.registrationNumber, naslov: counterpartiesTable.address, ulica: counterpartiesTable.ulica,
      posta: counterpartiesTable.postCode, kraj: counterpartiesTable.city, drzava: counterpartiesTable.kodaDrzave,
      iban: counterpartiesTable.iban, trr: counterpartiesTable.trr,
    }).from(counterpartiesTable).where(and(eq(counterpartiesTable.id, dobaviteljId), eq(counterpartiesTable.companyId, companyId))).limit(1)
    : [];
  const trr = Array.isArray(supplier?.trr) ? supplier.trr[0] : null;
  const inputDdvOsnova = denarAliNull(ddvOsnova);
  const inputDdvZnesek = denarAliNull(ddvZnesek);
  const manualCosts = odvisniStroskiVnos(odvisniStroski).reduce((sum, item) => sum + Number(item.znesek), 0);
  const calculatedGross = inputDdvOsnova !== null && inputDdvZnesek !== null
    ? String((Number(inputDdvOsnova) + Number(inputDdvZnesek) + manualCosts).toFixed(2)) : null;
  const documentType = ["RACUN", "DOBAVNICA", "DOBROPIS", "BREMEPIS"].includes(vrstaDokumenta)
    ? vrstaDokumenta as "RACUN" | "DOBAVNICA" | "DOBROPIS" | "BREMEPIS" : "DOBAVNICA";

  let transactionResult: {
    prejemnica: typeof prejemniceTable.$inferSelect;
    postavkeResult: Array<Record<string, unknown>>;
  };
  try {
    transactionResult = await db.transaction(async (tx) => {
    // Brez dobavitelja ali dobaviteljeve številke ni varne poslovne identitete;
    // tak operativni zapis ostane namenoma brez sourceDocumentId.
    const sourceDocumentId = dobaviteljId && typeof stDokumenta === "string" && stDokumenta.trim()
      ? await claimPurchaseSourceDocument(tx, {
          companyId,
          counterpartyId: dobaviteljId,
          kind: documentType === "RACUN"
            ? "invoice"
            : documentType === "DOBROPIS"
              ? "credit_note"
              : documentType === "BREMEPIS"
                ? "debit_note"
                : "delivery_note",
          documentNumber: stDokumenta,
          documentDate: datumAliNull(datumDokumenta),
          currency: valutaAliEur(valuta),
        })
      : null;
    if (sourceDocumentId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sourceDocumentId}))`);
      const existingErpReceipt = await tx.select({ id: goodsReceiptsTable.id })
        .from(goodsReceiptsTable)
        .where(eq(goodsReceiptsTable.sourceDocumentId, sourceDocumentId))
        .limit(1);
      if (existingErpReceipt.length > 0) throw new Error("PURCHASE_SOURCE_ALREADY_IN_ERP");
      const existingFinalInvoice = await tx.select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.sourceDocumentId, sourceDocumentId),
          ne(invoicesTable.status, "draft"),
        ))
        .limit(1);
      if (existingFinalInvoice.length > 0) throw new Error("PURCHASE_SOURCE_ALREADY_IN_ERP");
    }
    const [prejemnica] = await tx.insert(prejemniceTable).values({
      enotaId: tenotaId,
      dobaviteljId: dobaviteljId ?? null,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null,
      vrstaCen: (vrstaCen === "bruto" ? "bruto" : "neto") as "neto" | "bruto",
      skupajVrednost: String(skupajVrednost.toFixed(2)),
      stDokumenta: stDokumenta ?? null,
      datumDokumenta: datumAliNull(datumDokumenta),
      valuta: valutaAliEur(valuta),
      datumZapadlosti: datumAliNull(datumZapadlosti),
      ddvOsnova: inputDdvOsnova,
      ddvZnesek: inputDdvZnesek,
      vrstaDokumenta: documentType,
      datumDobave: datumAliNull(datumDobave),
      datumOpravljeneStoritve: datumAliNull(datumOpravljeneStoritve),
      brutoSkupaj: denarAliNull(brutoSkupaj) ?? calculatedGross,
      placilniNacin: typeof placilniNacin === "string" ? placilniNacin : null,
      placanoZGotovino: placanoZGotovino === true
        || (placanoZGotovino == null
          && normalizeIncomingPaymentMethod(typeof placilniNacin === "string" ? placilniNacin : null) === "cash"),
      placilniSklic: typeof placilniSklic === "string" ? placilniSklic : null,
      dobaviteljNaziv: supplier?.naziv ?? null,
      dobaviteljDavcna: supplier?.davcna ?? null,
      dobaviteljIdDdv: supplier?.idZaDdv ?? null,
      dobaviteljMaticna: supplier?.maticna ?? null,
      dobaviteljUlica: supplier?.ulica ?? supplier?.naslov ?? null,
      dobaviteljPosta: supplier?.posta ?? null,
      dobaviteljKraj: supplier?.kraj ?? null,
      dobaviteljDrzava: supplier?.drzava ?? null,
      dobaviteljIban: supplier?.iban ?? trr?.iban ?? null,
      dobaviteljBic: trr?.bic ?? null,
      prejemnikNaziv: company.naziv,
      prejemnikDavcna: company.davcna,
      prejemnikIdDdv: company.idZaDdv,
      prejemnikNaslov: company.naslov ?? company.ulica ?? null,
      prejemnikDrzava: company.drzava ?? null,
      snapshotZajet: new Date(),
      sourceDocumentId,
    }).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const kolicina = p.kolicina ?? 0;
      const cenaKos = p.cenaKos ?? 0;
      const skupaj = kolicina * cenaKos;

      const enotVPaketu = p.enotVPaketu && Number(p.enotVPaketu) > 1 ? Number(p.enotVPaketu) : 1;
      // izvCena = katalog cena pred popustom; rabat1Odst = popust v %
      // Frontend pošlje izvCena = cena iz forme, popust = popust %; cenaKos je že neto.
      const izvCena = p.izvCena != null ? Number(p.izvCena) : null;
      const rabat1Odst = p.popust != null ? Number(p.popust) : 0;
      const art = artikelMap.get(p.artikelId);
      let alergeniProfil;
      try {
        alergeniProfil = TESTNI_ALERGENSKI_NACIN
          ? alergenskiSnapshotBrezAlergenov(actorSnapshot)
          : art?.povratnaEmbalaza
            ? alergenskiSnapshotZaPovratnoEmbalazo(actorSnapshot)
            : zahtevajPotrjenAlergenskiSnapshot(p);
      } catch (error) {
        const naziv = art?.imeZaNabavo ?? art?.ime ?? `Artikel ${p.artikelId}`;
        throw new Error(`RECEIPT_ALLERGEN_INVALID:${naziv}: ${(error as Error).message}`);
      }
      const [pp] = await tx.insert(prejemnicePostavkeTable).values({
        prejemnicaId: prejemnica.id,
        artikelId: p.artikelId,
        kolicina: String(kolicina),
        cenaKos: String(cenaKos),
        skupaj: String(skupaj.toFixed(2)),
        enotVPaketu: String(enotVPaketu),
        ...(izvCena != null ? { izvCena: String(izvCena) } : {}),
        izvNaziv: typeof p.izvNaziv === "string" ? p.izvNaziv : (art?.imeZaNabavo ?? art?.ime ?? null),
        rabat1Odst: String(rabat1Odst),
        ddvStopnja: denarAliNull(p.ddvStopnja),
        ddvOsnova: denarAliNull(p.ddvOsnova),
        ddvZnesek: denarAliNull(p.ddvZnesek),
        vatCodeId: typeof p.vatCodeId === "string" ? p.vatCodeId : null,
        vrsticaTip: p.vrsticaTip === "strosek" ? "poraba_surovin" : (p.vrsticaTip ?? "zaloga"),
        enotaMere: toUneceUnitCode(p.enotaMere ?? art?.enotaMere),
        netoCena: String(cenaKos),
        netoZnesek: String(skupaj.toFixed(2)),
        ddvKategorija: typeof p.ddvKategorija === "string" ? p.ddvKategorija : (p.ddvStopnja != null ? (Number(p.ddvStopnja) > 0 ? "S" : "Z") : null),
        ...(alergeniProfil ?? {}),
      }).returning();

      if (alergeniProfil && alergeniProfil.alergeniStatus !== "nepreverjeno" && p.artikelId != null) {
        await tx.update(artikliTable).set({
          alergeni: alergeniProfil.alergeni, alergeniSledi: alergeniProfil.alergeniSledi,
          alergeniStatus: alergeniProfil.alergeniStatus, alergeniVir: alergeniProfil.alergeniVir,
          alergeniOpombaVira: alergeniProfil.alergeniOpombaVira, alergeniDocumentId: alergeniProfil.alergeniDocumentId,
          alergeniVerifiedBy: alergeniProfil.alergeniVerifiedBy, alergeniVerifiedAt: alergeniProfil.alergeniVerifiedAt,
          alergeniHash: alergeniProfil.alergeniHash,
        }).where(eq(artikliTable.id, p.artikelId));
        await razveljaviAlergeneNadrejenih(p.artikelId, tx as any);
      }

      // A canonical credit-note packaging line is evidence for an already
      // executed physical return, not a second stock movement.
      const reconciliationPackagingLine = documentType === "DOBROPIS" && art?.povratnaEmbalaza;
      postavkeResult.push({
        id: pp.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        kolicina,
        cenaKos,
        skupaj,
        enotVPaketu});
    }

    for (const strosek of odvisniStroskiVnos(odvisniStroski)) {
      await tx.insert(prejemniceOdvisniStroskiTable).values({
        prejemnicaId: prejemnica.id,
        naziv: strosek.naziv,
        znesek: strosek.znesek,
        ddvStopnja: strosek.ddvStopnja,
        obravnava: strosek.obravnava,
      });
    }

    return { prejemnica, postavkeResult };
    });
  } catch (error: any) {
    if (error?.message?.startsWith("RECEIPT_ALLERGEN_INVALID:")) {
      req.log.warn({ err: error }, "Invalid receipt allergen snapshot");
      res.status(400).json({ error: error.message.slice("RECEIPT_ALLERGEN_INVALID:".length) });
      return;
    }
    if (
      error?.cause?.code === "23505"
      || error?.code === "23505"
      || error?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
      || error?.message?.includes("že zajeta")
      || error?.message === "PURCHASE_SOURCE_ALREADY_IN_ERP"
    ) {
      res.status(409).json({
        error: "Dobaviteljeva listina s to številko je že zajeta v POS ali ERP",
      });
      return;
    }
    throw error;
  }
  const { prejemnica, postavkeResult } = transactionResult;
  broadcastToUnit(tenotaId, "update", { type: "zaloge" });

  res.status(201).json({
    id: prejemnica.id,
    stevilka: prejemnica.stevilka,
    datum: prejemnica.datum,
    opomba: prejemnica.opomba,
    vrstaCen: prejemnica.vrstaCen,
    skupajVrednost,
    valuta: prejemnica.valuta,
    datumZapadlosti: prejemnica.datumZapadlosti,
    ddvOsnova: prejemnica.ddvOsnova != null ? Number(prejemnica.ddvOsnova) : null,
    ddvZnesek: prejemnica.ddvZnesek != null ? Number(prejemnica.ddvZnesek) : null,
    placanoZGotovino: prejemnica.placanoZGotovino,
    status: prejemnica.status,
    ustvarjeno: prejemnica.ustvarjeno,
    postavke: postavkeResult});

});

router.get("/prejemnice/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const companyId = (req as any).companyId as string;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [prejemnica] = await db
    .select({
      id: prejemniceTable.id,
      stevilka: prejemniceTable.stevilka,
      datum: prejemniceTable.datum,
      datumDokumenta: prejemniceTable.datumDokumenta,
      stDokumenta: prejemniceTable.stDokumenta,
      valuta: prejemniceTable.valuta,
      datumZapadlosti: prejemniceTable.datumZapadlosti,
      ddvOsnova: prejemniceTable.ddvOsnova,
      ddvZnesek: prejemniceTable.ddvZnesek,
      opomba: prejemniceTable.opomba,
      vrstaCen: prejemniceTable.vrstaCen,
      skupajVrednost: prejemniceTable.skupajVrednost,
      ustvarjeno: prejemniceTable.ustvarjeno,
      dobaviteljId: prejemniceTable.dobaviteljId,
      dobaviteljNaziv: counterpartiesTable.name,
      status: prejemniceTable.status,
      placanoZGotovino: prejemniceTable.placanoZGotovino,
    })
    .from(prejemniceTable)
    .innerJoin(enoteTable, and(
      eq(enoteTable.id, prejemniceTable.enotaId),
      eq(enoteTable.companyId, companyId),
    ))
    .leftJoin(counterpartiesTable, and(
      eq(counterpartiesTable.id, prejemniceTable.dobaviteljId),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .where(and(eq(prejemniceTable.id, id), eq(prejemniceTable.enotaId, tenotaId)));
  if (!prejemnica) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  const postavke = await db
    .select({
      id: prejemnicePostavkeTable.id,
      artikelId: prejemnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: prejemnicePostavkeTable.kolicina,
      cenaKos: prejemnicePostavkeTable.cenaKos,
      skupaj: prejemnicePostavkeTable.skupaj,
      enotVPaketu: prejemnicePostavkeTable.enotVPaketu,
      rabat1Odst: prejemnicePostavkeTable.rabat1Odst,
      rabat2Odst: prejemnicePostavkeTable.rabat2Odst,
       izvCena: prejemnicePostavkeTable.izvCena,
       izvNaziv: prejemnicePostavkeTable.izvNaziv,
       izvEnota: prejemnicePostavkeTable.izvEnota,
       enotaMereEslog: prejemnicePostavkeTable.enotaMere,
       netoCena: prejemnicePostavkeTable.netoCena,
       netoZnesek: prejemnicePostavkeTable.netoZnesek,
       ddvKategorija: prejemnicePostavkeTable.ddvKategorija,
       ddvStopnja: prejemnicePostavkeTable.ddvStopnja,
       ddvOsnova: prejemnicePostavkeTable.ddvOsnova,
       ddvZnesek: prejemnicePostavkeTable.ddvZnesek,
       vatCodeId: prejemnicePostavkeTable.vatCodeId,
        vrsticaTip: prejemnicePostavkeTable.vrsticaTip,
        alergeni: prejemnicePostavkeTable.alergeni,
        alergeniSledi: prejemnicePostavkeTable.alergeniSledi,
        alergeniStatus: prejemnicePostavkeTable.alergeniStatus,
        alergeniVir: prejemnicePostavkeTable.alergeniVir,
        alergeniOpombaVira: prejemnicePostavkeTable.alergeniOpombaVira,
        alergeniDocumentId: prejemnicePostavkeTable.alergeniDocumentId,
        alergeniVerifiedBy: prejemnicePostavkeTable.alergeniVerifiedBy,
        alergeniVerifiedAt: prejemnicePostavkeTable.alergeniVerifiedAt,
        alergeniRevision: prejemnicePostavkeTable.alergeniRevision,
        alergeniHash: prejemnicePostavkeTable.alergeniHash})
    .from(prejemnicePostavkeTable)
    .leftJoin(artikliTable, and(
      eq(prejemnicePostavkeTable.artikelId, artikliTable.id),
      eq(artikliTable.enotaId, tenotaId),
    ))
    .where(eq(prejemnicePostavkeTable.prejemnicaId, id))
    // ID uvozne vrstice sledi zaporedju na dobavnici. Povratno embalažo
    // prikažemo šele za vhodnimi artikli, ne da bi premešali katerokoli skupino.
    .orderBy(
      sql`CASE WHEN COALESCE(${artikliTable.povratnaEmbalaza}, false) THEN 1 ELSE 0 END`,
      prejemnicePostavkeTable.id,
    );
  const odvisniStroski = await db
    .select()
    .from(prejemniceOdvisniStroskiTable)
    .where(eq(prejemniceOdvisniStroskiTable.prejemnicaId, id));

  res.json({
    id: prejemnica.id,
    stevilka: prejemnica.stevilka,
    datum: prejemnica.datum,
    datumDokumenta: prejemnica.datumDokumenta ?? null,
    stDokumenta: prejemnica.stDokumenta ?? null,
    valuta: prejemnica.valuta,
    datumZapadlosti: prejemnica.datumZapadlosti ?? null,
    ddvOsnova: prejemnica.ddvOsnova != null ? Number(prejemnica.ddvOsnova) : null,
    ddvZnesek: prejemnica.ddvZnesek != null ? Number(prejemnica.ddvZnesek) : null,
    opomba: prejemnica.opomba,
    vrstaCen: prejemnica.vrstaCen ?? "neto",
    skupajVrednost: Number(prejemnica.skupajVrednost),
    ustvarjeno: prejemnica.ustvarjeno,
    dobaviteljId: prejemnica.dobaviteljId ?? null,
    dobaviteljNaziv: prejemnica.dobaviteljNaziv ?? null,
     status: prejemnica.status,
     placanoZGotovino: prejemnica.placanoZGotovino,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      skupaj: Number(p.skupaj),
      enotVPaketu: Number(p.enotVPaketu ?? 1),
      rabat1Odst: Number(p.rabat1Odst ?? 0),
      rabat2Odst: Number(p.rabat2Odst ?? 0),
       izvCena: p.izvCena != null ? Number(p.izvCena) : null,
        izvNaziv: p.izvNaziv ?? null,
        izvEnota: p.izvEnota ?? null,
        enotaMereEslog: p.enotaMereEslog ?? null,
        netoCena: p.netoCena != null ? Number(p.netoCena) : null,
        netoZnesek: p.netoZnesek != null ? Number(p.netoZnesek) : null,
        ddvKategorija: p.ddvKategorija ?? null,
       ddvStopnja: p.ddvStopnja != null ? Number(p.ddvStopnja) : null,
       ddvOsnova: p.ddvOsnova != null ? Number(p.ddvOsnova) : null,
       ddvZnesek: p.ddvZnesek != null ? Number(p.ddvZnesek) : null,
       vatCodeId: p.vatCodeId ?? null,
        vrsticaTip: p.vrsticaTip ?? "zaloga",
        alergeni: p.alergeni ?? [],
        alergeniSledi: p.alergeniSledi ?? [],
        alergeniStatus: p.alergeniStatus,
        alergeniVir: p.alergeniVir ?? null,
        alergeniOpombaVira: p.alergeniOpombaVira ?? null,
        alergeniDocumentId: p.alergeniDocumentId ?? null,
        alergeniVerifiedBy: p.alergeniVerifiedBy ?? null,
        alergeniVerifiedAt: p.alergeniVerifiedAt?.toISOString() ?? null,
        alergeniRevision: Number(p.alergeniRevision ?? 0),
        alergeniHash: p.alergeniHash ?? null})),
    odvisniStroski: odvisniStroski.map((strosek) => ({
      ...strosek,
      znesek: Number(strosek.znesek),
      ddvStopnja: strosek.ddvStopnja != null ? Number(strosek.ddvStopnja) : null,
    })),
  });
});

router.put("/prejemnice/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const companyId = (req as any).companyId as string;
  const actorSnapshot = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  let [existing] = await db.select().from(prejemniceTable)
    .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  let artikelMap: Map<number, {
    id: number;
    ime: string;
    imeZaNabavo: string | null;
    enotaMere: string | null;
    povratnaEmbalaza: boolean;
    depozitnaVrednost: string | null;
    alergeni: unknown;
    alergeniSledi: unknown;
    alergeniStatus: string;
    alergeniVir: string | null;
    alergeniOpombaVira: string | null;
    alergeniDocumentId: string | null;
    alergeniVerifiedBy: string | null;
    alergeniVerifiedAt: Date | null;
  }> | undefined;
  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Prejemnica mora imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    const artikliRows = await db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      povratnaEmbalaza: artikliTable.povratnaEmbalaza,
      depozitnaVrednost: artikliTable.depozitnaVrednost,
      alergeni: artikliTable.alergeni,
      alergeniSledi: artikliTable.alergeniSledi,
      alergeniStatus: artikliTable.alergeniStatus,
      alergeniVir: artikliTable.alergeniVir,
      alergeniOpombaVira: artikliTable.alergeniOpombaVira,
      alergeniDocumentId: artikliTable.alergeniDocumentId,
      alergeniVerifiedBy: artikliTable.alergeniVerifiedBy,
      alergeniVerifiedAt: artikliTable.alergeniVerifiedAt,
    })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(artikliRows.map(a => a.id));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }
    const vatCodeNapaka = await preveriVhodneDdvKode(
      novaPostavke,
      datumAliNull(parsed.data.datumDokumenta)
        ?? (parsed.data.datum ? new Date(parsed.data.datum).toISOString().slice(0, 10) : existing.datum.toISOString().slice(0, 10)),
    );
    if (vatCodeNapaka) { res.status(400).json({ error: vatCodeNapaka }); return; }
    artikelMap = new Map(artikliRows.map(a => [a.id, a]));
  }

  let didUpdatePostavke = false;

  let updatedRows: Array<typeof prejemniceTable.$inferSelect>;
  try {
    updatedRows = await db.transaction(async (tx) => {
    await lockPosReceiptForEdit(tx, companyId, tenotaId, id);
    const [lockedExisting] = await tx.select().from(prejemniceTable)
      .where(and(eq(prejemniceTable.id, id), eq(prejemniceTable.enotaId, tenotaId)))
      .limit(1);
    if (!lockedExisting) throw new ReceiptEditConflict("RECEIPT_NOT_FOUND", "Prejemnica ni najdena.");
    if (lockedExisting.status === "confirmed") {
      throw new ReceiptEditConflict("RECEIPT_CONFIRMED", "Potrjene prejemnice ni dovoljeno spreminjati.");
    }
    await invalidatePosReceiptBookingDraft(tx, id);
    existing = lockedExisting;
    const changesAllocatedIdentity = parsed.data.dobaviteljId !== undefined
      || parsed.data.stDokumenta !== undefined
      || parsed.data.vrstaDokumenta !== undefined
      || parsed.data.postavke !== undefined;
    if (changesAllocatedIdentity && existing.sourceDocumentId) {
      const allocationHistory = await tx.execute(sql`
        SELECT 1
        FROM pos_credit_note_allocations
        WHERE company_id = ${companyId}
          AND source_document_id = ${existing.sourceDocumentId}
        LIMIT 1
      `);
      if (allocationHistory.rows.length > 0) {
        throw new ReceiptEditConflict(
          "CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED",
          "Dobropisa z zgodovino povezovanja povratne embalaže ni mogoče spreminjati. Razveljavitev popravi povezavo, dokument pa zaradi revizijske sledi ostane nespremenljiv.",
        );
      }
    }
    if (parsed.data.postavke !== undefined) {
      const vatCodeNapaka = await preveriVhodneDdvKode(
        parsed.data.postavke,
        datumAliNull(parsed.data.datumDokumenta)
          ?? (parsed.data.datum
            ? new Date(parsed.data.datum).toISOString().slice(0, 10)
            : existing.datum.toISOString().slice(0, 10)),
        tx,
      );
      if (vatCodeNapaka) throw new Error(`RECEIPT_VAT_INVALID:${vatCodeNapaka}`);
    }
    const txUpdates: Partial<typeof existing> = {};
    const effectiveSupplierId = parsed.data.dobaviteljId !== undefined
      ? parsed.data.dobaviteljId ?? null
      : existing.dobaviteljId;
    const effectiveDocumentNumber = parsed.data.stDokumenta !== undefined
      ? parsed.data.stDokumenta ?? null
      : existing.stDokumenta;
    const effectiveDocumentType = parsed.data.vrstaDokumenta !== undefined
      && ["RACUN", "DOBAVNICA", "DOBROPIS", "BREMEPIS"].includes(parsed.data.vrstaDokumenta)
      ? parsed.data.vrstaDokumenta
      : existing.vrstaDokumenta;
    const sourceIdentityChanged = parsed.data.dobaviteljId !== undefined || parsed.data.stDokumenta !== undefined
      || parsed.data.vrstaDokumenta !== undefined;
    const effectiveSourceDocumentId = sourceIdentityChanged
      ? (effectiveSupplierId
      && typeof effectiveDocumentNumber === "string"
      && effectiveDocumentNumber.trim()
      ? await claimPurchaseSourceDocument(tx, {
          companyId,
          counterpartyId: effectiveSupplierId,
          kind: effectiveDocumentType === "RACUN"
            ? "invoice"
            : effectiveDocumentType === "DOBROPIS"
              ? "credit_note"
              : effectiveDocumentType === "BREMEPIS"
                ? "debit_note"
                : "delivery_note",
          documentNumber: effectiveDocumentNumber,
          documentDate: datumAliNull(parsed.data.datumDokumenta) ?? existing.datumDokumenta,
          excludePosReceiptId: id,
          currency: parsed.data.valuta !== undefined
            ? valutaAliEur(parsed.data.valuta)
            : existing.valuta,
         })
       : null)
      : existing.sourceDocumentId;
    if (sourceIdentityChanged) txUpdates.sourceDocumentId = effectiveSourceDocumentId;
    if (effectiveSourceDocumentId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${effectiveSourceDocumentId}))`);
      const existingErpReceipt = await tx.select({ id: goodsReceiptsTable.id })
        .from(goodsReceiptsTable)
        .where(eq(goodsReceiptsTable.sourceDocumentId, effectiveSourceDocumentId))
        .limit(1);
      if (existingErpReceipt.length > 0) throw new Error("PURCHASE_SOURCE_ALREADY_IN_ERP");
      const existingFinalInvoice = await tx.select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(and(
           eq(invoicesTable.sourceDocumentId, effectiveSourceDocumentId),
          ne(invoicesTable.status, "draft"),
        ))
        .limit(1);
      if (existingFinalInvoice.length > 0) throw new Error("PURCHASE_SOURCE_ALREADY_IN_ERP");
    }
    const [sourceIdentity] = effectiveSourceDocumentId
      ? await tx.select({ kind: purchaseSourceDocumentsTable.kind })
        .from(purchaseSourceDocumentsTable).where(eq(purchaseSourceDocumentsTable.id, effectiveSourceDocumentId)).limit(1)
      : [];
    const canonicalCreditNote = effectiveDocumentType === "DOBROPIS"
      && sourceIdentity?.kind === "credit_note"
      && Boolean(effectiveSourceDocumentId);
    if (parsed.data.datum !== undefined) txUpdates.datum = new Date(parsed.data.datum);
    if (parsed.data.opomba !== undefined) txUpdates.opomba = parsed.data.opomba;
    if (parsed.data.dobaviteljId !== undefined) txUpdates.dobaviteljId = parsed.data.dobaviteljId ?? null;
    if (parsed.data.vrstaCen !== undefined) txUpdates.vrstaCen = parsed.data.vrstaCen === "bruto" ? "bruto" : "neto";
    if (parsed.data.stDokumenta !== undefined) txUpdates.stDokumenta = parsed.data.stDokumenta ?? null;
    if (parsed.data.datumDokumenta !== undefined) txUpdates.datumDokumenta = parsed.data.datumDokumenta ? new Date(parsed.data.datumDokumenta).toISOString().slice(0, 10) : null;
    if (parsed.data.valuta !== undefined) txUpdates.valuta = valutaAliEur(parsed.data.valuta);
    if (parsed.data.datumZapadlosti !== undefined) txUpdates.datumZapadlosti = datumAliNull(parsed.data.datumZapadlosti);
    if (parsed.data.ddvOsnova !== undefined) txUpdates.ddvOsnova = denarAliNull(parsed.data.ddvOsnova);
    if (parsed.data.ddvZnesek !== undefined) txUpdates.ddvZnesek = denarAliNull(parsed.data.ddvZnesek);
    if (parsed.data.vrstaDokumenta !== undefined) {
      txUpdates.vrstaDokumenta = ["RACUN", "DOBAVNICA", "DOBROPIS", "BREMEPIS"].includes(parsed.data.vrstaDokumenta)
        ? parsed.data.vrstaDokumenta : existing.vrstaDokumenta;
    }
    if (parsed.data.datumDobave !== undefined) txUpdates.datumDobave = datumAliNull(parsed.data.datumDobave);
    if (parsed.data.datumOpravljeneStoritve !== undefined) txUpdates.datumOpravljeneStoritve = datumAliNull(parsed.data.datumOpravljeneStoritve);
    if (parsed.data.brutoSkupaj !== undefined) txUpdates.brutoSkupaj = denarAliNull(parsed.data.brutoSkupaj);
    if (parsed.data.placilniNacin !== undefined) txUpdates.placilniNacin = typeof parsed.data.placilniNacin === "string" ? parsed.data.placilniNacin : null;
    if (parsed.data.placanoZGotovino !== undefined) txUpdates.placanoZGotovino = parsed.data.placanoZGotovino === true;
    if (parsed.data.placilniSklic !== undefined) txUpdates.placilniSklic = typeof parsed.data.placilniSklic === "string" ? parsed.data.placilniSklic : null;

    if (parsed.data.postavke !== undefined) {
      const novaPostavke = parsed.data.postavke;
      const newArtikleIds: number[] = [];

      const oldPostavke = await tx.select().from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
       const oldById = new Map(oldPostavke.map((row) => [row.id, row]));

      await tx.delete(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));

      let skupajVrednost = 0;
      for (const p of novaPostavke) {
        const kolicina = p.kolicina ?? 0;
        const cenaKos = p.cenaKos ?? 0;
        skupajVrednost += kolicina * cenaKos;

        const enotVPaketu = p.enotVPaketu && Number(p.enotVPaketu) > 1 ? Number(p.enotVPaketu) : 1;
        const izvCena = p.izvCena != null ? Number(p.izvCena) : null;
        const rabat1Odst = p.popust != null ? Number(p.popust) : 0;
        const art = artikelMap?.get(p.artikelId);
        const old = Number.isInteger(Number(p.id)) ? oldById.get(Number(p.id)) : undefined;
        let alergeniProfil;
        try {
          alergeniProfil = TESTNI_ALERGENSKI_NACIN
            ? alergenskiSnapshotBrezAlergenov(actorSnapshot)
            : art?.povratnaEmbalaza
              ? alergenskiSnapshotZaPovratnoEmbalazo(actorSnapshot)
              : alergenskiSnapshotZaUrejanje(p, old?.artikelId);
        } catch (error) {
          const naziv = art?.imeZaNabavo ?? art?.ime ?? `Artikel ${p.artikelId}`;
          throw new Error(`RECEIPT_ALLERGEN_INVALID:${naziv}: ${(error as Error).message}`);
        }
        const ohranjenAlergenskiSnapshot = old ? {
          alergeni: old.alergeni, alergeniSledi: old.alergeniSledi, alergeniStatus: old.alergeniStatus,
          alergeniVir: old.alergeniVir, alergeniOpombaVira: old.alergeniOpombaVira, alergeniDocumentId: old.alergeniDocumentId,
          alergeniVerifiedBy: old.alergeniVerifiedBy, alergeniVerifiedAt: old.alergeniVerifiedAt,
          alergeniRevision: old.alergeniRevision, alergeniHash: old.alergeniHash,
        } : {};
        const [novaPostavka] = await tx.insert(prejemnicePostavkeTable).values({
          prejemnicaId: id,
          artikelId: p.artikelId,
          kolicina: String(kolicina),
          cenaKos: String(cenaKos),
          skupaj: String((kolicina * cenaKos).toFixed(2)),
          enotVPaketu: String(enotVPaketu),
          ...(izvCena != null ? { izvCena: String(izvCena) } : {}),
          izvNaziv: typeof p.izvNaziv === "string" ? p.izvNaziv : (old?.izvNaziv ?? art?.imeZaNabavo ?? art?.ime ?? null),
          rabat1Odst: String(rabat1Odst),
           ddvStopnja: denarAliNull(p.ddvStopnja),
           ddvOsnova: denarAliNull(p.ddvOsnova),
           ddvZnesek: denarAliNull(p.ddvZnesek),
           vatCodeId: typeof p.vatCodeId === "string" ? p.vatCodeId : null,
           vrsticaTip: p.vrsticaTip === "strosek" ? "poraba_surovin" : (p.vrsticaTip ?? "zaloga"),
            enotaMere: typeof p.enotaMereEslog === "string"
              ? p.enotaMereEslog
              : (old?.enotaMere ?? toUneceUnitCode(p.enotaMere ?? art?.enotaMere)),
            netoCena: String(cenaKos),
            netoZnesek: String((kolicina * cenaKos).toFixed(2)),
            ddvKategorija: typeof p.ddvKategorija === "string"
              ? p.ddvKategorija
               : (p.ddvStopnja != null
                 ? (Number(p.ddvStopnja) > 0 ? "S" : "Z")
                 : old?.ddvKategorija ?? null),
          ...ohranjenAlergenskiSnapshot,
          ...(alergeniProfil ?? {}),
        }).returning({ id: prejemnicePostavkeTable.id });

        // Če uporabnik na že povezani uvoženi postavki popravi pakiranje,
        // naj ta popravek postane nova naučena vrednost za istega dobavitelja
        // in artikel. Starejša prejemnica ne sme prepisati povezave, ki je bila
        // že osvežena z novejšim prevzemom.
        const pakiranjeSpremenjeno = old != null
          && Number(old.enotVPaketu ?? 1) !== enotVPaketu;
        if (pakiranjeSpremenjeno && effectiveSupplierId && p.artikelId != null) {
          const datumPrevzema = parsed.data.datum !== undefined
            ? new Date(parsed.data.datum)
            : existing.datum;
          await tx.execute(sql`
            UPDATE artikel_dobavitelj
               SET enot_v_paketu = ${String(enotVPaketu)},
                   zadnji_prevzem = ${datumPrevzema}
             WHERE enota_id = ${tenotaId}
               AND dobavitelj_id = ${effectiveSupplierId}
               AND artikel_id = ${p.artikelId}
               AND aktivno
               AND (zadnji_prevzem IS NULL OR zadnji_prevzem <= ${datumPrevzema})
          `);
        }

        if (alergeniProfil && alergeniProfil.alergeniStatus !== "nepreverjeno" && p.artikelId != null) {
          await tx.update(artikliTable).set({
            alergeni: alergeniProfil.alergeni, alergeniSledi: alergeniProfil.alergeniSledi,
            alergeniStatus: alergeniProfil.alergeniStatus, alergeniVir: alergeniProfil.alergeniVir,
            alergeniOpombaVira: alergeniProfil.alergeniOpombaVira, alergeniDocumentId: alergeniProfil.alergeniDocumentId,
            alergeniVerifiedBy: alergeniProfil.alergeniVerifiedBy, alergeniVerifiedAt: alergeniProfil.alergeniVerifiedAt,
            alergeniHash: alergeniProfil.alergeniHash,
          }).where(eq(artikliTable.id, p.artikelId));
          await razveljaviAlergeneNadrejenih(p.artikelId, tx as any);
        }

         if (p.artikelId != null) {
          newArtikleIds.push(p.artikelId);
        }
      }

      txUpdates.skupajVrednost = String(skupajVrednost.toFixed(2));
      didUpdatePostavke = true;
    } else if (parsed.data.vrstaDokumenta !== undefined && effectiveDocumentType !== existing.vrstaDokumenta) {
       didUpdatePostavke = true;
    } else if (parsed.data.datum !== undefined && txUpdates.datum!.getTime() !== existing.datum.getTime()) {
      // Datuma zgodovinskega giba ne spreminjamo. Aktivne gibe najprej
      // storniramo, nato pa iz nespremenjenih postavk dodamo nov posnetek.
      didUpdatePostavke = true;
    }

    if (parsed.data.odvisniStroski !== undefined) {
      await tx.delete(prejemniceOdvisniStroskiTable)
        .where(eq(prejemniceOdvisniStroskiTable.prejemnicaId, id));
      for (const strosek of odvisniStroskiVnos(parsed.data.odvisniStroski)) {
        await tx.insert(prejemniceOdvisniStroskiTable).values({
          prejemnicaId: id,
          naziv: strosek.naziv,
          znesek: strosek.znesek,
          ddvStopnja: strosek.ddvStopnja,
          obravnava: strosek.obravnava,
        });
      }
    }

    return tx.update(prejemniceTable).set(txUpdates)
      .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)))
      .returning();
    });
  } catch (error: any) {
    if (error?.message?.startsWith("RECEIPT_VAT_INVALID:")) {
      req.log.warn({ receiptId: id, reason: error.message }, "Receipt update rejected by VAT validation");
      res.status(400).json({ error: error.message.slice("RECEIPT_VAT_INVALID:".length) });
      return;
    }
    if (error?.message?.startsWith("RECEIPT_ALLERGEN_INVALID:")) {
      req.log.warn({ receiptId: id, reason: error.message }, "Receipt update rejected by allergen validation");
      res.status(400).json({ error: error.message.slice("RECEIPT_ALLERGEN_INVALID:".length) });
      return;
    }
    if (error instanceof ReceiptEditConflict && (error.code === "RECEIPT_BOOKING_POSTED" || error.code === "RECEIPT_CONFIRMED")) {
      res.status(409).json({ error: "Potrjene knjižbe prejemnice ni dovoljeno spreminjati" });
      return;
    }
    if (error instanceof ReceiptEditConflict && error.code === "RECEIPT_NOT_FOUND") {
      res.status(404).json({ error: "Prejemnica ni najdena" });
      return;
    }
    if (error instanceof ReceiptEditConflict && error.code === "CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED") {
      res.status(409).json({ code: error.code, error: error.message });
      return;
    }
    if (
      error?.cause?.code === "23505"
      || error?.code === "23505"
      || error?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
      || error?.message?.includes("že zajeta")
      || error?.message === "PURCHASE_SOURCE_ALREADY_IN_ERP"
    ) {
      res.status(409).json({
        error: "Dobaviteljeva listina s to številko je že zajeta v POS ali ERP",
      });
      return;
    }
    throw error;
  }
  const [updated] = updatedRows;

  if (didUpdatePostavke) broadcastToUnit(tenotaId, "update", { type: "zaloge" });

  const postavke = await db
    .select({
      id: prejemnicePostavkeTable.id,
      artikelId: prejemnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: prejemnicePostavkeTable.kolicina,
      cenaKos: prejemnicePostavkeTable.cenaKos,
      skupaj: prejemnicePostavkeTable.skupaj,
       enotVPaketu: prejemnicePostavkeTable.enotVPaketu,
       ddvStopnja: prejemnicePostavkeTable.ddvStopnja,
       ddvOsnova: prejemnicePostavkeTable.ddvOsnova,
       ddvZnesek: prejemnicePostavkeTable.ddvZnesek,
       vatCodeId: prejemnicePostavkeTable.vatCodeId,
       vrsticaTip: prejemnicePostavkeTable.vrsticaTip})
    .from(prejemnicePostavkeTable)
    .leftJoin(artikliTable, eq(prejemnicePostavkeTable.artikelId, artikliTable.id))
    .where(eq(prejemnicePostavkeTable.prejemnicaId, id));
  const odvisniStroski = await db.select().from(prejemniceOdvisniStroskiTable)
    .where(eq(prejemniceOdvisniStroskiTable.prejemnicaId, id));

  void artikelMap;
  res.json({
    id: updated.id,
    stevilka: updated.stevilka,
    datum: updated.datum,
    opomba: updated.opomba,
    vrstaCen: updated.vrstaCen ?? "neto",
    skupajVrednost: Number(updated.skupajVrednost),
    valuta: updated.valuta,
    datumZapadlosti: updated.datumZapadlosti ?? null,
    ddvOsnova: updated.ddvOsnova != null ? Number(updated.ddvOsnova) : null,
    ddvZnesek: updated.ddvZnesek != null ? Number(updated.ddvZnesek) : null,
    placanoZGotovino: updated.placanoZGotovino,
    ustvarjeno: updated.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      skupaj: Number(p.skupaj),
       enotVPaketu: Number(p.enotVPaketu ?? 1),
       ddvStopnja: p.ddvStopnja != null ? Number(p.ddvStopnja) : null,
       ddvOsnova: p.ddvOsnova != null ? Number(p.ddvOsnova) : null,
       ddvZnesek: p.ddvZnesek != null ? Number(p.ddvZnesek) : null,
       vatCodeId: p.vatCodeId ?? null,
       vrsticaTip: p.vrsticaTip ?? "zaloga"})),
    odvisniStroski: odvisniStroski.map((strosek) => ({
      ...strosek,
      znesek: Number(strosek.znesek),
      ddvStopnja: strosek.ddvStopnja != null ? Number(strosek.ddvStopnja) : null,
    })),
  });
});

router.delete("/prejemnice/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const companyId = (req as any).companyId as string;
  const actorSnapshot = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(prejemniceTable)
    .innerJoin(enoteTable, and(
      eq(enoteTable.id, prejemniceTable.enotaId),
      eq(enoteTable.companyId, companyId),
    ))
    .where(and(eq(prejemniceTable.id, id), eq(prejemniceTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  const postavke = await db.select().from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
  const artikelIds = postavke.map((p: any) => p.artikelId).filter((aid: any) => aid != null) as number[];

  // Preberi nastavitev dovoliNegativneZaloge (privzeto: true)
  const [negNast] = await db.select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, "dovoliNegativneZaloge")));
  const dovoliNegativneZaloge = (negNast?.vrednost ?? "true") === "true";

  if (!dovoliNegativneZaloge && artikelIds.length > 0) {
    const negativni: { artikelId: number; artikelIme: string | null; projiciranKolicina: number }[] = [];

    for (const p of postavke) {
      if (p.artikelId == null) continue;
      const [totalRow] = await db
        .select({ vsota: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')` })
        .from(zalogaGibiTable)
        .where(eq(zalogaGibiTable.artikelId, p.artikelId));

      const [prejRow] = await db
        .select({ vsota: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')` })
        .from(zalogaGibiTable)
        .where(sql`${zalogaGibiTable.artikelId} = ${p.artikelId} AND ${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'prejemnica'`);

      const projicirana = Number(totalRow?.vsota ?? 0) - Number(prejRow?.vsota ?? 0);

      if (projicirana < 0) {
        const [art] = await db.select({ ime: artikliTable.ime }).from(artikliTable).where(eq(artikliTable.id, p.artikelId));
        negativni.push({ artikelId: p.artikelId, artikelIme: art?.ime ?? null, projiciranKolicina: projicirana });
      }
    }

    if (negativni.length > 0) {
      res.status(409).json({
        error: "Brisanje bi povzročilo negativne zaloge",
        prizadeti: negativni});
      return;
    }
  }

  try {
    await db.transaction(async (tx) => {
      await lockPosReceiptForEdit(tx, companyId, tenotaId, id);
      const [lockedReceipt] = await tx.select({ status: prejemniceTable.status })
        .from(prejemniceTable).where(eq(prejemniceTable.id, id)).limit(1);
      if (lockedReceipt?.status === "confirmed") {
        throw new ReceiptEditConflict("RECEIPT_CONFIRMED", "Potrjene prejemnice ni dovoljeno brisati.");
      }
      if (existing.prejemnice.sourceDocumentId) {
        const allocationHistory = await tx.execute(sql`
          SELECT 1
          FROM pos_credit_note_allocations
          WHERE company_id = ${companyId}
            AND source_document_id = ${existing.prejemnice.sourceDocumentId}
          LIMIT 1
        `);
        if (allocationHistory.rows.length > 0) {
          throw new ReceiptEditConflict(
            "CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED",
            "Dobropisa z zgodovino povezovanja povratne embalaže ni mogoče izbrisati.",
          );
        }
      }
      const oldPackagingLines = await tx.select({ id: prejemnicePostavkeTable.id }).from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
      await reversePackagingForLines(tx, oldPackagingLines.map((row: any) => row.id), actorSnapshot);
      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["prejemnica", "uvoz-prejemnica"],
        actorSnapshot,
        reversalSourceSnapshot: "prejemnica_reversal",
        note: `Razveljavitev gibov ob brisanju prejemnice #${id}`,
        legacyKind: "prejemnica",
      });
      await tx.delete(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
      await tx.delete(uvozSejaTable).where(eq(uvozSejaTable.prejemnicaId, id));
      await tx.delete(prejemniceTable).where(and(eq(prejemniceTable.id, id), eq(prejemniceTable.enotaId, tenotaId)));

      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
    });
  } catch (error) {
    if (error instanceof ReceiptEditConflict && (error.code === "RECEIPT_BOOKING_POSTED" || error.code === "RECEIPT_CONFIRMED")) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof ReceiptEditConflict && error.code === "RECEIPT_NOT_FOUND") {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ReceiptEditConflict && error.code === "CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED") {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  broadcastToUnit(tenotaId, "update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
