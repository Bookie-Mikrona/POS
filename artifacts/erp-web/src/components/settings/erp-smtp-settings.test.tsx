import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErpSmtpSettings } from "./erp-smtp-settings";

const mocks = vi.hoisted(() => ({
  settings: { configured: true, host: "mail.example.si", port: 465, user: "smtp-user", from: "relay@example.si", passwordSet: true },
  save: vi.fn(), test: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetErpSmtpSettingsQueryKey: (companyId: string) => ["smtp", companyId],
  useGetErpSmtpSettings: () => ({ data: mocks.settings, isLoading: false, isError: false, refetch: mocks.refetch }),
  useSaveErpSmtpSettings: () => ({ mutateAsync: mocks.save, reset: vi.fn(), isPending: false }),
  useTestErpSmtpSettings: () => ({ mutateAsync: mocks.test, reset: vi.fn(), isPending: false }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(mocks.settings);
  mocks.test.mockResolvedValue({ success: true });
  mocks.refetch.mockResolvedValue({ data: mocks.settings });
});

describe("ERP SMTP settings form", () => {
  it("loads saved fields without a password, saves changes for the active company", async () => {
    render(<ErpSmtpSettings companyId="company-a" />);
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
    render(<ErpSmtpSettings companyId="company-b" />);
    fireEvent.change(screen.getByLabelText("Prejemnik testnega sporočila"), { target: { value: "test@example.si" } });
    fireEvent.click(screen.getByText("Pošlji testno e-pošto"));
    await waitFor(() => expect(mocks.test).toHaveBeenCalledWith({
      companyId: "company-b", data: { recipient: "test@example.si" },
    }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("sprejel testno sporočilo"));
  });
});
