import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchNormativeCalculator } from "./BatchNormativeCalculator";

afterEach(cleanup);
const items = [{ vhodniArtikelId: 1, ime: "Jabolka", kolicina: "0.12" }];
const articles = [{ id: 1, ime: "Jabolka", enotaMere: "KGM" }];

describe("preračun pekača v obrazcu", () => {
  it("ne uporabi starega normativa kot pekač in uporabi samo potrjen preračun", () => {
    const apply = vi.fn();
    render(<BatchNormativeCalculator items={items} articles={articles} onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Recept za pekač" }));
    const quantity = screen.getByLabelText("Za pekač (KGM)") as HTMLInputElement;
    expect(quantity.value).toBe("");
    fireEvent.change(quantity, { target: { value: "0,96" } });
    fireEvent.change(screen.getByLabelText("Izkoristek (%)"), { target: { value: "80" } });
    expect(screen.getByTestId("batch-preview-0").textContent).toBe("0,15");
    fireEvent.click(screen.getByRole("button", { name: "Uporabi normativ na kos" }));
    expect(apply).toHaveBeenCalledWith([{ vhodniArtikelId: 1, ime: "Jabolka", kolicina: "0.15" }]);
  });
  it("preklic ničesar ne spremeni; ponovni vstop ponastavi količine", () => {
    const apply = vi.fn();
    render(<BatchNormativeCalculator items={items} articles={articles} onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Recept za pekač" }));
    fireEvent.change(screen.getByLabelText("Za pekač (KGM)"), { target: { value: "1,2" } });
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recept za pekač" }));
    expect((screen.getByLabelText("Za pekač (KGM)") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Uporabi normativ na kos" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("ne dovoljuje odpiranja brez surovin ali med osveževanjem", () => {
    const { rerender } = render(<BatchNormativeCalculator items={[]} articles={articles} onApply={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Recept za pekač" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<BatchNormativeCalculator items={items} articles={articles} disabled onApply={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Recept za pekač" }) as HTMLButtonElement).disabled).toBe(true);
  });
});