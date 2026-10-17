import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PosAccountDimensionWarning } from "./pos-account-dimension-warning";

describe("Opozorilo o obveznih dimenzijah POS konta", () => {
  it.each([
    ["requiresPartner", "partnerja"],
    ["requiresCostCenter", "stroškovno mesto"],
    ["requiresProject", "projekt"],
  ] as const)("prikaže rumeno opozorilo za %s", (flag, label) => {
    const html = renderToStaticMarkup(<PosAccountDimensionWarning account={{ [flag]: true }} />);
    expect(html).toContain(`Ta konto zahteva ${label}`);
    expect(html).toContain("bg-amber-50");
    expect(html).toContain("ne bo mogoče neposredno potrditi");
  });

  it("odstrani opozorilo pri prazni izbiri ali kontu brez zahtev", () => {
    expect(renderToStaticMarkup(<PosAccountDimensionWarning />)).toBe("");
    expect(renderToStaticMarkup(<PosAccountDimensionWarning account={{}} />)).toBe("");
  });
});
