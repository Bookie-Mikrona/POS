import "@testing-library/jest-dom";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnitCapabilitySwitches } from "./UnitCapabilitySwitches";
import { ALL_UNIT_CAPABILITIES, CAPABILITY_LABELS, type UnitCapability } from "@/lib/unitProfiles";

afterEach(cleanup);

function Editor({ initial = [] }: { initial?: UnitCapability[] }) {
  const [capabilities, setCapabilities] = useState(initial);
  return (
    <>
      <UnitCapabilitySwitches
        capabilities={capabilities}
        allowedCapabilities={ALL_UNIT_CAPABILITIES}
        onToggle={(capability, checked) => setCapabilities(current =>
          checked ? [...current, capability] : current.filter(value => value !== capability),
        )}
      />
      <button>Shrani</button>
    </>
  );
}

describe("sprotna opozorila odvisnosti zmožnosti", () => {
  it.each([
    ["delivery", "phone_orders", "Funkcija »Dostava« zahteva funkcijo »Telefonska naročila«."],
    ["reservations", "tables", "Funkcija »Rezervacije« zahteva funkcijo »Mize«."],
    ["multi_course", "kitchen", "Funkcija »Večhodni meniji« zahteva funkcijo »Kuhinja«."],
  ] as const)("%s opozori brez %s; vklop odvisnosti odstrani opozorilo", (capability, requires, message) => {
    render(<Editor />);
    const feature = screen.getByRole("switch", { name: CAPABILITY_LABELS[capability] });
    const dependency = screen.getByRole("switch", { name: CAPABILITY_LABELS[requires] });
    fireEvent.click(feature);
    expect(feature).toBeChecked();
    expect(dependency).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(feature).toHaveAccessibleDescription(message);
    expect(screen.getByRole("button", { name: "Shrani" })).toBeVisible();

    fireEvent.click(dependency);
    expect(feature).toBeChecked();
    expect(dependency).toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(dependency);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    fireEvent.click(feature);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("takoj opozori na staro nedosledno izbiro, ne da bi jo popravil", () => {
    render(<Editor initial={["delivery"]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Telefonska naročila");
    expect(screen.getByRole("switch", { name: "Dostava in prevzem" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Telefonska naročila" })).not.toBeChecked();
  });
});
