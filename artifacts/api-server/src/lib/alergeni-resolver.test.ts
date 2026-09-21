import { describe, expect, it } from "vitest";
import {
  razresiAlergeneIzGrafa,
  type AlergenResolverNode,
} from "./alergeni-resolver";

describe("rekurzivni predogled alergenov normativa", () => {
  it("upošteva sestavljene vhode, vire in nepreverjene vmesne profile", () => {
    const nodes = new Map<number, AlergenResolverNode>([
      [10, {
        id: 10,
        ime: "Mlečna sestavina",
        alergeni: ["MLEKO"],
        alergeniSledi: [],
        alergeniStatus: "potrjeno",
        alergeniVir: "etiketa",
        alergeniDocumentId: "etiketa-10",
      }],
      [20, {
        id: 20,
        ime: "Pripravljena osnova",
        alergeni: [],
        alergeniSledi: ["MLEKO", "SOJA"],
        alergeniStatus: "nepreverjeno",
        alergeniVir: null,
        alergeniDocumentId: null,
      }],
    ]);
    const graph = new Map([[20, [10]]]);

    const result = razresiAlergeneIzGrafa([20], nodes, graph);

    expect(result.alergeni.map(item => item.koda)).toEqual(["MLEKO"]);
    expect(result.alergeniSledi.map(item => item.koda)).toEqual(["SOJA"]);
    expect(result.potrjen).toBe(false);
    expect(result.opozorila).toContain("Sestavina »Pripravljena osnova« nima potrjenega alergenskega profila.");
    expect(result.izvori).toEqual([
      {
        artikelId: 10,
        artikel: "Mlečna sestavina",
        vir: "etiketa",
        documentId: "etiketa-10",
      },
    ]);
  });

  it("vrne enak rezultat za podvojeno vhodno sestavino", () => {
    const nodes = new Map<number, AlergenResolverNode>([
      [10, {
        id: 10,
        ime: "Mlečna sestavina",
        alergeni: ["MLEKO"],
        alergeniSledi: [],
        alergeniStatus: "potrjeno",
        alergeniVir: "etiketa",
        alergeniDocumentId: null,
      }],
    ]);

    expect(razresiAlergeneIzGrafa([10, 10], nodes, new Map()))
      .toEqual(razresiAlergeneIzGrafa([10], nodes, new Map()));
  });
});