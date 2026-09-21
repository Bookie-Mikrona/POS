import Decimal from "decimal.js";

export const EVENT_TRANSFER_MOVEMENT_TYPES = [
  "event_transfer_out",
  "event_transfer_in",
  "event_return_out",
  "event_return_in",
] as const;

type TransferDirection = "outbound" | "return";
type TransferStatus = "draft" | "completed" | "cancelled";

export type DiagnosticTransfer = {
  id: number;
  eventId: number;
  direction: TransferDirection;
  status: TransferStatus;
  sourceUnitId: number;
  targetUnitId: number;
};

export type DiagnosticLine = {
  id: number;
  transferId: number;
  sourceArticleId: number;
  targetArticleId: number;
  quantity: string | number;
  unitCost: string | number;
};

export type DiagnosticMovement = {
  id: number;
  articleId: number;
  type: string;
  quantity: string | number;
  unitCost: string | number | null;
  value: string | number | null;
  referenceId: number | null;
  eventTransferId: number | null;
};

type MovementShape = {
  articleId: number;
  articleName?: string;
  type: string;
  quantity: string;
  unitCost: string | null;
  value: string | null;
};

export type EventTransferViolation = {
  kind:
    | "missing_movement"
    | "extra_movement"
    | "movement_value_mismatch"
    | "unexpected_movement_for_status"
    | "missing_transfer_link"
    | "orphan_transfer_link"
    | "reference_conflict"
    | "non_event_has_transfer_link"
    | "ambiguous_transfer_line";
  transferId: number | null;
  transferExists?: boolean;
  eventId: number | null;
  eventExists?: boolean;
  eventName?: string;
  direction: TransferDirection | null;
  status: TransferStatus | null;
  sourceUnitId: number | null;
  sourceUnitName?: string;
  targetUnitId: number | null;
  targetUnitName?: string;
  lineId?: number;
  movementId?: number;
  expected?: MovementShape;
  actual?: MovementShape;
  differences?: Array<"quantity" | "unitCost" | "value">;
  detail: string;
};

type ExpectedMovement = MovementShape & {
  lineId: number;
};

export type TransferMovementComparison = {
  lineId: number;
  state: "matched" | "missing" | "mismatch";
  movementId: number | null;
  expected: MovementShape;
  actual?: MovementShape;
  differences: NonNullable<EventTransferViolation["differences"]>;
};

export type UnexpectedTransferMovement = {
  movementId: number;
  actual: MovementShape;
  reason: "extra" | "unexpected_status";
};

const eventTypes = new Set<string>(EVENT_TRANSFER_MOVEMENT_TYPES);
const quantity = (value: string | number): string =>
  new Decimal(value).toDecimalPlaces(4).toFixed(4);
const unitCost = (value: string | number): string =>
  new Decimal(value).toDecimalPlaces(6).toFixed(6);
const movementValue = (value: Decimal.Value): string =>
  new Decimal(value).toDecimalPlaces(4).toFixed(4);

function movementShape(movement: DiagnosticMovement): MovementShape {
  return {
    articleId: movement.articleId,
    type: movement.type,
    quantity: quantity(movement.quantity),
    unitCost: movement.unitCost == null ? null : unitCost(movement.unitCost),
    value: movement.value == null ? null : movementValue(movement.value),
  };
}

function expectedMovements(
  transfer: DiagnosticTransfer,
  lines: DiagnosticLine[],
): ExpectedMovement[] {
  const outType = transfer.direction === "outbound"
    ? "event_transfer_out"
    : "event_return_out";
  const inType = transfer.direction === "outbound"
    ? "event_transfer_in"
    : "event_return_in";

  return lines.flatMap((line) => {
    const qty = new Decimal(line.quantity);
    const cost = new Decimal(line.unitCost);
    return [
      {
        lineId: line.id,
        articleId: line.sourceArticleId,
        type: outType,
        quantity: quantity(qty.negated().toString()),
        unitCost: unitCost(cost.toString()),
        value: movementValue(qty.times(cost).negated()),
      },
      {
        lineId: line.id,
        articleId: line.targetArticleId,
        type: inType,
        quantity: quantity(qty.toString()),
        unitCost: unitCost(cost.toString()),
        value: movementValue(qty.times(cost)),
      },
    ];
  });
}

const exactKey = (movement: MovementShape): string => JSON.stringify({
  articleId: movement.articleId,
  type: movement.type,
  quantity: movement.quantity,
  unitCost: movement.unitCost,
  value: movement.value,
});
const roleKey = (movement: MovementShape): string =>
  `${movement.articleId}:${movement.type}`;

