import { useState } from "react";
import { Loader2, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { exportFinancialStatementExcel, type FinancialStatementExcelOptions } from "@/lib/financialStatementExcel";

export function FinancialStatementXlsxButton({ options, disabled }: { options: FinancialStatementExcelOptions; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  async function handleExport() {
    setLoading(true);
    try {
      await exportFinancialStatementExcel(options);
      trackEvent("report_exported", { report_type: options.reportType, format: "xlsx" });
    } catch (error) {
      alert(`Napaka pri izvozu XLSX: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button variant="outline" className="h-9 gap-1.5 print:hidden" disabled={disabled || loading} onClick={handleExport}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
      Izvozi XLSX
    </Button>
  );
}
