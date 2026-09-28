import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ESLOG_UNITS, EslogUnitPicker, displayEslogUnit, filterEslogUnits } from "./EslogUnitPicker";

describe("izbira enote mere artikla", () => {
  it("išče po nazivu brez šumnikov in po kodi ter ne omeji rezultatov na prvih nekaj enot", () => {
    expect(filterEslogUnits("sKatla").map(unit => unit.code)).toContain("BX");
    expect(filterEslogUnits("mlt").map(unit => unit.code)).toEqual(["MLT"]);
    expect(filterEslogUnits("")).toHaveLength(10);
    expect(ESLOG_UNITS.map(unit => unit.code)).toEqual([
      "H87", "KGM", "GRM", "LTR", "MLT", "MTR", "MTK", "MTQ", "CT", "BX",
    ]);
    expect(filterEslogUnits("paleta")).toHaveLength(0);
    expect(displayEslogUnit("H87")).toBe("kos");
    expect(displayEslogUnit("KGM")).toBe("kg");
    expect(displayEslogUnit("nova")).toBe("nova");
  });

  it("ohrani izbrano vrednost med iskanjem in jo spremeni šele ob izbiri", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EslogUnitPicker id="enota-test" value="LTR" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    expect((input as HTMLInputElement).value).toBe("l");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "gra" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "gram (GRM)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "gram (GRM)" }));
    expect(onChange).toHaveBeenCalledWith("GRM");
    rerender(<EslogUnitPicker id="enota-test" value="GRM" onChange={onChange} />);
    expect((input as HTMLInputElement).value).toBe("g");
  });

  it("pri shranjeni kodi H87 pokaže kos, tehnično kodo pa ohrani v izboru", () => {
    const onChange = vi.fn();
    render(<EslogUnitPicker id="kos-test" value="H87" onChange={onChange} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("kos");
    fireEvent.focus(input);
    expect(screen.getByRole("option", { name: "kos (H87)" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
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
    fireEvent.change(input, { target: { value: "kgm" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("Uredi artikel")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "kgm" } });
    fireEvent.click(screen.getByRole("option", { name: "kilogram (KGM)" }));
    expect(onChange).toHaveBeenCalledWith("KGM");
  });

  it("staro enoto pusti nespremenjeno in opozori, da je ne more izvoziti", () => {
    const onChange = vi.fn();
    render(<EslogUnitPicker id="stara-enota" value="kom" onChange={onChange} />);
    expect(screen.getByText("Obstoječa enota ni v standardnem izboru e-SLOG. Pred izvozom preverite njeno kodo.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});