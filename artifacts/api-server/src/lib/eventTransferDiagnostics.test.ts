import { describe, expect, it } from "vitest";
import {
  diagnoseEventTransfers,
  compareTransferMovements,
  enrichEventTransferViolations,
  summarizeEventTransferViolations,
  type DiagnosticMovement,
} from "./eventTransferDiagnostics";

const transfer = {
  id: 10,
  eventId: 20,
  direction: "outbound" as const,
  status: "completed" as const,
  sourceUnitId: 30,
  targetUnitId: 40,
};
const line = {
  id: 50,
  transferId: 10,
  sourceArticleId: 60,
  targetArticleId: 70,
  quantity: "2",
  unitCost: "3",
};
const movement = (
  id: number,
  articleId: number,
  type: string,
  quantity: number,
  value: number,
): DiagnosticMovement => ({
  id,
  articleId,
  type,
  quantity,
  unitCost: 3,
  value,
  referenceId: 10,
  eventTransferId: 10,
});

describe("diagnoseEventTransfers", () => {
  it("ločeno pokaže manjkajoč in vrednostno neusklajen gib", () => {
    const violations = diagnoseEventTransfers({
      transfers: [transfer],
      lines: [line],
      movements: [
        movement(1, 60, "event_transfer_out", -2, -5),
      ],
    });

    expect(summarizeEventTransferViolations(violations)).toEqual({
      movement_value_mismatch: 1,
      missing_movement: 1,
    });
    expect(violations.find(item => item.kind === "movement_value_mismatch"))
      .toMatchObject({
        transferId: 10,
        eventId: 20,
        lineId: 50,
        differences: ["value"],
        expected: { value: "-6.0000" },
        actual: { value: "-5.0000" },
      });
  });

  it("vrne primerjave za dialog z manjkajočim, neusklajenim in dodatnim premikom", () => {
    const comparison = compareTransferMovements(transfer, [line], [
      movement(1, 60, "event_transfer_out", -2, -5),
      movement(2, 999, "event_transfer_in", 1, 1),
    ]);

    expect(comparison.comparisons).toEqual([
      expect.objectContaining({
        lineId: 50,
        state: "mismatch",
        movementId: 1,
        differences: ["value"],
      }),
      expect.objectContaining({
        lineId: 50,
        state: "missing",
        movementId: null,
      }),
    ]);
    expect(comparison.unexpectedMovements).toEqual([
      expect.objectContaining({
        movementId: 2,
        reason: "extra",
      }),
    ]);
  });

  it("pokaže podvojen gib kot dodaten", () => {
    const violations = diagnoseEventTransfers({
      transfers: [transfer],
      lines: [line],
      movements: [
        movement(1, 60, "event_transfer_out", -2, -6),
        movement(2, 70, "event_transfer_in", 2, 6),
        movement(3, 70, "event_transfer_in", 2, 6),
      ],
    });
    expect(violations).toEqual([
      expect.objectContaining({
        kind: "extra_movement",
        transferId: 10,
        movementId: 3,
      }),
    ]);
  });

  it("pokaže gibe nedokončanih in preklicanih prenosov", () => {
    const violations = diagnoseEventTransfers({
      transfers: [
        { ...transfer, status: "draft" },
        { ...transfer, id: 11, status: "cancelled" },
      ],
      lines: [],
      movements: [
        movement(1, 60, "event_transfer_out", -2, -6),
        { ...movement(2, 60, "event_transfer_out", -2, -6), referenceId: 11, eventTransferId: 11 },
      ],
    });
    expect(violations.map(item => [item.kind, item.status])).toEqual([
      ["unexpected_movement_for_status", "draft"],
      ["unexpected_movement_for_status", "cancelled"],
    ]);
  });

  it("pokaže manjkajočo, osirotelo in konfliktno namensko povezavo", () => {
    const violations = diagnoseEventTransfers({
      transfers: [transfer],
      lines: [],
      movements: [
        { ...movement(1, 60, "event_transfer_out", -1, -3), eventTransferId: null },
        { ...movement(2, 60, "event_transfer_out", -1, -3), eventTransferId: 999 },
        { ...movement(3, 60, "event_transfer_out", -1, -3), referenceId: 99 },
      ],
    });
    expect(violations.map(item => item.kind)).toEqual([
      "missing_transfer_link",
      "orphan_transfer_link",
      "reference_conflict",
      "reference_conflict",
      "extra_movement",
    ]);
  });

  it("izrecno označi gib, ki ustreza več vrsticam prenosa", () => {
    const violations = diagnoseEventTransfers({
      transfers: [transfer],
      lines: [line, { ...line, id: 51 }],
      movements: [
        { ...movement(1, 60, "event_transfer_out", -2, -6), eventTransferId: null },
        { ...movement(2, 70, "event_transfer_in", 2, 6), eventTransferId: null },
      ],
    });
    expect(violations.filter(item => item.kind === "ambiguous_transfer_line"))
      .toHaveLength(2);
  });

  it("doda samo preverjena imena in za manjkajoče zapise ohrani goli ID", () => {
    const [violation] = diagnoseEventTransfers({
      transfers: [transfer],
      lines: [line],
      movements: [],
    });
    const [enriched] = enrichEventTransferViolations([{
      ...violation,
      actual: {
        articleId: 999,
        type: "event_transfer_out",
        quantity: "-2.0000",
        unitCost: "3.000000",
        value: "-6.0000",
      },
    }], {
      events: new Map([[20, "Festival ob jezeru"]]),
      units: new Map([[30, "Glavna kuhinja"], [40, "Prireditveni šotor"]]),
      articles: new Map([[60, "Sok jabolko"]]),
    });

    expect(enriched).toMatchObject({
      eventId: 20,
      eventName: "Festival ob jezeru",
      sourceUnitId: 30,
      sourceUnitName: "Glavna kuhinja",
      targetUnitId: 40,
      targetUnitName: "Prireditveni šotor",
      expected: { articleId: 60, articleName: "Sok jabolko" },
      actual: { articleId: 999 },
    });
    expect(enriched.actual).not.toHaveProperty("articleName");
  });
});