/**
 * osKarticaVrednosti.test.ts
 *
 * Scenarij 0000402 (realni podatki):
 *   nabavna = 5000.00  (4 doknjižbe, vse aktivirane pred 2024)
 *   uvožena odpisana = 4742.01
 *   sedanjaVrednostPredObracunom = 257.99
 *   obračunano 2024 = 61.97
 *   sedanjaVrednostPoObracunu = 196.02 (= konNed v medletnem registru 2024)
 */

import { describe, it, expect } from "vitest";
import { calcKarticaVrednosti } from "./osKarticaVrednosti";

// ─── Pomožna funkcija za preprosto en-doknjizba-primer ─────────────────────────

function enDoknjizba(
  nabavna: number,
  odpisana: number,
  neamortizljiviPct = 0,
  izlocena = false,
) {
  const amortizirljiva = nabavna * ((100 - neamortizljiviPct) / 100);
  return {
    nabavnaVrednost: nabavna.toFixed(2),
    odpisanaVrednost: odpisana.toFixed(2),
    amortizirljivaBaza: amortizirljiva.toFixed(2),
    jeIzlocena: izlocena,
  };
}

// ─── Skupne vrednosti brez obračuna ─────────────────────────────────────────────

describe("calcKarticaVrednosti — brez obračuna", () => {
  it("predObračunom = nabavna − odpisana; poObračunu = predObračunom (ni amortizacije)", () => {
    const r = calcKarticaVrednosti(5000, 4742.01, 0, [
      enDoknjizba(5000, 4742.01),
    ]);
    expect(r.sedanjaVrednostPredObracunom).toBe("257.99");
    expect(r.sedanjaVrednostPoObracunu).toBe("257.99");  // ni amortizacije
    expect(r.skupnaAmortizacijaObracunana).toBe("0.00");
  });

  it("prazna lista doknjizb", () => {
    const r = calcKarticaVrednosti(0, 0, 0, []);
    expect(r.sedanjaVrednostPredObracunom).toBe("0.00");
    expect(r.sedanjaVrednostPoObracunu).toBe("0.00");
    expect(r.perDoknjizba).toHaveLength(0);
  });
});

// ─── Scenarij 0000402 — realni primer ────────────────────────────────────────

describe("calcKarticaVrednosti — scenarij 0000402 leto 2024", () => {
  // seq 0: osnova 5000 NV; 4742.01 odpisana (uvoz 12/2023)
  // seq 1,2,3: dograditve (za test jih združimo v seq 0, ker skupna NV = 5000)
  // Obračun 2024 = 61.97

  const r = calcKarticaVrednosti(5000, 4742.01, 61.97, [
    enDoknjizba(5000, 4742.01),
  ]);

  it("sedanjaVrednostPredObracunom = 257.99", () => {
    expect(r.sedanjaVrednostPredObracunom).toBe("257.99");
  });

  it("sedanjaVrednostPoObracunu = 196.02 (= konNed v medletnem registru)", () => {
    expect(r.sedanjaVrednostPoObracunu).toBe("196.02");
  });

  it("skupnaAmortizacijaObracunana = 61.97", () => {
    expect(r.skupnaAmortizacijaObracunana).toBe("61.97");
  });

  it("ravnotežje: poObracunu = predObracunom − skupnaAmort", () => {
    const pred = parseFloat(r.sedanjaVrednostPredObracunom);
    const po = parseFloat(r.sedanjaVrednostPoObracunu);
    const amort = parseFloat(r.skupnaAmortizacijaObracunana);
    expect(po).toBeCloseTo(pred - amort, 2);
  });

  it("perDoknjizba[0].sedanjaVrednostPoObracunu = 196.02", () => {
    expect(r.perDoknjizba[0].sedanjaVrednostPoObracunu).toBe("196.02");
  });
});

// ─── Dva doknjizbi — porazdelitev sorazmerno z amortizirljivo bazo ──────────────

