export type TableVisualStatus =
  | "prosta"
  | "zasedena"
  | "rezervirana"
  | "delno_zaracunana"
  | "vse_zaracunano";

type OrderItemLike = {
  parentPostavkaId?: number | null;
  racunId?: number | null;
};

type OpenOrderLike = {
  status: string;
  postavke?: OrderItemLike[] | null;
};

export function resolveTableVisualStatus(
  storedStatus: string,
  orders: OpenOrderLike[],
): TableVisualStatus {
  const openOrders = orders.filter(order => order.status === "odprto");
  if (openOrders.length > 0) {
    const items = openOrders.flatMap(order =>
      (order.postavke ?? []).filter(item => item.parentPostavkaId == null),
    );
    const invoicedCount = items.filter(item => item.racunId != null).length;
    if (items.length > 0 && invoicedCount === items.length) return "vse_zaracunano";
    if (invoicedCount > 0) return "delno_zaracunana";
    return "zasedena";
  }
  if (storedStatus === "rezervirana") return "rezervirana";
  if (storedStatus === "zasedena") return "zasedena";
  return "prosta";
}

export const TABLE_CARD_BORDER_CLASS: Record<TableVisualStatus, string> = {
  prosta: "border-l-green-500",
  zasedena: "border-l-red-500",
  rezervirana: "border-l-yellow-500",
  delno_zaracunana: "border-l-orange-500",
  vse_zaracunano: "border-l-teal-500",
};

export const TABLE_FLOOR_CLASS: Record<TableVisualStatus, string> = {
  prosta: "border-green-500 bg-green-50 shadow-green-100/50",
  zasedena: "border-red-500 bg-red-50 shadow-red-100/50",
  rezervirana: "border-yellow-500 bg-yellow-50 shadow-yellow-100/50",
  delno_zaracunana: "border-orange-500 bg-orange-50 shadow-orange-100/50",
  vse_zaracunano: "border-teal-500 bg-teal-50 shadow-teal-100/50",
};