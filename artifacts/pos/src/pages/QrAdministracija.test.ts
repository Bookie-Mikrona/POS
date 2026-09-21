import { describe, expect, it } from "vitest";
import { resolveQrPreviewUrl } from "./QrAdministracija";

describe("resolveQrPreviewUrl", () => {
  const publicUrl = "https://bookie.example/meni/nov-qr-token";

  it("v razvoju preskusi žeton na trenutnem Replit naslovu", () => {
    expect(resolveQrPreviewUrl(publicUrl, true)).toBe("/meni/nov-qr-token");
  });

  it("v produkciji ohrani kanonični javni naslov", () => {
    expect(resolveQrPreviewUrl(publicUrl, false)).toBe(publicUrl);
  });
});