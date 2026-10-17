import type { PrejemDTO } from "./dto";

export type FixedAssetType = "OTHER_FA" | "REALESTATE";

export interface FixedAssetCandidateLine {
  sequence: number;
  description: string;
  suggestedAssetType: FixedAssetType;
  sourceAmount: string | null;
}

export interface FixedAssetCandidate {
  supplierCountry: string;
  lines: FixedAssetCandidateLine[];
}

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
]);

const REAL_ESTATE_TERMS =
  /\b(land|grundstuck\w*|building|gebaude\w*|nepremicn\w*|immobilie\w*|real estate|real-estate|property)\b/i;
const FIXED_ASSET_TERMS =
  /\b(anlagevermogen|anlagegut\w*|investitionsgut\w*|sachanlagen|maschine\w*|machinery|machine|equipment|oprem\w*|computer|notebook|laptop|server|fahrzeug\w*|vehicle|device|gerat\w*)\b/i;

/**
 * A deliberately narrow source-text hint, never an accounting decision.
 * Only EU cross-border e-SLOG invoices are surfaced for human review.
 */
export function inferEslogFixedAssetCandidate(
  dto: PrejemDTO,
  isEslogInvoice: boolean,
): FixedAssetCandidate | null {
  if (!isEslogInvoice || dto.vrstaDokumenta !== "RACUN") return null;
  const supplierCountry = (dto.dobaviteljDrzava ?? dto.dobaviteljIdDdv?.slice(0, 2) ?? "")
    .trim()
    .toUpperCase();
  if (!EU_COUNTRIES.has(supplierCountry) || supplierCountry === "SI") return null;

  const lines = dto.postavke.flatMap((line) => {
    const description = line.izvNaziv.trim();
    if (!description) return [];
    const normalizedDescription = description
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const assetType: FixedAssetType | null = REAL_ESTATE_TERMS.test(normalizedDescription)
      ? "REALESTATE"
      : FIXED_ASSET_TERMS.test(normalizedDescription)
        ? "OTHER_FA"
        : null;
    if (!assetType) return [];
    return [{
      sequence: line.zap,
      description,
      suggestedAssetType: assetType,
      sourceAmount: line.ddvOsnova?.toString() ?? line.izvVrednost?.toString() ?? null,
    }];
  });
  return lines.length ? { supplierCountry, lines } : null;
}