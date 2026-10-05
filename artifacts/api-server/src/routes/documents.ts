/**
 * documents.ts — AI/OCR obdelava dokumentov
 *
 * Tok:
 *   1. Frontend naloži datoteko na GCS via presigned URL (POST /storage/uploads/request-url)
 *   2. Frontend registrira dokument (POST /companies/:id/documents/register) → status: pending
 *   3. Backend takoj sproži async OCR (ne čaka na odgovor) → status: processing
 *   4. OCR konča → status: done + ocrResult
 *   5. Računovodja potrdi (POST .../confirm) → status: confirmed + opcijsko draft račun
 *
 * INVARIANT — potrjena knjižba ostane zapisana tudi po brisanju dokumenta:
 *   - Ni DELETE endpointa za dokumente. Dokumenti se ne brišejo.
 *   - Ko je račun (invoice) ustvarjen ob potrditvi, živi neodvisno od dokumenta.
 *   - FK je enosmeren: documents.linkedInvoiceId → invoices.id (brez CASCADE).
 *   - Brisanje dokumenta (če bi bilo kdaj dodano) NE sme izbrisati računa ali
 *     invoice_lines — te vsebujejo učni kontekst za prihodnje predloge kontiranja.
 *   - Vsak prihodnji DELETE handler mora eksplicitno ničiti linkedInvoiceId
 *     na dokumentu in pustiti invoice nedotaknjen.
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, desc, sql, asc, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  documentsTable,
  companiesTable,
  accountingRolesTable,
  counterpartiesTable,
  accountsTable,
  vatCodeTable,
  vatCodesTable,
  invoicesTable,
  invoiceLinesTable,
  accountingPeriodsTable,
  counterpartyAccountTemplatesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { isScannedBankStatement, parseScannedBankStatement } from "../lib/scannedBankStatement";
import { BankDraftError, createScannedBankDraft } from "../lib/scannedBankDraft";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { OcrResult, ProposedLine } from "@workspace/db";
import { validateDirectPostingAccounts } from "../lib/directPostingAccountValidation";
import { claimPurchaseSourceDocument } from "../lib/purchaseSourceDocuments";
import {
  expectedDocumentVatDirection,
  inheritOmittedVatCodeSelection,
  resolveDocumentVatCodeMappings,
} from "../lib/documentVatCodeMapping";
import {
  classifyPartyIdentity,
  filterSelfCounterparties,
  findScopedCounterparty,
  partyHasIdentity,
  resolveDocumentParties,
  type CompanyPartyIdentity,
  type DocumentParty,
  type OcrDocumentType,
} from "../lib/documentPartyResolution";
import {
  assertPositiveUnitsPerEur,
  assertRequestedInvoiceDate,
  assertValidRateDate,
  convertDocumentAmounts,
  DocumentExchangeRateError,
  getEcbUsdEurQuote,
  type DocumentTotals,
  type ExchangeRateMode,
  type DocumentVatTreatment,
  type ExpenseEurRoundingAdjustment,
  type SourceGrossRoundingAdjustment,
} from "../lib/documentExchangeRate";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveActorLabel(clerkUserId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    if (fullName) return fullName;

    const primaryEmail = user.emailAddresses.find(
      (email) => email.id === user.primaryEmailAddressId,
    )?.emailAddress;
    return primaryEmail ?? user.emailAddresses[0]?.emailAddress ?? clerkUserId;
  } catch {
    // Akcija se ne sme izjaloviti samo zato, ker Clerk trenutno ni dosegljiv.
    // ID ohrani sledljivost do uporabnika, medtem ko običajni tok vedno shrani
    // ime ali e-pošto.
    return clerkUserId;
  }
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return null; }
  return { role: row.role };
}

const storage = new ObjectStorageService();

// ─── OCR logika ────────────────────────────────────────────────────────────────

type SuggestionTemplateRow = {
  counterpartyId: string;
  accountId: string;
  usageCount: number | null;
  lastLineDescription?: string | null;
};

type SuggestionBookingRow = {
  counterpartyId: string;
  accountCode: string;
  accountId?: string;
  lineDescription?: string;
  invoiceLineId?: string;
};

type AssetCandidate = "OTHER_FA" | "REALESTATE";
const EU_VAT_PREFIXES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "EL", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SK", "XI",
]);
const MAX_PROMPT_ACCOUNTS = 160;
const MAX_PROMPT_COUNTERPARTIES = 200;

function normalizeLineDescription(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sampleEvenly<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  if (limit <= 1) return rows.slice(0, limit);
  return Array.from({ length: limit }, (_, index) =>
    rows[Math.round(index * (rows.length - 1) / (limit - 1))],
  );
}

function selectPromptAccounts<T extends { code: string; type?: string; isActive: boolean; allowsPosting: boolean }>(accounts: T[]): T[] {
  const postable = accounts.filter(account => account.isActive && account.allowsPosting);
  const expenseOrAsset = postable.filter(account =>
    account.type ? account.type === "expense" || account.type === "asset" : /^[0-6]/.test(account.code),
  );
  const revenue = postable.filter(account =>
    account.type ? account.type === "revenue" : /^[78]/.test(account.code),
  );
  const halfLimit = Math.floor(MAX_PROMPT_ACCOUNTS / 2);
  const selected = [
    ...sampleEvenly(expenseOrAsset, halfLimit),
    ...sampleEvenly(revenue, halfLimit),
  ];
  if (selected.length < MAX_PROMPT_ACCOUNTS) {
    const selectedIds = new Set(selected);
    selected.push(...postable.filter(account => !selectedIds.has(account)).slice(0, MAX_PROMPT_ACCOUNTS - selected.length));
  }
  return selected.sort((a, b) => a.code.localeCompare(b.code));
}

function isAccountCompatibleWithDocumentType(
  account: { code: string; type?: string },
  documentType: OcrDocumentType,
): boolean {
  if (account.type) {
    return documentType === "invoice_issued"
      ? account.type === "revenue"
      : account.type === "expense" || account.type === "asset";
  }
  return documentType === "invoice_issued"
    ? /^[78]/.test(account.code)
    : /^[034]/.test(account.code);
}

type OcrCandidateLine = ProposedLine & {
  assetTypeCandidate?: AssetCandidate;
  assetTypeReason?: string;
  assetTypeOriginalAccountCode?: string | null;
  assetTypeOriginalAccountId?: string | null;
  assetType?: "NONE" | "OTHER_FA" | "REALESTATE";
  vatCodeId?: string | null;
  vatCodeFursId?: string;
  proposedFursVatCodeId?: string | null;
  vatCodeReason?: string;
  vatCodeReviewRequired?: boolean;
  vatCodeReviewReason?: string;
};

type OcrReviewResult = OcrResult & {
  counterpartyTaxId?: string;
  invoiceDate?: string;
  lines: OcrCandidateLine[];
};

function assertSubmittedSourceAmountsMatchOcr(
  ocrLines: readonly ProposedLine[],
  submittedLines: readonly ProposedLine[],
): void {
  if (submittedLines.length !== ocrLines.length) {
    throw new DocumentExchangeRateError(
      "SOURCE_LINES_CHANGED",
      "Število vrstic se ne ujema z nespremenljivim OCR-izvirnikom. Pretvorba ni bila izvedena.",
    );
  }
  const sourceAmounts: Array<keyof Pick<ProposedLine, "quantity" | "unitPrice" | "vatRate" | "vatBase" | "vatAmount">> = [
    "quantity", "unitPrice", "vatRate", "vatBase", "vatAmount",
  ];
  for (const [index, sourceLine] of ocrLines.entries()) {
    const submittedLine = submittedLines[index];
    for (const key of sourceAmounts) {
      const submittedValue = submittedLine[key];
      const originalValue = sourceLine[key];
      if (
        typeof submittedValue !== "number"
        || !Number.isFinite(submittedValue)
        || typeof originalValue !== "number"
        || !Number.isFinite(originalValue)
        || submittedValue !== originalValue
      ) {
        throw new DocumentExchangeRateError(
          "SOURCE_LINE_AMOUNT_CHANGED",
          `Znesek, količina ali stopnja DDV vrstice ${index + 1} se ne ujema z nespremenljivim OCR-izvirnikom.`,
        );
      }
    }
  }
}

function sameSourceGrossAdjustment(
  submitted: unknown,
  expected: SourceGrossRoundingAdjustment | undefined,
): boolean {
  if (!expected) return submitted === undefined || submitted === null;
  if (!submitted || typeof submitted !== "object") return false;
  const value = submitted as Partial<SourceGrossRoundingAdjustment>;
  return value.sourceCurrency === expected.sourceCurrency
    && value.sourceGross === expected.sourceGross
    && value.lineGross === expected.lineGross
    && value.amount === expected.amount
    && value.lineIndex === expected.lineIndex;
}

function sameExpenseEurAdjustment(
  submitted: unknown,
  expected: ExpenseEurRoundingAdjustment | undefined,
): boolean {
  if (!expected) return submitted === undefined || submitted === null;
  if (!submitted || typeof submitted !== "object") return false;
  const value = submitted as Partial<ExpenseEurRoundingAdjustment>;
  return value.amount === expected.amount && value.lineIndex === expected.lineIndex;
}

type OcrDraft = Partial<OcrResult> & {
  issuer?: DocumentParty | null;
  recipient?: DocumentParty | null;
};

export function isEuSupplierTaxId(taxId: string | null | undefined): boolean {
  const normalized = (taxId ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return normalized.length > 2 && EU_VAT_PREFIXES.has(normalized.slice(0, 2));
}

/**
 * OCR asset classification is deliberately a proposal, never a booking rule.
 * Only unmistakable asset terminology is enough to create a visible candidate.
 */
