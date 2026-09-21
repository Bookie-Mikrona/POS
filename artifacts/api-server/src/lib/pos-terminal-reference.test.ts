import { describe, expect, it } from "vitest";
import { hasCardTerminalCharge, reserveTerminalReference } from "./pos-terminal-reference";

describe("mixed bon + card terminal reference", () => {
  it("reserves and persists a mixed-payment reference once; replay is rejected", async () => {
    const persisted = new Map<string, string>();
    const persist = async (provider: "sumup" | "viva", reference: string) => {
      const key = `${provider}:${reference}`;
      if (persisted.has(key)) return null;
      const id = `r-${persisted.size + 1}`;
      persisted.set(key, id);
      return { id };
    };
    // Bon is the primary method, but 10 EUR card sale + 3 EUR tip is a terminal charge.
    expect(hasCardTerminalCharge(13, 3)).toBe(true);
    await expect(reserveTerminalReference(persist, "sumup-mixed-1", "")).resolves.toEqual({ id: "r-1" });
    expect(persisted.get("sumup:sumup-mixed-1")).toBe("r-1");
    await expect(reserveTerminalReference(persist, "sumup-mixed-1", "")).resolves.toBeNull();
  });
});