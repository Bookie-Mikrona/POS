import { execFileSync, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";
import {
  buildAjpesAnnualReport,
  type AjpesAnnualReport,
  type AjpesSource,
} from "./annual-model";
import { generateAjpesPublicationPdf } from "./publication-pdf";

const allConfirmedStatistics = Object.fromEntries(
  [
    ...AJPES_GD_AOP_CATALOG_2025.aops
      .filter((row) => !row.isAggregate && row.form === "IBD-BI")
      .map((row) => [row.id, "0.00"] as const),
    ["188", "0.00"],
    ["189", "0.00"],
  ],
);
const allPreviousEditableLeaves = Object.fromEntries(
  AJPES_GD_AOP_CATALOG_2025.aops
    .filter((row) => !row.isAggregate)
    .map((row) => [row.id, "0.00"] as const),
);

const profile = {
  legalForm: "doo" as const,
  framework: "SRS" as const,
  size: "small" as const,
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  currentCriteria: { assets: "2866.75", revenue: "0.00", employees: "1" },
  previousCriteria: { assets: "0.00", revenue: "0.00", employees: "1" },
  sizeBasis: "Velikost družbe je potrjena po presoji meril za tekoče in predhodno leto.",
  previousYearException: "",
  microRegime: "no" as const,
  auditRequired: "no" as const,
  groupMember: "no" as const,
  consolidationRequired: "no" as const,
  simplifiedSubmission: "no" as const,
  foreignOperations: "no" as const,
  sfrRequired: "no" as const,
  cppsRequired: "no" as const,
  listed: "no" as const,
  specialRegime: "no" as const,
  confirmationBasis: "Podatki in statusi so preverjeni z dokumentacijo za leto.",
  confirmed: true,
};

function source(
  mode: "notes" | "micro" = "notes",
  narrativeOverrides: Partial<Record<
    "accountingPolicies" | "explanations" | "disclosure4" | "disclosure5" |
    "disclosure6" | "disclosure10" | "proposal" | "decision" | "statement",
    string
  >> = {},
  simplifiedSubmission = false,
): AjpesSource {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Ljubljana",
  });
  return {
    year: 2025,
    company: {
      name: "Živa čebelarstva d.o.o.",
      street: "Čopova ulica 15",
      postalCode: "1000",
      city: "Ljubljana",
      registrationNumber: "01234567",
      taxNumber: "SI12345678",
    },
    accounts: [
      {
        accountId: "cash",
        code: "1100000",
        name: "Denarna sredstva",
        currentBalance: "2866.75",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
      {
        accountId: "liabilities",
        code: "2200000",
        name: "Obveznosti",
        currentBalance: "-2866.75",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
    ],
    journals: [
      {
        id: "journal-current",
        number: "2025-1",
        date: "2025-12-31",
        reference: "",
        description: "Redni dnevnik",
      },
      {
        id: "journal-previous",
        number: "2024-1",
        date: "2024-12-31",
        reference: "",
        description: "Redni dnevnik",
      },
    ],
    settings: {
      mappings: { cash: "052", liabilities: "093" },
      mappingReasons: {},
      currentValues: { ...allConfirmedStatistics },
      previousValues: { ...allPreviousEditableLeaves },
      excludedEntryIds: [],
      metadata: {
        previousDataMode: "ledger",
        accountingMethod: "2",
        size: mode === "micro" ? "4" : "3",
      },
      profile: {
        ...profile,
        size: mode === "micro" ? "micro" : "small",
        microRegime: mode === "micro" ? "yes" : "no",
        simplifiedSubmission: simplifiedSubmission ? "yes" : "no",
      },
      narrative: {
        accountingPolicies:
          narrativeOverrides.accountingPolicies ?? "Sprejete računovodske usmeritve za leto 2025.",
        explanations: narrativeOverrides.explanations ?? "Pojasnila k izkazom za leto 2025.",
        disclosure4: narrativeOverrides.disclosure4 ?? "Ni pogojnih finančnih obveznosti zunaj bilance.",
        disclosure5: narrativeOverrides.disclosure5 ?? "Obveznosti niso zavarovane s stvarnim jamstvom.",
        disclosure6: narrativeOverrides.disclosure6 ?? "Ni predujmov, posojil ali poroštev določenim osebam.",
        disclosure10: narrativeOverrides.disclosure10 ?? "Družba nima lastnih deležev.",
        historicalCostConfirmed: true,
        profitProposal: {
          text: narrativeOverrides.proposal ?? "Predlagana razporeditev dobička v rezerve.",
          preparedBy: "Maja Računovodkinja",
          preparedDate: today,
        },
        profitDecision: {
          text: narrativeOverrides.decision ?? "Skupščina je sprejela predlog.",
          adoptedBy: "Skupščina družbenikov",
          adoptedDate: today,
          reference: "Sklep št. 1/2025",
          adopted: true,
        },
        simplifiedStatement: {
          text: narrativeOverrides.statement ?? (simplifiedSubmission
            ? "Izjava za poenostavljeno predložitev."
            : "Zastarela izjava, ki ne sme biti vključena."),
          signatory: simplifiedSubmission ? "Direktor družbe" : "",
          date: today,
          confirmed: simplifiedSubmission,
        },
      },
    },
    revision: 1,
    hasCurrent: true,
    hasPrevious: true,
    sourceVersion: "publication-pdf-test-v1",
  };
}

function makeReport(
  mode: "notes" | "micro" = "notes",
  narrativeOverrides: Parameters<typeof source>[1] = {},
  simplifiedSubmission = false,
): AjpesAnnualReport {
  const draftSource = source(mode, narrativeOverrides, simplifiedSubmission);
  const initial = buildAjpesAnnualReport(draftSource);
  const reviewed = buildAjpesAnnualReport({
    ...draftSource,
    reviewedFingerprint: initial.sourceFingerprint,
    settings: {
      ...draftSource.settings,
      publicationReview: {
        fingerprint: initial.sourceFingerprint,
        reviewedBy: "clerk-internal-raw-id-should-not-be-rendered",
        reviewedAt: new Date().toISOString(),
      },
    },
  });
  expect(reviewed.canExport).toBe(true);
  expect(reviewed.publicationAssessment.canExport).toBe(true);
  return reviewed;
}

const pdftotextAvailable =
  spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

function extractText(pdf: Buffer): string {
  return execFileSync("pdftotext", ["-layout", "-", "-"], {
    input: pdf,
    encoding: "utf8",
  });
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

describe("AJPES annual publication PDF", () => {
  it("requires both reviewed annual-report approval and publication assessment approval", async () => {
    const report = makeReport();
    await expect(
      generateAjpesPublicationPdf({ ...report, reviewed: false }),
    ).rejects.toThrow(/approved and reviewed/);
    await expect(
      generateAjpesPublicationPdf({ ...report, canExport: false }),
    ).rejects.toThrow(/approved and reviewed/);
    await expect(
      generateAjpesPublicationPdf({ ...report, year: 2026 }),
    ).rejects.toThrow(/supported only for the verified 2025/);
    await expect(
      generateAjpesPublicationPdf({
        ...report,
        publicationAssessment: {
          ...report.publicationAssessment,
          canExport: false,
        },
      }),
    ).rejects.toThrow(/publication assessment/);
  });

  it.skipIf(!pdftotextAvailable)(
    "renders exact JOLP statements, reviewed metadata and authored decision text in order",
    async () => {
      const report = makeReport("notes", {
        accountingPolicies: "Usmeritve potrjene za leto 2025; čšž.",
        proposal: "Predlagani sklep: čisti dobiček se razporedi v rezerve.",
        decision: "Dejanski sklep: skupščina je sprejela predlog.",
      });
      report.publicationAssessment.sections.push({
        code: "disclosure4",
        label: "Neuporabljeno mikro razkritje",
        text: "Zastarelo mikro besedilo ne sme biti vključeno.",
      });
      report.balanceSheet[0] = {
        ...report.balanceSheet[0],
        current: "9007199254740.13",
        previous: "9007199254740.17",
      };
      const pdf = await generateAjpesPublicationPdf(report);
      const text = normalized(extractText(pdf));
      const rows = report.balanceSheet;
      const firstCurrentSource = rows[0].current;
      const firstCurrent = "9.007.199.254.740,13";
      const firstPrevious = "9.007.199.254.740,17";
      const lastBalanceLabel = rows[rows.length - 1].label;
      const firstIncomeLabel = report.incomeStatement[0].label;
      const firstBalanceLabel = rows[0].label;
      const lastBalance = text.indexOf(lastBalanceLabel);
      const incomeStart = text.indexOf(firstIncomeLabel);
      const firstBalancePosition = text.indexOf(firstBalanceLabel);
      const currentPosition = text.indexOf(firstCurrent);
      const previousPosition = text.indexOf(firstPrevious);
      const proposalPosition = text.indexOf("Predlagani sklep:");
      const adoptedPosition = text.indexOf("Dejanski sklep:");

      expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(text).toContain("Živa čebelarstva d.o.o.");
      expect(text).toContain("Čopova ulica 15");
      expect(text).toContain("01234567");
      expect(text).toContain("SI12345678");
      expect(text).toContain("01. 01. 2025–31. 12. 2025");
      expect(text).toContain("Pravna oblika: d.o.o.");
      expect(text).toContain("Velikost družbe: Majhna");
      expect(text).toContain("Zneski v EUR");
      expect(text).toContain("Maja Računovodkinja");
      expect(text).toContain("Dejanski sklep: skupščina je sprejela predlog.");
      expect(text).toContain("Usmeritve potrjene za leto 2025; čšž.");
      expect(text).toContain(report.publicationAssessment.contentFingerprint);
      expect(text).toContain(report.sourceFingerprint);
      expect(text).toContain(new Intl.DateTimeFormat("sl-SI", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(report.settings.publicationReview!.reviewedAt)));
      expect(text).toContain("9.007.199.254.740,13");
      expect(text).toContain("9.007.199.254.740,17");
      expect(text).not.toContain("clerk-internal-raw-id-should-not-be-rendered");
      expect(text).not.toContain("Zastarelo mikro besedilo");
      expect(firstCurrentSource).toBe("9007199254740.13");
      expect(firstBalancePosition).toBeGreaterThan(-1);
      expect(currentPosition).toBeGreaterThan(firstBalancePosition);
      expect(previousPosition).toBeGreaterThan(currentPosition);
      expect(lastBalance).toBeGreaterThan(-1);
      expect(incomeStart).toBeGreaterThan(lastBalance);
      expect(proposalPosition).toBeGreaterThan(incomeStart);
      expect(adoptedPosition).toBeGreaterThan(proposalPosition);
      expect(text).toContain("ni elektronsko podpisan");
      expect(text).toContain("ni dokazilo o predložitvi");
    },
  );

  it.skipIf(!pdftotextAvailable)(
    "places only confirmed micro disclosures between the balance sheet and IPI",
    async () => {
      const report = makeReport("micro", {
        disclosure4: "Razkritje štiri čšž.",
        disclosure5: "Razkritje pet.",
        disclosure6: "Razkritje šest.",
        disclosure10: "Razkritje deset.",
        accountingPolicies: "Ne prikaži.",
        proposal: "Predlog dobička.",
        decision: "Sprejeti sklep.",
      });
      const text = normalized(extractText(await generateAjpesPublicationPdf(report)));
      const finalBalance = text.indexOf(
        report.balanceSheet[report.balanceSheet.length - 1].label,
      );
      const micro4 = text.indexOf("Razkritje štiri čšž.");
      const micro10 = text.indexOf("Razkritje deset.");
      const firstIncome = text.indexOf(report.incomeStatement[0].label);
      const proposal = text.indexOf("Predlog dobička.");

      expect(finalBalance).toBeGreaterThan(-1);
      expect(micro4).toBeGreaterThan(finalBalance);
      expect(micro10).toBeGreaterThan(micro4);
      expect(firstIncome).toBeGreaterThan(micro10);
      expect(proposal).toBeGreaterThan(firstIncome);
      expect(text).not.toContain("Ne prikaži.");
      expect(text).toContain("Velikost družbe: Mikro");
    },
  );

  it("writes fictional ordinary and micro PDF samples for manual inspection", async () => {
    const ordinary = await generateAjpesPublicationPdf(makeReport("notes"));
    const micro = await generateAjpesPublicationPdf(makeReport("micro"));
    await writeFile("/tmp/ajpes-phaseb-ordinary.pdf", ordinary);
    await writeFile("/tmp/ajpes-phaseb-micro.pdf", micro);
  });

  it.skipIf(!pdftotextAvailable)(
    "omits a stale simplified statement unless the confirmed profile is eligible",
    async () => {
      const report = makeReport("notes");
      report.publicationAssessment.sections.push({
        code: "statement",
        label: "Izjava",
        text: "Izjava starega profila.",
      });
      const text = normalized(extractText(await generateAjpesPublicationPdf(report)));
      expect(text).not.toContain("Izjava starega profila.");
    },
  );

  it.skipIf(!pdftotextAvailable)(
    "includes the simplified declaration only for the confirmed eligible profile",
    async () => {
      const report = makeReport("notes", {}, true);
      const text = normalized(extractText(await generateAjpesPublicationPdf(report)));
      expect(text).toContain("Izjava za poenostavljeno predložitev.");
    },
  );

  it.skipIf(!pdftotextAvailable)(
    "wraps long text across pages without losing its tail or adding blank footer pages",
    async () => {
      const longTail = "KONEC_DOLGEGA_POJASNILA_ČŠŽ";
      const longText = `${"besedilo-brez-presledkov-čšž".repeat(500)} ${"Dolgo pojasnilo z več vrsticami in podatki. ".repeat(90)}${longTail}`;
      const report = makeReport("notes", { explanations: longText });
      const pdf = await generateAjpesPublicationPdf(report);
      const text = normalized(extractText(pdf));
      const pages = pageCount(pdf);
      const extractedPages = extractText(pdf).split("\f").filter((page) => page.trim());

      expect(pages).toBeGreaterThan(2);
      expect(extractedPages).toHaveLength(pages);
      expect(text).toContain(longTail);
      expect(text).toContain("besedilo-brez-presledkov-čšž");
      expect((text.match(/Stran \d+ \/ \d+/gu) ?? []).length).toBe(pages);
      expect(text).toContain(`Stran ${pages} / ${pages}`);
    },
  );
});