export function inferAssetCandidate(description: string, documentText = ""): {
  candidate: AssetCandidate | null;
  reason?: string;
} {
  const text = `${description} ${documentText}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const acquisitionEvidence = /\b(nakup|nabava|dobava|investicija|investicijska)\b/.test(text);
  if (acquisitionEvidence && /\b(nepremicnin\w*|zemljisc\w*|stavb\w*|poslovn\w*\s+prostor\w*)\b/.test(text)) {
    return { candidate: "REALESTATE", reason: "Opis izrecno omenja nakup oziroma investicijo v nepremičnino." };
  }
  if (acquisitionEvidence && /\b(stroj\w*|oprem\w*|racunalnik\w*|vozil\w*|pohistv\w*)\b/.test(text)) {
    return { candidate: "OTHER_FA", reason: "Opis izrecno kaže na nabavo trajnejše opreme oziroma osnovnega sredstva." };
  }
  return { candidate: null };
}

export function enrichLinesWithSuggestionSource(
  lines: ProposedLine[],
  detectedCounterpartyId: string | null,
  templateRows: SuggestionTemplateRow[],
  recentBookingRows: SuggestionBookingRow[],
): ProposedLine[] {
  return lines.map(line => {
    const accountId = line.accountId ?? null;
    if (!accountId || !detectedCounterpartyId) {
      return { ...line, suggestionSource: "pattern" as const };
    }

    const matchingTemplate = templateRows.find(
      t => t.counterpartyId === detectedCounterpartyId
        && t.accountId === accountId
        && normalizeLineDescription(t.lastLineDescription) === normalizeLineDescription(line.description),
    );
    if (matchingTemplate) {
      return {
        ...line,
        suggestionSource: "history" as const,
        suggestionCount: matchingTemplate.usageCount ?? undefined,
      };
    }

    const matchingBookings = recentBookingRows.filter(
      b => b.counterpartyId === detectedCounterpartyId
        && b.accountCode === line.accountCode
        && normalizeLineDescription(b.lineDescription) === normalizeLineDescription(line.description),
    );
    if (matchingBookings.length > 0) {
      return {
        ...line,
        suggestionSource: "history" as const,
        suggestionCount: matchingBookings.length,
      };
    }

    return { ...line, suggestionSource: "pattern" as const };
  });
}

/**
 * Pridobi vsebino datoteke iz GCS za posredovanje Claudu.
 * Podprti formati: PDF, JPEG, PNG, WEBP.
 */
type ClaudeFileSource =
  | { contentType: "image"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }
  | { contentType: "document"; media_type: "application/pdf"; data: string };

async function fetchFileForClaude(objectPath: string, mimeType: string): Promise<ClaudeFileSource> {
  const normalizedPath = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath;

  const file = await storage.getObjectEntityFile(`/objects/${normalizedPath}`);
  const [fileContents] = await file.download();
  const base64 = fileContents.toString("base64");

  if (mimeType === "application/pdf") {
    return { contentType: "document", media_type: "application/pdf", data: base64 };
  }
  const imgMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  type ImgMime = (typeof imgMimes)[number];
  const mt = (imgMimes.includes(mimeType as ImgMime) ? mimeType : "image/jpeg") as ImgMime;
  return { contentType: "image", media_type: mt, data: base64 };
}

/**
 * Pokliče Claude Vision za ekstrakcijo podatkov iz dokumenta.
 * Vrne strukturiran OcrResult.
 */
export async function runOcrWithClaude(
  objectPath: string,
  mimeType: string,
  companyId: string,
): Promise<OcrResult> {
  const [company] = await db.select({
    naziv: companiesTable.naziv,
    kratekNaziv: companiesTable.kratekNaziv,
    podjetjeDavcna: companiesTable.podjetjeDavcna,
    idZaDdv: companiesTable.idZaDdv,
    maticnaStevilka: companiesTable.maticnaStevilka,
  })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) {
    throw new Error(`OCR company identity not found for companyId ${companyId}`);
  }
  const companyIdentity: CompanyPartyIdentity = company;

  // Pridobi kontekst (partnerji + konte + pretekle knjižbe) za boljše predloge
  const [counterparties, accounts, vatCodes, recentBookingRows, templateRows] = await Promise.all([
    db.select({
      id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId,
      address: counterpartiesTable.address, postCode: counterpartiesTable.postCode, city: counterpartiesTable.city,
    })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.companyId, companyId), eq(counterpartiesTable.isActive, true))),
    db.select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true)))
      .orderBy(asc(accountsTable.code)),
    db.select({
      id: vatCodeTable.id,
      code: vatCodeTable.code,
      rate: vatCodeTable.rate,
      direction: vatCodeTable.direction,
      isReverseCharge: vatCodeTable.isReverseCharge,
      validFrom: vatCodeTable.validFrom,
      validTo: vatCodeTable.validTo,
    })
      .from(vatCodeTable)
      .where(inArray(vatCodeTable.direction, ["IN", "OUT"])),
    // Pretekle potrjene knjižbe za učenje vzorcev kontiranja po partnerjih
    db.select({
      counterpartyId: counterpartiesTable.id,
      counterpartyName: counterpartiesTable.name,
      counterpartyTaxId: counterpartiesTable.taxId,
      invoiceType: invoicesTable.type,
      invoiceLineId: invoiceLinesTable.id,
      lineDescription: invoiceLinesTable.description,
      accountId: accountsTable.id,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      vatRate: invoiceLinesTable.vatRate,
    })
      .from(invoiceLinesTable)
      .innerJoin(invoicesTable, eq(invoiceLinesTable.invoiceId, invoicesTable.id))
      .innerJoin(counterpartiesTable, eq(invoicesTable.counterpartyId, counterpartiesTable.id))
      .innerJoin(accountsTable, eq(invoiceLinesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(counterpartiesTable.companyId, companyId),
          inArray(invoicesTable.status, ["posted", "paid"]),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .limit(100),
    // Shranjene predloge kontiranja po partnerju — nastanejo ob potrditvi dokumenta
    db.select({
      counterpartyId: counterpartyAccountTemplatesTable.counterpartyId,
      counterpartyName: counterpartiesTable.name,
      counterpartyTaxId: counterpartiesTable.taxId,
      accountId: counterpartyAccountTemplatesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      accountIsActive: accountsTable.isActive,
      documentType: counterpartyAccountTemplatesTable.documentType,
      lastLineDescription: counterpartyAccountTemplatesTable.lastLineDescription,
      usageCount: counterpartyAccountTemplatesTable.usageCount,
    })
      .from(counterpartyAccountTemplatesTable)
      .innerJoin(counterpartiesTable, eq(counterpartyAccountTemplatesTable.counterpartyId, counterpartiesTable.id))
      .innerJoin(accountsTable, eq(counterpartyAccountTemplatesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(counterpartyAccountTemplatesTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
        ),
      )
      .orderBy(desc(counterpartyAccountTemplatesTable.usageCount))
      .limit(200),
  ]);
  const visibleCounterparties = filterSelfCounterparties(counterparties, companyIdentity);
  const visibleBookingRows = recentBookingRows.filter(row =>
    classifyPartyIdentity({ name: row.counterpartyName, taxId: row.counterpartyTaxId }, companyIdentity) !== "self",
  );
  const visibleTemplateRows = templateRows.filter(row =>
    classifyPartyIdentity({ name: row.counterpartyName, taxId: row.counterpartyTaxId }, companyIdentity) !== "self",
  );

  // Združi shranjene predloge po partnerjih
  const templatesByCounterparty = new Map<string, typeof visibleTemplateRows>();
  for (const row of visibleTemplateRows) {
    const existing = templatesByCounterparty.get(row.counterpartyId) ?? [];
    existing.push(row);
    templatesByCounterparty.set(row.counterpartyId, existing);
  }
  const templatesContext = templatesByCounterparty.size > 0
    ? Array.from(templatesByCounterparty.entries())
        .map(([, rows]) => {
          const cpName = rows[0].counterpartyName;
          const lines = rows.map(r =>
            `    • [${r.usageCount}× potrjeno] ${r.documentType === "invoice_received" ? "prejet" : "izdan"} račun | "${r.lastLineDescription ?? "–"}" → konto ${r.accountCode} (${r.accountName})`,
          ).join("\n");
          return `  ${cpName}:\n${lines}`;
        })
        .join("\n\n")
    : null;

  // Združi pretekle knjižbe po partnerjih — max 5 vrstic na partnerja
  const bookingsByCounterparty = new Map<string, typeof visibleBookingRows>();
  for (const row of visibleBookingRows) {
    const existing = bookingsByCounterparty.get(row.counterpartyId) ?? [];
    if (existing.length < 5) {
      existing.push(row);
      bookingsByCounterparty.set(row.counterpartyId, existing);
    }
  }
  const pastBookingsContext = bookingsByCounterparty.size > 0
    ? Array.from(bookingsByCounterparty.entries())
        .map(([, rows]) => {
          const cpName = rows[0].counterpartyName;
          const lines = rows.map(r =>
            `    • ${r.invoiceType === "received" ? "prejet" : "izdan"} račun | ${r.lineDescription} → konto ${r.accountCode} (${r.accountName}), DDV ${r.vatRate}%`,
          ).join("\n");
          return `  ${cpName}:\n${lines}`;
        })
        .join("\n\n")
    : "(še ni preteklih knjižb)";

  const counterpartyList = [...visibleCounterparties]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_PROMPT_COUNTERPARTIES)
    .map(c => `- ${c.name}${c.taxId ? ` (DDV: ${c.taxId})` : ""} [id: ${c.id}]`)
    .join("\n");
  const promptAccounts = selectPromptAccounts(accounts);
  const accountList = promptAccounts.map(a => `- ${a.code}: ${a.name} [id: ${a.id}]`).join("\n");
  const vatList = vatCodes.map(v => `- ${v.code} (${v.rate}%, ${v.direction === "IN" ? "vstopni/prejeti" : "izstopni/izdani"}) [id: ${v.id}]`).join("\n");

  const source = await fetchFileForClaude(objectPath, mimeType);

  const prompt = `Si računovodski AI asistent za slovensko dvostavno knjigovodstvo. Iz priloženega dokumenta (računa/fakturo) ekstrahiraj vse računovodske podatke in vrni IZKLJUČNO veljaven JSON brez komentarjev.

KONTEKST PODJETJA:
Aktivno podjetje (izdajatelj lastnega izdanega računa, ne partner):
- Naziv: ${companyIdentity.naziv}
- Kratek naziv: ${companyIdentity.kratekNaziv ?? "–"}
- Davčna številka: ${companyIdentity.podjetjeDavcna}
- ID za DDV: ${companyIdentity.idZaDdv ?? "–"}
- Matična številka: ${companyIdentity.maticnaStevilka ?? "–"}

Partnerji v sistemu (aktivno podjetje je iz seznama izključeno):
${counterpartyList || "(ni partnerjev)"}

Kontni načrt (konte za knjiženje):
${accountList || "(ni kontov)"}

DDV kode:
${vatList || "(ni DDV kod)"}

SHRANJENE PREDLOGE KONTIRANJA PO PARTNERJIH (NAJVIŠJA PRIORITETA — te konte je računovodja že potrdil za istega partnerja):
${templatesContext ?? "(še ni shranjenih predlog)"}

PRETEKLE POTRJENE KNJIŽBE PO PARTNERJIH (sekundaren učni vzorec):
${pastBookingsContext}

TIPIČNI VZORCI KONTIRANJA ZA GOSTINSTVO (upoštevaj pri predlogih):
- Izdani račun kupcu za prodajo/storitev: uporabi prihodek (konto tipa revenue) iz kontnega načrta, nikoli nabavnega stroška.
- Prejeti račun dobavitelja: uporabi ustrezen strošek, zalogo ali osnovno sredstvo glede na vsebino.
- Prejet račun za surovine/hrano (9,5% DDV):  BREME 3100 + 1601 | DOBRO 2200
- Prejet račun za pijačo (22% DDV):            BREME 3101 + 1600 | DOBRO 2201
- Prejet račun za embalažo (22% DDV):          BREME 3102 + 1600 | DOBRO 2202
- Prejet račun za računovodstvo (22% DDV):     BREME 4150 + 1600 | DOBRO 2203
- Prejet račun za najemnino (22% DDV):         BREME 410  + 1600 | DOBRO 2202
- Prejet račun za elektriko/vodo (22% DDV):    BREME 412  + 1600 | DOBRO 2202
- Prenos surovin v kuhinjo (interni):          BREME 4000 | DOBRO 3100
- Dnevni iztržek blagajne (gotovina):          BREME 1050 | DOBRO 8000/8002/8003/8004 + 2800/2801
- DDV stopnje: hrana v lokalu 9,5% (8000), sokovi 9,5% (8003), pijača+alkohol 22% (8002), embalaža 22% (8004)

NAVODILA:
1. Ločeno prepoznaj izdajatelja računa in prejemnika/kupca, skupaj z njunima nazivoma, davčnima ID-jema in matičnima številkama. Aktivno podjetje zgoraj ni partner: če je aktivno podjetje izdajatelj, je dokument invoice_issued in partner je prejemnik; če je aktivno podjetje prejemnik, je invoice_received in partner je izdajatelj. Primerjaj davčne in matične številke, ne sklepaj, da je podjetje partner zato, ker se pojavi na računu.
2. Vrsto dokumenta izrazi glede na aktivno podjetje: invoice_received (aktivno podjetje je prejemnik računa dobavitelja) ali invoice_issued (aktivno podjetje je izdajatelj računa kupcu). Če sta obe strani aktivno podjetje, so podatki v konfliktu ali vloge niso jasne, vrste oziroma partnerja ne ugibaj.
3. Ekstrahiraj številko računa, datum, rok plačila, naslov partnerja, zneske in vse vrstice.
4. Uporabi samo predloge in pretekle knjižbe iste vrste dokumenta in z enakim oziroma res primerljivim opisom vrstice; ne prenesi konta z nepovezanega izdelka ali storitve. Izdan račun je prodaja/prihodek, prejet račun je nabava/strošek.
5. DDV koda IN je vstopna in velja za prejeti račun, DDV koda OUT je izstopna in velja za izdani račun. Predlagaj samo kodo ustrezne smeri.
6. Za vsako vrstico predlagaj konto iz seznama — najprej združljive shranjene predloge, nato združljive pretekle knjižbe, nato ustrezne vzorce glede na prodajo/prihodek ali nabavo/strošek.
7. Izračunaj skupne vsote.
8. Oceni zaupnost prepoznave (0.0-1.0) — upoštevaj samo združljive shranjene predloge.

VRNI TOČNO ta JSON (brez markdowna, brez besedila pred/po):
{
  "rawText": "celotno besedilo dokumenta",
  "confidence": 0.95,
  "issuer": { "name": "Izdajatelj računa", "taxId": "SI12345678", "registrationId": "matična številka", "address": "Naslov" },
  "recipient": { "name": "Prejemnik računa", "taxId": "SI12345678", "registrationId": "matična številka", "address": "Naslov" },
  "counterpartyName": "Ime podjetja d.o.o.",
  "counterpartyTaxId": "SI12345678",
  "counterpartyAddress": "Naslov 1, 1000 Ljubljana",
  "invoiceNumber": "R-2024-001",
  "invoiceDate": "2024-01-15",
  "dueDate": "2024-02-14",
  "totalNet": 1000.00,
  "totalVat": 220.00,
  "totalGross": 1220.00,
  "currency": "EUR",
  "lines": [
    {
      "description": "Opis storitve",
      "quantity": 1,
      "unitPrice": 1000.00,
      "vatRate": 22,
      "vatBase": 1000.00,
      "vatAmount": 220.00,
      "vatCodeId": "uuid-globalne-vstopne-ddv-kode-ali-null",
      "accountCode": "400",
      "accountId": "uuid-konta-ali-null",
      "confidence": 0.9
    }
  ],
  "suggestedCounterpartyId": "uuid-partnerja-ali-null",
  "suggestedCounterpartyName": "Prepoznano ime partnerja",
  "suggestedDocumentType": "invoice_received"
}

Če nečesa ne prepoznaš, nastavi vrednost na null. Za accountId in suggestedCounterpartyId vrni točni UUID iz zgornjega seznama ali null. Aktivno podjetje nikoli ne sme biti suggestedCounterpartyId; suggestedCounterpartyId izberi samo, če se ujema z dejansko nasprotno stranko in je ta v seznamu partnerjev.`;

  // Sestavi vsebinski blok glede na tip datoteke (PDF vs. slika)
  const fileBlock = source.contentType === "document"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: source.media_type, data: source.data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: source.media_type, data: source.data } };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          fileBlock as any,
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const block = message.content[0];
  const rawText = block.type === "text" ? block.text : "{}";

  // Razčleni JSON — poskusi odpraviti morebitne markdown ovoje
  let jsonStr = rawText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: OcrDraft;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      rawText: rawText,
      confidence: 0,
      lines: [],
      error: `Napaka pri razčlenjevanju OCR odgovora: ${rawText.slice(0, 200)}`,
    };
  }

  // Bank statements have no invoice/VAT lines. Keep unsupported statements in
  // the bank review too, with explicit parsing errors rather than an invoice.
  const bankStatement = parseScannedBankStatement(parsed.rawText ?? "");
  if (bankStatement) {
    return { rawText: parsed.rawText ?? "", confidence: parsed.confidence ?? 0,
      currency: bankStatement.currency, invoiceDate: bankStatement.statementDate, lines: [] };
  }
  const partyResolution = resolveDocumentParties(
    parsed.issuer,
    parsed.recipient,
    companyIdentity,
    parsed.suggestedDocumentType,
  );
  const documentType = partyResolution.documentType;
  const structuredCounterparty = partyResolution.oppositeParty;
  const oppositeStatus = documentType === "invoice_issued"
    ? partyResolution.recipientStatus
    : documentType === "invoice_received"
      ? partyResolution.issuerStatus
      : "unknown";
  const legacyCounterparty: DocumentParty = {
    name: parsed.counterpartyName,
    taxId: parsed.counterpartyTaxId,
    address: parsed.counterpartyAddress,
  };
  // Legacy generic model fields are only considered when role-specific data did
  // not identify the opposite party; they must still be non-self and catalog-backed.
  let counterparty = partyHasIdentity(structuredCounterparty) ? structuredCounterparty : undefined;
  let scopedCounterparty = counterparty
    ? findScopedCounterparty(counterparty, companyIdentity, visibleCounterparties)
    : undefined;
  if (!counterparty
    && documentType
    && oppositeStatus === "unknown"
    && classifyPartyIdentity(legacyCounterparty, companyIdentity) === "other") {
    const legacyMatch = findScopedCounterparty(legacyCounterparty, companyIdentity, visibleCounterparties);
    if (legacyMatch) {
      counterparty = legacyCounterparty;
      scopedCounterparty = legacyMatch;
    }
  }
  const detectedCounterpartyId = scopedCounterparty?.id ?? null;
  const matchingTemplates = documentType
    ? visibleTemplateRows.filter(row => row.documentType === documentType)
    : [];
  const matchingBookings = documentType
    ? visibleBookingRows.filter(row =>
        row.counterpartyId === detectedCounterpartyId
        && row.invoiceType === (documentType === "invoice_received" ? "received" : "issued"),
      )
    : [];
  const validatedModelLines = (parsed.lines ?? []).map(line => {
    if (!documentType || partyResolution.correctedModelType) {
      return { ...line, accountCode: undefined, accountId: undefined };
    }
    let account = line.accountId
      ? accounts.find(candidate => candidate.id === line.accountId && candidate.isActive && candidate.allowsPosting)
      : undefined;
    if (!account && line.accountCode) {
      const codeMatches = accounts.filter(candidate =>
        candidate.code === line.accountCode && candidate.isActive && candidate.allowsPosting,
      );
      if (codeMatches.length === 1) account = codeMatches[0];
    }
    if (!account || !isAccountCompatibleWithDocumentType(account, documentType)) {
      return { ...line, accountCode: undefined, accountId: undefined };
    }
    return { ...line, accountCode: account.code, accountId: account.id };
  });

  const needsScopedHistory = detectedCounterpartyId !== null
    && documentType !== undefined
    && validatedModelLines.some(line => {
      return !line.accountId && Boolean(normalizeLineDescription(line.description));
    });
  const scopedHistoryRows: SuggestionBookingRow[] = needsScopedHistory && detectedCounterpartyId && documentType
    ? await db.select({
        counterpartyId: invoicesTable.counterpartyId,
        invoiceLineId: invoiceLinesTable.id,
        lineDescription: invoiceLinesTable.description,
        accountId: accountsTable.id,
        accountCode: accountsTable.code,
      })
        .from(invoiceLinesTable)
        .innerJoin(invoicesTable, eq(invoiceLinesTable.invoiceId, invoicesTable.id))
        .innerJoin(counterpartiesTable, eq(invoicesTable.counterpartyId, counterpartiesTable.id))
        .innerJoin(accountsTable, eq(invoiceLinesTable.accountId, accountsTable.id))
        .where(
          and(
            eq(invoicesTable.companyId, companyId),
            eq(counterpartiesTable.companyId, companyId),
            eq(invoicesTable.counterpartyId, detectedCounterpartyId),
            eq(invoicesTable.type, documentType === "invoice_received" ? "received" : "issued"),
            inArray(invoicesTable.status, ["posted", "paid"]),
          ),
        )
        .orderBy(desc(invoicesTable.createdAt))
        .limit(500)
    : [];
  const uniqueBookingRows = new Map<string, SuggestionBookingRow>();
  for (const row of [...matchingBookings, ...scopedHistoryRows]) {
    const key = row.invoiceLineId
      ?? `${row.counterpartyId}:${row.accountCode}:${normalizeLineDescription(row.lineDescription)}`;
    uniqueBookingRows.set(key, row);
  }
  const actualPartnerHistory = [...uniqueBookingRows.values()];
  const fallbackHistoryCounts = new Map<number, number>();
  const modelLines = validatedModelLines.map((line, lineIndex) => {
    if (line.accountId || !documentType || !detectedCounterpartyId) return line;
    // A full 500-row window could hide another historical account, so it cannot
    // establish uniqueness and is deliberately not used for a deterministic fallback.
    if (scopedHistoryRows.length >= 500) return line;
    const sameDescriptionRows = actualPartnerHistory.filter(row =>
      row.counterpartyId === detectedCounterpartyId
      && normalizeLineDescription(row.lineDescription) === normalizeLineDescription(line.description),
    );
    const countsByAccount = new Map<string, { account: typeof accounts[number]; count: number }>();
    for (const row of sameDescriptionRows) {
      const account = row.accountId
        ? accounts.find(candidate => candidate.id === row.accountId)
        : accounts.find(candidate => candidate.code === row.accountCode);
      if (!account
        || !account.isActive
        || !account.allowsPosting
        || !isAccountCompatibleWithDocumentType(account, documentType)) continue;
      const existing = countsByAccount.get(account.id);
      countsByAccount.set(account.id, { account, count: (existing?.count ?? 0) + 1 });
    }
    if (countsByAccount.size !== 1) return line;
    const [{ account, count }] = countsByAccount.values();
    fallbackHistoryCounts.set(lineIndex, count);
    return {
      ...line,
      accountId: account.id,
      accountCode: account.code,
      suggestionSource: "history" as const,
      suggestionCount: count,
    };
  });

  // Resolve role and direction before associating a line with learned context.
  const enrichedLines = enrichLinesWithSuggestionSource(
    modelLines,
    detectedCounterpartyId,
    matchingTemplates,
    actualPartnerHistory,
  ).map((line, lineIndex) => {
    const historyCount = fallbackHistoryCounts.get(lineIndex);
    const resolvedLine = historyCount === undefined
      ? line
      : { ...line, suggestionSource: "history" as const, suggestionCount: historyCount };
    if (documentType !== "invoice_received" || partyResolution.correctedModelType) return resolvedLine;
    const asset = inferAssetCandidate(resolvedLine.description ?? "");
    if (!asset.candidate) return resolvedLine;
    // Suggested fixed-asset accounts must be active, directly postable OS 02/04
    // accounts. In particular, never retain a proposed 4* expense account.
    const prefix = asset.candidate === "REALESTATE" ? "02" : "04";
    const account = accounts.find(a =>
      a.code.startsWith(prefix) && a.isActive && a.allowsPosting,
    );
    return {
      ...resolvedLine,
      assetTypeCandidate: asset.candidate,
      assetTypeReason: asset.reason,
      assetTypeOriginalAccountCode: resolvedLine.accountCode ?? null,
      assetTypeOriginalAccountId: resolvedLine.accountId ?? null,
      accountCode: account?.code ?? undefined,
      accountId: account?.id ?? undefined,
      suggestionSource: "pattern" as const,
    };
  });
  const counterpartyTaxId = counterparty?.taxId ?? undefined;
  const euSupplier = documentType === "invoice_received" && isEuSupplierTaxId(counterpartyTaxId);
  const reverseChargeEvidence = /reverse charge|tax to be accounted for by the recipient|obrnjena davcna obveznost|obracun davka po 76\. clenu/i
    .test(parsed.rawText ?? rawText);
  const invoiceDate = parsed.invoiceDate?.slice(0, 10);
  const euVatCode = vatCodes.find(code =>
    code.code === "EUB22/95"
    && code.direction === "IN"
    && (!invoiceDate || code.validFrom <= invoiceDate)
    && (!invoiceDate || !code.validTo || code.validTo >= invoiceDate),
  );
  const expectedVatDirection = documentType === "invoice_received"
    ? "IN"
    : documentType === "invoice_issued"
      ? "OUT"
      : undefined;
  const vatEnrichedLines = enrichedLines.map(line => {
    const knownVatCode = line.vatCodeId
      ? vatCodes.find(code => code.id === line.vatCodeId)
      : undefined;
    const directionSafeLine = line.vatCodeId
      && (!expectedVatDirection || !knownVatCode || knownVatCode.direction !== expectedVatDirection)
      ? { ...line, vatCodeId: undefined, vatCodeReason: undefined }
      : line;
    const assetCandidate = documentType === "invoice_received"
      ? inferAssetCandidate(line.description ?? "").candidate
      : null;
    if (!euSupplier || (Number(directionSafeLine.vatRate) !== 0 && !assetCandidate)) return directionSafeLine;
    if (reverseChargeEvidence && euVatCode && Number(directionSafeLine.vatRate) === 0) return {
      ...directionSafeLine,
      vatCodeId: euVatCode.id,
      vatCodeReason: "EU DDV-ID, 0 % DDV in izrecna navedba obrnjene davčne obveznosti; predlagana je EUB22/95.",
    };
    return {
      ...directionSafeLine,
      vatCodeReviewRequired: true,
      vatCodeReviewReason: "Prepoznan je dobaviteljev EU DDV-ID oziroma osnovno sredstvo pri EU dobavitelju. Izberite veljavno vstopno kodo EUB pred ustvarjanjem računa.",
    };
  });

  return {
    rawText: parsed.rawText ?? rawText,
    confidence: parsed.confidence ?? 0,
    counterpartyName: counterparty?.name ?? undefined,
    counterpartyTaxId,
    counterpartyAddress: counterparty?.address ?? undefined,
    invoiceNumber: parsed.invoiceNumber ?? undefined,
    invoiceDate: parsed.invoiceDate ?? undefined,
    dueDate: parsed.dueDate ?? undefined,
    totalNet: parsed.totalNet ?? undefined,
    totalVat: parsed.totalVat ?? undefined,
    totalGross: parsed.totalGross ?? undefined,
    currency: parsed.currency ?? "EUR",
    lines: vatEnrichedLines,
    suggestedCounterpartyId: scopedCounterparty?.id,
    suggestedCounterpartyName: scopedCounterparty?.name ?? counterparty?.name ?? undefined,
    suggestedDocumentType: documentType as OcrDocumentType | undefined,
    suggestedPeriodId: undefined,
  };
}

/**
 * Async OCR: posodobi status na processing, pokliče Claude, shrani rezultat.
 * Napaka se shrani v errorMessage (dokument ne "pade" — računovodja vidi napako).
 */
async function processDocumentAsync(documentId: string, objectPath: string, mimeType: string, companyId: string): Promise<void> {
  try {
    await db.update(documentsTable).set({ status: "processing" }).where(eq(documentsTable.id, documentId));
    const ocrResult = await runOcrWithClaude(objectPath, mimeType, companyId);
    await db.update(documentsTable).set({
      status: ocrResult.error ? "error" : "done",
      ocrResult: ocrResult as any,
      errorMessage: ocrResult.error ?? null,
    }).where(eq(documentsTable.id, documentId));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(documentsTable).set({ status: "error", errorMessage: msg }).where(eq(documentsTable.id, documentId));
  }
}

// ─── GET /companies/:companyId/documents ──────────────────────────────────────
router.get(
  "/companies/:companyId/documents",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { status, limit = "50" } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [eq(documentsTable.companyId, companyId)];
    if (status) conditions.push(eq(documentsTable.status, status as any));

    const documents = await db
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .orderBy(desc(documentsTable.createdAt))
      .limit(Math.min(parseInt(limit ?? "50", 10), 200));

    res.json({ documents });
  },
);

// ─── POST /companies/:companyId/documents/register ────────────────────────────
router.post(
  "/companies/:companyId/documents/register",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { objectPath, fileName, mimeType, fileSizeBytes } = req.body as {
      objectPath: string; fileName: string; mimeType: string; fileSizeBytes?: number;
    };

    if (!objectPath || !fileName || !mimeType) {
      res.status(400).json({ error: "Polja objectPath, fileName in mimeType so obvezna" });
      return;
    }

    const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(mimeType)) {
      res.status(400).json({ error: `Nepodprt format. Dovoljeni: ${allowed.join(", ")}` });
      return;
    }

    // Preveri dejno velikost datoteke iz GCS metapodatkov — ne zaupamo vrednosti odjemalca
    const MAX_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? String(20 * 1024 * 1024), 10);
    const actualSizeBytes = await storage.getObjectEntitySizeBytes(objectPath);
    if (actualSizeBytes != null && actualSizeBytes > MAX_BYTES) {
      res.status(400).json({ error: `Datoteka je prevelika (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
      return;
    }

    // Prepričamo se, da objectPath še ni vezan na drug dokument (preprečimo ponovna vezava)
    const [existing] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(eq(documentsTable.objectPath, objectPath))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Dokument s to potjo že obstaja" });
      return;
    }

    const [doc] = await db.insert(documentsTable).values({
      companyId,
      objectPath,
      fileName,
      mimeType,
      fileSizeBytes: fileSizeBytes ?? null,
      status: "pending",
      uploadedByClerkId: authReq.clerkUserId,
    }).returning();

    res.status(201).json(doc);

    // Sproži OCR asinhrono (po odzivu)
    setImmediate(() => {
      processDocumentAsync(doc.id, objectPath, mimeType, companyId).catch(() => {});
    });
  },
);

