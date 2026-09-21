import { describe, expect, it } from "vitest";
import { resolveCompanyVatCodeLinks } from "../lib/journalVatCodeLinks";

describe("resolveCompanyVatCodeLinks", () => {
  it("iz podjetniške kode atomarno razreši globalni FURS ID", () => {
    const result = resolveCompanyVatCodeLinks(
      [{ companyVatCodeId: "company-code-1", vatCodeId: null, amount: "100.00" }],
      [{ id: "company-code-1", fursCodeId: "furs-code-1" }],
    );

    expect(result.error).toBeNull();
    expect(result.lines?.[0]).toMatchObject({
      companyVatCodeId: "company-code-1",
      vatCodeId: "furs-code-1",
      amount: "100.00",
    });
  });

  it("zavrne podjetniško kodo drugega podjetja", () => {
    const result = resolveCompanyVatCodeLinks(
      [{ companyVatCodeId: "foreign-company-code", vatCodeId: null }],
      [{ id: "own-company-code", fursCodeId: "furs-code-1" }],
    );

    expect(result.error).toMatch(/ne pripada temu podjetju/);
  });

  it("zavrne podjetniško kodo brez FURS povezave", () => {
    const result = resolveCompanyVatCodeLinks(
      [{ companyVatCodeId: "company-code-1", vatCodeId: null }],
      [{ id: "company-code-1", fursCodeId: null }],
    );

    expect(result.error).toMatch(/ni povezana/);
  });

  it("zavrne neskladen par podjetniške in globalne kode", () => {
    const result = resolveCompanyVatCodeLinks(
      [{ companyVatCodeId: "company-code-1", vatCodeId: "furs-code-2" }],
      [{ id: "company-code-1", fursCodeId: "furs-code-1" }],
    );

    expect(result.error).toMatch(/ne ujemata/);
  });

  it("ohrani obstoječi neposredni globalni vatCodeId brez podjetniške kode", () => {
    const result = resolveCompanyVatCodeLinks(
      [{ companyVatCodeId: null, vatCodeId: "legacy-global-code" }],
      [],
    );

    expect(result.error).toBeNull();
    expect(result.lines?.[0].vatCodeId).toBe("legacy-global-code");
  });
});