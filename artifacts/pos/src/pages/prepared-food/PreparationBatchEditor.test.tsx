import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreparationBatchEditor } from "./PreparationBatchEditor";

afterEach(cleanup);

describe("PreparationBatchEditor", () => {
  const base = { name: "Jabolčna pita", defaultPieces: 12 };

  it.each([null, []])("skrije ogled brez shranjenih priprav (%j)", value => {
    render(<PreparationBatchEditor {...base} value={value} readOnly onChange={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("omogoča le ogled shranjenega razreza pri zaključeni evidenci", () => {
    const onChange = vi.fn();
    render(<PreparationBatchEditor {...base} value={[{ batchCount: 1, piecesPerBatch: 15 }]} readOnly onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Ogled priprav in razreza: Jabolčna pita" });
    expect(trigger.textContent).toBe("Ogled priprav in razreza (1)");
    fireEvent.click(trigger);
    expect(screen.getByRole("heading", { name: "Ogled priprav in razreza — Jabolčna pita" })).not.toBeNull();
    expect((screen.getByLabelText("Število pekačev") as HTMLInputElement).disabled).toBe(true);
    const pieces = screen.getByLabelText("Kosov iz pekača") as HTMLInputElement;
    expect(pieces.disabled).toBe(true);
    expect(pieces.value).toBe("15");
    expect(screen.queryByRole("button", { name: "Dodaj pripravo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Uporabi pripravljen razrez" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Odstrani pripravo/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Zapri" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ohrani urejanje in privzeti razrez pri odprti evidenci brez priprav", () => {
    const onChange = vi.fn();
    render(<PreparationBatchEditor {...base} value={null} readOnly={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Priprave in razrez: Jabolčna pita" }));
    const pieces = screen.getByLabelText("Kosov iz pekača") as HTMLInputElement;
    expect(pieces.disabled).toBe(false);
    expect(pieces.value).toBe("12");
    fireEvent.change(pieces, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Uporabi pripravljen razrez" }));
    expect(onChange).toHaveBeenCalledWith([{ batchCount: 1, piecesPerBatch: 15 }]);
  });
});