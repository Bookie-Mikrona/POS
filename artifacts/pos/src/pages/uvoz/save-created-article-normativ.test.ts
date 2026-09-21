import { describe, expect, it, vi } from "vitest";
import { saveCreatedArticleNormativ } from "./save-created-article-normativ";

describe("normativ artikla, ustvarjenega pri uvozu prejemnice", () => {
  it("pošlje revizijsko zaščiten payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await saveCreatedArticleNormativ({
      url: "/api/artikli/42/normativi",
      headers: { "X-Enota-Id": "7" },
      expectedRevision: 3,
      items: [{ vhodniArtikelId: 42, kolicina: 1 }],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/artikli/42/normativi", expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({
        items: [{ vhodniArtikelId: 42, kolicina: 1 }],
        expectedRevision: 3,
      }),
    }));
  });

  it("napake normativa ne skrije in zato ne dovoli lažnega uspeha uvoza", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: "Normativ se je medtem spremenil." }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));

    await expect(saveCreatedArticleNormativ({
      url: "/api/artikli/42/normativi",
      headers: { "X-Enota-Id": "7" },
      expectedRevision: 1,
      items: [{ vhodniArtikelId: 42, kolicina: 1 }],
      fetchImpl,
    })).rejects.toThrow("Normativ se je medtem spremenil.");
  });
});