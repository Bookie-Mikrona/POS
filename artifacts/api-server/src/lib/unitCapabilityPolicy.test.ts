import { describe, expect, it } from "vitest";
import { getMissingCapabilityDependencies, capabilityDependencyMessage, getRemovedCapabilities } from "./unitCapabilityPolicy";

describe("odvisnosti zmožnosti enote", () => {
  it("vrne vse manjkajoče odvisnosti", () => {
    const missing = getMissingCapabilityDependencies(["delivery", "reservations", "multi_course"]);
    expect(missing).toEqual([
      { capability: "delivery", requires: "phone_orders" },
      { capability: "reservations", requires: "tables" },
      { capability: "multi_course", requires: "kitchen" },
    ]);
    expect(capabilityDependencyMessage(missing)).toContain("Telefonska naročila");
  });
  it("veljavne in prazne kombinacije nimajo manjkajočih odvisnosti", () => {
    expect(getMissingCapabilityDependencies([])).toEqual([]);
    expect(getMissingCapabilityDependencies(["delivery", "phone_orders", "reservations", "tables", "multi_course", "kitchen"])).toEqual([]);
    expect(getMissingCapabilityDependencies(["phone_orders", "tables", "kitchen"])).toEqual([]);
  });
  it("ne spremeni vhoda in ohrani funkcijo odstranjenih zmožnosti", () => {
    const values = Object.freeze(["delivery", "delivery"]);
    expect(getMissingCapabilityDependencies(values)).toEqual([{ capability: "delivery", requires: "phone_orders" }]);
    expect(values).toEqual(["delivery", "delivery"]);
    expect(getRemovedCapabilities(["delivery", "phone_orders"], ["phone_orders"])).toEqual(["delivery"]);
  });
});