describe("calcKarticaVrednosti — dve doknjizbi, porazdelitev", () => {
  // doc1: nabavna=300, odpisana=0, amortizirljiva=300
  // doc2: nabavna=200, odpisana=0, amortizirljiva=200
  // skupna amort = 50 → doc1 dobi 50*(300/500)=30; doc2 dobi 50*(200/500)=20

  const r = calcKarticaVrednosti(500, 0, 50, [
    enDoknjizba(300, 0),
    enDoknjizba(200, 0),
  ]);

  it("predObracunom skupaj = 500", () => {
    expect(r.sedanjaVrednostPredObracunom).toBe("500.00");
  });

  it("poObracunu skupaj = 450", () => {
    expect(r.sedanjaVrednostPoObracunu).toBe("450.00");
  });

  it("doc1 poObracunu = 270.00 (300 − 30)", () => {
    expect(r.perDoknjizba[0].sedanjaVrednostPoObracunu).toBe("270.00");
  });

  it("doc2 poObracunu = 180.00 (200 − 20)", () => {
    expect(r.perDoknjizba[1].sedanjaVrednostPoObracunu).toBe("180.00");
  });

  it("vsota perDoknjizba ≈ skupaj poObracunu (v centih)", () => {
    const vsota = r.perDoknjizba.reduce(
      (s, d) => s + parseFloat(d.sedanjaVrednostPoObracunu),
      0,
    );
    expect(vsota).toBeCloseTo(parseFloat(r.sedanjaVrednostPoObracunu), 1);
  });
});

// ─── Neamortizljiv delež ─────────────────────────────────────────────────────

describe("calcKarticaVrednosti — neamortizljiv delež", () => {
  // nabavna=1000, 50% neamortizljivo → amortizirljiva=500
  // amort skupaj=100 → pride 100 od 500 amortizirljive baze → odpisana za ta doc = 100
  it("neamortizljiv del zmanjša amortizirljivo bazo za porazdelitev", () => {
    const r = calcKarticaVrednosti(1000, 0, 100, [
      enDoknjizba(1000, 0, 50),  // 50% neamortizljivo
    ]);
    // sedanjaPred = 1000; amortDel = 100 * (500/500) = 100
    expect(r.sedanjaVrednostPredObracunom).toBe("1000.00");
    expect(r.sedanjaVrednostPoObracunu).toBe("900.00");
    expect(r.perDoknjizba[0].sedanjaVrednostPoObracunu).toBe("900.00");
  });
});

// ─── Izločena doknjizba — ne vstopa v porazdelitev ─────────────────────────────

describe("calcKarticaVrednosti — izločena doknjizba", () => {
  // doc1: aktivna, nabavna=200, amortizirljiva=200
  // doc2: izločena, nabavna=100, amortizirljiva=100 (ne sme dobiti amortizacije)
  // skupna amort = 40 → gre samo na doc1

  it("izločena doknjizba ne dobi deleža amortizacije", () => {
    const r = calcKarticaVrednosti(300, 0, 40, [
      enDoknjizba(200, 0, 0, false),    // aktivna
      enDoknjizba(100, 0, 0, true),     // izločena
    ]);
    // doc1: amortDel = 40 * (200/200) = 40 → sedanja po = 200 − 40 = 160
    expect(r.perDoknjizba[0].sedanjaVrednostPoObracunu).toBe("160.00");
    // doc2: izločena → amort = 0 → sedanja po = 100 − 0 = 100
    expect(r.perDoknjizba[1].sedanjaVrednostPoObracunu).toBe("100.00");
  });
});

// ─── Polno odpisan − nikoli negativno ────────────────────────────────────────

describe("calcKarticaVrednosti — negativna zaščita", () => {
  it("sedanjaVrednostPoObracunu nikoli < 0 (zaokroži na 0)", () => {
    const r = calcKarticaVrednosti(1000, 900, 200, [
      enDoknjizba(1000, 900),
    ]);
    // pred = 100; po = 100 − 200 = −100 → zaščita: 0.00
    expect(r.sedanjaVrednostPoObracunu).toBe("0.00");
    expect(r.perDoknjizba[0].sedanjaVrednostPoObracunu).toBe("0.00");
  });
});

// ─── Doslednost z medletnim registrom ────────────────────────────────────────

describe("doslednost z medletnim registrom (konNed)", () => {
  it("kartica poObracunu = medletni register konNed za isti scenarij", () => {
    // Medletni register (osRegisterMedletni.test.ts) za 0000402 vrne konNed=196.02
    // Kartica mora vrniti enako sedanjaVrednostPoObracunu
    const r = calcKarticaVrednosti(5000, 4742.01, 61.97, [
      enDoknjizba(5000, 4742.01),
    ]);
    // 196.02 je konNed iz medletnega registra za 0000402 leto 2024
    expect(parseFloat(r.sedanjaVrednostPoObracunu)).toBeCloseTo(196.02, 2);
  });
});
