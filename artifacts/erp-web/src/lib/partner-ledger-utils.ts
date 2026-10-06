import { formatDatum } from "@/lib/utils";
export const fmt = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : Number(v).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (v?: string | null) => (v ? formatDatum(v) : "-");
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const today = () => new Date().toISOString().split("T")[0];
