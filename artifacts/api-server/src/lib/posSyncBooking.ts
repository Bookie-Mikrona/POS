/**
 * POS → ERP samodejno knjiženje
 * ─────────────────────────────────────────────────────────────────────────────
 * Za vsak dan generira do 4 osnutke temeljnic + KIR vrstice:
 *
 *   1. POS:PRODAJA:YYYY-MM-DD   — dnevna prodaja (Z-poročilo)
 *      Debet:  gotovina / kartica / darilni boni / ostalo
 *      Kredit: prihodki po vrsti artikla × DDV stopnji + DDV po stopnji
 *      ⚠ Izključuje lastna_poraba in reprezentanca račune (ti gredo v T4).
 *
 *   2. POS:PREJEMNICA:YYYY-MM-DD — prejemnice blaga
 *      Debet:  zaloga materiala + zaloga blaga
 *      Kredit: obveznosti do dobaviteljev
 *
 *   3. POS:PORABA:YYYY-MM-DD    — razknjižba zalog (COGS)
 *      Debet:  stroški materiala + NVPB blaga
 *      Kredit: zmanjšanje ustrezne zaloge
 *
 *   4. POS:LASTREPR:YYYY-MM-DD  — lastna poraba + reprezentanca
 *      DDV se obračuna na face value (vrednost postavk, skupaj=0).
 *      Debet:  odhodki lastne porabe / odhodki reprezentance (bruto)
 *      Kredit: prihodki po vrsti × DDV (neto) + DDV po stopnji
 *
 *   KIR (Knjiga izdanih računov):
 *      B2C: en zbirni ERP invoice na dan (fizične osebe)
 *      B2B: posamičen ERP invoice za vsak račun z davčno številko ali negotovinskim plačilom
 *      Lastna/repr: ločen ERP invoice z DDV osnovo iz face value
 *      Pogoj: nastavljen kir_ar_account_id v pos_booking_settings
 *
 * Analitika:
 *   - vrsta_artikla: 'material' | 'blago' | 'storitev'
 *   - davek: 9.5 | 22 | 0  (DDV stopnja v %)
 *
 * Funkcija je idempotentna: obstoječe osnutke z istim ref pobriše in ustvari
 * nove. Potrjene temeljnice (status='posted') nikoli ne briše.
 * KIR invoices: briše stare pos-sync invoices za ta datum in ustvari nove.
 */

import Decimal from "decimal.js";
import { and, eq, inArray, isNull, lte, gte, notInArray, sql, isNotNull } from "drizzle-orm";
import {
  db,
  posBookingSettingsTable,
  accountingPeriodsTable,
  enoteTable,
  racuniTable,
  prejemniceTable,
  prejemnicePostavkeTable,
  postavkeTable,
  zalogaGibiTable,
  artikliTable,
  journalEntriesTable,
  journalEntryLinesTable,
  invoicesTable,
  invoiceLinesTable,
  counterpartiesTable,
} from "@workspace/db";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface SyncLine {
  accountId: string;
  side: "debit" | "credit";
  amount: Decimal;
  desc?: string;
}

interface SyncResult {
  created: string[];
  skipped: Array<{ ref: string; reason: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dec(v: string | number | null | undefined): Decimal {
  if (v == null || v === "") return new Decimal(0);
  return new Decimal(String(v));
}

function isBalanced(lines: SyncLine[]): boolean {
  const debit = lines.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const credit = lines.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
  return debit.minus(credit).abs().lt("0.01");
}

/** Sešteje vrstice z istim accountId in stranjo v eno vrstico */
function mergeLines(lines: SyncLine[]): SyncLine[] {
  const map = new Map<string, SyncLine>();
  for (const l of lines) {
    const key = `${l.accountId}|${l.side}`;
    const ex = map.get(key);
    if (ex) {
      ex.amount = ex.amount.plus(l.amount);
      if (l.desc && ex.desc && !ex.desc.includes(l.desc)) {
        ex.desc = `${ex.desc}, ${l.desc}`;
      }
    } else {
      map.set(key, { ...l });
    }
  }
  return [...map.values()].filter(l => l.amount.gt("0.005"));
}

async function deleteExistingDrafts(companyId: string, ref: string): Promise<void> {
  await db
    .delete(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, ref),
        eq(journalEntriesTable.status, "draft"),
      ),
    );
}

async function insertEntry(
  companyId: string,
  periodId: string,
  datum: string,
  description: string,
  ref: string,
  lines: SyncLine[],
): Promise<void> {
  await db.transaction(async tx => {
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        companyId,
        periodId,
        entryDate: datum,
        documentDate: datum,
        description,
        reference: ref,
        status: "draft",
        sourceType: "document",
        createdBy: "pos-sync",
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalEntryLinesTable).values(
      lines.map((l, i) => ({
        entryId: entry.id,
        accountId: l.accountId,
        side: l.side,
        amount: l.amount.toFixed(2),
        description: l.desc ?? null,
        sequence: i,
      })),
    );
  });
}

