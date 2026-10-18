import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ErpSmtpSettings } from "./erp-smtp-settings";

const mocks = vi.hoisted(() => ({
  settings: { configured: true, host: "mail.example.si", port: 465, user: "smtp-user", from: "relay@example.si", passwordSet: true },
  save: vi.fn(), test: vi.fn(), refetch: vi.fn(), remove: vi.fn(),
  removeError: null as Error | null,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetErpSmtpSettingsQueryKey: (companyId: string) => ["smtp", companyId],
  useGetErpSmtpSettings: (companyId: string) => {
    const query = useQuery({ queryKey: ["smtp", companyId], queryFn: async () => mocks.settings, initialData: mocks.settings, staleTime: Infinity });
    return { ...query, refetch: mocks.refetch };
  },
  useSaveErpSmtpSettings: () => ({ mutateAsync: mocks.save, reset: vi.fn(), isPending: false }),
  useTestErpSmtpSettings: () => ({ mutateAsync: mocks.test, reset: vi.fn(), isPending: false }),
  useDeleteErpSmtpSettings: () => ({ mutateAsync: mocks.remove, reset: vi.fn(), isPending: false, error: mocks.removeError }),
}));
function renderSettings(companyId: string) {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><ErpSmtpSettings companyId={companyId} /></QueryClientProvider>);
  return { client, ...view };
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.removeError = null;
  mocks.remove.mockResolvedValue({ configured: false, passwordSet: false, host: "", port: 465, user: "", from: "" });
  mocks.save.mockResolvedValue(mocks.settings);
  mocks.test.mockResolvedValue({ success: true });
  mocks.refetch.mockResolvedValue({ data: mocks.settings });
});

describe("ERP SMTP settings form", () => {
  it("loads saved fields without a password, saves changes for the active company", async () => {
    renderSettings("company-a");
    expect((screen.getByLabelText("SMTP strežnik") as HTMLInputElement).value).toBe("mail.example.si");
    expect((screen.getByLabelText("Geslo") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("SMTP strežnik"), { target: { value: "other.example.si" } });
    expect((screen.getByText("Pošlji testno e-pošto") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Shrani SMTP nastavitve"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      companyId: "company-a", data: expect.objectContaining({ host: "other.example.si", password: "" }),
    }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("shranjene"));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
  it("sends a test to the entered recipient using saved settings", async () => {
    renderSettings("company-b");
    fireEvent.change(screen.getByLabelText("Prejemnik testnega sporočila"), { target: { value: "test@example.si" } });
    fireEvent.click(screen.getByText("Pošlji testno e-pošto"));
    await waitFor(() => expect(mocks.test).toHaveBeenCalledWith({
      companyId: "company-b", data: { recipient: "test@example.si" },
    }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("sprejel testno sporočilo"));
  });
  it("does not delete on opening or cancelling confirmation", () => {
    renderSettings("company-a");
    fireEvent.click(screen.getByText("Izklopi pošiljanje poročil"));
    expect(screen.getByRole("alertdialog").textContent).toContain("shranjeno geslo");
    expect(screen.getByRole("alertdialog").textContent).toContain("PDF ostane na voljo");
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Prekliči"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((screen.getByLabelText("SMTP strežnik") as HTMLInputElement).value).toBe("mail.example.si");
  });
  it("removes the active company's settings after confirmation and clears even an unsaved password", async () => {
    const { client } = renderSettings("company-b");
    fireEvent.change(screen.getByLabelText("Geslo"), { target: { value: "unsaved-password" } });
    fireEvent.click(screen.getByText("Izklopi pošiljanje poročil"));
    fireEvent.click(screen.getByText("Izklopi in odstrani nastavitve"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ companyId: "company-b" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(client.getQueryData(["smtp", "company-b"])).toMatchObject({ configured: false, passwordSet: false });
    expect((screen.getByLabelText("Geslo") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Geslo") as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText("SMTP strežnik") as HTMLInputElement).value).toBe("");
    expect((screen.getByText("Pošlji testno e-pošto") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Izklopi pošiljanje poročil")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Prenos PDF-jev ostaja na voljo");
  });
  it("keeps settings and confirmation when deletion fails", async () => {
    mocks.remove.mockRejectedValue(new Error("Izklop ni uspel."));
    mocks.removeError = new Error("Izklop ni uspel.");
    const { client } = renderSettings("company-a");
    fireEvent.click(screen.getByText("Izklopi pošiljanje poročil"));
    fireEvent.click(screen.getByText("Izklopi in odstrani nastavitve"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Izklop ni uspel.");
    expect(client.getQueryData(["smtp", "company-a"])).toEqual(mocks.settings);
    expect((screen.getByLabelText("SMTP strežnik") as HTMLInputElement).value).toBe("mail.example.si");
  });
});
