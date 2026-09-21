import { sql, type SQL } from "drizzle-orm";

/**
 * Accounting view of tips as they were recorded on receipts.  It deliberately
 * uses receipt snapshots (rather than the currently active tip policy), so a
 * later policy change cannot rewrite a historical X/Z report.
 */
export type TipBreakdownLine = {
  policyMode: string;
  paymentMethod: "cash" | "card" | "unknown";
  vatTreatment: "outside_vat" | "output_vat";
  gross: number;
  net: number;
  vat: number;
  cardFee: number;
  liability: number;
  revenue: number;
};

export type TipBreakdown = {
  gross: number;
  net: number;
  vat: number;
  cardFee: number;
  liability: number;
  revenue: number;
  byPolicyMode: TipBreakdownLine[];
};

type SqlExecutor = { execute: (query: SQL) => Promise<{ rows: unknown[] }> };

/**
 * Receipt snapshots are authoritative. Legacy rows without an immutable policy
 * or payment channel remain explicitly historical/unreviewed rather than being
 * reclassified according to a later UI or policy decision.
 */
export async function getTipBreakdown(
  executor: SqlExecutor,
  enotaId: number,
  start: Date,
  end: Date,
  receiptPrefixPattern?: string,
): Promise<TipBreakdown> {
  const prefixFilter = receiptPrefixPattern
    ? sql`AND stevilka_racuna LIKE ${receiptPrefixPattern} ESCAPE '!'`
    : sql``;
  const result = await executor.execute(sql`
    WITH receipt_tips AS (
      SELECT
        COALESCE(tip_policy_mode, 'historical_unreviewed') AS policy_mode,
        COALESCE(tip_payment_method, 'unknown') AS payment_method,
        CASE WHEN tip_policy_mode = 'employer_controlled'
          THEN 'output_vat' ELSE 'outside_vat' END AS vat_treatment,
        COALESCE(znesek_napitnina::numeric, 0) AS gross,
        COALESCE(tip_vat_amount::numeric, 0) AS vat,
        COALESCE(tip_card_fee_amount::numeric, 0) AS card_fee,
        COALESCE(tip_card_fee_treatment, '') AS fee_treatment
      FROM racuni
      WHERE enota_id = ${enotaId}
        AND ustvarjeno >= ${start.toISOString()}::timestamptz
        AND ustvarjeno < ${end.toISOString()}::timestamptz
        AND status != 'storniran' AND je_storno IS NOT TRUE
        ${prefixFilter}
    )
    SELECT policy_mode, payment_method, vat_treatment,
      COALESCE(SUM(gross_part), 0) AS gross,
      COALESCE(SUM(CASE WHEN policy_mode = 'employer_controlled' THEN gross_part - (vat * gross_part / NULLIF(gross, 0))
                        WHEN fee_treatment = 'deduct_from_tip' AND payment_method = 'card' THEN gross_part - card_fee ELSE gross_part END), 0) AS net,
      COALESCE(SUM(CASE WHEN policy_mode = 'employer_controlled' THEN vat * gross_part / NULLIF(gross, 0) ELSE 0 END), 0) AS vat,
      COALESCE(SUM(CASE WHEN payment_method = 'card' THEN card_fee ELSE 0 END), 0) AS card_fee,
      COALESCE(SUM(CASE WHEN policy_mode IN ('direct_employee', 'independent_pool')
        THEN CASE WHEN fee_treatment = 'deduct_from_tip' AND payment_method = 'card' THEN gross_part - card_fee ELSE gross_part END ELSE 0 END), 0) AS liability,
      COALESCE(SUM(CASE WHEN policy_mode = 'employer_controlled' THEN gross_part - (vat * gross_part / NULLIF(gross, 0)) ELSE 0 END), 0) AS revenue
    FROM (
      SELECT *, gross AS gross_part FROM receipt_tips
    ) split
    WHERE gross_part <> 0
    GROUP BY policy_mode, payment_method, vat_treatment
    ORDER BY policy_mode, payment_method
  `);
  type Row = Omit<TipBreakdownLine, "paymentMethod" | "policyMode" | "vatTreatment" | "cardFee"> & {
    policy_mode: string;
    payment_method: "cash" | "card" | "unknown";
    vat_treatment: "outside_vat" | "output_vat";
    card_fee: string | number;
  };
  const lines = (result.rows as Row[]).map(row => ({
    policyMode: row.policy_mode,
    paymentMethod: row.payment_method,
    vatTreatment: row.vat_treatment,
    gross: Number(row.gross ?? 0),
    net: Number(row.net ?? 0),
    vat: Number(row.vat ?? 0),
    cardFee: Number(row.card_fee ?? 0),
    liability: Number(row.liability ?? 0),
    revenue: Number(row.revenue ?? 0),
  }));
  const total = (key: keyof Omit<TipBreakdownLine, "policyMode" | "paymentMethod" | "vatTreatment">) =>
    lines.reduce((sum, line) => sum + line[key], 0);
  return {
    gross: total("gross"), net: total("net"), vat: total("vat"), cardFee: total("cardFee"),
    liability: total("liability"), revenue: total("revenue"), byPolicyMode: lines,
  };
}