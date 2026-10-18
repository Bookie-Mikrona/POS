const order = {
  id: 704,
  number: "N-2026-0704",
  supplierId: "supplier-704",
  supplierName: "Mlekarna Planika",
  status: "draft",
  createdAt: "2026-10-17T10:00:00.000Z",
  expectedDeliveryDate: "2026-10-22",
  sentAt: null,
  lineCount: 1,
  openQuantity: 12,
  internalNotes: "INTERNAL ONLY: preveriti stanje embalaže.",
  supplierNotes: " ",
  closedReason: null,
  lines: [{
    id: 7041,
    supplierMappingId: 7042,
    articleId: 7043,
    articleName: "Mleko 3,5 %",
    supplierItemName: "Mleko polnomastno",
    supplierCode: "ML-01",
    packageQuantity: 2,
    packageFactor: 6,
    currentPackageFactor: 6,
    packageName: "zaboj",
    baseUnit: "L",
    orderedBaseQuantity: 12,
    receivedBaseQuantity: 0,
    openBaseQuantity: 12,
    unitPrice: 18,
    receipts: [],
  }],
};

const summary = {
  id: order.id,
  number: order.number,
  supplierId: order.supplierId,
  supplierName: order.supplierName,
  status: order.status,
  createdAt: order.createdAt,
  expectedDeliveryDate: order.expectedDeliveryDate,
  lineCount: order.lineCount,
  openQuantity: order.openQuantity,
  internalNotes: order.internalNotes,
  supplierNotes: order.supplierNotes,
};

const emptyMutation = () => ({ mutateAsync: async () => ({}), isPending: false });
const emptyQuery = data => ({ data, isLoading: false, isError: false, refetch: async () => ({ data, isError: false }) });

export const getGetSupplierOrderDashboardQueryKey = () => ["supplier-order-dashboard"];
export const getListSupplierOrdersQueryKey = params => ["supplier-orders", params];
export const getListSupplierOrdersMissingInstructionsQueryKey = params => ["supplier-orders-missing-instructions", params];
export const getGetSupplierOrderQueryKey = id => ["supplier-order", id];

export const useGetSupplierOrderDashboard = () => emptyQuery({ articles: [], orders: [summary] });
export const useListSupplierOrders = () => emptyQuery([summary]);
export const useListSupplierOrdersMissingInstructions = params => emptyQuery({
  orders: [],
  total: 0,
  page: params.page,
  pageSize: params.pageSize,
});
export const useGetSupplierOrder = () => emptyQuery(order);
export const useSaveSupplierReorderSettings = emptyMutation;
export const useCreateSupplierOrder = emptyMutation;
export const useUpdateSupplierOrder = emptyMutation;
export const useMarkSupplierOrderSent = emptyMutation;
export const useCloseSupplierOrder = emptyMutation;
export const useCancelSupplierOrder = emptyMutation;
export const useCreatePrejemnica = emptyMutation;