// ─── GET /companies/:companyId/documents/:id ───────────────────────────────────
router.get(
  "/companies/:companyId/documents/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }

    const bankStatement = parseScannedBankStatement(doc.ocrResult?.rawText ?? "");
    if (bankStatement) {
      const partners = await db.select().from(counterpartiesTable).where(and(
        eq(counterpartiesTable.companyId, companyId), eq(counterpartiesTable.isActive, true),
      ));
      res.json({
        ...doc, bankStatement: {
          ...bankStatement,
          transactions: bankStatement.transactions.map(transaction => {
            const matches = partners.filter(partner => transaction.counterpartyIban
              && partner.iban?.replace(/\s/g, "").toUpperCase() === transaction.counterpartyIban);
            return { ...transaction, suggestedCounterpartyId: matches.length === 1 ? matches[0].id : undefined };
          }),
        },
        bankStatementDraft: doc.confirmedData?.bankStatementDraft,
      });
      return;
    }
    res.json(doc);
  },
);

router.post(
  "/companies/:companyId/documents/:id/confirm-bank",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za prenos izpiska potrebujete vlogo računovodja ali lastnik." });
      return;
    }
    try {
      const result = await createScannedBankDraft(companyId, extractParam(req.params.id),
        authReq.clerkUserId, await resolveActorLabel(authReq.clerkUserId), req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof BankDraftError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Izpisek je že v evidenci; ponovni prenos je preprečen." });
        return;
      }
      req.log.error({ err: error, companyId }, "Prenos skeniranega bančnega izpiska ni uspel");
      res.status(500).json({ error: "Prenos ni uspel. Nobena sprememba ni bila shranjena." });
    }
  },
);