/**
 * Poišče poslovnega partnerja po davčni številki, nato po imenu.
 * Če ga ni, ga ustvari.
 */
async function ensureCounterparty(
  companyId: string,
  name: string,
  taxId: string | null | undefined,
  address?: string | null,
  vatPayer?: boolean,
): Promise<string> {
  // 1. Poišči po davčni številki
  if (taxId?.trim()) {
    const [found] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(
        and(
          eq(counterpartiesTable.companyId, companyId),
          eq(counterpartiesTable.taxId, taxId.trim()),
        ),
      )
      .limit(1);
    if (found) return found.id;
  }

  // 2. Poišči po imenu
  const [foundByName] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(
      and(
        eq(counterpartiesTable.companyId, companyId),
        eq(counterpartiesTable.name, name),
      ),
    )
    .limit(1);
  if (foundByName) return foundByName.id;

  // 3. Ustvari novega
  const [created] = await db
    .insert(counterpartiesTable)
    .values({
      companyId,
      type: "customer",
      name,
      taxId: taxId?.trim() ?? null,
      address: address ?? null,
      vatPayer: vatPayer ?? false,
    })
    .returning({ id: counterpartiesTable.id });

  return created.id;
}

// ── Prihodkovni konto za vrsta × DDV (deljeno med T1, T4, KIR) ───────────────

function getRevenueAccount(
  vrsta: string,
  davekPct: Decimal,
  settings: {
    revenueMaterial95AccountId?: string | null;
    revenueMaterial22AccountId?: string | null;
    revenueGoods95AccountId?: string | null;
    revenueGoods22AccountId?: string | null;
    revenueServiceAccountId?: string | null;
    revenueAccountId?: string | null;
  },
): string | null | undefined {
  const map: Record<string, string | null | undefined> = {
    "material|9.50":  settings.revenueMaterial95AccountId,
    "material|22.00": settings.revenueMaterial22AccountId,
    "blago|9.50":     settings.revenueGoods95AccountId,
    "blago|22.00":    settings.revenueGoods22AccountId,
    "storitev|22.00": settings.revenueServiceAccountId,
    "storitev|9.50":  settings.revenueServiceAccountId,
    "storitev|0.00":  settings.revenueServiceAccountId,
    "material|0.00":  settings.revenueMaterial95AccountId,
    "blago|0.00":     settings.revenueGoods95AccountId,
  };
  const key = `${vrsta}|${davekPct.toFixed(2)}`;
  return map[key] ?? settings.revenueAccountId;
}

// ── Glavna funkcija ───────────────────────────────────────────────────────────

