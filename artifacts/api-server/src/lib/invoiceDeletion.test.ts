import { describe, expect, it } from "vitest";
import { getInvoiceDeletionFailure } from "./invoiceDeletion";

describe("invoice deletion errors", () => {
  const pg = { code: "23503", constraint: "documents_linked_invoice_id_invoices_id_fk" };
  it.each([pg, { cause: pg }, { cause: { cause: pg } }])("recognizes direct and wrapped document references", (error) => {
    expect(getInvoiceDeletionFailure(error)).toMatchObject({
      status: 409, message: expect.stringContaining("Najprej razvežite ali odstranite vezani dokument"),
    });
  });
  it("does not mislabel other references or leak unknown database errors", () => {
    expect(getInvoiceDeletionFailure({ ...pg, constraint: "other_fk" }).message).not.toContain("vezani dokument");
    expect(getInvoiceDeletionFailure(new Error("SQL secret"))).toMatchObject({ status: 500 });
    expect(getInvoiceDeletionFailure(new Error("SQL secret")).message).not.toContain("SQL");
  });
  it("handles cyclic error causes", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(getInvoiceDeletionFailure(error).status).toBe(500);
  });
});