export function compareTransferMovements(
  transfer: DiagnosticTransfer,
  lines: DiagnosticLine[],
  movements: DiagnosticMovement[],
): {
  comparisons: TransferMovementComparison[];
  unexpectedMovements: UnexpectedTransferMovement[];
} {
  const actual = movements
    .filter(movement => movement.eventTransferId === transfer.id && eventTypes.has(movement.type))
    .map(row => ({ movementId: row.id, shape: movementShape(row) }));

  if (transfer.status !== "completed") {
    return {
      comparisons: [],
      unexpectedMovements: actual.map(row => ({
        movementId: row.movementId,
        actual: row.shape,
        reason: "unexpected_status",
      })),
    };
  }

  const expected = expectedMovements(transfer, lines);
  const unmatchedActual = new Set(actual.map((_, index) => index));
  const unmatchedExpected: ExpectedMovement[] = [];
  const comparisons: TransferMovementComparison[] = [];

  for (const expectedRow of expected) {
    const match = actual.findIndex(
      (actualRow, index) =>
        unmatchedActual.has(index)
        && exactKey(actualRow.shape) === exactKey(expectedRow),
    );
    if (match >= 0) {
      unmatchedActual.delete(match);
      comparisons.push({
        lineId: expectedRow.lineId,
        state: "matched",
        movementId: actual[match].movementId,
        expected: expectedRow,
        actual: actual[match].shape,
        differences: [],
      });
    } else {
      unmatchedExpected.push(expectedRow);
    }
  }

  for (const expectedRow of unmatchedExpected) {
    const mismatch = actual.findIndex(
      (actualRow, index) =>
        unmatchedActual.has(index)
        && roleKey(actualRow.shape) === roleKey(expectedRow),
    );
    if (mismatch < 0) {
      comparisons.push({
        lineId: expectedRow.lineId,
        state: "missing",
        movementId: null,
        expected: expectedRow,
        differences: [],
      });
      continue;
    }

    unmatchedActual.delete(mismatch);
    const actualRow = actual[mismatch];
    const differences: NonNullable<EventTransferViolation["differences"]> = [];
    if (expectedRow.quantity !== actualRow.shape.quantity) differences.push("quantity");
    if (expectedRow.unitCost !== actualRow.shape.unitCost) differences.push("unitCost");
    if (expectedRow.value !== actualRow.shape.value) differences.push("value");
    comparisons.push({
      lineId: expectedRow.lineId,
      state: "mismatch",
      movementId: actualRow.movementId,
      expected: expectedRow,
      actual: actualRow.shape,
      differences,
    });
  }

  return {
    comparisons,
    unexpectedMovements: [...unmatchedActual].map(index => ({
      movementId: actual[index].movementId,
      actual: actual[index].shape,
      reason: "extra",
    })),
  };
}

function transferFields(transfer?: DiagnosticTransfer) {
  return {
    transferId: transfer?.id ?? null,
    eventId: transfer?.eventId ?? null,
    direction: transfer?.direction ?? null,
    status: transfer?.status ?? null,
    sourceUnitId: transfer?.sourceUnitId ?? null,
    targetUnitId: transfer?.targetUnitId ?? null,
  };
}

