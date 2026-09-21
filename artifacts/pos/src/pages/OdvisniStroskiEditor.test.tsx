import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { OdvisniStroskiEditor, type OdvisniStrosekRow } from "./Zaloge";

function StatefulEditor() {
  const [rows, setRows] = useState<OdvisniStrosekRow[]>([]);
  return <OdvisniStroskiEditor value={rows} onChange={setRows} />;
}

describe("OdvisniStroskiEditor", () => {
  it("doda, ureja in odstrani odvisni strošek", () => {
    render(<StatefulEditor />);

    fireEvent.click(screen.getByRole("button", { name: /dodaj strošek/i }));
    const naziv = screen.getByLabelText("Naziv stroška 1");
    const znesek = screen.getByLabelText("Znesek stroška 1");
    const obravnava = screen.getByLabelText("Obravnava stroška 1");

    fireEvent.change(naziv, { target: { value: "Prevoz" } });
    fireEvent.change(znesek, { target: { value: "17,50" } });
    fireEvent.change(obravnava, { target: { value: "strosek" } });

    expect(naziv).toHaveValue("Prevoz");
    expect(znesek).toHaveValue("17,50");
    expect(obravnava).toHaveValue("strosek");

    fireEvent.click(screen.getByRole("button", { name: "Odstrani strošek 1" }));
    expect(screen.queryByLabelText("Naziv stroška 1")).not.toBeInTheDocument();
  });
});