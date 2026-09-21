import { describe, expect, it } from "vitest";
import { answerOperationalQuestion, type OperationalSnapshot } from "./operational-snapshot";

const snapshot: OperationalSnapshot = {
  audience: "guest",
  freshness: new Date().toISOString(),
  activePizzaTasks: 2,
  activeKitchenTasks: 3,
  eta: { minutes: 24, estimated: true, reason: "KDS čakalna vrsta.", confidence: "medium" },
  articles: [
    { name: "Hišno vino", price: 3.5, pizzaPrices: [{ size: "normalna", price: 3.5 }], available: true, preparedAvailableQuantity: null, wine: true, cigarette: false, cigaretteStock: null },
    { name: "Cigarete", price: 5, pizzaPrices: [{ size: "normalna", price: 5 }], available: true, preparedAvailableQuantity: null, wine: false, cigarette: true, cigaretteStock: null },
    { name: "Margherita", price: 9, pizzaPrices: [{ size: "mala", price: 7 }, { size: "normalna", price: 9 }], available: true, preparedAvailableQuantity: null, wine: false, cigarette: false, cigaretteStock: null },
  ],
};

describe("operational snapshot deterministic answers", () => {
  it("handles every guest starter prompt without an LLM fallback", () => {
    for (const prompt of [
      "Katera vina so na voljo?",
      "Koliko stane pica Margerita?",
      "Imate cigarete na zalogi?",
      "Katere pice se trenutno pripravljajo?",
      "Kakšna je čakalna doba?",
    ]) expect(answerOperationalQuestion(prompt, snapshot)).not.toBeNull();
    expect(answerOperationalQuestion("Katere pice se trenutno pripravljajo?", snapshot)).toContain("imena posameznih pic");
  });
  it("answers item price with configured pizza sizes", () => {
    expect(answerOperationalQuestion("Koliko stane Margherita?", snapshot)).toContain("9.00 €");
  });
  it("returns only identified available wines", () => {
    expect(answerOperationalQuestion("Katera vina so na voljo?", snapshot)).toContain("Hišno vino");
  });
  it("reports unknown cigarette stock rather than unlimited", () => {
    expect(answerOperationalQuestion("Koliko cigaret imamo?", snapshot)).toContain("zaloga ni znana");
  });
  it("uses persistent pizza queue wording and marks ETA as estimate", () => {
    expect(answerOperationalQuestion("Koliko pic čaka?", snapshot)).toContain("2 naloge");
    expect(answerOperationalQuestion("Kakšen je čas čakanja?", snapshot)).toContain("To je ocena");
  });
});