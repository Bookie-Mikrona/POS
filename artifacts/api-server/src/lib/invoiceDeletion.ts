export function getInvoiceDeletionFailure(error: unknown): { status: number; message: string } {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const pg = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === "23503") {
      return {
        status: 409,
        message: pg.constraint === "documents_linked_invoice_id_invoices_id_fk"
          ? "Računa ni mogoče izbrisati, ker je nanj vezan dokument. Najprej razvežite ali odstranite vezani dokument in nato znova poskusite izbrisati račun."
          : "Računa ni mogoče izbrisati, ker je povezan z drugim poslovnim zapisom. Najprej preverite povezane zapise.",
      };
    }
    current = pg.cause;
  }
  return {
    status: 500,
    message: "Računa trenutno ni bilo mogoče izbrisati. Podatki so ostali nespremenjeni. Poskusite znova pozneje.",
  };
}
