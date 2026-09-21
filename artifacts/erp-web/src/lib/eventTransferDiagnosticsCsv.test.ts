import { describe, expect, it } from "vitest";
import type { EventTransferDiagnosticReport } from "@workspace/api-client-react";
import {
  buildEventTransferDiagnosticsCsv,
  eventTransferDiagnosticsCsvFilename,
} from "./eventTransferDiagnosticsCsv";

const report: EventTransferDiagnosticReport = {
  generatedAt: "2026-09-04T08:15:30.000Z",
  scope: { companyId: "company-1", unitId: 40 },
  readOnly: true,
  checked: { transfers: 3, lines: 5, movements: 9 },
  violationCount: 1,
  summary: { movement_value_mismatch: 1 },
  violations: [{
    kind: "movement_value_mismatch",
    transferId: 10,
    eventId: 20,
    eventName: "Festival; \"Poletje\"",
    direction: "outbound",
    status: "completed",
    sourceUnitId: 30,
    sourceUnitName: "Glavna kuhinja",
    targetUnitId: 40,
    targetUnitName: "Prireditveni\nšotor",
    lineId: 50,
    movementId: 80,
    expected: {
      articleId: 60,
      articleName: "Sok jabolko",
      type: "event_transfer_out",
      quantity: "-2.0000",
      unitCost: "3.000000",
      value: "-6.0000",
    },
    actual: {
      articleId: 70,
      type: "event_transfer_out",
      quantity: "-2.0000",
      unitCost: "3.000000",
      value: "-5.0000",
    },
    differences: ["value"],
    detail: "Vrednost; ni enaka \"pričakovani\".",
  }],
};

describe("eventTransferDiagnosticsCsv", () => {
  it("izvozi read-only metapodatke, scope, imena, ID-je in expected/actual vrednosti", () => {
    const csv = buildEventTransferDiagnosticsCsv({
      report,
      violations: report.violations,
      companyName: "Mikrona d.o.o.",
      unitName: "Prireditveni šotor",
      filterLabel: "Neskladna vrednost premika",
      kindLabels: { movement_value_mismatch: "Neskladna vrednost premika" },
    });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Način";"SAMO ZA PREGLED — brez samodejnih popravkov"');
    expect(csv).toContain('"Čas nastanka";"2026-09-04T08:15:30.000Z"');
    expect(csv).toContain('"Podjetje";"Mikrona d.o.o.";"company-1"');
    expect(csv).toContain('"Enota";"Prireditveni šotor";"40"');
    expect(csv).toContain('"Festival; ""Poletje"""');
    expect(csv).toContain('"Vrednost; ni enaka ""pričakovani""."');
    expect(csv).toContain('"Sok jabolko";"60"');
    expect(csv).toContain(';"70";"event_transfer_out"');
    expect(csv).toContain('"value"');
  });

  it("ustvari varen in datumsko sledljiv filename", () => {
    expect(eventTransferDiagnosticsCsvFilename(
      "Čebelica & Sinovi d.o.o.",
      report.generatedAt,
    )).toBe("diagnostika-dogodkovnih-prenosov-cebelica-sinovi-d-o-o-2026-09-04.csv");
  });

  it("prepreči, da bi Excel besedilo iz poročila izvedel kot formulo", () => {
    const csv = buildEventTransferDiagnosticsCsv({
      report: {
        ...report,
        violations: [{
          ...report.violations[0],
          eventName: '=HYPERLINK("https://example.test")',
          detail: "@SUM(1+1)",
        }],
      },
      violations: [{
        ...report.violations[0],
        eventName: '=HYPERLINK("https://example.test")',
        detail: "@SUM(1+1)",
      }],
      companyName: "+NEVARNO",
      unitName: "Vse enote",
      filterLabel: "Vse vrste",
      kindLabels: {},
    });

    expect(csv).toContain(`"'+NEVARNO"`);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain(`"'@SUM(1+1)"`);
    expect(csv).toContain(`"'-2.0000"`);
  });
});