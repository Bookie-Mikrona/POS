/**
 * Skupni pomočnik za Z-poročilo.
 * Skupna pravila Z-poročila in poslovnega dne.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, zPorocilaTable } from "@workspace/db";
import { getBusinessDayBounds, getCurrentPosBusinessDate, getEnotaBusinessDayStart } from "./pos-business-day";

type Executor = Pick<typeof db, "execute">;

export type ZCloseBlockerType =
  | "OPEN_SHIFTS"
  | "OCCUPIED_TABLES"
  | "OPEN_ORDERS"
  | "OPEN_PREPARED_FOOD"
  | "FURS_UNRESOLVED"
  | "BUSINESS_FINALIZATION_PENDING"
  | "OPEN_A_RECEIPTS";

export type ZCloseBlocker = {
  type: ZCloseBlockerType;
  count: number;
  message: string;
  items: Array<{ id: number; label: string }>;
};

export type PreviousBusinessDayGate = {
  allowed: boolean;
  previousBusinessDate: string | null;
  missingRegisters: Array<{ id: number; name: string }>;
};

/** Enoten transakcijski zaklep za ustvarjanje naročil in zaključek dneva. */
export async function lockPosBusinessDay(executor: Executor, enotaId: number): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pos-business-day:${enotaId}`}))`);
}

