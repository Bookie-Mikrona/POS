import { describe, expect, it } from "vitest";
import { zahtevajAiDeviceToken } from "./use-ai-svetovalec";

describe("AI identiteta naprave", () => {
  it("ob izklopljenem svetovalcu ne zahteva žetona", () => {
    expect(zahtevajAiDeviceToken(false, undefined)).toBeNull();
  });

  it("ob vklopljenem svetovalcu brez žetona odpove zaprto", () => {
    expect(() => zahtevajAiDeviceToken(true, undefined)).toThrow("varne AI identitete");
  });

  it("ob vklopljenem svetovalcu vrne podpisani žeton", () => {
    expect(zahtevajAiDeviceToken(true, "podpisan-token")).toBe("podpisan-token");
  });
});