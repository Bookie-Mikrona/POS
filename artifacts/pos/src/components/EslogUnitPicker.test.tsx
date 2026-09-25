import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EslogUnitPicker, filterEslogUnits } from "./EslogUnitPicker";

describe("izbira enote mere artikla", () => {
  it("išče po nazivu brez šumnikov in po kodi ter ne omeji rezultatov na prvih nekaj enot", () => {
    expect(filterEslogUnits("sKatla").map(unit => unit.code)).toContain("BX");
    expect(filterEslogUnits("mlt").map(unit => unit.code)).toEqual(["MLT"]);
    expect(filterEslogUnits("")).toHaveLength(22);
  });

  it("ohrani izbrano vrednost med iskanjem in jo spremeni šele ob izbiri", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EslogUnitPicker id="enota-test" value="LTR" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    expect((input as HTMLInputElement).value).toBe("liter (LTR)");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "gra" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "gram (GRM)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "gram (GRM)" }));
    expect(onChange).toHaveBeenCalledWith("GRM");
    rerender(<EslogUnitPicker id="enota-test" value="GRM" onChange={onChange} />);
    expect((input as HTMLInputElement).value).toBe("gram (GRM)");
  });

  it("omogoči izbiro tudi v pogovornem oknu za urejanje artikla", () => {
    const onChange = vi.fn();
    function Editor() {
      const [pickerOpen, setPickerOpen] = useState(false);
      return (
        <Dialog open>
          <DialogContent onEscapeKeyDown={event => {
            if (pickerOpen) {
              event.preventDefault();
              setPickerOpen(false);
            }
          }}>
            <DialogTitle>Uredi artikel</DialogTitle>
            <EslogUnitPicker id="enota-v-dialogu" value={null} onChange={onChange}
              open={pickerOpen} onOpenChange={setPickerOpen} />
          </DialogContent>
        </Dialog>
      );
    }
    render(<Editor />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "clt" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("Uredi artikel")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "clt" } });
    fireEvent.click(screen.getByRole("option", { name: "centiliter (CLT)" }));
    expect(onChange).toHaveBeenCalledWith("CLT");
  });
});