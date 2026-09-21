import { POS_EVENT_STATUSES, POS_STOCK_TRANSFER_STATUSES } from "@workspace/db";

export { POS_EVENT_STATUSES };
export type PosEventStatus = (typeof POS_EVENT_STATUSES)[number];

const STATUS_TRANSITIONS: Record<PosEventStatus, readonly PosEventStatus[]> = {
  planned: ["planned", "active", "cancelled"],
  active: ["active", "closed", "cancelled"],
  closed: ["closed"],
  cancelled: ["cancelled"],
};

export function isEventStatusTransitionAllowed(from: PosEventStatus, to: PosEventStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export type PosStockTransferStatus = (typeof POS_STOCK_TRANSFER_STATUSES)[number];

const STOCK_TRANSFER_STATUS_TRANSITIONS: Record<
  PosStockTransferStatus,
  readonly PosStockTransferStatus[]
> = {
  draft: ["draft", "completed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

export function isStockTransferStatusTransitionAllowed(
  from: PosStockTransferStatus,
  to: PosStockTransferStatus,
): boolean {
  return STOCK_TRANSFER_STATUS_TRANSITIONS[from].includes(to);
}