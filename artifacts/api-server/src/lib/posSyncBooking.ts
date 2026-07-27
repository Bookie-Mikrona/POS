/**
 * POS → ERP samodejno knjiženje
 * ─────────────────────────────────────────────────────────────────────────────
 * Za vsak dan generira do 3 osnutke temeljnic:
 *   1. POS:PRODAJA:YYYY-MM-DD   — dnevna prodaja (Z-poročilo)
 *      Debet:  gotovina / kartica / darilni boni / ostalo
 *      Kredit: prihodki po vrsti artikla × DDV stopnji + DDV po stopnji
 *
 *   2. POS:PREJEMNICA:YYYY-MM-DD — prejemnice blaga
 *      Debet:  zaloga materiala + zaloga blaga
 *      Kredit: obveznosti do dobaviteljev
 *
 *   3. POS:PORABA:YYYY-MM-DD    — razknjižba zalog (COGS)
 *      Debet:  stroški materiala + NVPB blaga
 *      Kredit: zmanjšanje ustrezne zalogе
 *
 * Analitika:
 *   - vrsta_artikla: 'material' | 'blago' | 'storitev'
 *   - davek: 9.5 | 22 | 0  (DDV stopnja v %)
 *
 * Fallback: če analitični konti niso nastavljeni, se uporabi zastareli splošni
 * konto (revenueAccountId / vatLiabilityAccountId / inventoryAccountId / cogsAccountId).
 *
 * Funkcija je idempotentna: obstoječe osnutke z istim ref pobriše in ustvari
 * nove. Potrjene temeljnice (status='posted') nikoli ne briše.
 */

import Decimal from "decimal.js";
import { and, eq, inArray, isNull, lte, gte, notInArray, sql } from "drizzle-orm";
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

  // ── TEMELJNICA 1: PRODAJA ────────────────────────────────────────────────────
  const prodajaRef = `POS:PRODAJA:${datum}`;
  await (async () => {
    // 1a. Dnevni seštevki plačil (iz glave računa)
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
          inArray(racuniTable.enotaId, enotaIds),
          sql`(${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')::date = ${datum}::date`,
          notInArray(racuniTable.status, ["storniran", "testni"]),
        ),
      );

    const skupaj = dec(sales.skupaj);
    if (skupaj.lte(0)) {
      await deleteExistingDrafts(companyId, prodajaRef);
      return;
    }

    // 1b. Prihodki in DDV po vrsti artikla × DDV stopnji (iz postavk)
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
          inArray(racuniTable.enotaId, enotaIds),
          sql`(${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')::date = ${datum}::date`,
          notInArray(racuniTable.status, ["storniran", "testni"]),
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

    // Mapa vrsta × davek → konto prihodkov
    const revenueMap: Record<string, string | null | undefined> = {
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
    const vatMap: Record<string, string | null | undefined> = {
      "9.50":  settings.vat95AccountId,
      "22.00": settings.vat22AccountId,
    };

    // Skupaj DDV po stopnji (za balanciranje)
    const ddvPo: Record<string, Decimal> = {};

    let skupajBruto = new Decimal(0);
    for (const row of prodajaVrstice) {
      const bruto    = dec(row.bruto);
      const davekPct = dec(row.davek); // npr. 9.50
      if (bruto.lte("0.005")) continue;

      // neto = bruto * 100 / (100 + davek)
      const neto = davekPct.gt(0)
        ? bruto.times(100).div(davekPct.plus(100)).toDecimalPlaces(2)
        : bruto;
      const ddv  = bruto.minus(neto);

      skupajBruto = skupajBruto.plus(bruto);

      // Vrsta → konto prihodkov
      const vrsta   = row.vrstaArtikla ?? "material";
      const davekKey = davekPct.toFixed(2);
      const mapKey  = `${vrsta}|${davekKey}`;
      const revAcc  = revenueMap[mapKey] ?? settings.revenueAccountId;

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

      // DDV
      if (ddv.gt("0.005")) {
        ddvPo[davekKey] = (ddvPo[davekKey] ?? new Decimal(0)).plus(ddv);
      }
    }

    // Kredit DDV po stopnji
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

    // Fallback: če ni postavk, uporabi skupaj iz glave računa (stara logika)
    if (prodajaVrstice.length === 0 || skupajBruto.lte("0.005")) {
      const fallbackAcc = settings.revenueAccountId;
      if (!fallbackAcc) {
        skipped.push({ ref: prodajaRef, reason: "Ni postavk in splošni konto prihodkov ni nastavljen" });
        return;
      }
      const skupajDDV = skupaj.minus(dec(sales.gotovina).plus(kartica).plus(boni).plus(negotovinsko))
                              .abs();
      const skupajNeto = skupaj.minus(skupajDDV);
      lines.push({ accountId: fallbackAcc, side: "credit", amount: skupajNeto.gt(0) ? skupajNeto : skupaj, desc: "Prihodki od prodaje (neto)" });
      if (skupajDDV.gt("0.005") && settings.vatLiabilityAccountId) {
        lines.push({ accountId: settings.vatLiabilityAccountId, side: "credit", amount: skupajDDV, desc: "Izhodni DDV" });
      }
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

    // Vsota prejemnic po vrsti artikla (za ločitev material/blago)
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
        invAcc = settings.inventoryAccountId; // storitev — redko
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
    // Porabljeno po vrsti artikla
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

  return { created, skipped };
}
