import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, ArrowDownToLine, ArrowRight, Check,
  CircleDot, ClipboardList, Copy, FileText, PackageCheck, Plus, Printer, RefreshCw,
  Search, Send, Settings2, ShoppingCart, X,
} from "lucide-react";
import {
  getGetSupplierOrderDashboardQueryKey,
  getGetSupplierOrderQueryKey,
  getListSupplierOrdersQueryKey,
  useCancelSupplierOrder,
  useCloseSupplierOrder,
  useCreatePrejemnica,
  useCreateSupplierOrder,
  useGetSupplierOrder,
  useGetSupplierOrderDashboard,
  useListSupplierOrders,
  useMarkSupplierOrderSent,
  useSaveSupplierReorderSettings,
  useUpdateSupplierOrder,
} from "@workspace/api-client-react";
import type {
  SupplierOrderDetail,
  SupplierOrderInput,
  SupplierOrderStatus,
  SupplierReorderArticle,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrderRow = SupplierOrderInput["lines"][number];

const statusCopy: Record<SupplierOrderStatus, string> = {
  draft: "Osnutek",
  sent: "Poslano",
  partially_received: "Delno prejeto",
  received: "Prejeto",
  closed: "Zaprto",
  cancelled: "Preklicano",
};
const statusClass: Record<SupplierOrderStatus, string> = {
  draft: "border-amber-300 bg-amber-50 text-amber-900",
  sent: "border-sky-300 bg-sky-50 text-sky-900",
  partially_received: "border-orange-300 bg-orange-50 text-orange-900",
  received: "border-emerald-300 bg-emerald-50 text-emerald-900",
  closed: "border-stone-300 bg-stone-100 text-stone-700",
  cancelled: "border-rose-300 bg-rose-50 text-rose-900",
};
const formatQty = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : new Intl.NumberFormat("sl-SI", { maximumFractionDigits: digits }).format(value);
const formatDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const formatReceiptDate = (value: string) =>
  new Intl.DateTimeFormat("sl-SI", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
const formatMoney = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(value);
const MAX_ORDER_NOTE_LENGTH = 2000;
const formatUnitMoney = (value: number) =>
  new Intl.NumberFormat("sl-SI", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);

function comparableUnitPrice(
  mapping: {
    packageFactor: number;
    lastPackagePrice?: number | null;
    lastUnitPrice?: number | null;
  },
  baseUnit: string | null,
): number | null {
  if (!baseUnit?.trim()
    || !Number.isFinite(mapping.packageFactor)
    || mapping.packageFactor <= 0
    || mapping.lastPackagePrice == null
    || !Number.isFinite(mapping.lastPackagePrice)
    || mapping.lastPackagePrice < 0
    || mapping.lastUnitPrice == null
    || !Number.isFinite(mapping.lastUnitPrice)
    || mapping.lastUnitPrice < 0) {
    return null;
  }
  return mapping.lastUnitPrice;
}

function appendInternalNoteToSupplierNotes(internalNote: string, supplierNotes: string): string {
  const normalizedNote = internalNote.trim();
  if (!normalizedNote || supplierNotes.includes(normalizedNote)) return supplierNotes;
  if (!supplierNotes.trim()) return internalNote;
  return `${supplierNotes}${supplierNotes.endsWith("\n") ? "" : "\n\n"}${internalNote}`;
}

function StatusPill({ status }: { status: SupplierOrderStatus }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass[status]}`}>
    <CircleDot className="h-3 w-3" />{statusCopy[status]}
  </span>;
}

export function SupplierOrderPrintView({ order }: { order: SupplierOrderDetail }) {
  const pricedLines = order.lines.filter(line => line.unitPrice != null);
  const total = pricedLines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.packageQuantity, 0);
  const hasUnpricedLines = pricedLines.length !== order.lines.length;

  return createPortal(
    <article className="supplier-order-print" data-testid="supplier-order-print">
      <header className="supplier-order-print__header">
        <div>
          <p className="supplier-order-print__eyebrow">Naročilo dobavitelju</p>
          <h1 data-testid="text-supplier-order-print-number">{order.number}</h1>
        </div>
        <p className="supplier-order-print__created">Ustvarjeno {formatDate(order.createdAt)}</p>
      </header>

      <section className="supplier-order-print__meta" aria-label="Podatki naročila">
        <div>
          <span>Dobavitelj</span>
          <strong data-testid="text-supplier-order-print-supplier">{order.supplierName}</strong>
        </div>
        <div>
          <span>Predvidena dostava</span>
          <strong data-testid="text-supplier-order-print-delivery">{formatDate(order.expectedDeliveryDate)}</strong>
        </div>
      </section>

      <table className="supplier-order-print__table">
        <colgroup>
          <col style={{ width: "37%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Artikel</th>
            <th>Pakiranje</th>
            <th className="supplier-order-print__number">Količina paketov</th>
            <th className="supplier-order-print__number">Cena paketa</th>
            <th className="supplier-order-print__number">Znesek</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map(line => (
            <tr key={line.id} data-testid={`row-supplier-order-print-${line.id}`}>
              <td>
                <strong>{line.articleName}</strong>
                {(line.supplierItemName || line.supplierCode) && (
                  <small>{[line.supplierItemName, line.supplierCode].filter(Boolean).join(" · ")}</small>
                )}
              </td>
              <td>
                {line.packageName ?? "pakiranje"}
                {line.packageFactor > 0 && line.baseUnit
                  ? <small>1 pak. = {formatQty(line.packageFactor)} {line.baseUnit}</small>
                  : null}
              </td>
              <td className="supplier-order-print__number">{formatQty(line.packageQuantity, 3)}</td>
              <td className="supplier-order-print__number">{formatMoney(line.unitPrice)}</td>
              <td className="supplier-order-print__number">
                {line.unitPrice == null ? "—" : formatMoney(line.unitPrice * line.packageQuantity)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={4} className="supplier-order-print__number">Skupaj</th>
            <th className="supplier-order-print__number">{pricedLines.length ? formatMoney(total) : "—"}</th>
          </tr>
        </tfoot>
      </table>
      {hasUnpricedLines && <p className="supplier-order-print__subtotal-note">Vsota ne vključuje postavk brez določene cene.</p>}

      {order.supplierNotes && (
        <section className="supplier-order-print__notes">
          <h2>Navodilo dobavitelju</h2>
          <p data-testid="text-supplier-order-print-instructions">{order.supplierNotes}</p>
        </section>
      )}
    </article>,
    document.body,
  );
}

function Metric({ label, value, caption, tone = "normal" }: { label: string; value: string | number; caption: string; tone?: "normal" | "warning" }) {
  return <div className={`rounded-xl border px-4 py-3 ${tone === "warning" ? "border-orange-200 bg-orange-50/70" : "border-[#e6dfd2] bg-[#fffefa]"}`}>
    <p className="text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</p>
    <p className={`mt-1 font-display text-2xl font-bold tracking-tight ${tone === "warning" ? "text-orange-900" : "text-[#203d39]"}`}>{value}</p>
    <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
  </div>;
}

export default function NarocilaDobaviteljem() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const dashboardKey = getGetSupplierOrderDashboardQueryKey();
  const { data: dashboard, isLoading: dashboardLoading, isError: dashboardError, refetch: refetchDashboard } =
    useGetSupplierOrderDashboard({ query: { queryKey: dashboardKey } });
  const [statusFilter, setStatusFilter] = useState<SupplierOrderStatus | "all">("all");
  const listParams = statusFilter === "all" ? undefined : { status: statusFilter };
  const { data: orderList, isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders } =
    useListSupplierOrders(listParams, { query: { queryKey: getListSupplierOrdersQueryKey(listParams) } });
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { data: orderDetail, isLoading: detailLoading, isError: detailError, refetch: refetchDetail } =
    useGetSupplierOrder(selectedOrderId ?? 0, {
      query: { enabled: selectedOrderId !== null, queryKey: getGetSupplierOrderQueryKey(selectedOrderId ?? 0) },
    });
  const [printWarningOpen, setPrintWarningOpen] = useState(false);

  const saveSettings = useSaveSupplierReorderSettings();
  const createOrder = useCreateSupplierOrder();
  const updateOrder = useUpdateSupplierOrder();
  const markSent = useMarkSupplierOrderSent();
  const closeOrder = useCloseSupplierOrder();
  const cancelOrder = useCancelSupplierOrder();
  const createReceipt = useCreatePrejemnica();

  const [activeView, setActiveView] = useState<"suggestions" | "orders">("suggestions");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [settingsArticle, setSettingsArticle] = useState<SupplierReorderArticle | null>(null);
  const [settingPoint, setSettingPoint] = useState("");
  const [settingTarget, setSettingTarget] = useState("");
  const [settingMapping, setSettingMapping] = useState("");
  const [orderEditor, setOrderEditor] = useState<{
    id?: number;
    supplierId: string;
    rows: OrderRow[];
    date: string;
    internalNotes: string;
    supplierNotes: string;
  } | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeDialog, setCloseDialog] = useState(false);
  const [packageReview, setPackageReview] = useState<{
    order: SupplierOrderDetail;
    lines: SupplierOrderDetail["lines"];
  } | null>(null);
  const [packageReviewAcknowledged, setPackageReviewAcknowledged] = useState(false);
  const [articleSelection, setArticleSelection] = useState<number[]>([]);

  const articles = dashboard?.articles ?? [];
  const suggestions = useMemo(() => articles.filter(article => article.hasSuggestion), [articles]);
  const lowStock = articles.filter(article => article.reorderPoint != null && article.onHand <= article.reorderPoint).length;
  const openOrders = (dashboard?.orders ?? []).filter(order => ["draft", "sent", "partially_received"].includes(order.status)).length;
  const filteredArticles = articles.filter(article => {
    const q = search.trim().toLocaleLowerCase("sl");
    return (!q || `${article.articleName} ${article.purchaseName ?? ""}`.toLocaleLowerCase("sl").includes(q));
  });
  const filteredOrders = orderList ?? [];
  const supplierNotesAfterCopy = orderEditor
    ? appendInternalNoteToSupplierNotes(orderEditor.internalNotes, orderEditor.supplierNotes)
    : "";
  const supplierNoteCopyOverLimit = supplierNotesAfterCopy.length > MAX_ORDER_NOTE_LENGTH;
  const suggestedBySupplier = useMemo(() => {
    const groups = new Map<string, SupplierReorderArticle[]>();
    for (const article of suggestions) {
      const mapping = article.mappings.find(item => item.id === article.preferredMappingId) ??
        article.mappings.find(item => item.active);
      if (!mapping) continue;
      groups.set(mapping.supplierId, [...(groups.get(mapping.supplierId) ?? []), article]);
    }
    return groups;
  }, [suggestions]);

  const refreshLists = async (orderId?: number) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardKey }),
      queryClient.invalidateQueries({ queryKey: getListSupplierOrdersQueryKey() }),
      ...(orderId ? [queryClient.invalidateQueries({ queryKey: getGetSupplierOrderQueryKey(orderId) })] : []),
    ]);
  };
  const showError = (error: unknown, fallback: string) => setNotice({
    text: error instanceof Error ? error.message : fallback,
    error: true,
  });
  const openSettings = (article: SupplierReorderArticle) => {
    setSettingsArticle(article);
    setSettingPoint(article.reorderPoint == null ? "" : String(article.reorderPoint));
    setSettingTarget(article.targetStock == null ? "" : String(article.targetStock));
    setSettingMapping(article.preferredMappingId == null ? "" : String(article.preferredMappingId));
  };
  const saveArticleSettings = async () => {
    if (!settingsArticle) return;
    const point = Number(settingPoint);
    const target = Number(settingTarget);
    if (!Number.isFinite(point) || point < 0 || !Number.isFinite(target) || target <= 0 || target < point) {
      setNotice({ text: "Ciljna zaloga mora biti večja od nič in najmanj enaka pragu.", error: true });
      return;
    }
    try {
      await saveSettings.mutateAsync({
        artikelId: settingsArticle.articleId,
        data: { reorderPoint: point, targetStock: target, preferredMappingId: settingMapping ? Number(settingMapping) : null },
      });
      setSettingsArticle(null);
      setNotice({ text: "Prag, ciljna zaloga in dobavitelj so shranjeni." });
      await refreshLists();
    } catch (error) { showError(error, "Nastavitev ni bilo mogoče shraniti."); }
  };
  const startNewOrder = (supplierId?: string) => {
    const supplier = supplierId
      ? articles.flatMap(article => article.mappings).find(mapping => mapping.supplierId === supplierId)
      : undefined;
    setOrderEditor({ supplierId: supplierId ?? "", date: "", internalNotes: "", supplierNotes: "", rows: [] });
    setActiveView("suggestions");
    if (supplier) setNotice({ text: `Sestavljate osnutek za ${supplier.supplierName}.` });
  };
  const prepareSuggestedOrder = (supplierId: string) => {
    const supplierArticles = suggestedBySupplier.get(supplierId) ?? [];
    const mappingsByArticle = supplierArticles.flatMap(article => {
      const mapping = article.mappings.find(item => item.id === article.preferredMappingId && item.active) ??
        article.mappings.find(item => item.active && item.supplierId === supplierId);
      return mapping?.supplierId === supplierId ? [{ article, mapping }] : [];
    });
    const rows: OrderRow[] = mappingsByArticle.flatMap(({ article, mapping }) => {
      const quantity = mapping.id === article.preferredMappingId
        ? article.suggestedPackageQuantity
        : article.suggestedBaseQuantity != null
          ? Math.ceil(article.suggestedBaseQuantity / mapping.packageFactor)
          : undefined;
      return quantity && quantity > 0 ? [{
        supplierMappingId: mapping.id,
        packageQuantity: quantity,
        unitPrice: mapping.lastPackagePrice ?? undefined,
      }] : [];
    });
    if (!rows.length) {
      setNotice({ text: "Za tega dobavitelja ni postavk z določeno prednostno povezavo. Dodajte jih ročno.", error: true });
      startNewOrder(supplierId);
      return;
    }
    const mapping = mappingsByArticle[0]?.mapping;
    setOrderEditor({ supplierId, date: "", internalNotes: "", supplierNotes: "", rows });
    setNotice({ text: `Predlog vključuje ${rows.length} artiklov${mapping ? ` za ${mapping.supplierName}` : ""}.` });
  };
  const editSelectedOrder = () => {
    if (!orderDetail) return;
    setOrderEditor({
      id: orderDetail.id,
      supplierId: orderDetail.supplierId,
      date: orderDetail.expectedDeliveryDate?.slice(0, 10) ?? "",
      internalNotes: orderDetail.internalNotes ?? "",
      supplierNotes: orderDetail.supplierNotes ?? "",
      rows: orderDetail.lines.map(line => ({
        supplierMappingId: line.supplierMappingId,
        packageQuantity: line.packageQuantity,
        unitPrice: line.unitPrice ?? undefined,
      })),
    });
    setSelectedOrderId(null);
  };
  const requestPrintOrder = () => {
    if (!orderDetail) return;
    if ((orderDetail.internalNotes ?? "").trim() && !(orderDetail.supplierNotes ?? "").trim()) {
      setPrintWarningOpen(true);
      return;
    }
    window.print();
  };
  const continuePrintOrder = () => {
    setPrintWarningOpen(false);
    window.print();
  };
  const copyInternalNoteToSupplierNotes = () => {
    if (!orderEditor) return;
    const supplierNotes = appendInternalNoteToSupplierNotes(orderEditor.internalNotes, orderEditor.supplierNotes);
    if (supplierNotes.length > MAX_ORDER_NOTE_LENGTH) return;
    setOrderEditor({ ...orderEditor, supplierNotes });
  };
  const saveOrderDraft = async () => {
    if (!orderEditor?.supplierId || !orderEditor.rows.length || orderEditor.rows.some(line => line.packageQuantity <= 0)) {
      setNotice({ text: "Izberite dobavitelja in dodajte vsaj eno postavko z veljavno količino.", error: true });
      return;
    }
    const data: SupplierOrderInput = {
      supplierId: orderEditor.supplierId,
      expectedDeliveryDate: orderEditor.date || null,
      internalNotes: orderEditor.internalNotes.trim() || null,
      supplierNotes: orderEditor.supplierNotes.trim() || null,
      lines: orderEditor.rows,
    };
    try {
      const result = orderEditor.id
        ? await updateOrder.mutateAsync({ id: orderEditor.id, data })
        : await createOrder.mutateAsync({ data });
      setOrderEditor(null);
      setSelectedOrderId(result.id);
      setActiveView("orders");
      setNotice({ text: `Osnutek ${result.number} je shranjen. Naročilo samo ne spremeni zaloge ali računovodstva.` });
      await refreshLists(result.id);
    } catch (error) { showError(error, "Osnutka ni bilo mogoče shraniti."); }
  };
  const performOrderAction = async (action: "send" | "cancel" | "close") => {
    if (!orderDetail) return;
    try {
      if (action === "send") await markSent.mutateAsync({ id: orderDetail.id });
      if (action === "cancel") {
        if (!window.confirm(`Prekličem osnutek ${orderDetail.number}?`)) return;
        await cancelOrder.mutateAsync({ id: orderDetail.id });
      }
      if (action === "close") {
        if (closeReason.trim().length < 3) {
          setNotice({ text: "Vpišite razlog zaprtja (najmanj 3 znake).", error: true });
          return;
        }
        await closeOrder.mutateAsync({ id: orderDetail.id, data: { reason: closeReason.trim() } });
        setCloseDialog(false);
        setCloseReason("");
      }
      setNotice({ text: action === "send" ? "Naročilo je označeno kot poslano. Dobavitelju ga pošljete zunaj aplikacije." : action === "cancel" ? "Naročilo je preklicano." : "Naročilo je zaprto z zabeleženim razlogom." });
      await refreshLists(orderDetail.id);
    } catch (error) { showError(error, "Spremembe naročila ni bilo mogoče shraniti."); }
  };
  const createReceiptDraft = async (receiptOrder: SupplierOrderDetail) => {
    const openLines = receiptOrder.lines.filter(line => line.openBaseQuantity > 0);
    if (!openLines.length) {
      setNotice({ text: "Na naročilu ni več odprtih količin za prevzem.", error: true });
      return;
    }
    try {
      const receipt = await createReceipt.mutateAsync({
        data: {
          datum: new Date().toISOString().slice(0, 10),
          opomba: `Prejemnica za naročilo ${receiptOrder.number}`,
          vrstaCen: "neto",
          valuta: "EUR",
          postavke: openLines.map(line => {
            const pricePerBaseUnit = line.unitPrice == null
              ? undefined
              : line.unitPrice / line.packageFactor;
            return {
              artikelId: line.articleId,
              supplierOrderLineId: line.id,
              kolicina: line.openBaseQuantity,
              cenaKos: pricePerBaseUnit,
              izvKolicina: line.openBaseQuantity,
              izvCena: pricePerBaseUnit,
              izvEnota: line.baseUnit ?? undefined,
              enotVPaketu: 1,
            };
          }),
        },
      });
      setNotice({ text: "Osnutek prejemnice je pripravljen samo za odprte količine. Zaloga se spremeni šele ob potrditvi prejemnice." });
      setSelectedOrderId(null);
      setPackageReview(null);
      setPackageReviewAcknowledged(false);
      navigate(`/zaloge?prejemnica=${receipt.id}`);
    } catch (error) { showError(error, "Prejemnice ni bilo mogoče pripraviti."); }
  };
  const prepareReceipt = async () => {
    if (!orderDetail) return;
    const refreshed = await refetchDetail();
    if (refreshed.isError || !refreshed.data) {
      setNotice({ text: "Naročila ni bilo mogoče osvežiti. Prejemnica ni bila pripravljena.", error: true });
      return;
    }
    const latestOrder = refreshed.data;
    const openLines = latestOrder.lines.filter(line => line.openBaseQuantity > 0);
    if (!openLines.length) {
      setNotice({ text: "Na naročilu ni več odprtih količin za prevzem.", error: true });
      return;
    }
    const changedPackages = openLines.filter(line =>
      line.currentPackageFactor != null
      && Math.abs(line.currentPackageFactor - line.packageFactor) > 1e-9,
    );
    if (changedPackages.length) {
      setPackageReview({ order: latestOrder, lines: changedPackages });
      setPackageReviewAcknowledged(false);
      return;
    }
    await createReceiptDraft(latestOrder);
  };
  const toggleArticle = (id: number) => setArticleSelection(current =>
    current.includes(id) ? current.filter(value => value !== id) : [...current, id],
  );
  const startSelectedSuggested = () => {
    const selected = suggestions.filter(article => articleSelection.includes(article.articleId));
    const firstMapping = selected.flatMap(article => article.mappings)
      .find(mapping => mapping.active && selected.some(article =>
        article.preferredMappingId === mapping.id || article.mappings.some(item => item.id === mapping.id)));
    const supplierId = firstMapping?.supplierId;
    if (!supplierId) {
      setNotice({ text: "Izbrani artikli nimajo aktivne dobaviteljske povezave.", error: true });
      return;
    }
    const homogeneous = selected.every(article => {
      const mapping = article.mappings.find(item => item.id === article.preferredMappingId) ?? article.mappings.find(item => item.active);
      return mapping?.supplierId === supplierId;
    });
    if (!homogeneous) {
      setNotice({ text: "Izbrani predlogi so pri več dobaviteljih. Pripravite osnutek za posameznega dobavitelja." });
      return;
    }
    setArticleSelection([]);
    prepareSuggestedOrder(supplierId);
  };

  const busy = saveSettings.isPending || createOrder.isPending || updateOrder.isPending ||
    markSent.isPending || closeOrder.isPending || cancelOrder.isPending || createReceipt.isPending;

  return <main className="orders-page min-w-0 flex-1 overflow-auto bg-[#f7f4ec] p-3 sm:p-5 lg:p-7">
    {selectedOrderId !== null && !detailLoading && !detailError && orderDetail && (
      <SupplierOrderPrintView order={orderDetail} />
    )}
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col justify-between gap-4 border-b border-[#ded6c7] pb-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-[#52746d]">
            <span className="h-[1px] w-7 bg-[#52746d]" /> Operativa / Zaloge
          </div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-.04em] text-[#203d39] sm:text-[32px]">Naročila dobaviteljem</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#68736e]">Priprava nabave iz dejanskega stanja zalog. Naročilo je evidenca — zalogo posodobi šele potrjena prejemnica.</p>
        </div>
        <div className="orders-no-print flex flex-wrap gap-2">
          <Button variant="outline" className="border-[#cfc5b4] bg-[#fffefa] text-[#314a44]" onClick={() => { void refetchDashboard(); void refetchOrders(); }}>
            <RefreshCw className="mr-2 h-4 w-4" /> Osveži
          </Button>
          <Button className="bg-[#285d50] text-white hover:bg-[#204b41]" onClick={() => startNewOrder()}>
            <Plus className="mr-2 h-4 w-4" /> Novo naročilo
          </Button>
        </div>
      </header>

      {notice && <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${notice.error ? "border-rose-200 bg-rose-50 text-rose-900" : "border-[#cfe0d7] bg-[#edf5ef] text-[#285d50]"}`} role="status">
        {notice.error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
        <span className="flex-1">{notice.text}</span>
        <button type="button" aria-label="Zapri obvestilo" onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
      </div>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Predlogi za naročilo" value={dashboardLoading ? "…" : suggestions.length} caption="Artikli pod pragom oziroma s priporočeno količino" tone={suggestions.length > 0 ? "warning" : "normal"} />
        <Metric label="Pod pragom" value={dashboardLoading ? "…" : lowStock} caption="Stanje zaloge glede na nastavljeni minimum" tone={lowStock > 0 ? "warning" : "normal"} />
        <Metric label="Odprta naročila" value={dashboardLoading ? "…" : openOrders} caption="Osnutki, poslana in delno prejeta naročila" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-[#ded6c7] bg-[#eee9de] p-1">
          <button type="button" onClick={() => setActiveView("suggestions")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === "suggestions" ? "bg-[#fffefa] text-[#234d43] shadow-sm" : "text-[#64706a] hover:text-[#234d43]"}`}>
            Predlogi <span className="ml-1.5 rounded-full bg-[#e7eee8] px-2 py-0.5 text-[11px]">{suggestions.length}</span>
          </button>
          <button type="button" data-testid="tab-supplier-orders" onClick={() => setActiveView("orders")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === "orders" ? "bg-[#fffefa] text-[#234d43] shadow-sm" : "text-[#64706a] hover:text-[#234d43]"}`}>
            Naročila <span className="ml-1.5 rounded-full bg-[#e7eee8] px-2 py-0.5 text-[11px]">{orderList?.length ?? 0}</span>
          </button>
        </div>
        {activeView === "suggestions" ? <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78847e]" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Išči artikel…" className="h-10 border-[#ded6c7] bg-[#fffefa] pl-9" data-testid="input-search-articles" />
        </div> : <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as SupplierOrderStatus | "all")} className="h-10 rounded-lg border border-[#ded6c7] bg-[#fffefa] px-3 text-sm text-[#314a44]" aria-label="Filtriraj naročila po statusu">
          <option value="all">Vsi statusi</option>
          {Object.entries(statusCopy).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
      </div>

      {activeView === "suggestions" ? <section className="overflow-hidden rounded-2xl border border-[#ded6c7] bg-[#fffefa] shadow-[0_8px_28px_rgba(54,47,31,.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee8dc] px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-[#203d39]">Artikli za dopolnitev</h2>
            <p className="mt-0.5 text-xs text-[#77817b]">Količina naročila upošteva odprte količine iz že obstoječih naročil.</p>
          </div>
          <div className="orders-no-print flex gap-2">
            {articleSelection.length > 0 && <Button size="sm" variant="outline" onClick={startSelectedSuggested} className="border-[#c9d7cf] text-[#285d50]">
              <ShoppingCart className="mr-1.5 h-4 w-4" /> Pripravi izbrane ({articleSelection.length})
            </Button>}
            <Button size="sm" variant="outline" className="border-[#ded6c7]" onClick={() => setActiveView("orders")}><ClipboardList className="mr-1.5 h-4 w-4" /> Seznam naročil</Button>
          </div>
        </div>

        {dashboardError ? <div className="m-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <span>Pregleda zalog ni bilo mogoče naložiti.</span><Button variant="outline" size="sm" onClick={() => void refetchDashboard()}>Poskusi znova</Button>
        </div> : dashboardLoading ? <div className="space-y-3 p-5">
          {[1, 2, 3, 4].map(item => <div key={item} className="h-14 animate-pulse rounded-lg bg-[#f1eee6]" />)}
        </div> : filteredArticles.length === 0 ? <div className="px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf3ed] text-[#416c5e]"><PackageCheck className="h-6 w-6" /></div>
          <h3 className="mt-3 font-bold text-[#28453f]">{search ? "Ni zadetkov" : "Vse je pokrito"}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#748079]">{search ? "Poskusite z drugim imenom artikla." : "Trenutno ni artiklov s predlogom za ponovno naročilo. Pragove lahko uredite na seznamu zalog."}</p>
        </div> : <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-[#f7f4ec] text-[10px] font-bold uppercase tracking-[.13em] text-[#76817a]">
              <tr><th className="w-10 px-4 py-3"><span className="sr-only">Izberi</span></th><th className="px-2 py-3">Artikel</th><th className="px-3 py-3 text-right">Na zalogi</th><th className="px-3 py-3 text-right">Prag / cilj</th><th className="min-w-[230px] px-3 py-3">Dobavitelj / cena na osnovno enoto</th><th className="px-3 py-3 text-right">Predlog</th><th className="px-4 py-3 text-right">Uredi</th></tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece3]">
              {filteredArticles.map(article => {
                const mapping = article.mappings.find(item => item.id === article.preferredMappingId) ?? article.mappings.find(item => item.active);
                const comparableMappings = article.mappings
                  .map(item => ({ mapping: item, unitPrice: comparableUnitPrice(item, article.baseUnit) }))
                  .sort((a, b) => {
                    if (a.unitPrice == null) return b.unitPrice == null ? 0 : 1;
                    if (b.unitPrice == null) return -1;
                    return a.unitPrice - b.unitPrice;
                  });
                const validUnitPrices = comparableMappings
                  .map(item => item.unitPrice)
                  .filter((value): value is number => value !== null);
                const lowestUnitPrice = validUnitPrices.length ? Math.min(...validUnitPrices) : null;
                const under = article.reorderPoint != null && article.onHand <= article.reorderPoint;
                return <tr key={article.articleId} className="panel-lift hover:bg-[#fbfaf5]" data-testid={`row-reorder-article-${article.articleId}`}>
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Izberi ${article.articleName}`} checked={articleSelection.includes(article.articleId)} onChange={() => toggleArticle(article.articleId)} className="h-4 w-4 accent-[#285d50]" /></td>
                  <td className="px-2 py-3">
                    <div className="font-semibold text-[#28453f]">{article.articleName}</div>
                    <div className="mt-0.5 text-xs text-[#818a83]">{article.purchaseName || "Nabavno ime ni določeno"}</div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`data-mono font-semibold ${under ? "text-orange-800" : "text-[#344c45]"}`}>{formatQty(article.onHand)} <span className="text-xs font-normal text-[#858d87]">{article.baseUnit ?? ""}</span></span>
                    {under && <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">Pod pragom</div>}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-[#65736c]">
                    <span className="data-mono">{formatQty(article.reorderPoint)} / {formatQty(article.targetStock)}</span>
                    <div className="mt-0.5 text-[10px] text-[#949a94]">prag / cilj</div>
                  </td>
                  <td className="min-w-[230px] px-3 py-3">
                    {comparableMappings.length ? <div className="space-y-2">
                      {comparableMappings.map(({ mapping: supplierMapping, unitPrice }) => {
                        const packageFactorValid = Number.isFinite(supplierMapping.packageFactor)
                          && supplierMapping.packageFactor > 0;
                        const packagePriceValid = supplierMapping.lastPackagePrice != null
                          && Number.isFinite(supplierMapping.lastPackagePrice)
                          && supplierMapping.lastPackagePrice >= 0;
                        const isLowest = unitPrice != null && lowestUnitPrice != null
                          && Math.abs(unitPrice - lowestUnitPrice) <= 1e-9;
                        return <div key={supplierMapping.id} className="rounded-lg border border-[#eee8dc] bg-[#fbfaf6] px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-[#40574f]">{supplierMapping.supplierName}</span>
                            {supplierMapping.id === article.preferredMappingId && <span className="rounded bg-[#edf2e9] px-1.5 py-0.5 text-[10px] font-semibold text-[#52685f]">Izbran</span>}
                            {isLowest && <span data-testid={`lowest-unit-price-${supplierMapping.id}`} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">Najnižja cena / enoto</span>}
                          </div>
                          <div className="text-xs text-[#858d87]">
                            Trenutno pakiranje: {supplierMapping.packageName ?? "pakiranje"} · {packageFactorValid
                              ? article.baseUnit
                                ? `${formatQty(supplierMapping.packageFactor)} ${article.baseUnit} / pak.`
                                : `faktor ${formatQty(supplierMapping.packageFactor)}; enota ni določena`
                              : "velikost pakiranja ni veljavna"}
                          </div>
                          {packagePriceValid ? <div className="mt-1 space-y-0.5 text-xs text-[#68756e]" data-testid={`last-price-source-${supplierMapping.id}`}>
                            <div>Zadnja zabeležena cena pakiranja: {formatMoney(supplierMapping.lastPackagePrice)}</div>
                            {unitPrice != null
                              ? <div data-testid={`last-unit-price-${supplierMapping.id}`} className="font-semibold text-[#315247]">
                                Zadnja cena na osnovno enoto: {formatUnitMoney(unitPrice)} / {article.baseUnit}
                              </div>
                              : <div data-testid={`unavailable-unit-price-${supplierMapping.id}`}>
                                Cena na osnovno enoto ni prikazana{!packageFactorValid
                                  ? ": velikost pakiranja ni veljavna."
                                  : !article.baseUnit?.trim()
                                    ? ": osnovna enota ni določena."
                                    : "."}
                              </div>}
                            {supplierMapping.lastPriceReceipt
                              ? <div>
                                <button
                                  type="button"
                                  data-testid={`last-price-receipt-${supplierMapping.id}`}
                                  aria-label={`Odpri prejemnico št. ${supplierMapping.lastPriceReceipt.receiptNumber}`}
                                  onClick={() => {
                                    const sourceReceipt = supplierMapping.lastPriceReceipt;
                                    if (sourceReceipt) navigate(`/zaloge?prejemnica=${sourceReceipt.receiptId}&nacin=ogled`);
                                  }}
                                  className="text-left underline decoration-dotted underline-offset-2 hover:text-[#285d50] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#285d50]"
                                >
                                  Vir: prejemnica št. {supplierMapping.lastPriceReceipt.receiptNumber} · {formatReceiptDate(supplierMapping.lastPriceReceipt.date)}
                                </button>
                              </div>
                              : <div>Vir prejemnice ni zabeležen.</div>}
                          </div> : <div className="mt-1 text-xs text-[#858d87]">
                            {supplierMapping.lastPackagePrice == null ? "Zadnja cena ni zabeležena." : "Zadnja cena ni veljavna."}
                          </div>}
                        </div>;
                      })}
                    </div> : <span className="text-xs text-orange-800">Ni aktivne povezave</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {article.hasSuggestion && article.suggestedBaseQuantity != null ? <><strong className="data-mono text-[#285d50]">{formatQty(article.suggestedBaseQuantity)} {article.baseUnit}</strong><div className="mt-0.5 text-xs text-[#77817b]">{article.suggestedPackageQuantity != null ? `${formatQty(article.suggestedPackageQuantity)} ${mapping?.packageName ?? "pak."}` : "osnovna enota"}</div></> : <span className="text-xs text-[#969d97]">Nastavite cilj</span>}
                  </td>
                  <td className="orders-no-print px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => openSettings(article)} className="h-8 text-[#49665d]" aria-label={`Nastavi ${article.articleName}`}><Settings2 className="mr-1 h-3.5 w-3.5" /> Nastavi</Button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
        {!dashboardLoading && !dashboardError && suggestions.length > 0 && <div className="flex flex-col gap-2 border-t border-[#eee8dc] bg-[#fbfaf6] px-4 py-3 text-xs text-[#68756e] sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>Predlogi so informativni. Shranjeni osnutek ne spreminja zaloge ali računovodstva.</span>
          <div className="flex flex-wrap gap-2">
            {[...suggestedBySupplier.entries()].map(([supplierId, supplierArticles]) => {
              const supplierName = supplierArticles[0]?.mappings.find(mapping => mapping.supplierId === supplierId)?.supplierName ?? "Dobavitelj";
              return <Button key={supplierId} size="sm" variant="outline" className="h-8 border-[#cdd9d0] bg-[#fffefa] text-[#285d50]" onClick={() => prepareSuggestedOrder(supplierId)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Osnutek · {supplierName} ({supplierArticles.length})
              </Button>;
            })}
          </div>
        </div>}
      </section> : <section className="overflow-hidden rounded-2xl border border-[#ded6c7] bg-[#fffefa] shadow-[0_8px_28px_rgba(54,47,31,.04)]">
        <div className="flex items-center justify-between border-b border-[#eee8dc] px-4 py-4 sm:px-5">
          <div><h2 className="text-base font-bold text-[#203d39]">Evidenca naročil</h2><p className="mt-0.5 text-xs text-[#77817b]">Stanje naročila in dejanski prevzem sta ločena procesa.</p></div>
          <Button size="sm" variant="outline" className="orders-no-print border-[#ded6c7]" onClick={() => void refetchOrders()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Osveži</Button>
        </div>
        {ordersError ? <div className="m-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <span>Seznama naročil ni bilo mogoče naložiti.</span><Button variant="outline" size="sm" onClick={() => void refetchOrders()}>Poskusi znova</Button>
        </div> : ordersLoading ? <div className="space-y-3 p-5">{[1, 2, 3].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-[#f1eee6]" />)}</div> : filteredOrders.length === 0 ? <div className="px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf3ed] text-[#416c5e]"><FileText className="h-6 w-6" /></div>
          <h3 className="mt-3 font-bold text-[#28453f]">Za ta filter ni naročil</h3><p className="mt-1 text-sm text-[#748079]">Ustvarite osnutek iz predlogov ali dodajte naročilo ročno.</p>
          <Button className="mt-4 bg-[#285d50] text-white hover:bg-[#204b41]" onClick={() => startNewOrder()}><Plus className="mr-2 h-4 w-4" /> Novo naročilo</Button>
        </div> : <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-[#f7f4ec] text-[10px] font-bold uppercase tracking-[.13em] text-[#76817a]"><tr><th className="px-5 py-3">Številka</th><th className="px-3 py-3">Dobavitelj</th><th className="px-3 py-3">Ustvarjeno</th><th className="px-3 py-3">Predvidena dostava</th><th className="px-3 py-3 text-center">Postavke</th><th className="px-3 py-3">Status</th><th className="px-5 py-3 text-right">Odpri</th></tr></thead>
            <tbody className="divide-y divide-[#f0ece3]">{filteredOrders.map(order => <tr key={order.id} className="hover:bg-[#fbfaf5]" data-testid={`row-supplier-order-${order.id}`}>
              <td className="px-5 py-3"><span className="data-mono font-semibold text-[#285d50]">{order.number}</span></td>
              <td className="px-3 py-3 font-medium text-[#394e47]">{order.supplierName}</td>
              <td className="px-3 py-3 text-[#6b7770]">{formatDate(order.createdAt)}</td>
              <td className="px-3 py-3 text-[#6b7770]">{formatDate(order.expectedDeliveryDate)}</td>
              <td className="px-3 py-3 text-center data-mono text-[#50645b]">{order.lineCount}</td>
              <td className="px-3 py-3"><StatusPill status={order.status} /></td>
              <td className="orders-no-print px-5 py-3 text-right"><Button variant="ghost" size="sm" data-testid={`button-open-supplier-order-${order.id}`} className="text-[#285d50]" onClick={() => setSelectedOrderId(order.id)}>Podrobnosti <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>}

      <aside className="flex flex-col gap-3 rounded-xl border border-[#d8dfd4] bg-[#edf2e9] px-4 py-3 text-xs text-[#52685f] sm:flex-row sm:items-center">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#dce8db] text-[#3d685b]"><PackageCheck className="h-4 w-4" /></span>
        <p><strong className="text-[#315247]">Naročilo ne knjiži prevzema.</strong> Delni prevzem evidentirajte v povezani prejemnici na poti Zaloge; šele njena potrditev zabeleži dejansko količino.</p>
        <Button variant="link" className="h-auto shrink-0 p-0 text-[#285d50]" onClick={() => navigate("/zaloge")}>Odpri zaloge <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
      </aside>
    </div>

    {settingsArticle && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#172a25]/45 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsArticle(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="reorder-settings-title" className="w-full max-w-lg rounded-2xl border border-[#ddd4c4] bg-[#fffefa] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#628174]">Nastavitve dopolnjevanja</p><h2 id="reorder-settings-title" className="mt-1 text-xl font-bold text-[#203d39]">{settingsArticle.articleName}</h2></div><button type="button" onClick={() => setSettingsArticle(null)} className="rounded-lg p-2 text-[#718078] hover:bg-[#f2efe8]" aria-label="Zapri"><X className="h-4 w-4" /></button></div>
        <p className="mt-2 text-sm text-[#758078]">Vnesite osnovno enoto artikla{settingsArticle.baseUnit ? ` (${settingsArticle.baseUnit})` : ""}. Cilj določa količino, do katere dopolnjujemo zalogo.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-[#5f7068]">Prag zaloge<Input type="number" min="0" step="0.001" value={settingPoint} onChange={event => setSettingPoint(event.target.value)} className="mt-1.5 border-[#dcd4c6]" placeholder="0" /></label>
          <label className="text-xs font-semibold text-[#5f7068]">Ciljna zaloga<Input type="number" min="0.001" step="0.001" value={settingTarget} onChange={event => setSettingTarget(event.target.value)} className="mt-1.5 border-[#dcd4c6]" placeholder="0" /></label>
        </div>
        <label className="mt-4 block text-xs font-semibold text-[#5f7068]">Prednostna postavka dobavitelja
          <select value={settingMapping} onChange={event => setSettingMapping(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[#dcd4c6] bg-white px-3 text-sm font-normal text-[#344b43]">
            <option value="">Brez prednostne povezave</option>
            {settingsArticle.mappings.map(mapping => <option key={mapping.id} value={mapping.id} disabled={!mapping.active}>{mapping.supplierName} · {mapping.supplierItemName ?? mapping.packageName ?? "dobaviteljska postavka"}{mapping.active ? "" : " (neaktivna)"}</option>)}
          </select>
        </label>
        <div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setSettingsArticle(null)}>Prekliči</Button><Button disabled={saveSettings.isPending} onClick={() => void saveArticleSettings()} className="bg-[#285d50] text-white hover:bg-[#204b41]">{saveSettings.isPending ? "Shranjujem…" : "Shrani nastavitev"}</Button></div>
      </section>
    </div>}

    {orderEditor && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#172a25]/50 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setOrderEditor(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="order-editor-title" className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#ddd4c4] bg-[#fffefa] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#eee8dc] bg-[#fffefa]/95 px-5 py-4 backdrop-blur">
          <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#628174]">{orderEditor.id ? "Uredi osnutek" : "Nov osnutek"}</p><h2 id="order-editor-title" className="mt-1 text-xl font-bold text-[#203d39]">Naročilo dobavitelju</h2></div>
          <button type="button" onClick={() => setOrderEditor(null)} aria-label="Zapri" className="rounded-lg p-2 text-[#718078] hover:bg-[#f2efe8]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-[#5f7068]">Dobavitelj
              <select value={orderEditor.supplierId} onChange={event => setOrderEditor({ ...orderEditor, supplierId: event.target.value, rows: [] })} disabled={!!orderEditor.id} className="mt-1.5 h-10 w-full rounded-lg border border-[#dcd4c6] bg-white px-3 text-sm font-normal text-[#344b43]">
                <option value="">Izberi dobavitelja</option>
                {[...new Map(articles.flatMap(article => article.mappings).map(mapping => [mapping.supplierId, mapping])).values()].map(mapping => <option key={mapping.supplierId} value={mapping.supplierId}>{mapping.supplierName}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#5f7068]">Predviden datum dostave<Input type="date" value={orderEditor.date} onChange={event => setOrderEditor({ ...orderEditor, date: event.target.value })} className="mt-1.5 border-[#dcd4c6]" /></label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#e6dfd2]">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-[#f7f4ec] text-[10px] font-bold uppercase tracking-[.12em] text-[#748078]"><tr><th className="px-3 py-2.5">Postavka / pakiranje</th><th className="w-32 px-3 py-2.5 text-right">Pakiranj</th><th className="w-36 px-3 py-2.5 text-right">Cena / pak.</th><th className="w-12 px-3 py-2.5"></th></tr></thead>
              <tbody className="divide-y divide-[#eee8dc]">{orderEditor.rows.map((row, index) => {
                const mapping = articles.flatMap(article => article.mappings).find(item => item.id === row.supplierMappingId);
                const article = articles.find(item => item.mappings.some(mappingItem => mappingItem.id === row.supplierMappingId));
                return <tr key={`${row.supplierMappingId}-${index}`}>
                  <td className="px-3 py-3"><div className="font-semibold text-[#344d45]">{article?.articleName ?? "Artikel"}</div><div className="text-xs text-[#7b867f]">{mapping?.supplierItemName ?? article?.purchaseName ?? mapping?.packageName ?? "Dobaviteljska postavka"} · faktor {formatQty(mapping?.packageFactor)}</div></td>
                  <td className="px-3 py-3"><Input type="number" min="0.001" step="0.001" value={row.packageQuantity} onChange={event => setOrderEditor({ ...orderEditor, rows: orderEditor.rows.map((line, i) => i === index ? { ...line, packageQuantity: Number(event.target.value) } : line) })} className="h-9 border-[#ded6c7] text-right data-mono" aria-label={`Količina pakiranj ${article?.articleName ?? ""}`} /></td>
                  <td className="px-3 py-3"><Input type="number" min="0" step="0.01" value={row.unitPrice ?? ""} onChange={event => setOrderEditor({ ...orderEditor, rows: orderEditor.rows.map((line, i) => i === index ? { ...line, unitPrice: event.target.value === "" ? undefined : Number(event.target.value) } : line) })} className="h-9 border-[#ded6c7] text-right data-mono" placeholder="—" aria-label={`Cena pakiranja ${article?.articleName ?? ""}`} /></td>
                  <td className="px-2 py-3"><button type="button" onClick={() => setOrderEditor({ ...orderEditor, rows: orderEditor.rows.filter((_, i) => i !== index) })} className="rounded p-1.5 text-[#9a6256] hover:bg-rose-50" aria-label="Odstrani postavko"><X className="h-4 w-4" /></button></td>
                </tr>;
              })}</tbody>
            </table>
            {orderEditor.rows.length === 0 && <p className="px-4 py-5 text-center text-sm text-[#7b867f]">Za izbranega dobavitelja še ni postavk.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="text-xs font-semibold text-[#5f7068]">Dodaj postavko
              <select value="" onChange={event => {
                const mappingId = Number(event.target.value);
                const mapping = articles.flatMap(article => article.mappings).find(item => item.id === mappingId);
                if (!mapping || orderEditor.rows.some(line => line.supplierMappingId === mappingId)) return;
                const article = articles.find(item => item.mappings.some(itemMapping => itemMapping.id === mappingId));
                setOrderEditor({ ...orderEditor, rows: [...orderEditor.rows, { supplierMappingId: mappingId, packageQuantity: article?.suggestedPackageQuantity && mappingId === article.preferredMappingId ? article.suggestedPackageQuantity : 1, unitPrice: mapping.lastPackagePrice ?? undefined }] });
              }} disabled={!orderEditor.supplierId} className="mt-1.5 h-10 w-full rounded-lg border border-[#dcd4c6] bg-white px-3 text-sm font-normal text-[#344b43]">
                <option value="">Izberi aktivno pakiranje…</option>
                {articles.flatMap(article => article.mappings.filter(mapping => mapping.active && mapping.supplierId === orderEditor.supplierId).map(mapping => <option key={mapping.id} value={mapping.id}>{article.articleName} · {mapping.packageName ?? mapping.supplierItemName ?? "pakiranje"}</option>))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[#5f7068]">Interna opomba · samo za zaposlene
                <textarea value={orderEditor.internalNotes} onChange={event => setOrderEditor({ ...orderEditor, internalNotes: event.target.value })} maxLength={MAX_ORDER_NOTE_LENGTH} rows={3} className="mt-1.5 w-full rounded-lg border border-[#dcd4c6] bg-white px-3 py-2 text-sm font-normal text-[#344b43] outline-none focus-visible:ring-2 focus-visible:ring-[#285d50]" placeholder="Besedilo ostane v aplikaciji in se ne natisne." />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-copy-internal-to-supplier"
                disabled={!orderEditor.internalNotes.trim() || supplierNoteCopyOverLimit}
                onClick={copyInternalNoteToSupplierNotes}
                className="orders-no-print mt-2 border-[#c9d7cf] text-[#285d50]"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Kopiraj v navodilo dobavitelju
              </Button>
              {supplierNoteCopyOverLimit && <p role="alert" className="mt-1 text-xs text-rose-800">
                Kopija bi presegla omejitev {MAX_ORDER_NOTE_LENGTH} znakov. Skrajšajte besedilo; nič ne bo skrajšano samodejno.
              </p>}
              <p className="mt-1 text-[11px] leading-relaxed text-[#77817b]">
                Kopija se doda na konec obstoječega navodila. Izvirna opomba ostane nespremenjena; pred shranjevanjem preglejte besedilo.
              </p>
            </div>
            <label className="text-xs font-semibold text-[#5f7068]">Navodilo dobavitelju · natisne se
              <textarea value={orderEditor.supplierNotes} onChange={event => setOrderEditor({ ...orderEditor, supplierNotes: event.target.value })} maxLength={MAX_ORDER_NOTE_LENGTH} rows={3} className="mt-1.5 w-full rounded-lg border border-[#dcd4c6] bg-white px-3 py-2 text-sm font-normal text-[#344b43] outline-none focus-visible:ring-2 focus-visible:ring-[#285d50]" placeholder="Samo to besedilo bo vključeno v izpis." />
            </label>
          </div>
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {orderEditor.id
              ? "Interna opomba je vidna samo zaposlenim in se ne natisne. Prej shranjene enotne opombe so ohranjene v tem polju; če je katera namenjena dobavitelju, jo izrecno kopirajte v ločeno navodilo in ga preglejte."
              : "Interna opomba se ne natisne. Za besedilo, namenjeno dobavitelju, uporabite ločeno polje ali ga izrecno kopirajte z gumbom ob interni opombi."}
          </p>
          <p className="rounded-lg bg-[#f2f4ed] px-3 py-2 text-xs leading-relaxed text-[#66746b]">Po shranjevanju lahko naročilo pregledate in natisnete; v izpisu bo samo shranjeno navodilo dobavitelju. Shranjevanje ali označitev kot poslano ne spremeni zaloge in ne ustvari računovodske knjižbe.</p>
        </div>
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-[#eee8dc] bg-[#fffefa]/95 px-5 py-4 backdrop-blur"><Button variant="outline" onClick={() => setOrderEditor(null)}>Prekliči</Button><Button disabled={busy} onClick={() => void saveOrderDraft()} className="bg-[#285d50] text-white hover:bg-[#204b41]">{busy ? "Shranjujem…" : "Shrani osnutek"}</Button></div>
      </section>
    </div>}

    {selectedOrderId !== null && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#172a25]/50 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedOrderId(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="order-detail-title" className="max-h-[94dvh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#ddd4c4] bg-[#fffefa] shadow-2xl">
        {detailLoading ? <div className="space-y-4 p-8"><div className="h-7 w-52 animate-pulse rounded bg-[#eee9de]" /><div className="h-20 animate-pulse rounded-xl bg-[#f1eee6]" /><div className="h-48 animate-pulse rounded-xl bg-[#f1eee6]" /></div>
        : detailError || !orderDetail ? <div className="p-8 text-center"><AlertCircle className="mx-auto h-8 w-8 text-rose-700" /><h2 className="mt-3 font-bold text-[#203d39]">Podrobnosti niso na voljo</h2><p className="mt-1 text-sm text-[#758078]">Naročila ni bilo mogoče naložiti.</p><Button variant="outline" className="mt-4" onClick={() => void refetchDetail()}>Poskusi znova</Button></div>
        : <>
          <div className="flex flex-col gap-3 border-b border-[#eee8dc] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><h2 id="order-detail-title" className="data-mono text-xl font-bold text-[#203d39]">{orderDetail.number}</h2><StatusPill status={orderDetail.status} /></div><p className="mt-1 text-sm text-[#66746b]">{orderDetail.supplierName} <span className="mx-1.5 text-[#b7b9ae]">·</span> ustvarjeno {formatDate(orderDetail.createdAt)}</p></div>
            <div className="orders-no-print flex flex-wrap gap-2"><Button size="sm" variant="outline" data-testid={`button-print-supplier-order-${orderDetail.id}`} onClick={requestPrintOrder}><Printer className="mr-1.5 h-3.5 w-3.5" /> Natisni / PDF</Button>{orderDetail.status === "draft" && <Button size="sm" variant="outline" onClick={editSelectedOrder}>Uredi osnutek</Button>}<button type="button" onClick={() => setSelectedOrderId(null)} aria-label="Zapri" className="rounded-lg p-2 text-[#718078] hover:bg-[#f2efe8]" data-testid="button-close-supplier-order-detail"><X className="h-4 w-4" /></button></div>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#e6dfd2] bg-[#fbfaf6] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#77817b]">Predvidena dostava</p><p className="mt-1 font-semibold text-[#344d45]">{formatDate(orderDetail.expectedDeliveryDate)}</p></div>
              <div className="rounded-xl border border-[#e6dfd2] bg-[#fbfaf6] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#77817b]">Odprta količina</p><p className="data-mono mt-1 font-semibold text-[#344d45]">{formatQty(orderDetail.openQuantity)}</p></div>
              <div className="rounded-xl border border-[#e6dfd2] bg-[#fbfaf6] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#77817b]">Označeno kot poslano</p><p className="mt-1 font-semibold text-[#344d45]">{formatDate(orderDetail.sentAt)}</p></div>
            </div>
            {(orderDetail.internalNotes || orderDetail.supplierNotes) && <div className="grid gap-3 sm:grid-cols-2">
              {orderDetail.internalNotes && <section className="rounded-lg bg-[#f4f1e9] px-3 py-2 text-sm text-[#65736b]">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#59695f]">Interna opomba · ne natisne se</h3>
                <p className="mt-1 whitespace-pre-wrap">{orderDetail.internalNotes}</p>
              </section>}
              {orderDetail.supplierNotes && <section className="rounded-lg border border-[#d8dfd4] bg-[#edf2e9] px-3 py-2 text-sm text-[#52685f]">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#315247]">Navodilo dobavitelju · natisne se</h3>
                <p className="mt-1 whitespace-pre-wrap">{orderDetail.supplierNotes}</p>
              </section>}
            </div>}
            {orderDetail.closedReason && <p className="rounded-lg border border-[#e7dfd2] bg-[#f5f2eb] px-3 py-2 text-sm text-[#66736d]"><strong>Razlog zaprtja:</strong> {orderDetail.closedReason}</p>}
            <div className="overflow-x-auto rounded-xl border border-[#e6dfd2]">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-[#f7f4ec] text-[10px] font-bold uppercase tracking-[.12em] text-[#748078]"><tr><th className="px-3 py-2.5">Artikel</th><th className="px-3 py-2.5">Pakiranje</th><th className="px-3 py-2.5 text-right">Naročeno</th><th className="px-3 py-2.5 text-right">Prejeto</th><th className="px-3 py-2.5 text-right">Odprto</th></tr></thead>
                <tbody className="divide-y divide-[#eee8dc]">{orderDetail.lines.map(line => <tr key={line.id} data-testid={`row-order-line-${line.id}`}>
                  <td className="px-3 py-3"><div className="font-semibold text-[#344d45]">{line.articleName}</div><div className="text-xs text-[#818a83]">{line.supplierItemName ?? line.supplierCode ?? ""}</div></td>
                  <td className="px-3 py-3 text-xs text-[#69766e]">{formatQty(line.packageQuantity)} × {line.packageName ?? "pak."} <span className="text-[#9aa19b]">({formatQty(line.packageFactor)} {line.baseUnit})</span></td>
                  <td className="data-mono px-3 py-3 text-right">{formatQty(line.orderedBaseQuantity)} {line.baseUnit}</td>
                  <td className="data-mono px-3 py-3 text-right text-[#46705e]">{formatQty(line.receivedBaseQuantity)} {line.baseUnit}</td>
                  <td className="data-mono px-3 py-3 text-right font-semibold text-[#354e45]">{formatQty(line.openBaseQuantity)} {line.baseUnit}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="rounded-xl border border-[#d8dfd4] bg-[#edf2e9] p-3 text-xs leading-relaxed text-[#52685f]"><strong className="text-[#315247]">Prevzem in zaloga:</strong> priprava prejemnice uporabi samo odprte količine in poveže vrstico z naročilom. Prejemnico nato dokončate v Zaloge; samo potrditev prejemnice evidentira dejanski oziroma delni prevzem.</div>
          </div>
          <div className="orders-no-print sticky bottom-0 flex flex-wrap justify-between gap-2 border-t border-[#eee8dc] bg-[#fffefa]/95 px-5 py-4 backdrop-blur">
            <div className="flex flex-wrap gap-2">
              {orderDetail.status === "draft" && <Button variant="outline" disabled={busy} onClick={() => void performOrderAction("cancel")} className="border-rose-200 text-rose-800 hover:bg-rose-50">Prekliči naročilo</Button>}
              {["sent", "partially_received"].includes(orderDetail.status) && <Button variant="outline" onClick={() => setCloseDialog(true)}>Zapri z razlogom</Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {orderDetail.status === "draft" && <Button disabled={busy} onClick={() => void performOrderAction("send")} className="bg-[#285d50] text-white hover:bg-[#204b41]"><Send className="mr-2 h-4 w-4" /> Označi kot poslano</Button>}
              {["sent", "partially_received"].includes(orderDetail.status) && orderDetail.openQuantity > 0 && <Button disabled={busy} onClick={() => void prepareReceipt()} className="bg-[#285d50] text-white hover:bg-[#204b41]"><ArrowDownToLine className="mr-2 h-4 w-4" /> Pripravi prejemnico</Button>}
              <Button variant="outline" onClick={() => { setSelectedOrderId(null); navigate("/zaloge"); }}>Odpri Zaloge <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </>}
      </section>
    </div>}

    {printWarningOpen && orderDetail && <div className="orders-no-print fixed inset-0 z-[120] flex items-center justify-center bg-[#172a25]/60 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setPrintWarningOpen(false); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="supplier-order-print-warning-title" aria-describedby="supplier-order-print-warning-description" className="w-full max-w-lg rounded-2xl border border-amber-300 bg-[#fffefa] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 id="supplier-order-print-warning-title" className="text-lg font-bold text-[#203d39]">Naročilo nima navodila za dobavitelja</h2>
            <p id="supplier-order-print-warning-description" className="mt-1 text-sm leading-relaxed text-[#66746b]">
              {orderDetail.status === "draft"
                ? "Interna opomba se ne bo natisnila. Če je namenjena dobavitelju, jo najprej izrecno kopirajte v navodilo in shranite osnutek. Če nadaljujete, bo izpis brez navodil."
                : "Interna opomba se ne bo natisnila, naročila pa ni več mogoče urejati. Če nadaljujete, bo izpis brez navodil."}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" data-testid="button-dismiss-supplier-order-print-warning" onClick={() => setPrintWarningOpen(false)}>Nazaj na naročilo</Button>
          {orderDetail.status === "draft" && <Button variant="outline" data-testid="button-edit-supplier-order-from-print-warning" onClick={() => { setPrintWarningOpen(false); editSelectedOrder(); }}>Uredi osnutek</Button>}
          <Button data-testid="button-continue-supplier-order-print" onClick={continuePrintOrder} className="bg-[#285d50] text-white hover:bg-[#204b41]">Nadaljuj s tiskom</Button>
        </div>
      </section>
    </div>}

    {closeDialog && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#172a25]/55 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setCloseDialog(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="close-order-title" className="w-full max-w-md rounded-2xl border border-[#ddd4c4] bg-[#fffefa] p-5 shadow-2xl">
        <h2 id="close-order-title" className="text-lg font-bold text-[#203d39]">Zapri naročilo</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#758078]">Nedobavljena odprta količina se zaključi z navedenim razlogom. Že potrjeni prevzemi ostanejo evidentirani.</p>
        <label className="mt-4 block text-xs font-semibold text-[#5f7068]">Razlog zaprtja<Input autoFocus value={closeReason} onChange={event => setCloseReason(event.target.value)} maxLength={500} placeholder="Npr. dobavitelj ne more dobaviti preostanka" className="mt-1.5 border-[#dcd4c6]" /></label>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setCloseDialog(false)}>Nazaj</Button><Button disabled={closeOrder.isPending} onClick={() => void performOrderAction("close")} className="bg-[#285d50] text-white hover:bg-[#204b41]">{closeOrder.isPending ? "Zapiram…" : "Potrdi zaprtje"}</Button></div>
      </section>
    </div>}
    {packageReview && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#172a25]/60 p-3">
      <section role="alertdialog" aria-modal="true" aria-labelledby="package-change-title" className="w-full max-w-xl rounded-2xl border border-amber-300 bg-[#fffefa] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 id="package-change-title" className="text-lg font-bold text-[#203d39]">Pakiranje se je spremenilo</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66746b]">Naročilo ohrani pakiranje ob oddaji. Pred pripravo prejemnice preverite dejansko količino; spodnja razlika ne spreminja naročila ali že shranjenih prejemnic.</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-amber-100 rounded-xl border border-amber-200 bg-amber-50/60">
          {packageReview.lines.map(line => <div key={line.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div>
              <p className="font-semibold text-[#344d45]">{line.articleName}</p>
              <p className="text-xs text-[#748078]">Odprto za prevzem: {formatQty(line.openBaseQuantity)} {line.baseUnit ?? ""}</p>
            </div>
            <p className="text-xs text-[#66746b]"><span className="block font-semibold text-[#344d45]">Ob oddaji</span>{formatQty(line.packageFactor)} {line.baseUnit ?? ""} / pak.</p>
            <p className="text-xs text-[#66746b]"><span className="block font-semibold text-[#344d45]">Trenutno pakiranje</span>{formatQty(line.currentPackageFactor)} {line.baseUnit ?? ""} / pak.</p>
          </div>)}
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-[#e6dfd2] bg-white px-3 py-2.5 text-sm text-[#485b52]">
          <input
            type="checkbox"
            checked={packageReviewAcknowledged}
            onChange={event => setPackageReviewAcknowledged(event.target.checked)}
            className="mt-0.5 accent-[#285d50]"
          />
          <span>Preveril/-a sem dejansko količino glede na trenutno pakiranje.</span>
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => { setPackageReview(null); setPackageReviewAcknowledged(false); }}>Prekliči</Button>
          <Button
            disabled={!packageReviewAcknowledged || busy}
            onClick={() => { if (packageReviewAcknowledged) void createReceiptDraft(packageReview.order); }}
            className="bg-[#285d50] text-white hover:bg-[#204b41]"
          >
            {createReceipt.isPending ? "Pripravljam…" : "Nadaljuj na prejemnico"}
          </Button>
        </div>
      </section>
    </div>}
  </main>;
}
