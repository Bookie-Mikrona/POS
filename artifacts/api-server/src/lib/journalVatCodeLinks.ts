import { and, eq, inArray } from "drizzle-orm";
import { db, vatCodesTable } from "@workspace/db";

type VatLinkedLine = {
  companyVatCodeId?: string | null;
  vatCodeId?: string | null;
};

type CompanyVatCodeLink = {
  id: string;
  fursCodeId: string | null;
};

export class JournalVatCodeLinkError extends Error {}

/**
 * Resolve tenant IDs on the same transaction that writes the journal.
 * SHARE keeps a concurrent edit of the FURS link from changing its meaning
 * between validation and persistence.
 */
export async function resolveJournalVatCodeLinks<T extends VatLinkedLine>(
  tx: Pick<typeof db, "select">,
  companyId: string,
  lines: T[],
): Promise<T[]> {
  const ids = [...new Set(lines.flatMap(line => line.companyVatCodeId ? [line.companyVatCodeId] : []))];
  if (ids.length === 0) return lines;
  const codes = await tx.select({ id: vatCodesTable.id, fursCodeId: vatCodesTable.fursCodeId })
    .from(vatCodesTable)
    .where(and(eq(vatCodesTable.companyId, companyId), inArray(vatCodesTable.id, ids)))
    .for("share");
  const resolved = resolveCompanyVatCodeLinks(lines, codes);
  if (resolved.error !== null) throw new JournalVatCodeLinkError(resolved.error);
  return resolved.lines;
}

export function resolveCompanyVatCodeLinks<T extends VatLinkedLine>(
  lines: T[],
  companyCodes: CompanyVatCodeLink[],
): { lines: T[]; error: null } | { lines: null; error: string } {
  const codeMap = new Map(companyCodes.map((code) => [code.id, code.fursCodeId]));

  for (const line of lines) {
    if (!line.companyVatCodeId) continue;
    if (!codeMap.has(line.companyVatCodeId)) {
      return { lines: null, error: "Vsaj ena DDV koda ne obstaja ali ne pripada temu podjetju" };
    }
    const resolvedFursCodeId = codeMap.get(line.companyVatCodeId);
    if (!resolvedFursCodeId) {
      return { lines: null, error: "Izbrana podjetniška DDV koda ni povezana s FURS kodo" };
    }
    if (line.vatCodeId && line.vatCodeId !== resolvedFursCodeId) {
      return { lines: null, error: "Podjetniška DDV koda in FURS koda se ne ujemata" };
    }
  }

  return {
    error: null,
    lines: lines.map((line) => {
      if (!line.companyVatCodeId) return line;
      return {
        ...line,
        vatCodeId: codeMap.get(line.companyVatCodeId) ?? null,
      };
    }),
  };
}