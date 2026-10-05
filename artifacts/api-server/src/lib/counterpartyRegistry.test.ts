import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCounterpartyInetis } from "./counterpartyRegistry";
import { findScopedCounterparty } from "./documentPartyResolution";

afterEach(() => vi.unstubAllGlobals());

describe("live counterparty registry", () => {
  it("uses an exact Inetis tax-ID result, separates the address and excludes closed accounts", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok", list: [
        { Naziv: "Different company", DavcnaStevilkaKratka: "87654321" },
        { Naziv: "Stanič Borut s.p.", DavcnaStevilkaKratka: "11223344", MaticnaStevilka: "1234567000",
          Naslov: "Testna ulica 1, 1000 Ljubljana", ZavezanecZaDDV: false,
          TransakcijskiRacuni: [{ TRRSurovi: "020000123456789", Zaprt: true }, { TRRSurovi: "031000123456789", Zaprt: false }] },
      ],
    })));
    vi.stubGlobal("fetch", fetch);
    const result = await lookupCounterpartyInetis("SI 11223344");
    expect(fetch).toHaveBeenCalledWith("https://ddv.inetis.com/Ajax.aspx?a=isci&niz=11223344", expect.anything());
    expect(result).toMatchObject({ found: true, source: "inetis", taxId: "11223344", name: "Stanič Borut s.p.",
      registrationNumber: "1234567000", address: "Testna ulica 1", postCode: "1000", city: "Ljubljana", vatPayer: false });
    expect(result.iban?.replace(/\s/g, "")).toBe("SI54031000123456789");
  });
  it("does not invent a partner for a missing or mismatched registry result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok", list: [{ Naziv: "Another company", DavcnaStevilkaKratka: "87654321" }],
    }))));
    expect(await lookupCounterpartyInetis("11223344")).toMatchObject({
      found: false, name: "", iban: null, vatPayer: null, source: "inetis",
    });
  });
  it("reports outages instead of falling back to simulated data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(lookupCounterpartyInetis("11223344")).rejects.toThrow("Inetis HTTP 503");
  });
  it("does not infer VAT registration from a tax ID when the registry omits it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok", list: [{ Naziv: "Partner", DavcnaStevilkaKratka: "11223344" }],
    }))));
    expect((await lookupCounterpartyInetis("11223344")).vatPayer).toBeNull();
  });
  it("rejects an invalid Slovenian tax ID without calling the registry", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(lookupCounterpartyInetis("SI123")).rejects.toThrow("8 števk");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("sole proprietor identity", () => {
  const company = { naziv: "Other Company d.o.o.", podjetjeDavcna: "99887766" };
  const existing = { id: "existing", name: "Stanič Borut s.p.", taxId: "11223344" };
  it("matches the same complete name in reverse order", () => {
    expect(findScopedCounterparty({ name: "Borut Stanič, s.p." }, company, [existing])?.id).toBe("existing");
  });
  it("does not override a conflicting tax ID or select an ambiguous name", () => {
    expect(findScopedCounterparty({ name: "Borut Stanič, s.p.", taxId: "12341234" }, company, [existing])).toBeUndefined();
    expect(findScopedCounterparty({ name: "Borut Stanič, s.p." }, company, [existing, { ...existing, id: "another" }])).toBeUndefined();
  });
});