export async function isPosBusinessDayClosed(
  executor: Executor,
  enotaId: number,
  businessDate: string,
): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT 1
    FROM z_porocila
    WHERE enota_id = ${enotaId}
      AND poslovni_datum = ${businessDate}::date
      AND odklenjen_ob IS NULL
    LIMIT 1
  `);
  return result.rows.length > 0;
}

export async function getZCloseBlockers(
  executor: Executor,
  enotaId: number,
  businessDate: string,
  blagajnaId?: number,
): Promise<ZCloseBlocker[]> {
  const currentBusinessDate = await getCurrentPosBusinessDate(enotaId, undefined, executor);
  const isCurrentBusinessDate = currentBusinessDate === businessDate;
  const bounds = await getBusinessDayBounds(enotaId, businessDate, executor);
  const shifts = await executor.execute(sql`
      SELECT i.id, TRIM(CONCAT(COALESCE(n.ime, ''), ' ', COALESCE(n.priimek, ''))) AS label
      FROM izmene i
      LEFT JOIN natakari n ON n.id = i.natakari_id
      WHERE i.enota_id = ${enotaId}
        AND i.konec IS NULL
        AND i.zacetek >= ${bounds.start.toISOString()}::timestamptz
        AND i.zacetek < ${bounds.end.toISOString()}::timestamptz
      ORDER BY i.zacetek
    `);
  const tables = await executor.execute(sql`
      SELECT id, COALESCE(NULLIF(ime, ''), 'Miza ' || stevilka::text) AS label
      FROM mize
      WHERE enota_id = ${enotaId}
        AND status = 'zasedena'
        AND ${isCurrentBusinessDate}
      ORDER BY stevilka
    `);
  const orders = await executor.execute(sql`
      SELECT id, 'Naročilo #' || COALESCE(stevilka_narocila::text, id::text) AS label
      FROM narocila
      WHERE enota_id = ${enotaId}
        AND status = 'odprto'
        AND ustvarjeno >= ${bounds.start.toISOString()}::timestamptz
        AND ustvarjeno < ${bounds.end.toISOString()}::timestamptz
      ORDER BY id
    `);
  const prepared = await executor.execute(sql`
      SELECT a.id, a.ime AS label
      FROM artikli a
      LEFT JOIN prepared_food_daily_ledgers l
        ON l.enota_id = a.enota_id
        AND l.artikel_id = a.id
        AND l.business_date = ${businessDate}::date
      WHERE a.enota_id = ${enotaId}
        AND a.meal_type = 'prepared'
        AND (
          (l.id IS NOT NULL AND l.closed_at IS NULL)
          OR (${isCurrentBusinessDate} AND a.aktiven IS TRUE AND l.id IS NULL)
        )
      ORDER BY a.ime
    `);
  const registerPredicate = blagajnaId === undefined
    ? sql`TRUE`
    : sql`r.stevilka_racuna LIKE (
      (SELECT pp_id || '-' || b_id || '-%' FROM blagajne WHERE id = ${blagajnaId})
    )`;
  const furs = await executor.execute(sql`
      SELECT r.id, r.stevilka_racuna AS label
      FROM racuni r
      WHERE r.enota_id = ${enotaId}
        AND r.ustvarjeno >= ${bounds.start.toISOString()}::timestamptz
        AND r.ustvarjeno < ${bounds.end.toISOString()}::timestamptz
        AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
        AND r.furs_state IN ('sending', 'unknown', 'failed')
        AND ${registerPredicate}
      ORDER BY r.id
    `);
  const notFinalized = await executor.execute(sql`
      SELECT r.id, r.stevilka_racuna AS label
      FROM racuni r
      WHERE r.enota_id = ${enotaId}
        AND r.ustvarjeno >= ${bounds.start.toISOString()}::timestamptz
        AND r.ustvarjeno < ${bounds.end.toISOString()}::timestamptz
        AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
        AND r.furs_state = 'confirmed' AND r.business_finalized_at IS NULL
        AND ${registerPredicate}
      ORDER BY r.id
    `);
  const openAReceipts = await executor.execute(sql`
      SELECT r.id, r.stevilka_racuna AS label
      FROM racuni r
      WHERE r.enota_id = ${enotaId}
        AND r.ustvarjeno >= ${bounds.start.toISOString()}::timestamptz
        AND r.ustvarjeno < ${bounds.end.toISOString()}::timestamptz
        AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
        AND r.placilna_nacin = 'negotovinsko' AND COALESCE(r.dni_odloga, 0) > 0
        AND ${registerPredicate}
      ORDER BY r.id
    `);

  const blockers: ZCloseBlocker[] = [];
  const append = (
    type: ZCloseBlockerType,
    rows: unknown[],
    singular: string,
    plural: string,
  ) => {
    const items = (rows as Array<{ id: number; label: string | null }>).map((row) => ({
      id: Number(row.id),
      label: row.label?.trim() || `#${row.id}`,
    }));
    if (items.length === 0) return;
    const labels = items.slice(0, 5).map((item) => item.label).join(", ");
    const suffix = items.length > 5 ? ` in še ${items.length - 5}` : "";
    blockers.push({
      type,
      count: items.length,
      items,
      message: `${items.length === 1 ? singular : plural}: ${labels}${suffix}.`,
    });
  };

  append("OPEN_SHIFTS", shifts.rows, "Zaprite odprto izmeno", "Zaprite vse odprte izmene");
  append("OCCUPIED_TABLES", tables.rows, "Izpraznite zasedeno mizo", "Izpraznite vse zasedene mize");
  append("OPEN_ORDERS", orders.rows, "Zaključite odprto naročilo", "Zaključite vsa odprta naročila");
  append(
    "OPEN_PREPARED_FOOD",
    prepared.rows,
    `Zaključite dnevno evidenco pripravljene jedi za poslovni dan ${businessDate}`,
    `Zaključite dnevne evidence pripravljenih jedi za poslovni dan ${businessDate}`,
  );
  append("FURS_UNRESOLVED", furs.rows, "Razrešite FURS račun", "Razrešite FURS račune");
  append(
    "BUSINESS_FINALIZATION_PENDING",
    notFinalized.rows,
    "Dokončajte poslovno finalizacijo računa",
    "Dokončajte poslovno finalizacijo računov",
  );
  append("OPEN_A_RECEIPTS", openAReceipts.rows, "Zaprite odprt A-račun", "Zaprite odprte A-račune");
  return blockers;
}

/**
 * Poišče zadnji pretekli datum z dejansko POS dejavnostjo. Samo odprtje prazne
 * izmene ni poslovanje: brez naročila, računa, premika ali dnevne evidence tak
 * dan ne sme zahtevati umetnega praznega Z-poročila.
 */
async function getPreviousOperationalBusinessDate(
  executor: Executor,
  enotaId: number,
  currentBusinessDate: string,
): Promise<string | null> {
  const startTime = await getEnotaBusinessDayStart(enotaId, executor);
  const startInterval = `${startTime}:00`;
  const result = await executor.execute(sql`
    SELECT MAX(activity_date)::text AS activity_date
    FROM (
      SELECT ((ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date AS activity_date
      FROM narocila n
      WHERE n.enota_id = ${enotaId}
        AND (
          n.status <> 'preklicano'
          OR EXISTS (
            SELECT 1 FROM postavke p WHERE p.narocilo_id = n.id
          )
        )
      UNION ALL
      SELECT ((datum_cas AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date
      FROM blagajniski_premiki WHERE enota_id = ${enotaId}
      UNION ALL
      SELECT business_date FROM prepared_food_daily_ledgers WHERE enota_id = ${enotaId}
      UNION ALL
      SELECT poslovni_datum FROM z_porocila WHERE enota_id = ${enotaId}
    ) activity
    WHERE activity_date < ${currentBusinessDate}::date
  `);
  return (result.rows[0] as { activity_date?: string | null } | undefined)?.activity_date ?? null;
}

