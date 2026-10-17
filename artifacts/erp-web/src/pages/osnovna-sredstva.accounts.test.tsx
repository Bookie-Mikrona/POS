import "@testing-library/jest-dom";
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OsDialog } from "./osnovna-sredstva";

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useCreateCounterparty: () => ({}),
}));

// Keep the real dialog and account combobox; cmdk needs browser layout APIs.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

type Form = React.ComponentProps<typeof OsDialog>["form"];
const initial: Form = {
  inventarnaSt: "OS-1", naziv: "Stroj", skupinaId: "", costCenterId: "",
  accountId: "", kontoStroskaId: "", kontoPopravkaId: "",
  status: "v_uporabi", opomba: "", datumOdtujitve: "", razlogIzlocitve: "",
  nabavnaVrednost: "1000", odpisanaVrednost: "0", neamortizljiviDelPct: "0",
  datumNabave: "2026-01-01", datumAktivacije: "", datumIzpisa: "",
  partnerId: "", stRacuna: "", datumRacuna: "",
};
const accounts = [
  { id: "expense", code: "4320000", name: "Amortizacija" },
  { id: "correction", code: "0500000", name: "Popravek vrednosti" },
];

function FormHarness({ saved = initial }: { saved?: Form }) {
  const [form, setForm] = useState(saved);
  return <>
    <OsDialog open onClose={() => {}} editingId="asset" form={form} setForm={setForm}
      saving={false} saveError={null} onSave={() => {}} skupiny={[]} costCenters={[]}
      accounts={accounts} counterparties={[]} companyId="company" />
    <output data-testid="accounts">{JSON.stringify({
      kontoStroskaId: form.kontoStroskaId || null,
      kontoPopravkaId: form.kontoPopravkaId || null,
    })}</output>
  </>;
}

describe("Konta amortizacije na posameznem sredstvu", () => {
  it("prikaže obe opcijski polji in pojasni uporabo privzetih nastavitev", () => {
    render(<FormHarness />);
    for (const name of ["Konto stroška amortizacije", "Konto popravka vrednosti"]) {
      expect(screen.getByRole("combobox", { name })).toHaveTextContent("privzeto iz nastavitev modula");
    }
    expect(screen.getByText(/Prazno polje uporabi privzeti konto/)).toBeInTheDocument();
    expect(screen.getByTestId("accounts")).toHaveTextContent('"kontoStroskaId":null,"kontoPopravkaId":null');
  });

  it("izbere lasten konto-par in omogoči neodvisno vrnitev na privzeta konta", () => {
    render(<FormHarness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Konto stroška amortizacije" }));
    fireEvent.click(screen.getByRole("option", { name: "4320000 — Amortizacija" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Konto popravka vrednosti" }));
    fireEvent.click(screen.getByRole("option", { name: "0500000 — Popravek vrednosti" }));
    expect(screen.getByTestId("accounts")).toHaveTextContent('"kontoStroskaId":"expense","kontoPopravkaId":"correction"');

    fireEvent.click(screen.getByRole("combobox", { name: "Konto stroška amortizacije" }));
    fireEvent.click(screen.getByRole("option", { name: "— privzeto iz nastavitev modula —" }));
    expect(screen.getByTestId("accounts")).toHaveTextContent('"kontoStroskaId":null,"kontoPopravkaId":"correction"');
    fireEvent.click(screen.getByRole("combobox", { name: "Konto popravka vrednosti" }));
    fireEvent.click(screen.getByRole("option", { name: "— privzeto iz nastavitev modula —" }));
    expect(screen.getByTestId("accounts")).toHaveTextContent('"kontoStroskaId":null,"kontoPopravkaId":null');
  });

  it("predizpolni shranjeni konto-par ob ponovnem odprtju", () => {
    render(<FormHarness saved={{ ...initial, kontoStroskaId: "expense", kontoPopravkaId: "correction" }} />);
    expect(screen.getByRole("combobox", { name: "Konto stroška amortizacije" })).toHaveTextContent("4320000");
    expect(screen.getByRole("combobox", { name: "Konto popravka vrednosti" })).toHaveTextContent("0500000");
  });
});
