import type { DimensionReportRow } from "@workspace/api-client-react";
import { DIMENSION_EXCEL_FAILURE_MESSAGE, validateDimensionExcelSize } from "./dimensionReportExcelLimits";

export interface DimensionReportExcelOptions {
  rows: DimensionReportRow[];
  grandTotalDebit: string;
  grandTotalCredit: string;
  grandTotalBalance: string;
  dimensionLabel: string;
  dateFrom: string;
  dateTo: string;
  accountLabel?: string;
  companyName?: string;
  untagged?: {
    debit: string;
    credit: string;
    balance: string;
  };
}

export function createDimensionReportExcelBuffer(options: DimensionReportExcelOptions): Promise<ArrayBuffer> {
  // Validate before cloning data or starting an allocation-heavy worker.
  validateDimensionExcelSize(options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./dimensionReportExcel.worker.ts", import.meta.url), { type: "module" });
    const fail = () => {
      worker.terminate();
      clearTimeout(timeout);
      reject(new Error(DIMENSION_EXCEL_FAILURE_MESSAGE));
    };
    const timeout = setTimeout(fail, 120_000);
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
      worker.terminate();
      clearTimeout(timeout);
      if (data.buffer instanceof ArrayBuffer && data.buffer.byteLength > 0) resolve(data.buffer);
      else reject(new Error(data.error || DIMENSION_EXCEL_FAILURE_MESSAGE));
    };
    try {
      // Account breakdowns are not exported: do not duplicate them into worker memory.
      worker.postMessage({
        ...options,
        rows: options.rows.map(({ id, code, name, totalDebit, totalCredit, balance }) =>
          ({ id, code, name, totalDebit, totalCredit, balance })),
      });
    } catch {
      fail();
    }
  });
}

export async function exportDimensionReportExcel(options: DimensionReportExcelOptions) {
  const buffer = await createDimensionReportExcelBuffer(options);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    const dates = options.dateFrom && options.dateTo ? `_${options.dateFrom}_${options.dateTo}` : "";
    anchor.download = `porocilo_dimenzije_${options.dimensionLabel.replace(/\s+/g, "_")}${dates}.xlsx`;
    anchor.click();
  } finally {
    // Keep the URL alive until the browser has accepted the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