export async function checkPreviousBusinessDayClosed(
  executor: Executor,
  enotaId: number,
  currentBusinessDate: string,
): Promise<PreviousBusinessDayGate> {
  const previousBusinessDate = await getPreviousOperationalBusinessDate(
    executor,
    enotaId,
    currentBusinessDate,
  );
  if (!previousBusinessDate) {
    return { allowed: true, previousBusinessDate: null, missingRegisters: [] };
  }

  const bounds = await getBusinessDayBounds(enotaId, previousBusinessDate, executor);
  const relevant = await executor.execute(sql`
    SELECT DISTINCT b.id, b.ime AS name
    FROM blagajne b
    WHERE b.enota_id = ${enotaId}
      AND b.aktivna IS TRUE
      AND (
        EXISTS (
          SELECT 1 FROM z_porocila z
          WHERE z.blagajna_id = b.id AND z.poslovni_datum = ${previousBusinessDate}::date
        )
        OR EXISTS (
          SELECT 1 FROM blagajniski_premiki bp
          WHERE bp.blagajna_id = b.id
            AND bp.datum_cas >= ${bounds.start.toISOString()}::timestamptz
            AND bp.datum_cas < ${bounds.end.toISOString()}::timestamptz
        )
        OR EXISTS (
          SELECT 1 FROM racuni r
          WHERE r.enota_id = ${enotaId}
            AND r.ustvarjeno >= ${bounds.start.toISOString()}::timestamptz
            AND r.ustvarjeno < ${bounds.end.toISOString()}::timestamptz
            AND r.stevilka_racuna LIKE (b.pp_id || '-' || b.b_id || '-%')
        )
      )
    ORDER BY b.id
  `);

  let relevantRegisters = relevant.rows as Array<{ id: number; name: string }>;
  if (relevantRegisters.length === 0) {
    const fallback = await executor.execute(sql`
      SELECT id, ime AS name
      FROM blagajne
      WHERE enota_id = ${enotaId} AND aktivna IS TRUE
      ORDER BY id
    `);
    relevantRegisters = fallback.rows as Array<{ id: number; name: string }>;
  }

  const missingRegisters: Array<{ id: number; name: string }> = [];
  for (const register of relevantRegisters) {
    const closed = await executor.execute(sql`
      SELECT 1
      FROM z_porocila
      WHERE enota_id = ${enotaId}
        AND blagajna_id = ${register.id}
        AND poslovni_datum = ${previousBusinessDate}::date
        AND odklenjen_ob IS NULL
      LIMIT 1
    `);
    if (closed.rows.length === 0) {
      missingRegisters.push({ id: Number(register.id), name: register.name });
    }
  }

  return {
    allowed: missingRegisters.length === 0,
    previousBusinessDate,
    missingRegisters,
  };
}

/**
 * Vrne true, če je poslovni dan za to blagajno zaklenjen z Z-poročilom
 * (z_porocila obstaja in odklenjen_ob IS NULL).
 *
 * @param enotaId  - integer ID enote
 * @param blagajnaId - integer ID blagajne
 * @param datum    - poslovni datum v obliki YYYY-MM-DD (current business day)
 */
export async function checkZDnevniZaklep(
  enotaId: number,
  blagajnaId: number,
  datum: string,
): Promise<boolean> {
  const [z] = await db
    .select({ id: zPorocilaTable.id })
    .from(zPorocilaTable)
    .where(and(
      eq(zPorocilaTable.enotaId, enotaId),
      eq(zPorocilaTable.blagajnaId, blagajnaId),
      eq(zPorocilaTable.poslovniDatum, datum),
      isNull(zPorocilaTable.odklenjenOb),
    ))
    .limit(1);
  return !!z;
}

/**
 * Izračuna tekoči poslovni datum za enoto (upošteva zacetekDnevaUra 04:00 default).
 */
export async function getCurrentPoslovniDatum(enotaId: number): Promise<string> {
  return getCurrentPosBusinessDate(enotaId);
}
