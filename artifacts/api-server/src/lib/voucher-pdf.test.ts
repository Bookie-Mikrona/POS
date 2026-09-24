import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { voucherPdf } from "./voucher-pdf";

describe("PDF darilnega bona", () => {
  it("ohrani slovenske znake v gostilni in imenu prejemnika", async () => {
    const pdf = await voucherPdf("Križišče", "Špela Černe Žagar", [
      { code: "DEMO12345", amount: 5000 },
    ]);
    const text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, encoding: "utf8" });

    expect(text).toContain("Križišče");
    expect(text).toContain("Za: Špela Černe Žagar");
    expect(text).toContain("DEMO12345");
    expect(text).toContain("50,00 €");
  });
});