import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: mockCreate,
    },
  },
}));

import router, {
  preveriAiGlasovnePostavke,
  preveriKriticneNapakeSvetovalca,
  withAiTimeout,
} from "./glasovni-ukaz";

const katalog = [{
  id: 10,
  ime: "Margherita",
  kategorija: "Pice",
  jePica: true,
  velikostiPice: ["mala", "normalna", "druzinska"] as const,
  modifikatorji: [{
    id: 101,
    ime: "Trikotni razrez",
    skupinaIme: "Razrez",
    obvezna: false,
  }],
}];

describe("AI glasovni POS ukaz", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("prek Replit AI vrne velikost iste pice in njen razrez", async () => {
    mockCreate.mockResolvedValue({
      content: [{
        type: "tool_use",
        id: "tool-1",
        name: "oddaj_narocilo",
        input: {
          postavke: [{
            artikelId: 10,
            kolicina: 1,
            velikostPice: "mala",
            modifikatorji: [101],
          }],
        },
      }],
    });

    const app = express();
    app.use(express.json());
    app.use(router);

    const response = await request(app)
      .post("/ai/glasovni-ukaz")
      .send({
        transkript: "pica margherita mala trikotni razrez",
        artikli: katalog,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      postavke: [{
        artikelId: 10,
        kolicina: 1,
        velikostPice: "mala",
        modifikatorji: [101],
      }],
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-4-5",
      tool_choice: { type: "tool", name: "oddaj_narocilo" },
    }));
  });

  it("odstrani izmišljene ID-je in nedovoljeno velikost", () => {
    expect(preveriAiGlasovnePostavke({
      postavke: [
        { artikelId: 10, kolicina: 1, velikostPice: "druzinska", modifikatorji: [101, 999] },
        { artikelId: 999, kolicina: 1 },
      ],
    }, [{
      ...katalog[0],
      velikostiPice: ["mala", "normalna"],
    }])).toEqual({
      postavke: [{
        artikelId: 10,
        kolicina: 1,
        modifikatorji: [101],
      }],
    });
  });
});

describe("AI svetovalec - kritične kontrole", () => {
  const osnovnoNarocilo = {
    id: 42,
    nacin: "miza",
    status: "odprto",
    skupaj: 12,
    postavke: [{ naziv: "Kava", kolicina: 1, skupaj: 2 }],
  };

  it("ne spremeni običajnega nasveta v blokado", () => {
    expect(preveriKriticneNapakeSvetovalca("blagajna", osnovnoNarocilo)).toEqual([]);
  });

  it("blokira dostavo brez obveznih kontaktnih podatkov", () => {
    expect(preveriKriticneNapakeSvetovalca("blagajna", {
      ...osnovnoNarocilo,
      nacin: "dostava",
      telefon: null,
      naslovDostave: null,
    })).toEqual([
      "Pred zaključkom dostave je obvezen naslov dostave.",
      "Pred zaključkom telefonskega naročila ali dostave je obvezna telefonska številka.",
    ]);
  });

  it("prazno naročilo blokira šele v blagajni", () => {
    const prazno = { ...osnovnoNarocilo, skupaj: 0, postavke: [] };
    expect(preveriKriticneNapakeSvetovalca("narocilo", prazno)).toEqual([]);
    expect(preveriKriticneNapakeSvetovalca("blagajna", prazno)).toEqual([
      "Praznega naročila ni dovoljeno zaključiti.",
    ]);
  });

  it("časovno omeji nedosegljiv AI model", async () => {
    await expect(withAiTimeout(new Promise(() => undefined), 5)).rejects.toThrow("AI_TIMEOUT");
  });
});