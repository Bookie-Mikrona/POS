import { describe, expect, it } from "vitest";
import { canAcknowledgeKdsTicket } from "./kdsDispatch";

describe("KDS prevzem na postajnem zaslonu", () => {
  it("skrije prevzem pripravljenega naloga, kadar je omogočena Izdaja", () => {
    expect(canAcknowledgeKdsTicket("bumped", true)).toBe(false);
  });

  it("ohrani stari prevzem pripravljenega naloga brez Izdaje", () => {
    expect(canAcknowledgeKdsTicket("bumped", false)).toBe(true);
  });

  it("ne ponudi prevzema za aktivni ali že prevzeti nalog", () => {
    expect(canAcknowledgeKdsTicket("aktivno", false)).toBe(false);
    expect(canAcknowledgeKdsTicket("ack", false)).toBe(false);
    expect(canAcknowledgeKdsTicket("preklicano", false)).toBe(false);
  });
});