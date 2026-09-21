import { describe, expect, it } from "vitest";
import { sanitizeTerminalConfig } from "./naprave";

describe("nastavitev AI svetovalca na napravi", () => {
  it("je privzeto izklopljena", () => {
    expect(sanitizeTerminalConfig("{}")?.aiSvetovalecAktiven).toBe(false);
  });

  it("vrne trajno nastavitev samo za izbrano napravo", () => {
    expect(sanitizeTerminalConfig(JSON.stringify({
      aiSvetovalecAktiven: true,
      sumupApiKey: "ne-vrni-tega",
    }))).toMatchObject({
      aiSvetovalecAktiven: true,
      sumupApiKeyNastavljen: true,
    });
  });
});