import { describe, expect, it } from "vitest";
import { isEventStatusTransitionAllowed, isStockTransferStatusTransitionAllowed } from "./eventPolicy";
import { getRemovedCapabilities } from "./unitCapabilityPolicy";

describe("pravila dogodkov", () => {
  it("dovoli normalen življenjski cikel", () => {
    expect(isEventStatusTransitionAllowed("planned", "active")).toBe(true);
    expect(isEventStatusTransitionAllowed("active", "closed")).toBe(true);
  });

  it("ne dovoli ponovnega odpiranja ali spreminjanja zaključene zgodovine", () => {
    expect(isEventStatusTransitionAllowed("closed", "active")).toBe(false);
    expect(isEventStatusTransitionAllowed("cancelled", "planned")).toBe(false);
  });
});

describe("prehodi statusa prenosa zaloge", () => {
  it("dovoli zaključek ali preklic osnutka", () => {
    expect(isStockTransferStatusTransitionAllowed("draft", "completed")).toBe(true);
    expect(isStockTransferStatusTransitionAllowed("draft", "cancelled")).toBe(true);
  });

  it("ne dovoli ponovnega odpiranja terminalnega prenosa", () => {
    expect(isStockTransferStatusTransitionAllowed("completed", "draft")).toBe(false);
    expect(isStockTransferStatusTransitionAllowed("completed", "cancelled")).toBe(false);
    expect(isStockTransferStatusTransitionAllowed("cancelled", "draft")).toBe(false);
    expect(isStockTransferStatusTransitionAllowed("cancelled", "completed")).toBe(false);
  });
});

describe("izklop zmožnosti", () => {
  it("preverja samo dejansko odstranjene funkcije", () => {
    expect(getRemovedCapabilities(["checkout", "events", "inventory"], ["checkout", "inventory"]))
      .toEqual(["events"]);
  });
});