export async function syncPosBookingForDay(
  companyId: string,
  datum: string, // YYYY-MM-DD v Ljubljana času
): Promise<SyncResult> {
  const created: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];

  // 1. Nastavitve knjiženja
  const [settings] = await db
    .select()
    .from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId))
    .limit(1);

  if (!settings) {
    return { created: [], skipped: [{ ref: "vse", reason: "POS nastavitve knjiženja niso konfigurirane" }] };
  }

  // 2. Odprto računovodsko obdobje
  const [period] = await db
    .select({ id: accountingPeriodsTable.id })
    .from(accountingPeriodsTable)
    .where(
      and(
        eq(accountingPeriodsTable.companyId, companyId),
        lte(accountingPeriodsTable.startDate, datum),
        gte(accountingPeriodsTable.endDate, datum),
        notInArray(accountingPeriodsTable.status, ["locked"]),
      ),
    )
    .limit(1);

  if (!period) {
    return {
      created: [],
      skipped: [{ ref: "vse", reason: `Ni odprtega računovodskega obdobja za ${datum}` }],
    };
  }

  // 3. POS enote tega podjetja
  const enote = await db
    .select({ id: enoteTable.id })
    .from(enoteTable)
    .where(eq(enoteTable.companyId, companyId));

  const enotaIds = enote.map(e => e.id);
  if (enotaIds.length === 0) {
    return { created: [], skipped: [{ ref: "vse", reason: "Podjetje nima POS enot" }] };
  }

  // Skupni pogoji za POS datum (Ljubljana čas)
  const datumWhere = sql`(${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')::date = ${datum}::date`;
  const statusOk = notInArray(racuniTable.status, ["storniran", "testni"]);
  const enotaOk = inArray(racuniTable.enotaId, enotaIds);

  // ── TEMELJNICA 1: PRODAJA ────────────────────────────────────────────────────
  const prodajaRef = `POS:PRODAJA:${datum}`;
  await (async () => {
    // 1a. Dnevni seštevki plačil — BREZ lastna_poraba in reprezentanca
    const [sales] = await db
      .select({
        gotovina:      sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica:       sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        bon:           sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBon} AS numeric)), 0)`,
        bonPica:       sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBonPica} AS numeric)), 0)`,
        negotovinsko:  sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekNegotovinsko} AS numeric)), 0)`,
        skupaj:        sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
      })
      .from(racuniTable)
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
        ),
      );

    const skupaj = dec(sales.skupaj);
    if (skupaj.lte(0)) {
      await deleteExistingDrafts(companyId, prodajaRef);
      return;
    }

    // 1b. Prihodki in DDV po vrsti artikla × DDV stopnji — BREZ lastna/repr postavk
    const prodajaVrstice = await db
      .select({
        vrstaArtikla: postavkeTable.vrstaArtikla,
        davek:        postavkeTable.davek,
        bruto:        sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
      })
      .from(postavkeTable)
      .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          isNull(postavkeTable.parentPostavkaId),
        ),
      )
      .groupBy(postavkeTable.vrstaArtikla, postavkeTable.davek);

    // ── Debet: plačilni načini ───────────────────────────────────────────────

    const lines: SyncLine[] = [];

    const gotovina     = dec(sales.gotovina);
    const kartica      = dec(sales.kartica);
    const boni         = dec(sales.bon).plus(dec(sales.bonPica));
    const negotovinsko = dec(sales.negotovinsko);

    if (gotovina.gt(0)) {
      if (!settings.cashAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Gotovina (${gotovina.toFixed(2)} €): konto blagajne ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.cashAccountId, side: "debit", amount: gotovina, desc: "Gotovina" });
    }
    if (kartica.gt(0)) {
      if (!settings.cardAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Kartica (${kartica.toFixed(2)} €): konto POS terminala ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.cardAccountId, side: "debit", amount: kartica, desc: "Kartica / POS terminal" });
    }
    if (boni.gt("0.005")) {
      if (!settings.voucherAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Darilni boni (${boni.toFixed(2)} €): konto bonov ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.voucherAccountId, side: "debit", amount: boni, desc: "Darilni boni" });
    }
    if (negotovinsko.gt("0.005")) {
      if (!settings.otherPaymentAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Ostala negotovinska plačila (${negotovinsko.toFixed(2)} €): konto ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.otherPaymentAccountId, side: "debit", amount: negotovinsko, desc: "Ostala negot. plačila (Sodexo, TRR…)" });
    }

    // ── Kredit: prihodki in DDV ─────────────────────────────────────────────

    const vatMap: Record<string, string | null | undefined> = {
      "9.50":  settings.vat95AccountId,
      "22.00": settings.vat22AccountId,
    };

    const ddvPo: Record<string, Decimal> = {};
    let skupajBruto = new Decimal(0);

    for (const row of prodajaVrstice) {
      const bruto    = dec(row.bruto);
      const davekPct = dec(row.davek);
      if (bruto.lte("0.005")) continue;

      const neto = davekPct.gt(0)
        ? bruto.times(100).div(davekPct.plus(100)).toDecimalPlaces(2)
        : bruto;
      const ddv  = bruto.minus(neto);

      skupajBruto = skupajBruto.plus(bruto);

      const vrsta  = row.vrstaArtikla ?? "material";
      const revAcc = getRevenueAccount(vrsta, davekPct, settings);

      if (!revAcc) {
        skipped.push({
          ref: prodajaRef,
          reason: `Prihodki (${vrsta} ${davekPct.toFixed(1)}%, ${bruto.toFixed(2)} €): konto ni nastavljen`,
        });
        return;
      }
      lines.push({
        accountId: revAcc,
        side: "credit",
        amount: neto,
        desc: `Prihodki ${vrsta} ${davekPct.eq(0) ? "0 %" : davekPct.toFixed(1) + " %"}`,
      });

      if (ddv.gt("0.005")) {
        const davekKey = davekPct.toFixed(2);
        ddvPo[davekKey] = (ddvPo[davekKey] ?? new Decimal(0)).plus(ddv);
      }
    }

    for (const [davekKey, ddvZnesek] of Object.entries(ddvPo)) {
      const vatAcc = vatMap[davekKey] ?? settings.vatLiabilityAccountId;
      if (!vatAcc) {
        skipped.push({
          ref: prodajaRef,
          reason: `DDV ${davekKey}% (${ddvZnesek.toFixed(2)} €): konto DDV obveznosti ni nastavljen`,
        });
        return;
      }
      lines.push({
        accountId: vatAcc,
        side: "credit",
        amount: ddvZnesek,
        desc: `Izhodni DDV ${davekKey.replace(".00", "")}%`,
      });
    }

    // Fallback: brez postavk
    if (prodajaVrstice.length === 0 || skupajBruto.lte("0.005")) {
      const fallbackAcc = settings.revenueAccountId;
      if (!fallbackAcc) {
        skipped.push({ ref: prodajaRef, reason: "Ni postavk in splošni konto prihodkov ni nastavljen" });
        return;
      }
      lines.push({ accountId: fallbackAcc, side: "credit", amount: skupaj, desc: "Prihodki od prodaje (neto, fallback)" });
    }

    const merged = mergeLines(lines);
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: prodajaRef, reason: `Temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingDrafts(companyId, prodajaRef);
    await insertEntry(companyId, period.id, datum, `Dnevna prodaja POS — ${datum}`, prodajaRef, merged);
    created.push(prodajaRef);
  })();

  // ── TEMELJNICA 2: PREJEMNICE ─────────────────────────────────────────────────
  const prejemnicaRef = `POS:PREJEMNICA:${datum}`;
  await (async () => {
    const payablesAcc = settings.payablesAccountId;
    if (!payablesAcc) {
      skipped.push({ ref: prejemnicaRef, reason: "Konto obveznosti do dobaviteljev ni nastavljen" });
      return;
    }

    const prejRows = await db
      .select({
        vrstaArtikla: artikliTable.vrstaArtikla,
        skupaj: sql<string>`COALESCE(SUM(CAST(${prejemnicePostavkeTable.skupaj} AS numeric)), 0)`,
      })
      .from(prejemnicePostavkeTable)
      .innerJoin(prejemniceTable, eq(prejemniceTable.id, prejemnicePostavkeTable.prejemnicaId))
      .innerJoin(artikliTable, eq(artikliTable.id, prejemnicePostavkeTable.artikelId))
      .where(
        and(
          inArray(prejemniceTable.enotaId, enotaIds),
          sql`${prejemniceTable.datum}::date = ${datum}::date`,
        ),
      )
      .groupBy(artikliTable.vrstaArtikla);

    const skupajAll = prejRows.reduce((s, r) => s.plus(dec(r.skupaj)), new Decimal(0));
    if (skupajAll.lte(0)) {
      await deleteExistingDrafts(companyId, prejemnicaRef);
      return;
    }

    const lines: SyncLine[] = [];

    for (const row of prejRows) {
      const znesek = dec(row.skupaj);
      if (znesek.lte("0.005")) continue;
      const vrsta = row.vrstaArtikla ?? "material";

      let invAcc: string | null | undefined;
      if (vrsta === "material") {
        invAcc = settings.inventoryMaterialAccountId ?? settings.inventoryAccountId;
      } else if (vrsta === "blago") {
        invAcc = settings.inventoryGoodsAccountId ?? settings.inventoryAccountId;
      } else {
        invAcc = settings.inventoryAccountId;
      }

      if (!invAcc) {
        skipped.push({
          ref: prejemnicaRef,
          reason: `Konto zalog za vrsto '${vrsta}' (${znesek.toFixed(2)} €) ni nastavljen`,
        });
        return;
      }
      lines.push({ accountId: invAcc, side: "debit", amount: znesek, desc: `Prevzem ${vrsta}` });
    }

    lines.push({ accountId: payablesAcc, side: "credit", amount: skupajAll, desc: "Obveznosti do dobaviteljev" });

    const merged = mergeLines(lines);

    await deleteExistingDrafts(companyId, prejemnicaRef);
    await insertEntry(companyId, period.id, datum, `POS prejemnice blaga — ${datum}`, prejemnicaRef, merged);
    created.push(prejemnicaRef);
  })();

  // ── TEMELJNICA 3: PORABA BLAGA (COGS) ────────────────────────────────────────
  const porabaRef = `POS:PORABA:${datum}`;
  await (async () => {
    const porabaRows = await db
      .select({
        vrstaArtikla: artikliTable.vrstaArtikla,
        porabljeno: sql<string>`COALESCE(SUM(ABS(CAST(${zalogaGibiTable.vrednost} AS numeric))), 0)`,
      })
      .from(zalogaGibiTable)
      .innerJoin(artikliTable, eq(artikliTable.id, zalogaGibiTable.artikelId))
      .where(
        and(
          inArray(artikliTable.enotaId, enotaIds),
          eq(zalogaGibiTable.tip, "poraba"),
          sql`${zalogaGibiTable.ustvarjeno}::date = ${datum}::date`,
        ),
      )
      .groupBy(artikliTable.vrstaArtikla);

    const skupajPorabljeno = porabaRows.reduce((s, r) => s.plus(dec(r.porabljeno)), new Decimal(0));
    if (skupajPorabljeno.lte(0)) {
      await deleteExistingDrafts(companyId, porabaRef);
      return;
    }

    const lines: SyncLine[] = [];

    for (const row of porabaRows) {
      const znesek = dec(row.porabljeno);
      if (znesek.lte("0.005")) continue;
      const vrsta = row.vrstaArtikla ?? "material";

      let cogsAcc: string | null | undefined;
      let invAcc:  string | null | undefined;

      if (vrsta === "material") {
        cogsAcc = settings.cogsMaterialAccountId ?? settings.cogsAccountId;
        invAcc  = settings.inventoryMaterialAccountId ?? settings.inventoryAccountId;
      } else if (vrsta === "blago") {
        cogsAcc = settings.cogsGoodsAccountId ?? settings.cogsAccountId;
        invAcc  = settings.inventoryGoodsAccountId ?? settings.inventoryAccountId;
      } else {
        cogsAcc = settings.cogsAccountId;
        invAcc  = settings.inventoryAccountId;
      }

      if (!cogsAcc || !invAcc) {
        skipped.push({
          ref: porabaRef,
          reason: `Konto COGS ali zalog za vrsto '${vrsta}' (${znesek.toFixed(2)} €) ni nastavljen`,
        });
        return;
      }

      lines.push({ accountId: cogsAcc, side: "debit",  amount: znesek, desc: `Stroški ${vrsta === "blago" ? "prodanega blaga" : "materiala"}` });
      lines.push({ accountId: invAcc,  side: "credit", amount: znesek, desc: `Zmanjšanje zalog ${vrsta}` });
    }

    const merged = mergeLines(lines);
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: porabaRef, reason: `COGS temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingDrafts(companyId, porabaRef);
    await insertEntry(companyId, period.id, datum, `POS poraba blaga/materiala — ${datum}`, porabaRef, merged);
    created.push(porabaRef);
  })();

  // ── TEMELJNICA 4: LASTNA PORABA + REPREZENTANCA ───────────────────────────────
  const lastReprRef = `POS:LASTREPR:${datum}`;
  await (async () => {
    // Face value: vsota postavk za lastna_poraba in reprezentanca račune
    const lastreprVrstice = await db
      .select({
        placilnaNacin: racuniTable.placilnaNacin,
        vrstaArtikla:  postavkeTable.vrstaArtikla,
        davek:         postavkeTable.davek,
        faceValue:     sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
      })
      .from(postavkeTable)
      .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          inArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          isNull(postavkeTable.parentPostavkaId),
        ),
      )
      .groupBy(racuniTable.placilnaNacin, postavkeTable.vrstaArtikla, postavkeTable.davek);

    // Seštej face value po tipu (za debet) in po vrsta×davek (za kredit)
    const totalLastna    = lastreprVrstice.filter(r => r.placilnaNacin === "lastna_poraba")
                            .reduce((s, r) => s.plus(dec(r.faceValue)), new Decimal(0));
    const totalRepr      = lastreprVrstice.filter(r => r.placilnaNacin === "reprezentanca")
                            .reduce((s, r) => s.plus(dec(r.faceValue)), new Decimal(0));
    const skupajFace     = totalLastna.plus(totalRepr);

    if (skupajFace.lte("0.005")) {
      await deleteExistingDrafts(companyId, lastReprRef);
      return;
    }

    const lines: SyncLine[] = [];

    // Debet: odhodki po tipu
    if (totalLastna.gt("0.005")) {
      const acc = settings.lastnaPorabaAccountId;
      if (!acc) {
        skipped.push({ ref: lastReprRef, reason: `Lastna poraba (${totalLastna.toFixed(2)} €): konto odhodkov ni nastavljen` });
        return;
      }
      lines.push({ accountId: acc, side: "debit", amount: totalLastna, desc: "Odhodki — lastna poraba (face value)" });
    }
    if (totalRepr.gt("0.005")) {
      const acc = settings.reprezentancaAccountId;
      if (!acc) {
        skipped.push({ ref: lastReprRef, reason: `Reprezentanca (${totalRepr.toFixed(2)} €): konto odhodkov ni nastavljen` });
        return;
      }
      lines.push({ accountId: acc, side: "debit", amount: totalRepr, desc: "Odhodki — reprezentanca (face value)" });
    }

    // Kredit: prihodki (neto) + DDV po vrsta × davek
    const vatMap: Record<string, string | null | undefined> = {
      "9.50":  settings.vat95AccountId,
      "22.00": settings.vat22AccountId,
    };
    const ddvPo: Record<string, Decimal> = {};

    for (const row of lastreprVrstice) {
      const bruto    = dec(row.faceValue);
      const davekPct = dec(row.davek);
      if (bruto.lte("0.005")) continue;

      const neto = davekPct.gt(0)
        ? bruto.times(100).div(davekPct.plus(100)).toDecimalPlaces(2)
        : bruto;
      const ddv  = bruto.minus(neto);

      const vrsta  = row.vrstaArtikla ?? "material";
      const revAcc = getRevenueAccount(vrsta, davekPct, settings);

      if (!revAcc) {
        skipped.push({
          ref: lastReprRef,
          reason: `Prihodki T4 (${vrsta} ${davekPct.toFixed(1)}%, ${bruto.toFixed(2)} €): konto ni nastavljen`,
        });
        return;
      }
      lines.push({
        accountId: revAcc,
        side: "credit",
        amount: neto,
        desc: `Prihodki ${vrsta} ${davekPct.eq(0) ? "0 %" : davekPct.toFixed(1) + " %"} (lastna/repr)`,
      });

      if (ddv.gt("0.005")) {
        const davekKey = davekPct.toFixed(2);
        ddvPo[davekKey] = (ddvPo[davekKey] ?? new Decimal(0)).plus(ddv);
      }
    }

    for (const [davekKey, ddvZnesek] of Object.entries(ddvPo)) {
      const vatAcc = vatMap[davekKey] ?? settings.vatLiabilityAccountId;
      if (!vatAcc) {
        skipped.push({
          ref: lastReprRef,
          reason: `DDV T4 ${davekKey}% (${ddvZnesek.toFixed(2)} €): konto DDV ni nastavljen`,
        });
        return;
      }
      lines.push({
        accountId: vatAcc,
        side: "credit",
        amount: ddvZnesek,
        desc: `Izhodni DDV ${davekKey.replace(".00", "")}% (lastna/repr)`,
      });
    }

    const merged = mergeLines(lines);
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: lastReprRef, reason: `T4 temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingDrafts(companyId, lastReprRef);
    await insertEntry(companyId, period.id, datum, `POS lastna poraba / reprezentanca — ${datum}`, lastReprRef, merged);
    created.push(lastReprRef);
  })();

  // ── KIR: Knjiga izdanih računov ──────────────────────────────────────────────
  await (async () => {
    if (!settings.kirArAccountId) {
      skipped.push({ ref: `POS:KIR:${datum}`, reason: "KIR AR konto (terjatve do kupcev) ni nastavljen — KIR preskočen" });
      return;
    }
    const arAcc = settings.kirArAccountId;

    // Vsi veljavni računi tega dne
    const vsiRacuni = await db
      .select({
        id:                  racuniTable.id,
        stevilkaRacuna:      racuniTable.stevilkaRacuna,
        placilnaNacin:       racuniTable.placilnaNacin,
        skupaj:              racuniTable.skupaj,
        kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
        kupecNaziv:          racuniTable.kupecNaziv,
        kupecNaslov:         racuniTable.kupecNaslov,
        kupecZavezanecDdv:   racuniTable.kupecZavezanecDdv,
      })
      .from(racuniTable)
      .where(and(enotaOk, datumWhere, statusOk));

    if (vsiRacuni.length === 0) return;

    // Razdeli na kategorije
    const b2cRacuni    = vsiRacuni.filter(r =>
      r.placilnaNacin !== "lastna_poraba" &&
      r.placilnaNacin !== "reprezentanca" &&
      r.placilnaNacin !== "negotovinsko" &&
      !r.kupecDavcnaStevilka,
    );
    const b2bRacuni    = vsiRacuni.filter(r =>
      r.placilnaNacin !== "lastna_poraba" &&
      r.placilnaNacin !== "reprezentanca" &&
      (!!r.kupecDavcnaStevilka || r.placilnaNacin === "negotovinsko"),
    );
    const lastReprRacuni = vsiRacuni.filter(r =>
      r.placilnaNacin === "lastna_poraba" || r.placilnaNacin === "reprezentanca",
    );

    // Pobriši stare POS KIR invoices za ta datum
    await db
      .delete(invoicesTable)
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.invoiceDate, datum),
          eq(invoicesTable.createdBy, "pos-sync"),
          eq(invoicesTable.type, "issued"),
        ),
      );

    const allRacunIds = vsiRacuni.map(r => r.id);

    // Vsi postavke za ta datum (za KIR vrstice)
    const vsePostavke = allRacunIds.length > 0
      ? await db
          .select({
            racunId:      postavkeTable.racunId,
            vrstaArtikla: postavkeTable.vrstaArtikla,
            davek:        postavkeTable.davek,
            skupaj:       sql<string>`CAST(${postavkeTable.skupaj} AS numeric)`,
          })
          .from(postavkeTable)
          .where(
            and(
              inArray(postavkeTable.racunId, allRacunIds),
              isNull(postavkeTable.parentPostavkaId),
            ),
          )
      : [];

    // Helper: zgradi invoice lines iz seznam postavk za dano skupino računov
    function buildInvoiceLines(
      racunIdsFilter: number[],
    ): Array<{ vrstaArtikla: string; davekPct: Decimal; bruto: Decimal }> {
      const filterSet = new Set(racunIdsFilter);
      const agg = new Map<string, Decimal>();
      for (const p of vsePostavke) {
        if (!filterSet.has(p.racunId ?? 0)) continue;
        const vrsta = p.vrstaArtikla ?? "material";
        const davek = dec(p.davek).toFixed(2);
        const key   = `${vrsta}|${davek}`;
        agg.set(key, (agg.get(key) ?? new Decimal(0)).plus(dec(p.skupaj)));
      }
      return [...agg.entries()].map(([key, bruto]) => {
        const [vrstaArtikla, davekStr] = key.split("|");
        return { vrstaArtikla, davekPct: new Decimal(davekStr), bruto };
      });
    }

    // Helper: vstavi invoice + invoice_lines
    async function insertKirInvoice(params: {
      invoiceNumber: string;
      invoiceDate:   string;
      counterpartyId: string;
      lines: Array<{ vrstaArtikla: string; davekPct: Decimal; bruto: Decimal }>;
      notes?: string;
    }): Promise<void> {
      if (params.lines.length === 0) return;
      const totalBruto = params.lines.reduce((s, l) => s.plus(l.bruto), new Decimal(0));
      if (totalBruto.lte("0.005")) return;

      const [inv] = await db
        .insert(invoicesTable)
        .values({
          companyId,
          type:           "issued",
          counterpartyId: params.counterpartyId,
          periodId:       period.id,
          invoiceNumber:  params.invoiceNumber,
          invoiceDate:    params.invoiceDate,
          status:         "paid",
          arApAccountId:  arAcc,
          notes:          params.notes ?? null,
          createdBy:      "pos-sync",
        })
        .returning({ id: invoicesTable.id });

      const lineValues = [];
      let seq = 0;
      for (const l of params.lines) {
        const revAcc = getRevenueAccount(l.vrstaArtikla, l.davekPct, settings);
        if (!revAcc) continue; // brez konta preskočimo vrstico

        const neto = l.davekPct.gt(0)
          ? l.bruto.times(100).div(l.davekPct.plus(100)).toDecimalPlaces(2)
          : l.bruto;
        const ddv  = l.bruto.minus(neto);

        lineValues.push({
          invoiceId:   inv.id,
          description: `${l.vrstaArtikla} ${l.davekPct.eq(0) ? "0 %" : l.davekPct.toFixed(1) + " %"}`,
          quantity:    "1.000",
          unitPrice:   neto.toFixed(4),
          vatRate:     l.davekPct.toFixed(2),
          accountId:   revAcc,
          sequence:    seq++,
          vatBase:     neto.toFixed(2),
          vatAmount:   ddv.toFixed(2),
        });
      }

      if (lineValues.length > 0) {
        await db.insert(invoiceLinesTable).values(lineValues);
      }
    }

    let kirCount = 0;

    // ── B2C: zbirni invoice ──────────────────────────────────────────────────
    if (b2cRacuni.length > 0) {
      const b2cCounterpartyId = await ensureCounterparty(
        companyId,
        "Fizične osebe (dnevni promet POS)",
        null,
      );
      const b2cLines = buildInvoiceLines(b2cRacuni.map(r => r.id));
      await insertKirInvoice({
        invoiceNumber:  `POS-B2C-${datum}`,
        invoiceDate:    datum,
        counterpartyId: b2cCounterpartyId,
        lines:          b2cLines,
        notes:          `POS dnevni zbirnik B2C — ${b2cRacuni.length} računov`,
      });
      kirCount++;
    }

    // ── B2B: posamični invoices ──────────────────────────────────────────────
    for (const r of b2bRacuni) {
      const naziv  = r.kupecNaziv?.trim() || `Kupec ${r.kupecDavcnaStevilka ?? r.id}`;
      const taxId  = r.kupecDavcnaStevilka?.trim() || null;
      const cpId   = await ensureCounterparty(
        companyId,
        naziv,
        taxId,
        r.kupecNaslov ?? null,
        r.kupecZavezanecDdv ?? false,
      );
      const b2bLines = buildInvoiceLines([r.id]);
      await insertKirInvoice({
        invoiceNumber:  `POS-${r.stevilkaRacuna}`,
        invoiceDate:    datum,
        counterpartyId: cpId,
        lines:          b2bLines,
        notes:          `POS B2B — ${naziv}${taxId ? ` (${taxId})` : ""}`,
      });
      kirCount++;
    }

    // ── Lastna poraba / Reprezentanca ────────────────────────────────────────
    if (lastReprRacuni.length > 0) {
      const lrCounterpartyId = await ensureCounterparty(
        companyId,
        "Lastna poraba / Reprezentanca (POS)",
        null,
      );
      const lrLines = buildInvoiceLines(lastReprRacuni.map(r => r.id));
      await insertKirInvoice({
        invoiceNumber:  `POS-LASTREPR-${datum}`,
        invoiceDate:    datum,
        counterpartyId: lrCounterpartyId,
        lines:          lrLines,
        notes:          `POS lastna poraba/reprezentanca — ${lastReprRacuni.length} računov (face value)`,
      });
      kirCount++;
    }

    if (kirCount > 0) {
      created.push(`POS:KIR:${datum} (${kirCount} invoice-ov)`);
    }
  })();

  return { created, skipped };
}

