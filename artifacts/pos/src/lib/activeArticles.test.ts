import { describe, expect, it } from "vitest";
import { onlyActiveArticles } from "./activeArticles";

describe("onlyActiveArticles", () => {
  it("iz prodajne izbire izloči neaktivne artikle", () => {
    expect(onlyActiveArticles([
      { id: 1, ime: "Aktiven", aktiven: true },
      { id: 2, ime: "Neaktiven", aktiven: false },
    ])).toEqual([
      { id: 1, ime: "Aktiven", aktiven: true },
    ]);
  });
});