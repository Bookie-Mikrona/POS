import { describe, expect, it } from "vitest";
import { normalizirajTelefon } from "./narocniki-telefon";

describe("normalizirajTelefon", () => {
  it.each([
    "040 123 456",
    "040123456",
    "+38640123456",
    "0038640123456",
    "40123456",
  ])("normalizira %s v isti ključ", (telefon) => {
    expect(normalizirajTelefon(telefon)).toBe("+38640123456");
  });

  it("zavrne neveljavno številko", () => {
    expect(() => normalizirajTelefon("123")).toThrow();
  });
});