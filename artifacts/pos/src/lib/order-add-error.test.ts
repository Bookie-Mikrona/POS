import { describe, expect, it } from "vitest";
import { orderAddErrorMessage } from "./order-add-error";

describe("reason when adding an article fails", () => {
  it("shows a 409 availability reason", () => {
    expect(orderAddErrorMessage({
      status: 409,
      data: { error: "Artikel »Pražen krompir« nima dovolj razpoložljivih porcij." },
    })).toBe("Artikel »Pražen krompir« nima dovolj razpoložljivih porcij.");
  });

  it("shows a validation reason returned as napaka", () => {
    expect(orderAddErrorMessage({ status: 400, data: { napaka: "Izberite prilogo." } })).toBe("Izberite prilogo.");
  });

  it("does not expose server errors or internal exception messages", () => {
    expect(orderAddErrorMessage({ status: 500, data: { error: "SQL connection details" } })).toBe("Ni bilo mogoče dodati artikla");
    expect(orderAddErrorMessage(new Error("SQL connection details"))).toBe("Ni bilo mogoče dodati artikla");
  });
});