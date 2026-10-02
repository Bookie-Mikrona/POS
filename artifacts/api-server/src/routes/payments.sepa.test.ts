import { describe, expect, it } from "vitest";
import { buildSepaBatchXml } from "./payments.sepa";

describe("SEPA payment batch serialization", () => {
  const base = {
    messageId: "BATCH-1",
    companyName: "Podjetje",
    debtorIban: "SI56191000000123438",
    debtorBic: "HDELSI22",
    profile: "pain.001.001.03",
  };

  it("exports all compatible transactions once and sums exact cents", () => {
    const xml = buildSepaBatchXml({
      ...base,
      transactions: [
        { paymentId: "payment-a", amount: "10.25", executionDate: "2026-11-02", creditorName: "A", creditorIban: "SI56191000000123438" },
        { paymentId: "payment-b", amount: "2.75", executionDate: "2026-11-02", creditorName: "B", creditorIban: "SI56191000000123438" },
      ],
    });
    expect(xml.match(/<CdtTrfTxInf>/g)).toHaveLength(2);
    expect(xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(xml).toContain("<CtrlSum>13.00</CtrlSum>");
    expect(xml).toContain("<IBAN>SI56191000000123438</IBAN>");
    expect(xml).not.toContain("<CdtTrfTxInf><CdtTrfTxInf>");
  });

  it("preserves valid RF references as SCOR structured references and SI models as text", () => {
    const xml = buildSepaBatchXml({
      ...base,
      transactions: [
        { paymentId: "rf", amount: "1.00", executionDate: "2026-11-02", creditorName: "A", creditorIban: "SI56191000000123438", reference: "RF18539007547034" },
        { paymentId: "si", amount: "1.00", executionDate: "2026-11-02", creditorName: "B", creditorIban: "SI56191000000123438", model: "SI00", reference: "1234567890", purpose: "Račun" },
      ],
    });
    expect(xml).toContain("<Cd>SCOR</Cd>");
    expect(xml).toContain("<Ref>RF18539007547034</Ref>");
    expect(xml).toContain("SI00 1234567890 — Račun");
  });

  it("rejects incompatible dates and unsupported profiles rather than silently mixing", () => {
    expect(() => buildSepaBatchXml({
      ...base,
      transactions: [
        { paymentId: "a", amount: "1", executionDate: "2026-11-02", creditorName: "A", creditorIban: "SI56191000000123438" },
        { paymentId: "b", amount: "1", executionDate: "2026-11-03", creditorName: "B", creditorIban: "SI56191000000123438" },
      ],
    })).toThrow("Paket vsebuje nezdružljive datume izvedbe");
    expect(() => buildSepaBatchXml({ ...base, profile: "unknown", transactions: [
      { paymentId: "a", amount: "1", executionDate: "2026-11-02", creditorName: "A", creditorIban: "SI56191000000123438" },
    ] })).toThrow("Nepodprt");
  });
});