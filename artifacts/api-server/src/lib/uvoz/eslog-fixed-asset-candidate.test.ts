import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { postavkaSchema, prazenDto } from "./dto";
import { inferEslogFixedAssetCandidate } from "./eslog-fixed-asset-candidate";

describe("inferEslogFixedAssetCandidate", () => {
  it("only surfaces explicit asset-like lines on EU cross-border invoices", () => {
    const dto = prazenDto();
    dto.vrstaDokumenta = "RACUN";
    dto.dobaviteljDrzava = "DE";
    dto.postavke.push(postavkaSchema.parse({
      zap: 1, izvNaziv: "Laptop Dell Latitude", izvKolicina: new Decimal(1),
      izvCena: new Decimal(900), izvVrednost: new Decimal(900), ddvOsnova: new Decimal(900),
    }));
    dto.postavke.push(postavkaSchema.parse({
      zap: 2, izvNaziv: "Monthly support service", izvKolicina: new Decimal(1),
      izvCena: new Decimal(50), izvVrednost: new Decimal(50), ddvOsnova: new Decimal(50),
    }));

    expect(inferEslogFixedAssetCandidate(dto, true)?.lines).toEqual([
      expect.objectContaining({ sequence: 1, suggestedAssetType: "OTHER_FA" }),
    ]);
    expect(inferEslogFixedAssetCandidate(dto, false)).toBeNull();
  });

  it("does not infer domestic, non-invoice, or ambiguous ordinary purchases", () => {
    const dto = prazenDto();
    dto.dobaviteljDrzava = "SI";
    dto.postavke.push(postavkaSchema.parse({
      zap: 1, izvNaziv: "oprema", izvKolicina: "1", izvCena: "1",
    }));
    expect(inferEslogFixedAssetCandidate(dto, true)).toBeNull();
    dto.dobaviteljDrzava = "AT";
    dto.vrstaDokumenta = "DOBAVNICA";
    expect(inferEslogFixedAssetCandidate(dto, true)).toBeNull();
  });

  it("normalizes source-language accents when identifying real estate", () => {
    const dto = prazenDto();
    dto.vrstaDokumenta = "RACUN";
    dto.dobaviteljIdDdv = "ATU12345678";
    dto.postavke.push(postavkaSchema.parse({
      zap: 3, izvNaziv: "Kauf einer Immobilie", izvKolicina: "1", izvCena: "100000",
    }));

    expect(inferEslogFixedAssetCandidate(dto, true)?.lines[0]).toEqual(
      expect.objectContaining({ sequence: 3, suggestedAssetType: "REALESTATE" }),
    );
  });
});