// ── Začetna zaloga — otvoritvena temeljnica ───────────────────────────────────

export interface ZZPostavka {
  vrstaArtikla: string | null;
  kolicina: number;
  cenaKos: number;
}

/**
 * Ustvari ali osveži otvoritveno temeljnico za začetne zaloge:
 *   DR 310/300 (konto zalog) / CR 990 (otvoritveni konto)
 *
 * Referenca: POS:ZZ:{leto}
 * Idempotentna — obstoječi osnutek pobriše in ustvari novega.
 * Potrjene temeljnice ne briše.
 */
export async function bookZacetnaZaloga(
  companyId: string,
  leto: number,
  datum: string, // YYYY-MM-DD
  postavke: ZZPostavka[],
): Promise<{ created: string | null; skipped: { reason: string } | null }> {
  const ref = `POS:ZZ:${leto}`;

  // Nastavitve knjiženja
  const [settings] = await db
    .select()
    .from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId))
    .limit(1);

  if (!settings) {
    return { created: null, skipped: { reason: "POS nastavitve knjiženja niso konfigurirane" } };
  }

  if (!settings.openingBalanceAccountId) {
    return { created: null, skipped: { reason: "Otvoritveni konto bilance stanja (990/900) ni nastavljen v POS nastavitvah" } };
  }

  // Odprto računovodsko obdobje
  const [period] = await db
    .select({ id: accountingPeriodsTable.id })
    .from(accountingPeriodsTable)
    .where(
      and(
        eq(accountingPeriodsTable.companyId, companyId),
        lte(accountingPeriodsTable.startDate, datum),
        gte(accountingPeriodsTable.endDate, datum),
        notInArray(accountingPeriodsTable.status, ["locked"]),
      ),
    )
    .limit(1);

  if (!period) {
    return { created: null, skipped: { reason: `Ni odprtega računovodskega obdobja za ${datum}` } };
  }

  // Seštej vrednost po vrsti artikla
  const byVrsta = new Map<string, Decimal>();
  for (const p of postavke) {
    const vrsta = p.vrstaArtikla ?? "material";
    const val = new Decimal(p.kolicina).times(new Decimal(p.cenaKos)).toDecimalPlaces(2);
    byVrsta.set(vrsta, (byVrsta.get(vrsta) ?? new Decimal(0)).plus(val));
  }

  const skupaj = [...byVrsta.values()].reduce((s, v) => s.plus(v), new Decimal(0));
  if (skupaj.lte("0.005")) {
    await deleteExistingDrafts(companyId, ref);
    return { created: null, skipped: null }; // nič za knjižiti
  }

  const lines: SyncLine[] = [];

  for (const [vrsta, znesek] of byVrsta) {
    if (znesek.lte("0.005")) continue;

    let invAcc: string | null | undefined;
    if (vrsta === "material") {
      invAcc = settings.inventoryMaterialAccountId ?? settings.inventoryAccountId;
    } else if (vrsta === "blago") {
      invAcc = settings.inventoryGoodsAccountId ?? settings.inventoryAccountId;
    } else {
      invAcc = settings.inventoryAccountId;
    }

    if (!invAcc) {
      return {
        created: null,
        skipped: { reason: `Konto zalog za vrsto '${vrsta}' (${znesek.toFixed(2)} €) ni nastavljen v T2` },
      };
    }

    lines.push({
      accountId: invAcc,
      side: "debit",
      amount: znesek,
      desc: `Začetna zaloga ${vrsta} ${leto}`,
    });
  }

  lines.push({
    accountId: settings.openingBalanceAccountId,
    side: "credit",
    amount: skupaj,
    desc: `Otvoritev bilance ${leto}`,
  });

  const merged = mergeLines(lines);
  if (!isBalanced(merged)) {
    const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
    return { created: null, skipped: { reason: `Otvoritvena temeljnica ni uravnotežena: D ${d.toFixed(2)} ≠ K ${c.toFixed(2)}` } };
  }

  await deleteExistingDrafts(companyId, ref);
  await insertEntry(companyId, period.id, datum, `POS začetne zaloge ${leto}`, ref, merged);

  return { created: ref, skipped: null };
}
