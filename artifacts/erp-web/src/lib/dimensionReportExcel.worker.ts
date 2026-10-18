import { buildDimensionReportWorkbook } from "./dimensionReportExcelWorkbook";
import type { DimensionReportExcelOptions } from "./dimensionReportExcel";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DimensionReportExcelOptions>) => Promise<void>) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const bytes = await buildDimensionReportWorkbook(data).xlsx.writeBuffer();
    // ExcelJS may return a Uint8Array rather than an ArrayBuffer.
    const buffer = new Uint8Array(bytes as unknown as ArrayBuffer).slice().buffer;
    scope.postMessage({ buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : "Izvoz v Excel ni uspel." });
  }
};
