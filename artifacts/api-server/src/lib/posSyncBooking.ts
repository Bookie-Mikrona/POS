/**
 * POS → ERP samodejno knjiženje
 * ─────────────────────────────────────────────────────────────────────────────
 * Za vsak dan generira do 3 osnutke temeljnic:
 *   1. POS:PRODAJA:YYYY-MM-DD   — dnevna prodaja (Z-poročilo)
 *   2. POS:PREJEMNICA:YYYY-MM-DD — prejemnice blaga
 *   3. POS:PORABA:YYYY-MM-DD    — razknjižba zalog (COGS)
 *
 * Funkcija je idempotentna: obstoječe osnutke z istim ref pobriše in ustvari
 * nove. Potrjene temeljnice (status='posted') nikoli ne briše.
 *
 * Klic je async-fire-and-forget iz POS routov. Napake se zabeležijo samo
 * v konzolo — ne vplivajo na POS odgovor.
 */

import Decimal from "decimal.js";
import { and, eq, inArray, lte, gte, notInArray, sql } from "drizzle-orm";
import {
  db,
  posBookingSettingsTable,
  accountingPeriodsTable,
  enoteTable,
  racuniTable,
  prejemniceTable,
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
    if (!settings.revenueAccountId) {
      skipped.push({ ref: prodajaRef, reason: "Konto prihodkov ni nastavljen" });
      return;
    }

    const [sales] = await db
      .select({
        gotovina: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        osnova: sql<string>`COALESCE(SUM(CAST(${racuniTable.osnova} AS numeric)), 0)`,
        ddv: sql<string>`COALESCE(SUM(CAST(${racuniTable.ddv} AS numeric)), 0)`,
        skupaj: sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
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
      // Brez prodaje — pobriši morebitni obstoječi osnutek
      await deleteExistingDrafts(companyId, prodajaRef);
      return;
    }

    const gotovina = dec(sales.gotovina);
    const kartica = dec(sales.kartica);
    const osnova = dec(sales.osnova);
    const ddv = dec(sales.ddv);
    const ostalo = skupaj.minus(gotovina).minus(kartica);

    const lines: SyncLine[] = [];

    // Debet — plačilni načini
    if (gotovina.gt(0)) {
      if (!settings.cashAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Gotovina (${gotovina.toFixed(2)} €): konto blagajne ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.cashAccountId, side: "debit", amount: gotovina, desc: "Gotovina" });
    }
    if (kartica.gt(0)) {
      if (!settings.cardAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Kartica (${kartica.toFixed(2)} €): konto terjatev do processorja ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.cardAccountId, side: "debit", amount: kartica, desc: "Kartica" });
    }
    if (ostalo.gt("0.005")) {
      if (!settings.otherPaymentAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Ostala plačila (${ostalo.toFixed(2)} €): konto za ostala plačila ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.otherPaymentAccountId, side: "debit", amount: ostalo, desc: "Ostala plačila (boni, negotovinsko …)" });
    }

    // Kredit — prihodki + DDV
    if (osnova.gt(0)) {
      lines.push({ accountId: settings.revenueAccountId!, side: "credit", amount: osnova, desc: "Prihodki od prodaje (neto)" });
    }
    if (ddv.gt("0.005")) {
      if (!settings.vatLiabilityAccountId) {
        skipped.push({ ref: prodajaRef, reason: `DDV (${ddv.toFixed(2)} €): konto DDV obveznosti ni nastavljen` });
        return;
      }
      lines.push({ accountId: settings.vatLiabilityAccountId, side: "credit", amount: ddv, desc: "Izhodni DDV" });
    }

    if (lines.length === 0) return;

    if (!isBalanced(lines)) {
      const d = lines.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = lines.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: prodajaRef, reason: `Temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingDrafts(companyId, prodajaRef);
    await insertEntry(companyId, period.id, datum, `Dnevna prodaja POS — ${datum}`, prodajaRef, lines);
    created.push(prodajaRef);
  })();

  // ── TEMELJNICA 2: PREJEMNICE ─────────────────────────────────────────────────
  const prejemnicaRef = `POS:PREJEMNICA:${datum}`;
  await (async () => {
    if (!settings.inventoryAccountId || !settings.payablesAccountId) {
      skipped.push({ ref: prejemnicaRef, reason: "Konto zalog ali dobaviteljev ni nastavljen" });
      return;
    }

    const [pResult] = await db
      .select({
        skupaj: sql<string>`COALESCE(SUM(CAST(${prejemniceTable.skupajVrednost} AS numeric)), 0)`,
      })
      .from(prejemniceTable)
      .where(
        and(
          inArray(prejemniceTable.enotaId, enotaIds),
          sql`${prejemniceTable.datum}::date = ${datum}::date`,
        ),
      );

    const skupaj = dec(pResult.skupaj);
    if (skupaj.lte(0)) {
      await deleteExistingDrafts(companyId, prejemnicaRef);
      return;
    }

    const lines: SyncLine[] = [
      { accountId: settings.inventoryAccountId!, side: "debit", amount: skupaj, desc: "Prejeto blago — zaloge" },
      { accountId: settings.payablesAccountId!, side: "credit", amount: skupaj, desc: "Obveznosti do dobaviteljev" },
    ];

    await deleteExistingDrafts(companyId, prejemnicaRef);
    await insertEntry(companyId, period.id, datum, `POS prejemnice blaga — ${datum}`, prejemnicaRef, lines);
    created.push(prejemnicaRef);
  })();

  // ── TEMELJNICA 3: PORABA BLAGA ───────────────────────────────────────────────
  const porabaRef = `POS:PORABA:${datum}`;
  await (async () => {
    if (!settings.cogsAccountId || !settings.inventoryAccountId) {
      skipped.push({ ref: porabaRef, reason: "Konto stroškov blaga ali zalog ni nastavljen" });
      return;
    }

    // vrednost je negativna za 'poraba' (kolicina < 0), vzamemo absolutno vrednost
    const [cResult] = await db
      .select({
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
      );

    const porabljeno = dec(cResult.porabljeno);
    if (porabljeno.lte(0)) {
      await deleteExistingDrafts(companyId, porabaRef);
      return;
    }

    const lines: SyncLine[] = [
      { accountId: settings.cogsAccountId!, side: "debit", amount: porabljeno, desc: "Stroški prodanega blaga (COGS)" },
      { accountId: settings.inventoryAccountId!, side: "credit", amount: porabljeno, desc: "Zmanjšanje zalog blaga" },
    ];

    await deleteExistingDrafts(companyId, porabaRef);
    await insertEntry(companyId, period.id, datum, `POS poraba blaga — ${datum}`, porabaRef, lines);
    created.push(porabaRef);
  })();

  return { created, skipped };
}