// ─── GET /companies/:companyId/documents/:id/exchange-rate ─────────────────────
router.get(
  "/companies/:companyId/documents/:id/exchange-rate",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [doc] = await db.select({
      id: documentsTable.id,
      ocrResult: documentsTable.ocrResult,
    }).from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Dokument ni najden." } });
      return;
    }

    try {
      const queryValue = (value: unknown): unknown => Array.isArray(value) ? value[0] : value;
      const requestedDate = queryValue(req.query.date);
      assertRequestedInvoiceDate(requestedDate);
      const modeValue = queryValue(req.query.mode);
      const mode = modeValue == null ? "ecb" : modeValue;
      if (mode !== "ecb" && mode !== "manual") {
        throw new DocumentExchangeRateError("INVALID_MODE", "Način tečaja mora biti »ecb« ali »manual«.");
      }
      const treatmentValue = queryValue(req.query.vatTreatment);
      const vatTreatment = treatmentValue == null ? "standard" : treatmentValue;
      if (vatTreatment !== "standard" && vatTreatment !== "gross-expense-no-input-vat") {
        throw new DocumentExchangeRateError("INVALID_VAT_TREATMENT", "Neveljavna obravnava DDV za račun.");
      }

      const ocr = doc.ocrResult as OcrReviewResult | null;
      const currency = typeof ocr?.currency === "string" ? ocr.currency.trim().toUpperCase() : "EUR";
      if (currency !== "USD") {
        throw new DocumentExchangeRateError(
          "UNSUPPORTED_CURRENCY",
          `Pretvorba dokumentov iz valute ${currency} v EUR trenutno ni podprta. Podprt je USD.`,
          422,
        );
      }

      const sourceTotals: DocumentTotals = {
        net: ocr?.totalNet as number,
        vat: ocr?.totalVat as number,
        gross: ocr?.totalGross as number,
      };
      let rateDate: string;
      let unitsPerEur: number;
      let source: "ECB" | "manual";
      let sourceUrl: string | null;
      if (mode === "manual") {
        const requestedRateDate = queryValue(req.query.rateDate);
        rateDate = requestedRateDate == null ? requestedDate : requestedRateDate as string;
        assertValidRateDate(rateDate, requestedDate);
        const rawRate = queryValue(req.query.unitsPerEur);
        unitsPerEur = typeof rawRate === "string" && rawRate.trim() !== "" ? Number(rawRate) : Number.NaN;
        assertPositiveUnitsPerEur(unitsPerEur);
        source = "manual";
        sourceUrl = null;
      } else {
        const quote = await getEcbUsdEurQuote(requestedDate);
        rateDate = quote.rateDate;
        unitsPerEur = quote.unitsPerEur;
        source = quote.source;
        sourceUrl = quote.sourceUrl;
      }

      const converted = convertDocumentAmounts(
        (ocr?.lines ?? []).map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate,
          vatBase: line.vatBase,
          vatAmount: line.vatAmount,
        })),
        sourceTotals,
        unitsPerEur,
        vatTreatment as DocumentVatTreatment,
        currency,
      );
      res.json({
        mode: mode as ExchangeRateMode,
        vatTreatment,
        currency,
        targetCurrency: "EUR",
        requestedDate,
        rateDate,
        unitsPerEur,
        source,
        sourceUrl,
        ...converted,
      });
    } catch (error) {
      if (error instanceof DocumentExchangeRateError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  },
);

