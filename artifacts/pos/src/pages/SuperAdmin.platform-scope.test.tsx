import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
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
    vi.stubGlobal("fetch", vi.fn());
    const { hook } = memoryLocation({ path: "/pos/superadmin/eposta", static: true });
    render(<Router base="/pos" hook={hook}><SuperAdminPage /></Router>);
    expect(screen.getByRole("status")).toHaveTextContent("Platformna prijava nima aktivne POS enote");
    expect(screen.getByRole("status")).toHaveTextContent("Nastavitve → E-pošta");
    expect(screen.queryByRole("button", { name: /Shrani nastavitve/ })).not.toBeInTheDocument();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});