export function diagnoseEventTransfers(input: {
  transfers: DiagnosticTransfer[];
  lines: DiagnosticLine[];
  movements: DiagnosticMovement[];
}): EventTransferViolation[] {
  const transfers = new Map(input.transfers.map(transfer => [transfer.id, transfer]));
  const linesByTransfer = new Map<number, DiagnosticLine[]>();
  for (const line of input.lines) {
    const lines = linesByTransfer.get(line.transferId) ?? [];
    lines.push(line);
    linesByTransfer.set(line.transferId, lines);
  }
  const violations: EventTransferViolation[] = [];

  for (const movement of input.movements) {
    const linkedTransfer = movement.eventTransferId == null
      ? undefined
      : transfers.get(movement.eventTransferId);
    const referencedTransfer = movement.referenceId == null
      ? undefined
      : transfers.get(movement.referenceId);
    const context = linkedTransfer ?? referencedTransfer;
    const isEventMovement = eventTypes.has(movement.type);

    if (isEventMovement && movement.eventTransferId == null) {
      violations.push({
        kind: "missing_transfer_link",
        ...transferFields(context),
        movementId: movement.id,
        actual: movementShape(movement),
        detail: "Dogodkovni gib nima namenske povezave event_transfer_id.",
      });
    }
    if (movement.eventTransferId != null && !linkedTransfer) {
      violations.push({
        kind: "orphan_transfer_link",
        ...transferFields(),
        transferId: movement.eventTransferId,
        movementId: movement.id,
        actual: movementShape(movement),
        detail: "event_transfer_id kaže na neobstoječ ali izven obsega prenos.",
      });
    }
    if (
      movement.eventTransferId != null
      && movement.referenceId !== movement.eventTransferId
    ) {
      violations.push({
        kind: "reference_conflict",
        ...transferFields(linkedTransfer),
        movementId: movement.id,
        actual: movementShape(movement),
        detail: "referenca_id in event_transfer_id se ne ujemata.",
      });
    }
    if (!isEventMovement && movement.eventTransferId != null) {
      violations.push({
        kind: "non_event_has_transfer_link",
        ...transferFields(linkedTransfer),
        movementId: movement.id,
        actual: movementShape(movement),
        detail: "Nedogodkovni gib ima nepričakovano povezavo event_transfer_id.",
      });
    }
    if (isEventMovement && context) {
      const shape = movementShape(movement);
      const candidateLines = expectedMovements(
        context,
        linesByTransfer.get(context.id) ?? [],
      ).filter(expected => roleKey(expected) === roleKey(shape));
      if (candidateLines.length > 1) {
        violations.push({
          kind: "ambiguous_transfer_line",
          ...transferFields(context),
          movementId: movement.id,
          actual: shape,
          detail: `Gib ustreza ${candidateLines.length} vrsticam prenosa namesto točno eni.`,
        });
      }
    }
  }

  for (const transfer of input.transfers) {
    const lines = linesByTransfer.get(transfer.id) ?? [];
    const comparison = compareTransferMovements(transfer, lines, input.movements);

    if (transfer.status !== "completed") {
      for (const movement of comparison.unexpectedMovements) {
        violations.push({
          kind: "unexpected_movement_for_status",
          ...transferFields(transfer),
          movementId: movement.movementId,
          actual: movement.actual,
          detail: `Prenos s statusom ${transfer.status} ne sme imeti zalogovnega giba.`,
        });
      }
      continue;
    }

    for (const row of comparison.comparisons) {
      if (row.state === "missing") {
        violations.push({
          kind: "missing_movement",
          ...transferFields(transfer),
          lineId: row.lineId,
          expected: row.expected,
          detail: "Manjka pričakovani zalogovni gib vrstice prenosa.",
        });
        continue;
      }
      if (row.state === "mismatch") {
        violations.push({
          kind: "movement_value_mismatch",
          ...transferFields(transfer),
          lineId: row.lineId,
          movementId: row.movementId!,
          expected: row.expected,
          actual: row.actual,
          differences: row.differences,
          detail: `Gib se od vrstice razlikuje v poljih: ${row.differences.join(", ")}.`,
        });
      }
    }

    for (const row of comparison.unexpectedMovements) {
      violations.push({
        kind: "extra_movement",
        ...transferFields(transfer),
        movementId: row.movementId,
        actual: row.actual,
        detail: "Prenos vsebuje dodaten ali podvojen zalogovni gib.",
      });
    }
  }

  return violations;
}

export function summarizeEventTransferViolations(
  violations: EventTransferViolation[],
): Record<string, number> {
  return violations.reduce<Record<string, number>>((summary, violation) => {
    summary[violation.kind] = (summary[violation.kind] ?? 0) + 1;
    return summary;
  }, {});
}

export function enrichEventTransferViolations(
  violations: EventTransferViolation[],
  names: {
    events: ReadonlyMap<number, string>;
    units: ReadonlyMap<number, string>;
    articles: ReadonlyMap<number, string>;
    transferIds?: ReadonlySet<number>;
  },
): EventTransferViolation[] {
  const enrichMovement = (movement?: MovementShape): MovementShape | undefined => {
    if (!movement) return undefined;
    const articleName = names.articles.get(movement.articleId);
    return articleName ? { ...movement, articleName } : movement;
  };

  return violations.map(violation => ({
    ...violation,
    eventExists: violation.eventId != null && names.events.has(violation.eventId),
    transferExists: violation.transferId != null && (names.transferIds?.has(violation.transferId) ?? false),
    ...(violation.eventId != null && names.events.has(violation.eventId)
      ? { eventName: names.events.get(violation.eventId) }
      : {}),
    ...(violation.sourceUnitId != null && names.units.has(violation.sourceUnitId)
      ? { sourceUnitName: names.units.get(violation.sourceUnitId) }
      : {}),
    ...(violation.targetUnitId != null && names.units.has(violation.targetUnitId)
      ? { targetUnitName: names.units.get(violation.targetUnitId) }
      : {}),
    expected: enrichMovement(violation.expected),
    actual: enrichMovement(violation.actual),
  }));
}