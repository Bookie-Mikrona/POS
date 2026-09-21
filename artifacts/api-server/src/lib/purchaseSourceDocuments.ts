import { sql } from "drizzle-orm";
import type { PurchaseSourceDocumentKind } from "@workspace/db";

type SqlExecutor = {
  execute: (query: any) => Promise<any>;
};

export interface ClaimPurchaseSourceInput {
  companyId: string;
  counterpartyId: string;
  kind: PurchaseSourceDocumentKind;
  documentNumber?: string | null;
  documentDate?: string | null;
  currency?: string | null;
  contentSha256?: string | null;
  excludeInvoiceId?: string | null;
  excludeGoodsReceiptId?: string | null;
  excludePosReceiptId?: number | null;
}

export function normalizePurchaseDocumentNumber(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return normalized || null;
}

export async function claimPurchaseSourceDocument(
  executor: SqlExecutor,
  input: ClaimPurchaseSourceInput,
): Promise<string> {
  const normalizedNumber = normalizePurchaseDocumentNumber(input.documentNumber);
  const contentSha256 = input.contentSha256?.trim().toLowerCase() || null;
  if (!normalizedNumber && !contentSha256) {
    throw new Error("Za identiteto nabavne listine je obvezna številka dokumenta ali SHA-256.");
  }

  if (normalizedNumber) {
    const businessLockKey = [
      "purchase-source",
      input.companyId,
      input.counterpartyId,
      normalizedNumber,
    ].join(":");
    await executor.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${businessLockKey}))
    `);
    const legacyConflict = await executor.execute(sql`
      SELECT (
        EXISTS (
          SELECT 1
            FROM invoices i
           WHERE i.company_id = ${input.companyId}
             AND i.counterparty_id = ${input.counterpartyId}
             AND i.type = 'received'
             AND i.source_document_id IS NULL
             AND (${input.excludeInvoiceId ?? null}::uuid IS NULL OR i.id <> ${input.excludeInvoiceId ?? null}::uuid)
             AND regexp_replace(upper(normalize(i.invoice_number, NFKC)), '[[:space:][:punct:]]', '', 'g') = ${normalizedNumber}
        )
        OR EXISTS (
          SELECT 1
            FROM goods_receipts gr
           WHERE gr.company_id = ${input.companyId}
             AND gr.counterparty_id = ${input.counterpartyId}
             AND gr.source_document_id IS NULL
             AND (${input.excludeGoodsReceiptId ?? null}::uuid IS NULL OR gr.id <> ${input.excludeGoodsReceiptId ?? null}::uuid)
             AND regexp_replace(upper(normalize(gr.delivery_note_no, NFKC)), '[[:space:][:punct:]]', '', 'g') = ${normalizedNumber}
        )
        OR EXISTS (
          SELECT 1
            FROM prejemnice p
            JOIN enote e ON e.id = p.enota_id
           WHERE e.company_id = ${input.companyId}
             AND p.dobavitelj_id = ${input.counterpartyId}
             AND p.source_document_id IS NULL
             AND (${input.excludePosReceiptId ?? null}::integer IS NULL OR p.id <> ${input.excludePosReceiptId ?? null}::integer)
             AND p.st_dokumenta IS NOT NULL
             AND regexp_replace(upper(normalize(p.st_dokumenta, NFKC)), '[[:space:][:punct:]]', '', 'g') = ${normalizedNumber}
        )
      ) AS has_legacy_conflict
    `);
    if ((legacyConflict.rows[0] as { has_legacy_conflict?: boolean } | undefined)?.has_legacy_conflict) {
      const error = new Error(
        "LEGACY_PURCHASE_SOURCE_CONFLICT: obstoječa listina brez kanonične identitete zahteva ročno razrešitev",
      );
      Object.assign(error, { code: "LEGACY_PURCHASE_SOURCE_CONFLICT" });
      throw error;
    }
  }

  const inserted = await executor.execute(sql`
    INSERT INTO purchase_source_documents (
      company_id, counterparty_id, kind, normalized_number, display_number,
      document_date, currency, content_sha256
    ) VALUES (
      ${input.companyId}, ${input.counterpartyId}, ${input.kind}, ${normalizedNumber},
      ${input.documentNumber?.trim() || null}, ${input.documentDate ?? null},
      ${(input.currency ?? "EUR").toUpperCase()}, ${contentSha256}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  const created = inserted.rows[0] as { id: string } | undefined;
  if (created) return created.id;

  const existing = await executor.execute(sql`
    SELECT id, counterparty_id, kind
      FROM purchase_source_documents
     WHERE company_id = ${input.companyId}
       AND (
         (${contentSha256}::text IS NOT NULL AND content_sha256 = ${contentSha256})
         OR (
           ${normalizedNumber}::text IS NOT NULL
           AND counterparty_id = ${input.counterpartyId}
           AND normalized_number = ${normalizedNumber}
         )
       )
     ORDER BY CASE WHEN content_sha256 = ${contentSha256} THEN 0 ELSE 1 END
     LIMIT 1
  `);
  const found = existing.rows[0] as { id: string; counterparty_id: string; kind: string } | undefined;
  if (!found) throw new Error("Identitete nabavne listine ni bilo mogoče rezervirati.");
  if (found.counterparty_id !== input.counterpartyId) {
    throw new Error("Ista izvorna datoteka je že zajeta z drugim dobaviteljem.");
  }
  return found.id;
}