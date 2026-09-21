import { describe, expect, it } from "vitest";
import { resolveAgentErrorMessage } from "./agent-error";

describe("resolveAgentErrorMessage", () => {
  it("401 pretvori v navodilo za ponovno izbiro natakarja", () => {
    expect(resolveAgentErrorMessage(401)).toContain("Zakleni POS");
    expect(resolveAgentErrorMessage(401)).toContain("PIN");
  });

  it("pri drugih napakah prikaže sporočilo strežnika", () => {
    expect(resolveAgentErrorMessage(403, { napaka: "AI pomočnik je izklopljen." }))
      .toBe("AI pomočnik je izklopljen.");
  });
});