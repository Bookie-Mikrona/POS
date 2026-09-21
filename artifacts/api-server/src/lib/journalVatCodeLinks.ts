type VatLinkedLine = {
  companyVatCodeId?: string | null;
  vatCodeId?: string | null;
};

type CompanyVatCodeLink = {
  id: string;
  fursCodeId: string | null;
};

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