// ─── POST /companies/:companyId/documents/:id/confirm ─────────────────────────
router.post(
  "/companies/:companyId/documents/:id/confirm",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    try {
    const authReq = req as AuthenticatedRequest;

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za potrditev dokumenta potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [doc] = await db.select().from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }
    if (doc.status !== "done") {
      res.status(400).json({ error: `Dokument ni v stanju 'done' (trenutno: ${doc.status})` });
      return;
    }

    if (isScannedBankStatement(doc.ocrResult?.rawText ?? "")) {
      res.status(400).json({ error: "Bančni izpisek ni račun. Uporabite prenos v osnutek bančne temeljnice.", code: "BANK_STATEMENT_NOT_INVOICE" });
      return;
    }
    const {
      documentType,
      counterpartyId,
      periodId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      lines = [],
      createInvoice = false,
      arApAccountId,
      exchangeRate,
      vatTreatment: requestedVatTreatment,
      vatTreatmentReviewed,
    } = req.body as {
      documentType?: string;
      counterpartyId?: string;
      periodId?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      dueDate?: string;
      lines?: ProposedLine[];
      createInvoice?: boolean;
      arApAccountId?: string;
      vatTreatment?: DocumentVatTreatment;
      vatTreatmentReviewed?: boolean;
      exchangeRate?: {
        mode?: "ecb" | "manual";
        vatTreatment?: DocumentVatTreatment;
        requestedDate?: string;
        rateDate?: string;
        unitsPerEur?: number;
        reviewed?: boolean;
        manualReason?: string;
        sourceRoundingAdjustment?: SourceGrossRoundingAdjustment;
        expenseEurRoundingAdjustment?: ExpenseEurRoundingAdjustment;
      };
    };
    const ocrReview = doc.ocrResult as OcrReviewResult | null;
    const vatTreatment = requestedVatTreatment === undefined ? "standard" : requestedVatTreatment;
    if (vatTreatment !== "standard" && vatTreatment !== "gross-expense-no-input-vat") {
      res.status(400).json({ error: "Neveljavna obravnava DDV za račun.", code: "INVALID_VAT_TREATMENT" });
      return;
    }
    if (vatTreatment === "gross-expense-no-input-vat" && vatTreatmentReviewed !== true) {
      res.status(400).json({
        error: "Za bruto odhodek brez odbitka vstopnega DDV je potrebna izrecna potrditev računovodje.",
        code: "VAT_TREATMENT_REVIEW_REQUIRED",
      });
      return;
    }
    const sourceCurrency = typeof ocrReview?.currency === "string"
      ? ocrReview.currency.trim().toUpperCase()
      : "EUR";
    const effectiveDocumentType = documentType ?? ocrReview?.suggestedDocumentType ?? doc.documentType;
    if (vatTreatment === "gross-expense-no-input-vat") {
      if (createInvoice !== true) {
        res.status(400).json({
          error: "Bruto odhodek brez odbitka DDV je dovoljen samo ob ustvarjanju prejetega računa.",
          code: "VAT_TREATMENT_REQUIRES_INVOICE",
        });
        return;
      }
      if (effectiveDocumentType !== "invoice_received") {
        res.status(400).json({
          error: "Bruto odhodek brez odbitka DDV je dovoljen samo za prejeti račun.",
          code: "VAT_TREATMENT_RECEIVED_ONLY",
        });
        return;
      }
      if (sourceCurrency !== "EUR" && sourceCurrency !== "USD") {
        res.status(400).json({
          error: `Bruto odhodki iz valute ${sourceCurrency} v EUR niso podprti.`,
          code: "UNSUPPORTED_CURRENCY",
        });
        return;
      }
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "Dokument nima vrstic za kontiranje — dodajte vsaj eno vrstico." });
      return;
    }

    // Validacija: vse vrstice morajo imeti aktiven, knjižljiv konto iz kontnega
    // načrta tega podjetja. Skupinski konti (allowsPosting=false) so namenjeni
    // samo grupiranju v poročilih in jih ni dovoljeno neposredno knjižiti.
    const submittedLines = lines as Array<ProposedLine & {
      assetType?: "NONE" | "OTHER_FA" | "REALESTATE";
      assetTypeCandidate?: "OTHER_FA" | "REALESTATE";
      assetTypeReason?: string;
      assetTypeOriginalAccountCode?: string | null;
      assetTypeOriginalAccountId?: string | null;
      vatCodeId?: string | null;
      vatCodeFursId?: string;
      proposedFursVatCodeId?: string | null;
      vatCodeReason?: string;
      vatCodeReviewRequired?: boolean;
      vatCodeReviewReason?: string;
    }>;
    const ocrProposalLines = ocrReview?.lines ?? [];
    if (createInvoice && vatTreatment !== "gross-expense-no-input-vat") {
      for (const [index, proposed] of ocrProposalLines.entries()) {
        if (proposed.assetTypeCandidate) {
          const submitted = submittedLines[index];
          if (!submitted || submitted.assetType == null) {
            res.status(400).json({
              error: `Pred potrditvijo računa morate sprejeti ali zavrniti predlog osnovnega sredstva za vrstico ${index + 1}.`
            });
            return;
          }
          if (submitted.assetType !== "NONE" && submitted.assetType !== proposed.assetTypeCandidate) {
            res.status(400).json({ error: "Potrjena vrsta osnovnega sredstva ne ustreza predlogu OCR." });
            return;
          }
        }
        if (proposed.vatCodeReviewRequired && !submittedLines[index]?.vatCodeId) {
          res.status(400).json({
            error: proposed.vatCodeReviewReason ?? "Izberite veljavno vstopno DDV-kodo pred ustvarjanjem računa."
          });
          return;
        }
      }
    }
    // Preserve the server-generated proposal and VAT evidence for audit. These
    // metadata fields are not client-authoritative.
    submittedLines.forEach((line, index) => {
      const proposal = ocrProposalLines[index];
      if (proposal) {
        const selectedLine = inheritOmittedVatCodeSelection(line, proposal);
        if (selectedLine !== line) line.vatCodeId = selectedLine.vatCodeId;
        line.assetTypeCandidate = proposal.assetTypeCandidate;
        line.assetTypeReason = proposal.assetTypeReason;
        line.assetTypeOriginalAccountCode = proposal.assetTypeOriginalAccountCode;
        line.assetTypeOriginalAccountId = proposal.assetTypeOriginalAccountId;
        line.proposedFursVatCodeId = proposal.vatCodeId;
        if (proposal.vatCodeReason) line.vatCodeReason = proposal.vatCodeReason;
        if (proposal.vatCodeReviewRequired) {
          line.vatCodeReviewRequired = true;
          line.vatCodeReviewReason = proposal.vatCodeReviewReason;
        }
      }
      if (vatTreatment === "gross-expense-no-input-vat") {
        line.proposedFursVatCodeId = proposal?.vatCodeId ?? null;
        line.vatCodeId = null;
        line.vatCodeFursId = undefined;
        line.vatCodeReviewRequired = false;
        delete line.vatCodeReviewReason;
      }
    });
    for (const line of submittedLines) {
      if (line.assetType != null && !["NONE", "OTHER_FA", "REALESTATE"].includes(line.assetType)) {
        res.status(400).json({ error: "Neveljavna vrsta osnovnega sredstva na vrstici." });
        return;
      }
      if (
        createInvoice
        && vatTreatment !== "gross-expense-no-input-vat"
        && line.assetTypeCandidate
        && line.assetType == null
      ) {
        res.status(400).json({
          error: `Pred potrditvijo računa morate sprejeti ali zavrniti predlog osnovnega sredstva za vrstico »${line.description}«.`
        });
        return;
      }
      if (
        createInvoice
        && vatTreatment !== "gross-expense-no-input-vat"
        && line.vatCodeReviewRequired
        && !line.vatCodeId
      ) {
        res.status(400).json({
          error: line.vatCodeReviewReason ?? "Izberite veljavno vstopno DDV-kodo pred ustvarjanjem računa."
        });
        return;
      }
      if (
        createInvoice
        && vatTreatment !== "gross-expense-no-input-vat"
        && line.assetTypeCandidate
        && line.assetType !== "NONE"
        && line.assetType !== line.assetTypeCandidate
      ) {
        res.status(400).json({ error: "Potrjena vrsta osnovnega sredstva ne ustreza predlogu OCR." });
        return;
      }
    }
    const allLineAccountIds = submittedLines.map(l => l.accountId).filter((id): id is string => !!id);
    const missingAccountLines = submittedLines.filter(l => !l.accountId);
    if (missingAccountLines.length > 0) {
      res.status(400).json({
        error: `${missingAccountLines.length} ${missingAccountLines.length === 1 ? "vrstica nima" : "vrstice nimajo"} izbranega konta — pred potrditvijo izberite konto za vsako vrstico`
      });
      return;
    }
    if (allLineAccountIds.length > 0) {
      const uniqueLineAccountIds = [...new Set(allLineAccountIds)];
      const validAccounts = await db
        .select({
          id: accountsTable.id,
          code: accountsTable.code,
          type: accountsTable.type,
          isActive: accountsTable.isActive,
          allowsPosting: accountsTable.allowsPosting,
        })
        .from(accountsTable)
        .where(and(
          inArray(accountsTable.id, uniqueLineAccountIds),
          eq(accountsTable.companyId, companyId),
        ));
      const validation = validateDirectPostingAccounts(uniqueLineAccountIds, validAccounts);
      if (!validation.valid && validation.reason === "missing") {
        const missingIds = validation.accounts.map(account => account.id);
        res.status(400).json({
          error: `${missingIds.length} ${missingIds.length === 1 ? "konto ni najden" : "kontov ni najdenih"} v kontnem načrtu tega podjetja — preverite kontiranje pred potrditvijo`
        });
        return;
      }

      if (!validation.valid && validation.reason === "inactive") {
        const labels = validation.accounts.map(account => account.code).join(", ");
        res.status(400).json({
          error: `Konto ${labels} ni aktiven — izberite aktiven konto za direktno knjiženje`
        });
        return;
      }

      if (!validation.valid && validation.reason === "group") {
        const labels = validation.accounts.map(account => account.code).join(", ");
        res.status(400).json({
          error: `Konto ${labels} je skupinski — izberite analitični konto za direktno knjiženje`
        });
        return;
      }
      const acceptedAssetLines = createInvoice && vatTreatment !== "gross-expense-no-input-vat" ? submittedLines.filter(line =>
        line.assetType === "OTHER_FA" || line.assetType === "REALESTATE",
      ) : [];
      const accountById = new Map(validAccounts.map(account => [account.id, account]));
      if (vatTreatment === "gross-expense-no-input-vat") {
        const invalidExpenseLine = submittedLines.find(line =>
          !line.accountId || accountById.get(line.accountId)?.type !== "expense",
        );
        if (invalidExpenseLine) {
          res.status(400).json({
            error: `Bruto odhodek brez odbitka DDV zahteva aktiven, knjižljiv konto odhodkov za vrstico »${invalidExpenseLine.description}«.`,
            code: "GROSS_EXPENSE_ACCOUNT_REQUIRED",
          });
          return;
        }
        // Gross-expense treatment may clear an OCR asset proposal only after
        // every selected tenant account has been proven to be a postable expense.
        submittedLines.forEach(line => {
          line.assetType = "NONE";
          line.vatCodeId = null;
          line.vatCodeFursId = undefined;
        });
      }
      const invalidAssetAccount = acceptedAssetLines.find(line => {
        const code = line.accountId ? accountById.get(line.accountId)?.code : undefined;
        return !code || !/^(02|04)/.test(code) || /^4/.test(code);
      });
      if (invalidAssetAccount) {
        res.status(400).json({
          error: `Sprejeta vrstica osnovnega sredstva »${invalidAssetAccount.description}« mora imeti izbran knjižljiv konto OS iz skupine 02 ali 04.`
        });
        return;
      }
    }

    if (submittedLines.some(line =>
      line.vatCodeId !== undefined
      && line.vatCodeId !== null
      && typeof line.vatCodeId !== "string",
    )) {
      res.status(400).json({ error: "DDV-koda na vrstici ni veljaven identifikator." });
      return;
    }
    const requestedVatCodeIds = [...new Set(submittedLines
      .map(line => line.vatCodeId)
      .filter((codeId): codeId is string => typeof codeId === "string" && codeId.length > 0))];
    const fursVatCodesById = new Map<string, { code: string; direction: "IN" | "OUT"; validFrom: string; validTo: string | null }>();
    const invoiceVatDate = (invoiceDate ?? ocrReview?.invoiceDate ?? new Date().toISOString()).slice(0, 10);
    const expectedVatDirection = expectedDocumentVatDirection(
      createInvoice && effectiveDocumentType !== "invoice_issued"
        ? "invoice_received"
        : effectiveDocumentType,
    );
    if (requestedVatCodeIds.length > 0) {
      const [requestedVatCodes, companyVatCodes] = await Promise.all([
        db.select({
          id: vatCodeTable.id,
          code: vatCodeTable.code,
          direction: vatCodeTable.direction,
          rate: vatCodeTable.rate,
          validFrom: vatCodeTable.validFrom,
          validTo: vatCodeTable.validTo,
          isReverseCharge: vatCodeTable.isReverseCharge,
        })
          .from(vatCodeTable)
          .where(inArray(vatCodeTable.id, requestedVatCodeIds)),
        db.select({
          id: vatCodesTable.id,
          companyId: vatCodesTable.companyId,
          fursCodeId: vatCodesTable.fursCodeId,
          rate: vatCodesTable.rate,
          behavior: vatCodesTable.behavior,
          validFrom: vatCodesTable.validFrom,
          validTo: vatCodesTable.validTo,
          isActive: vatCodesTable.isActive,
        })
          .from(vatCodesTable)
          .where(and(
            eq(vatCodesTable.companyId, companyId),
            inArray(vatCodesTable.fursCodeId, requestedVatCodeIds),
          )),
      ]);
      for (const code of requestedVatCodes) fursVatCodesById.set(code.id, code);
      const mapping = resolveDocumentVatCodeMappings(
        requestedVatCodeIds,
        requestedVatCodes,
        companyVatCodes,
        companyId,
        invoiceVatDate,
        expectedVatDirection,
      );
      if (mapping.error) {
        const failedId = mapping.error.fursCodeId;
        const fursCode = requestedVatCodes.find(code => code.id === failedId);
        const codeLabel = fursCode?.code ?? failedId;
        const error = mapping.error.kind === "wrong_direction"
          ? `DDV-koda ${codeLabel} (${failedId}) nima ustrezne smeri za ${mapping.error.expected === "OUT" ? "izdani" : "prejeti"} račun.`
          : mapping.error.kind === "invalid_furs_date"
            ? `DDV-koda ${codeLabel} (${failedId}) ni veljavna na datum računa.`
            : mapping.error.kind === "ambiguous_company_mapping"
              ? `DDV-koda ${codeLabel} (${failedId}) ima več veljavnih povezav v Nastavitve > DDV kode. Uredite šifrant podjetja.`
              : `DDV-koda ${codeLabel} (${failedId}) nima enolične aktivne, datumom veljavne povezave v Nastavitve > DDV kode. Preverite FURS povezavo, stopnjo, vrsto, aktivnost in veljavnost kode.`;
        res.status(400).json({ error });
        return;
      }
      for (const line of submittedLines) {
        if (typeof line.vatCodeId !== "string" || line.vatCodeId.length === 0) continue;
        line.vatCodeFursId = line.vatCodeId;
        line.vatCodeId = mapping.mappings.get(line.vatCodeId)!;
      }
    }

    let confirmedLines: typeof submittedLines = submittedLines;
    let exchangeAudit: Record<string, unknown> | undefined;
    let convertedBookingTotals: DocumentTotals | undefined;
    let sourceRoundingAdjustment: SourceGrossRoundingAdjustment | undefined;
    let expenseEurRoundingAdjustment: ExpenseEurRoundingAdjustment | undefined;
    if (createInvoice && sourceCurrency !== "EUR") {
      if (sourceCurrency !== "USD") {
        res.status(400).json({
          error: `Pretvorba iz valute ${sourceCurrency} v EUR ni podprta; račun ni bil ustvarjen in dokument ostaja nespremenjen.`,
          code: "UNSUPPORTED_CURRENCY",
        });
        return;
      }
      if (!invoiceDate) {
        res.status(400).json({
          error: "Za ustvarjanje osnutka računa so obvezni partner, obračunsko obdobje in datum računa.",
          code: "MISSING_INVOICE_DATE",
        });
        return;
      }

      try {
        assertRequestedInvoiceDate(invoiceDate);
        if (!exchangeRate || exchangeRate.reviewed !== true) {
          throw new DocumentExchangeRateError(
            "EXCHANGE_RATE_REVIEW_REQUIRED",
            "Pred ustvarjanjem EUR-osnutka morate pregledati in izrecno potrditi tečaj.",
          );
        }
        if ((exchangeRate.vatTreatment ?? "standard") !== vatTreatment) {
          throw new DocumentExchangeRateError(
            "STALE_VAT_TREATMENT_QUOTE",
            "Pregledani predogled ne ustreza izbrani obravnavi DDV. Pridobite in preglejte nov predogled.",
          );
        }
        if (exchangeRate.mode !== "ecb" && exchangeRate.mode !== "manual") {
          throw new DocumentExchangeRateError("INVALID_MODE", "Način tečaja mora biti »ecb« ali »manual«.");
        }
        if (exchangeRate.requestedDate !== invoiceDate) {
          throw new DocumentExchangeRateError(
            "STALE_EXCHANGE_RATE_DATE",
            "Tečaj je bil pridobljen za drug datum računa. Pridobite in preglejte tečaj za trenutni datum računa.",
          );
        }

        const originalLines = ocrReview?.lines ?? [];
        assertSubmittedSourceAmountsMatchOcr(originalLines, submittedLines);

        let authoritativeRateDate: string;
        let authoritativeUnitsPerEur: number;
        let exchangeSource: "ECB" | "manual";
        let exchangeSourceUrl: string | null;
        let manualReason: string | undefined;
        if (exchangeRate.mode === "manual") {
          assertValidRateDate(exchangeRate.rateDate, invoiceDate);
          assertPositiveUnitsPerEur(exchangeRate.unitsPerEur);
          manualReason = typeof exchangeRate.manualReason === "string"
            ? exchangeRate.manualReason.trim()
            : "";
          if (manualReason.length < 3 || manualReason.length > 500) {
            throw new DocumentExchangeRateError(
              "MANUAL_REASON_REQUIRED",
              "Za ročni tečaj navedite razlog dolžine od 3 do 500 znakov.",
            );
          }
          authoritativeRateDate = exchangeRate.rateDate;
          authoritativeUnitsPerEur = exchangeRate.unitsPerEur;
          exchangeSource = "manual";
          exchangeSourceUrl = null;
        } else {
          const quote = await getEcbUsdEurQuote(invoiceDate);
          if (
            exchangeRate.rateDate !== quote.rateDate
            || typeof exchangeRate.unitsPerEur !== "number"
            || !Number.isFinite(exchangeRate.unitsPerEur)
            || Math.abs(exchangeRate.unitsPerEur - quote.unitsPerEur) > 1e-12
          ) {
            throw new DocumentExchangeRateError(
              "STALE_ECB_QUOTE",
              "Pregledani tečaj ECB se je spremenil ali ni več aktualen. Pridobite in preglejte trenutni tečaj.",
            );
          }
          authoritativeRateDate = quote.rateDate;
          authoritativeUnitsPerEur = quote.unitsPerEur;
          exchangeSource = quote.source;
          exchangeSourceUrl = quote.sourceUrl;
        }

        const converted = convertDocumentAmounts(
          originalLines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            vatBase: line.vatBase,
            vatAmount: line.vatAmount,
          })),
          {
            net: ocrReview?.totalNet as number,
            vat: ocrReview?.totalVat as number,
            gross: ocrReview?.totalGross as number,
          },
          authoritativeUnitsPerEur,
          vatTreatment,
          sourceCurrency,
        );
        if (!sameSourceGrossAdjustment(
          exchangeRate.sourceRoundingAdjustment,
          converted.sourceRoundingAdjustment,
        )) {
          throw new DocumentExchangeRateError(
            "STALE_SOURCE_ROUNDING_ADJUSTMENT",
            "Predogled prilagoditve bruto zneska se ne ujema z izvirnikom. Pridobite in preglejte nov predogled.",
          );
        }
        if (!sameExpenseEurAdjustment(
          exchangeRate.expenseEurRoundingAdjustment,
          converted.expenseEurRoundingAdjustment,
        )) {
          throw new DocumentExchangeRateError(
            "STALE_EUR_GROSS_ROUNDING_ADJUSTMENT",
            "Predogled uskladitve bruto zneska v EUR se ne ujema z izvirnikom. Pridobite in preglejte nov predogled.",
          );
        }
        confirmedLines = submittedLines.map((line, index) => ({
          ...line,
          ...converted.convertedLines[index],
        }));
        convertedBookingTotals = converted.eurTotals;
        sourceRoundingAdjustment = converted.sourceRoundingAdjustment;
        expenseEurRoundingAdjustment = converted.expenseEurRoundingAdjustment;
        exchangeAudit = {
          mode: exchangeRate.mode,
          vatTreatment,
          sourceCurrency,
          targetCurrency: "EUR",
          requestedDate: exchangeRate.requestedDate,
          rateDate: authoritativeRateDate,
          unitsPerEur: authoritativeUnitsPerEur,
          source: exchangeSource,
          sourceUrl: exchangeSourceUrl,
          reviewed: true,
          request: {
            mode: exchangeRate.mode,
            vatTreatment,
            requestedDate: exchangeRate.requestedDate,
            rateDate: exchangeRate.rateDate,
            unitsPerEur: exchangeRate.unitsPerEur,
            reviewed: true,
            ...(manualReason ? { manualReason } : {}),
          },
          quote: {
            vatTreatment,
            rateDate: authoritativeRateDate,
            unitsPerEur: authoritativeUnitsPerEur,
            source: exchangeSource,
            sourceUrl: exchangeSourceUrl,
            ...(converted.sourceRoundingAdjustment
              ? { sourceRoundingAdjustment: converted.sourceRoundingAdjustment }
              : {}),
            ...(converted.expenseEurRoundingAdjustment
              ? { expenseEurRoundingAdjustment: converted.expenseEurRoundingAdjustment }
              : {}),
          },
          sourceTotals: converted.sourceTotals,
          eurTotals: converted.eurTotals,
          ...(converted.sourceRoundingAdjustment
            ? { sourceRoundingAdjustment: converted.sourceRoundingAdjustment }
            : {}),
          ...(converted.expenseEurRoundingAdjustment
            ? { expenseEurRoundingAdjustment: converted.expenseEurRoundingAdjustment }
            : {}),
          roundingDifference: converted.roundingDifference,
          convertedAt: new Date().toISOString(),
          ...(manualReason ? { manualReason } : {}),
        };
      } catch (error) {
        if (error instanceof DocumentExchangeRateError) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        throw error;
      }
    } else if (
      createInvoice
      && vatTreatment === "gross-expense-no-input-vat"
      && sourceCurrency === "EUR"
    ) {
      try {
        const originalLines = ocrReview?.lines ?? [];
        assertSubmittedSourceAmountsMatchOcr(originalLines, submittedLines);
        const converted = convertDocumentAmounts(
          originalLines.map(line => ({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            vatBase: line.vatBase,
            vatAmount: line.vatAmount,
          })),
          {
            net: ocrReview?.totalNet as number,
            vat: ocrReview?.totalVat as number,
            gross: ocrReview?.totalGross as number,
          },
          1,
          vatTreatment,
        );
        confirmedLines = submittedLines.map((line, index) => ({
          ...line,
          ...converted.convertedLines[index],
        }));
        convertedBookingTotals = converted.eurTotals;
        sourceRoundingAdjustment = converted.sourceRoundingAdjustment;
        expenseEurRoundingAdjustment = converted.expenseEurRoundingAdjustment;
      } catch (error) {
        if (error instanceof DocumentExchangeRateError) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        throw error;
      }
    }

    // Sestavi confirmedData iz OCR + popravkov računovodje
    const base = doc.ocrResult ?? { rawText: "", confidence: 0, lines: [] };
    const confirmedData = {
      ...base,
      invoiceNumber: invoiceNumber ?? base.invoiceNumber,
      invoiceDate: invoiceDate ?? base.invoiceDate,
      dueDate: dueDate ?? base.dueDate,
      currency: createInvoice && sourceCurrency !== "EUR" ? "EUR" : sourceCurrency,
      vatTreatment,
      ...(vatTreatment === "gross-expense-no-input-vat"
        ? { vatTreatmentReviewed: true }
        : {}),
      ...(sourceRoundingAdjustment ? { sourceRoundingAdjustment } : {}),
      ...(expenseEurRoundingAdjustment ? { expenseEurRoundingAdjustment } : {}),
      lines: confirmedLines,
      suggestedCounterpartyId: counterpartyId ?? base.suggestedCounterpartyId,
      suggestedPeriodId: periodId ?? base.suggestedPeriodId,
      suggestedDocumentType: (documentType as OcrResult["suggestedDocumentType"]) ?? base.suggestedDocumentType,
      ...(exchangeAudit ? {
        sourceCurrency,
        exchangeRate: exchangeAudit,
        totalNet: (exchangeAudit.eurTotals as DocumentTotals).net,
        totalVat: (exchangeAudit.eurTotals as DocumentTotals).vat,
        totalGross: (exchangeAudit.eurTotals as DocumentTotals).gross,
      } : convertedBookingTotals ? {
        sourceCurrency,
        totalNet: convertedBookingTotals.net,
        totalVat: convertedBookingTotals.vat,
        totalGross: convertedBookingTotals.gross,
      } : { sourceCurrency }),
    } as OcrResult & {
      sourceCurrency?: string;
      exchangeRate?: Record<string, unknown>;
      vatTreatment?: DocumentVatTreatment;
      vatTreatmentReviewed?: boolean;
      sourceRoundingAdjustment?: SourceGrossRoundingAdjustment;
      expenseEurRoundingAdjustment?: ExpenseEurRoundingAdjustment;
    };

    let linkedInvoiceId: string | null = null;
    let updated: typeof doc | undefined;
    const confirmedBy = await resolveActorLabel(authReq.clerkUserId);

    // Ustvari draft račun (opcijsko)
    if (createInvoice && (!counterpartyId || !periodId || !invoiceDate)) {
      res.status(400).json({
        error: "Za ustvarjanje osnutka računa iz dokumenta so obvezni partner, obračunsko obdobje in datum računa."
      });
      return;
    }
    if (createInvoice && counterpartyId && periodId && invoiceDate) {
      const effectiveInvoiceNumber = invoiceNumber ?? base.invoiceNumber;
      if (!effectiveInvoiceNumber) {
        res.status(400).json({ error: "Za ustvarjanje prejetega računa je številka dobaviteljeve listine obvezna" });
        return;
      }
      // Validacija partnerja in obdobja
      const [cp] = await db.select({ id: counterpartiesTable.id, taxId: counterpartiesTable.taxId })
        .from(counterpartiesTable)
        .where(and(eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId)))
        .limit(1);
      if (!cp) { res.status(400).json({ error: "Partner ni najden" }); return; }
      const isEuSupplier = effectiveDocumentType !== "invoice_issued"
        && (isEuSupplierTaxId(cp.taxId) || isEuSupplierTaxId(ocrReview?.counterpartyTaxId));
      if (isEuSupplier) {
        const missingEubLine = submittedLines.find(line => {
          if (line.assetType !== "OTHER_FA" && line.assetType !== "REALESTATE") return false;
          const fursCodeId = line.vatCodeFursId ?? line.vatCodeId;
          return !fursCodeId || !fursVatCodesById.get(fursCodeId)?.code.startsWith("EUB");
        });
        if (missingEubLine) {
          res.status(400).json({
            error: `EU dobaviteljev račun zahteva veljavno vstopno EUB-kodo na vsaki sprejeti vrstici osnovnega sredstva (${missingEubLine.description}). Izberite EUB kodo ali zavrnite predlog osnovnega sredstva.`
          });
          return;
        }
      }

      const [period] = await db.select({ id: accountingPeriodsTable.id })
        .from(accountingPeriodsTable)
        .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
        .limit(1);
      if (!period) { res.status(400).json({ error: "Obdobje ni najdeno" }); return; }

      // Vrstice so bile že validirane zgoraj. Ta preverba ostane kot obramba
      // pred uporabo kontov iz kakšnega prihodnjega privzetega vira.
      const lineAccountIds = [...new Set((lines ?? []).filter(l => l.accountId).map((l) => l.accountId as string))];
      if (lineAccountIds.length > 0) {
        const validLineAccounts = await db
          .select({
            id: accountsTable.id,
            code: accountsTable.code,
            isActive: accountsTable.isActive,
            allowsPosting: accountsTable.allowsPosting,
          })
          .from(accountsTable)
          .where(and(
            inArray(accountsTable.id, lineAccountIds),
            eq(accountsTable.companyId, companyId),
          ));
        const validation = validateDirectPostingAccounts(lineAccountIds, validLineAccounts);
        if (!validation.valid) {
          const message = validation.reason === "group"
            ? "Eden ali več kontov vrstic je skupinskih — izberite analitične konte za direktno knjiženje"
            : validation.reason === "inactive"
              ? "Eden ali več kontov vrstic ni aktivnih — izberite aktivne konte za direktno knjiženje"
              : "Eden ali več kontov vrstic ne pripada temu podjetju";
          res.status(400).json({ error: message });
          return;
        }
      }

      const invType = effectiveDocumentType === "invoice_issued" ? "issued" : "received";

      // Poišči privzete AR/AP konto (120 za izdane, 220 za prejete) če ni podan
      const arApPrefix = invType === "issued" ? "120" : isEuSupplier ? "221" : "220";
      const revenuePrefix = invType === "issued" ? "760" : "400";

      const [resolvedArApAccount] = isEuSupplier
        ? await db.select({ id: accountsTable.id, code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
            .from(accountsTable)
            .where(and(
              eq(accountsTable.companyId, companyId),
              eq(accountsTable.code, "2210000"),
              eq(accountsTable.isActive, true),
              eq(accountsTable.allowsPosting, true),
            ))
            .limit(1)
        : arApAccountId
        ? await db.select({ id: accountsTable.id, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
            .from(accountsTable)
            .where(and(
              eq(accountsTable.id, arApAccountId),
              eq(accountsTable.companyId, companyId),
              eq(accountsTable.isActive, true),
              eq(accountsTable.allowsPosting, true),
            ))
            .limit(1)
        : await db.select({ id: accountsTable.id, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
            .from(accountsTable)
            .where(and(
              eq(accountsTable.companyId, companyId),
              eq(accountsTable.isActive, true),
              eq(accountsTable.allowsPosting, true),
              sql`${accountsTable.code} LIKE ${arApPrefix + "%"}`,
            ))
            .orderBy(asc(accountsTable.code))
            .limit(1);

      if (!resolvedArApAccount) {
        res.status(400).json({
          error: isEuSupplier
            ? "EU dobaviteljevemu računu ni mogoče ustvariti osnutka: manjka aktiven, knjižljiv konto 2210000 v kontnem načrtu podjetja."
            : `Privzeti AR/AP konto (${arApPrefix}*) ni najden — ročno izberite konto terjatev/obveznosti`
        });
        return;
      }

      // Poišči privzet prihodkovni/stroškovni konto za vrstice
      const [defaultAccount] = await db.select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
          sql`${accountsTable.code} LIKE ${revenuePrefix + "%"}`,
        ))
        .orderBy(asc(accountsTable.code))
        .limit(1);

      try {
        const transactionResult = await db.transaction(async (tx) => {
        const [claimedDocument] = await tx.update(documentsTable)
          .set({
            status: "confirmed",
            documentType: (documentType ?? doc.documentType) as any,
            confirmedData: confirmedData as any,
            confirmedBy,
          })
          .where(and(
            eq(documentsTable.id, id),
            eq(documentsTable.companyId, companyId),
            eq(documentsTable.status, "done"),
          ))
          .returning({ id: documentsTable.id });
        if (!claimedDocument) throw new Error("DOCUMENT_ALREADY_CONFIRMED");

        const sourceDocumentId = invType === "received"
          ? await claimPurchaseSourceDocument(tx, {
              companyId,
              counterpartyId,
              kind: "invoice",
              documentNumber: effectiveInvoiceNumber,
              documentDate: invoiceDate,
              currency: confirmedData.currency,
            })
          : null;

        const [inv] = await tx.insert(invoicesTable).values({
          companyId,
          type: invType as any,
          counterpartyId,
          periodId,
          invoiceNumber: effectiveInvoiceNumber,
          invoiceDate: invoiceDate as string,
          dueDate: (dueDate ?? null) as string | null,
          status: "draft",
          // Reviewed FX amounts, not rounded unit-price multiplication, are authoritative.
          ...(vatTreatment === "gross-expense-no-input-vat"
            ? { sourceType: "ai-document-gross-expense" }
            : exchangeAudit
              ? { sourceType: "ai-document-fx" }
              : {}),
          arApAccountId: resolvedArApAccount.id,
          createdBy: authReq.clerkUserId,
          notes: `Ustvarjeno iz dokumenta: ${doc.fileName}`,
          sourceDocumentId,
        } as any).returning({ id: invoicesTable.id });

        // Ustvari vrstice
        for (let i = 0; i < confirmedData.lines.length; i++) {
          const line = confirmedData.lines[i];
          const acctId = line.accountId ?? defaultAccount?.id;
          if (!acctId) continue;

          await tx.insert(invoiceLinesTable).values({
            invoiceId: inv.id,
            description: line.description,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            vatRate: String(line.vatRate),
            vatBase: String(line.vatBase),
            vatAmount: String(line.vatAmount),
            accountId: acctId,
            assetType: line.assetType ?? "NONE",
            ...(line.vatCodeId ? { vatCodeId: line.vatCodeId } : {}),
            sequence: i,
          } as any);
        }
        const [savedDocument] = await tx.update(documentsTable)
          .set({ linkedInvoiceId: inv.id, sourceDocumentId })
          .where(eq(documentsTable.id, id))
          .returning();
        return { invoiceId: inv.id, document: savedDocument };
        });
        linkedInvoiceId = transactionResult.invoiceId;
        updated = transactionResult.document;
      } catch (error: any) {
        if (
          error?.message === "DOCUMENT_ALREADY_CONFIRMED"
          || error?.cause?.code === "23505"
          || error?.code === "23505"
          || error?.code === "LEGACY_PURCHASE_SOURCE_CONFLICT"
        ) {
          res.status(409).json({
            error: "Ta nabavna listina je že potrjena ali že zajeta kot prejeti račun",
          });
          return;
        }
        throw error;
      }
    }

    if (!updated) {
      [updated] = await db.update(documentsTable).set({
        status: "confirmed",
        documentType: (documentType ?? doc.documentType) as any,
        confirmedData: confirmedData as any,
        linkedInvoiceId,
        confirmedBy,
      }).where(and(
        eq(documentsTable.id, id),
        eq(documentsTable.companyId, companyId),
        eq(documentsTable.status, "done"),
      )).returning();
      if (!updated) {
        res.status(409).json({ error: "Dokument je bil medtem že potrjen" });
        return;
      }
    }

    // ── Upsert predlog kontiranja po partnerju ──────────────────────────────
    // Ob vsaki potrditvi shranimo par (partner + konto) za vsako vrstico.
    // Ob naslednjem dokumentu istega partnerja se ti pari predlagajo pred AI.
    if (counterpartyId && confirmedData.lines.length > 0) {
      const docTypeKey = confirmedData.suggestedDocumentType ?? documentType ?? "invoice_received";
      // Zberi unikatne accountId-je iz vrstic
      const lineAccountPairs = confirmedData.lines
        .filter((l) => l.accountId)
        .reduce<Map<string, string>>((acc, l) => {
          if (!acc.has(l.accountId!)) acc.set(l.accountId!, l.description ?? "");
          return acc;
        }, new Map());

      if (lineAccountPairs.size > 0) {
        try {
          await Promise.all(
            Array.from(lineAccountPairs.entries()).map(([acctId, desc]) =>
              db
                .insert(counterpartyAccountTemplatesTable)
                .values({
                  companyId,
                  counterpartyId,
                  accountId: acctId,
                  documentType: docTypeKey,
                  lastLineDescription: desc || null,
                  usageCount: 1,
                  lastUsedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [
                    counterpartyAccountTemplatesTable.companyId,
                    counterpartyAccountTemplatesTable.counterpartyId,
                    counterpartyAccountTemplatesTable.accountId,
                    counterpartyAccountTemplatesTable.documentType,
                  ],
                  set: {
                    usageCount: sql`${counterpartyAccountTemplatesTable.usageCount} + 1`,
                    lastLineDescription: desc || null,
                    lastUsedAt: new Date(),
                  },
                }),
            ),
          );
        } catch (error) {
          req.log?.warn(
            { err: error, companyId, documentId: id, invoiceId: linkedInvoiceId },
            "Dokument potrjen, vendar posodobitev predlog kontiranja ni uspela",
          );
        }
      }
    }

    res.json(updated);
    } catch (error) {
      req.log?.error({ err: error, companyId, documentId: id }, "Nepričakovana napaka pri potrditvi dokumenta");
      if (!res.headersSent) {
        res.status(500).json({ error: "Potrditev dokumenta ni uspela zaradi nepričakovane napake." });
      }
    }
  },
);

// ─── POST /companies/:companyId/documents/:id/reject ──────────────────────────
router.post(
  "/companies/:companyId/documents/:id/reject",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za zavrnitev dokumenta potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [doc] = await db.select({ id: documentsTable.id, companyId: documentsTable.companyId })
      .from(documentsTable)
      .where(and(eq(documentsTable.id, id), eq(documentsTable.companyId, companyId)))
      .limit(1);
    if (!doc) { res.status(404).json({ error: "Dokument ni najden" }); return; }

    const rejectedBy = await resolveActorLabel(authReq.clerkUserId);
    const [updated] = await db.update(documentsTable).set({ status: "rejected", rejectedBy })
      .where(eq(documentsTable.id, id)).returning();

    res.json(updated);
  },
);

export default router;
