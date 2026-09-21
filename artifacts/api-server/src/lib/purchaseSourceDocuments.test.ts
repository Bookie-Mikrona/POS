import { describe, expect, it, vi } from "vitest";
import {
  claimPurchaseSourceDocument,
  normalizePurchaseDocumentNumber,
} from "./purchaseSourceDocuments";

describe("normalizePurchaseDocumentNumber", () => {
  it("izenači ločila, presledke, velikost črk in Unicode zapis", () => {
    expect(normalizePurchaseDocumentNumber(" račun- 2026 / 001 ")).toBe("RAČUN2026001");
    expect(normalizePurchaseDocumentNumber("RAČUN 2026-001")).toBe("RAČUN2026001");
  });

  it("prazen poslovni identifikator vrne kot null", () => {
    expect(normalizePurchaseDocumentNumber(" - / ")).toBeNull();
  });
});

describe("claimPurchaseSourceDocument", () => {
  const input = {
    companyId: "company-1",
    counterpartyId: "supplier-1",
    kind: "invoice" as const,
    documentNumber: "R-2026/15",
    documentDate: "2026-08-31",
  };

  it("vrne pravkar ustvarjeno identiteto", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_legacy_conflict: false }] })
      .mockResolvedValueOnce({ rows: [{ id: "source-new" }] });
    await expect(claimPurchaseSourceDocument({ execute }, input)).resolves.toBe("source-new");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("ob konfliktu vrne obstoječo identiteto iste listine", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_legacy_conflict: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "source-existing", counterparty_id: "supplier-1", kind: "invoice" }],
      });
    await expect(claimPurchaseSourceDocument({ execute }, input)).resolves.toBe("source-existing");
  });

  it("iste datoteke ne sprejme pod drugim dobaviteljem", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_legacy_conflict: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "source-existing", counterparty_id: "supplier-2", kind: "delivery_note" }],
      });
    await expect(claimPurchaseSourceDocument({ execute }, {
      ...input,
      contentSha256: "a".repeat(64),
    })).rejects.toThrow("drugim dobaviteljem");
  });

  it("isto številko prizna kot isti vir tudi ob drugačni klasifikaciji", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_legacy_conflict: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "source-existing", counterparty_id: "supplier-1", kind: "delivery_note" }],
      });
    await expect(claimPurchaseSourceDocument({ execute }, input)).resolves.toBe("source-existing");
  });

  it("zavrne preostali legacy zapis brez kanonične identitete", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_legacy_conflict: true }] });
    await expect(claimPurchaseSourceDocument({ execute }, input))
      .rejects.toThrow("LEGACY_PURCHASE_SOURCE_CONFLICT");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("zavrne vir brez številke in brez vsebinskega odtisa", async () => {
    const execute = vi.fn();
    await expect(claimPurchaseSourceDocument({ execute }, {
      ...input,
      documentNumber: null,
    })).rejects.toThrow("številka dokumenta ali SHA-256");
    expect(execute).not.toHaveBeenCalled();
  });
});