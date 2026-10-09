import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SuperAdminPage from "./SuperAdmin";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { vloga: "superadmin" } }),
}));
// Nativna izbira izolira logiko potrjevanja od Radix pointer dogodkov v jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) =>
    <select aria-label="POS paket" value={value} disabled={disabled} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const company = {
    id: "00000000-0000-4000-8000-000000000005", naziv: "Test paketa", davcnaStevilka: "00000000",
    posPlan: "extended", steviloUporabnikov: 0, uporabniki: [],
  };
  const mutations: Array<{ plan: string; force?: boolean }> = [];
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      const body = JSON.parse(String(options.body));
      mutations.push(body);
      if (body.force === true) {
        company.posPlan = body.plan;
        return { ok: true, status: 200, json: async () => ({ companyId: company.id, plan: body.plan }) };
      }
      return {
        ok: false, status: 409,
        json: async () => ({
          napaka: "Enota ima odprto delo.",
          blockedUnits: [{ id: 42, ime: "Test enota", blockers: [
            { kind: "open_events", description: "Enota je povezana z načrtovanim ali aktivnim dogodkom." },
          ] }],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => [{ ...company }] };
  });
  vi.stubGlobal("fetch", fetchMock);
  const { hook } = memoryLocation({ path: "/pos/superadmin", static: true });
  render(<Router base="/pos" hook={hook}><SuperAdminPage /></Router>);
  return { company, mutations };
}

async function requestDowngrade() {
  fireEvent.click(await screen.findByRole("button", { name: /Test paketa/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "POS paket" }), { target: { value: "standard" } });
  expect(await screen.findByRole("dialog")).toHaveTextContent("Znižanje paketa je blokirano");
  expect(screen.getByRole("dialog")).toHaveTextContent("Test enota");
  expect(screen.getByRole("dialog")).toHaveTextContent("Enota je povezana z načrtovanim ali aktivnim dogodkom.");
  expect(screen.getByRole("dialog")).toHaveTextContent("lahko izgubijo dostop");
  expect(screen.getByRole("dialog")).toHaveTextContent("revizijsko sled");
}

describe("POS paket – izrecna izsilitev", () => {
  it("prikaže blokade; preklic ohrani paket in ne pošlje force", async () => {
    const { company, mutations } = setup();
    await requestDowngrade();
    fireEvent.click(screen.getByRole("button", { name: "Ohrani trenutni paket" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutations).toEqual([{ plan: "standard" }]);
    expect(company.posPlan).toBe("extended");
    expect(screen.getByRole("combobox", { name: "POS paket" })).toHaveValue("extended");
  });
  it("šele potrditveni klik pošlje force:true; uspeh osveži prikaz paketa", async () => {
    const { mutations } = setup();
    await requestDowngrade();
    expect(mutations).toEqual([{ plan: "standard" }]);
    fireEvent.click(screen.getByRole("button", { name: "Potrjujem izsiljeno znižanje" }));
    await waitFor(() => expect(mutations).toEqual([{ plan: "standard" }, { plan: "standard", force: true }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("POS Standard")).toBeInTheDocument();
  });
});
