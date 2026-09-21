import { describe, expect, it } from "vitest";
import { buildQrMizaPdfContent, generateQrMizePdf } from "./report-pdf";

describe("generateQrMizePdf", () => {
  it("ustvari eno A4 stran za vsako mizo z nazivom in jasnimi navodili", async () => {
    const pdf = await generateQrMizePdf({
      podjetjeNaziv: "Gostilna Pri Mizi",
      enotaNaziv: "Ljubljana center",
      prostorNaziv: "Terasa",
      qrWifiSsid: "Gostilna-Gosti",
      qrWifiPassword: "DoberTek2026",
      createdAt: new Date("2026-08-26T10:30:00.000Z"),
      mize: [
        { stevilka: 1, ime: "Ob oknu", javniUrl: "https://example.test/meni/miza-1" },
        { stevilka: 2, ime: null, javniUrl: "https://example.test/meni/miza-2" },
        { stevilka: 3, ime: "Vrt", javniUrl: "https://example.test/meni/miza-3" },
      ],
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);

    // Vsaka miza dobi svojo stran A4.
    const pageObjects = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(pageObjects).toHaveLength(3);

    const content = buildQrMizaPdfContent(
      { stevilka: 1, ime: "  Ob oknu  ", javniUrl: "https://example.test/meni/miza-1" },
      "Terasa",
      "Gostilna-Gosti",
      "DoberTek2026",
    );
    expect(content).toEqual({
      mizaNaziv: "Ob oknu",
      prostor: "Prostor: Terasa",
      navodila: [
        "1. Skenirajte QR kodo s fotoaparatom telefona.",
        "2. Odprite povezavo in dovolite uporabo lokacije (GPS).",
        "3. Če GPS ni dosegljiv ali dovolj natančen, se povežite na spodnji Wi-Fi in poskusite znova.",
      ],
      wifiSsid: "Gostilna-Gosti",
      wifiPassword: "DoberTek2026",
      slogan: "Naročite hitro, uživajte dlje.",
      pomoc: "Če se meni ne aktivira, prosite osebje za pomoč.",
    });
  });

  it("uporabi številko samo kot nadomestek, kadar miza nima naziva", () => {
    expect(buildQrMizaPdfContent(
      { stevilka: 12, ime: null, javniUrl: "https://example.test/meni/miza-12" },
      "Vrt",
    ).mizaNaziv).toBe("Miza 12");
  });

  it("jasno označi manjkajoče Wi-Fi podatke", () => {
    const content = buildQrMizaPdfContent(
      { stevilka: 4, ime: "Vrt", javniUrl: "https://example.test/meni/miza-4" },
      "Terasa",
    );
    expect(content.wifiSsid).toBe("Ni nastavljeno");
    expect(content.wifiPassword).toBe("Ni nastavljeno");
  });
});