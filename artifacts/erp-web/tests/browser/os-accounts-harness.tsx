import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OsDialog } from "../../src/pages/osnovna-sredstva";
import "../../src/index.css";

type Form = React.ComponentProps<typeof OsDialog>["form"];
const editing = new URLSearchParams(location.search).has("edit");
const initial: Form = {
  inventarnaSt: "OS-1", naziv: "Stroj", skupinaId: "", costCenterId: "",
  accountId: "", kontoStroskaId: editing ? "expense-1" : "",
  kontoPopravkaId: editing ? "correction-1" : "",
  status: "v_uporabi", opomba: "", datumOdtujitve: "", razlogIzlocitve: "",
  nabavnaVrednost: "1000", odpisanaVrednost: "0", neamortizljiviDelPct: "0",
  datumNabave: "2026-01-01", datumAktivacije: "", datumIzpisa: "",
  partnerId: "", stRacuna: "", datumRacuna: "",
};
const accounts = [
  { id: "expense-1", code: "4320000", name: "Amortizacija opreme" },
  { id: "expense-2", code: "4320001", name: "Amortizacija strojev" },
  { id: "correction-1", code: "0500000", name: "Popravek vrednosti opreme" },
  { id: "correction-2", code: "0500001", name: "Popravek vrednosti strojev" },
];

function Harness() {
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Form | null>(null);
  return <>
    <button onClick={() => setOpen(true)}>Odpri sredstvo</button>
    <OsDialog open={open} onClose={() => setOpen(false)}
      editingId={editing ? "asset" : null} form={form} setForm={setForm}
      saving={false} saveError={null} onSave={() => setSaved({ ...form })}
      skupiny={[]} costCenters={[]} accounts={accounts}
      counterparties={[]} companyId="keyboard-test" />
    <output data-testid="form">{JSON.stringify(form)}</output>
    <output data-testid="saved">{JSON.stringify(saved)}</output>
  </>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Harness />
  </QueryClientProvider>,
);
