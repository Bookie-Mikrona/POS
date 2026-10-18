import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SuperAdminPage from "./SuperAdmin";

const state = vi.hoisted(() => ({
  user: { vloga: "superadmin", enotaId: undefined as number | undefined },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("platform E-mail page", () => {
  it.each([undefined, 7])("does not read or expose unit SMTP settings for SuperAdmin (%s)", async (enotaId) => {
    state.user = { vloga: "superadmin", enotaId };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        configured: false, present: { host: false, from: false, user: false, password: false },
        portValid: true, missing: ["SMTP_HOST", "SMTP_FROM"],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { hook } = memoryLocation({ path: "/pos/superadmin/eposta", static: true });
    render(<Router base="/pos" hook={hook}><SuperAdminPage /></Router>);
    expect(screen.getByText(/Platformna prijava nima aktivne POS enote/)).toHaveTextContent("Nastavitve → E-pošta");
    expect(screen.queryByRole("button", { name: /Shrani nastavitve/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Globalno pošiljanje ni konfigurirano/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/superadmin\/email$/);
    expect(screen.getByRole("button", { name: "Pošlji globalni preizkus" })).toBeDisabled();
  });
});