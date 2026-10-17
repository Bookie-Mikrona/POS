import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type InvoiceRecord } from "@workspace/api-client-react";
import { DeleteInvoiceDialog } from "./racuni";

const state = vi.hoisted(() => ({ mutation: { mutate: vi.fn(), isPending: false, error: null as unknown } }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useDeleteInvoice: () => state.mutation,
}));

describe("invoice deletion dialog", () => {
  beforeEach(() => {
    state.mutation = { mutate: vi.fn(), isPending: false, error: null };
  });
  const invoice = { id: "invoice-1", invoiceNumber: "R-1" } as InvoiceRecord;
  it("submits only after confirmation and passes the selected company and invoice", () => {
    const onDeleted = vi.fn();
    render(<DeleteInvoiceDialog companyId="company-1" invoice={invoice} onClose={vi.fn()} onDeleted={onDeleted} />);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Izbriši osnutek" }));
    expect(state.mutation.mutate).toHaveBeenCalledWith({ companyId: "company-1", id: "invoice-1" }, { onSuccess: onDeleted });
  });
  it("renders the actionable message without HTTP or database details", () => {
    const message = "Računa ni mogoče izbrisati. Najprej razvežite ali odstranite vezani dokument.";
    state.mutation.error = new ApiError(new Response(null, { status: 409 }), { error: message }, { method: "DELETE", url: "/test" });
    render(<DeleteInvoiceDialog companyId="company-1" invoice={invoice} onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/HTTP|23503|linked_invoice_id/);
  });
  it("does not expose raw errors and prevents duplicate requests while pending", () => {
    state.mutation.error = new Error("PostgreSQL constraint internal");
    state.mutation.isPending = true;
    render(<DeleteInvoiceDialog companyId="company-1" invoice={invoice} onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/PostgreSQL|constraint/);
    expect(screen.getByRole("button", { name: "Izbriši osnutek" })).toBeDisabled();
  });
});
