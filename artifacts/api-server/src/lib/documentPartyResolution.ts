export type CompanyPartyIdentity = {
  naziv: string;
  kratekNaziv?: string | null;
  podjetjeDavcna: string;
  idZaDdv?: string | null;
  maticnaStevilka?: string | null;
};

export type DocumentParty = {
  name?: string | null;
  taxId?: string | null;
  registrationId?: string | null;
  address?: string | null;
};

export type PartyIdentityStatus = "self" | "other" | "unknown" | "conflict";
export type OcrDocumentType = "invoice_received" | "invoice_issued";

export type DocumentPartyResolution = {
  documentType?: OcrDocumentType;
  oppositeParty?: DocumentParty;
  issuerStatus: PartyIdentityStatus;
  recipientStatus: PartyIdentityStatus;
  correctedModelType: boolean;
  ambiguous: boolean;
};

export type ScopedCounterparty = {
  id: string;
  name: string;
  taxId?: string | null;
};

/** Remove formatting while preserving country prefixes other than the Slovenian equivalence. */
export function normalizeTaxId(value: string | null | undefined): string {
  const normalized = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const slovenianNumber = normalized.match(/^(?:SI)?(\d{8})$/);
  return slovenianNumber ? slovenianNumber[1] : normalized;
}

function normalizeRegistrationId(value: string | null | undefined): string {
  const normalized = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Slovenian legal entities may print the seven-digit registration number
  // while company settings contain its ten-digit head-office form (...000).
  // Do not collapse non-zero branch suffixes or foreign alphanumeric IDs.
  const slovenianHeadOffice = normalized.match(/^(\d{7})(?:000)?$/);
  return slovenianHeadOffice ? slovenianHeadOffice[1] : normalized;
}

