export const NORMATIVE_PROPOSAL_DRAFT_KEY = "pos_normative_proposal_draft_v1";
const VERSION = 1;
const MAX_AGE_MS = 30 * 60 * 1000;

export type ProposalRow = {
  normativRowId: number;
  proposalToken: string;
  ingredientName: string;
  oldQuantity: number;
  newQuantity: number;
  unit: string | null;
  sourceTitle: string;
  sourceUrl: string;
};

export type NormativeProposalDraft = {
  version: 1;
  artikelId: number;
  targetName: string;
  generatedAt: string;
  selected: ProposalRow[];
};

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function isValidProposalDraft(value: unknown): value is NormativeProposalDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NormativeProposalDraft>;
  return draft.version === VERSION && typeof draft.artikelId === "number" && Number.isInteger(draft.artikelId) && draft.artikelId > 0
    && isString(draft.targetName) && isString(draft.generatedAt) && !Number.isNaN(Date.parse(draft.generatedAt))
    && Array.isArray(draft.selected) && draft.selected.length > 0
    && draft.selected.every(row => row && Number.isInteger(row.normativRowId) && row.normativRowId > 0
      && isString(row.proposalToken) && isString(row.ingredientName)
      && isFiniteNumber(row.oldQuantity) && isFiniteNumber(row.newQuantity)
      && (row.unit === null || typeof row.unit === "string")
      && isString(row.sourceTitle) && isSafeSourceUrl(row.sourceUrl));
}

export function isSafeSourceUrl(url: unknown): url is string {
  if (!isString(url)) return false;
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

export function readProposalDraft(storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): NormativeProposalDraft | null {
  const raw = storage.getItem(NORMATIVE_PROPOSAL_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidProposalDraft(parsed) || Date.now() - Date.parse(parsed.generatedAt) > MAX_AGE_MS) {
      storage.removeItem(NORMATIVE_PROPOSAL_DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(NORMATIVE_PROPOSAL_DRAFT_KEY);
    return null;
  }
}

export function saveProposalDraft(draft: NormativeProposalDraft, storage: Pick<Storage, "setItem"> = sessionStorage): void {
  if (!isValidProposalDraft(draft)) throw new Error("Neveljaven predlog normativa.");
  storage.setItem(NORMATIVE_PROPOSAL_DRAFT_KEY, JSON.stringify(draft));
}

export function clearProposalDraft(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  storage.removeItem(NORMATIVE_PROPOSAL_DRAFT_KEY);
}

export function chooseOneProposal(selected: ProposalRow[], proposal: ProposalRow): ProposalRow[] {
  const withoutSameRow = selected.filter(item => item.normativRowId !== proposal.normativRowId);
  return selected.some(item => item.proposalToken === proposal.proposalToken) ? withoutSameRow : [...withoutSameRow, proposal];
}