function normalizeAlias(value: string | null | undefined): string {
  const legalName = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  const proprietor = legalName.match(/^(.*?)\bS[\s.]*P\.?\s*$/u);
  if (proprietor) {
    const personTokens = proprietor[1].match(/[\p{L}\p{N}]+/gu) ?? [];
    if (personTokens.length >= 2) return `SP:${personTokens.sort().join("|")}`;
  }
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function companyTaxIds(company: CompanyPartyIdentity): Set<string> {
  return new Set([company.podjetjeDavcna, company.idZaDdv]
    .map(normalizeTaxId)
    .filter(Boolean));
}

function partyHasTaxId(party: DocumentParty): boolean {
  return Boolean(normalizeTaxId(party.taxId));
}

function partyHasRegistrationId(party: DocumentParty): boolean {
  return Boolean(normalizeRegistrationId(party.registrationId));
}

export function classifyPartyIdentity(
  party: DocumentParty | null | undefined,
  company: CompanyPartyIdentity,
): PartyIdentityStatus {
  if (!party) return "unknown";

  const taxId = normalizeTaxId(party.taxId);
  const registrationId = normalizeRegistrationId(party.registrationId);
  const ownTaxIds = companyTaxIds(company);
  const ownRegistrationId = normalizeRegistrationId(company.maticnaStevilka);
  const hasIds = Boolean(taxId || registrationId);

  if (hasIds) {
    const taxMatches = taxId ? ownTaxIds.has(taxId) : false;
    const registrationMatches = registrationId && ownRegistrationId
      ? registrationId === ownRegistrationId
      : false;
    const idConflict = Boolean(
      (taxId && !taxMatches)
      || (registrationId && (!ownRegistrationId || !registrationMatches)),
    );
    const hasOwnEvidence = taxMatches || registrationMatches;
    if (hasOwnEvidence && idConflict) return "conflict";
    return hasOwnEvidence ? "self" : "other";
  }

  const aliases = [company.naziv, company.kratekNaziv]
    .map(normalizeAlias)
    .filter(Boolean);
  const name = normalizeAlias(party.name);
  if (!name) return "unknown";
  return aliases.includes(name) ? "self" : "other";
}

export function resolveDocumentParties(
  issuer: DocumentParty | null | undefined,
  recipient: DocumentParty | null | undefined,
  company: CompanyPartyIdentity,
  modelType?: string | null,
): DocumentPartyResolution {
  const issuerStatus = classifyPartyIdentity(issuer, company);
  const recipientStatus = classifyPartyIdentity(recipient, company);
  const validModelType: OcrDocumentType | undefined =
    modelType === "invoice_received" || modelType === "invoice_issued" ? modelType : undefined;

  if (issuerStatus === "self" && recipientStatus === "self") {
    return {
      issuerStatus,
      recipientStatus,
      correctedModelType: Boolean(validModelType),
      ambiguous: true,
    };
  }
  if (issuerStatus === "conflict" || recipientStatus === "conflict") {
    return {
      issuerStatus,
      recipientStatus,
      correctedModelType: Boolean(validModelType),
      ambiguous: true,
    };
  }
  if (issuerStatus === "self") {
    return {
      documentType: "invoice_issued",
      oppositeParty: recipientStatus === "other" ? recipient ?? undefined : undefined,
      issuerStatus,
      recipientStatus,
      correctedModelType: validModelType !== undefined && validModelType !== "invoice_issued",
      ambiguous: false,
    };
  }
  if (recipientStatus === "self") {
    return {
      documentType: "invoice_received",
      oppositeParty: issuerStatus === "other" ? issuer ?? undefined : undefined,
      issuerStatus,
      recipientStatus,
      correctedModelType: validModelType !== undefined && validModelType !== "invoice_received",
      ambiguous: false,
    };
  }

  // With no positive company-role evidence, retain only a valid model direction.
  // The caller still has to corroborate any party against its tenant catalog.
  const oppositeParty = validModelType === "invoice_issued"
    ? recipient
    : validModelType === "invoice_received"
      ? issuer
      : undefined;
  const status = validModelType === "invoice_issued" ? recipientStatus : issuerStatus;
  return {
    documentType: validModelType,
    oppositeParty: status === "other" ? oppositeParty ?? undefined : undefined,
    issuerStatus,
    recipientStatus,
    correctedModelType: false,
    ambiguous: issuerStatus === "unknown" && recipientStatus === "unknown",
  };
}

/**
 * Match only exact normalized identifiers or (when no identifier is supplied)
 * exact normalized names. A conflicting identifier never falls back to name.
 */
export function findScopedCounterparty(
  party: DocumentParty | null | undefined,
  company: CompanyPartyIdentity,
  counterparties: ScopedCounterparty[],
): ScopedCounterparty | undefined {
  if (!party || classifyPartyIdentity(party, company) === "self" || classifyPartyIdentity(party, company) === "conflict") {
    return undefined;
  }
  const taxId = normalizeTaxId(party.taxId);
  const registrationId = normalizeRegistrationId(party.registrationId);
  let matches: ScopedCounterparty[];

  if (taxId || registrationId) {
    if (!taxId) return undefined;
    matches = counterparties.filter(counterparty => normalizeTaxId(counterparty.taxId) === taxId);
  } else {
    const name = normalizeAlias(party.name);
    if (!name) return undefined;
    matches = counterparties.filter(counterparty => normalizeAlias(counterparty.name) === name);
  }

  // Never pick an arbitrary person when two sole proprietors share a name.
  if (!taxId && !registrationId && normalizeAlias(party.name).startsWith("SP:") && matches.length !== 1) return undefined;
  return [...matches].sort((a, b) => a.id.localeCompare(b.id))[0];
}

export function filterSelfCounterparties<T extends ScopedCounterparty>(
  counterparties: T[],
  company: CompanyPartyIdentity,
): T[] {
  return counterparties.filter(counterparty =>
    classifyPartyIdentity({ name: counterparty.name, taxId: counterparty.taxId }, company) !== "self",
  );
}

export function partyHasIdentity(party: DocumentParty | null | undefined): boolean {
  return Boolean(party && (party.name?.trim() || partyHasTaxId(party) || partyHasRegistrationId(party)));
}