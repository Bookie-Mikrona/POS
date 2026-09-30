import { describe, expect, it, vi } from "vitest";
import { buildNormativeComparisonCacheKey, clearNormativeComparisonCache, compareNormative, filterResearchSources, getCachedNormativeComparison, isPreparedFoodBulkNormative, isSafeResearchUrl, normalizeQuantity, NORMATIVE_COMPARISON_MAX_IN_FLIGHT, NORMATIVE_COMPARISON_MAX_IN_FLIGHT_PER_TENANT, PREPARED_BULK_COMPARISON_MESSAGE, signNormativeProposal, verifyNormativeProposal, type LocalNormative } from "./normative-comparison";
import { researchNormative } from "../routes/pos/glasovni-ukaz";

describe("normative comparison units and evidence", () => {
  it("prepozna samo pripravljene jedi z enoto kg ali l kot neprimerljive s porcijskimi recepti", () => {
    expect(isPreparedFoodBulkNormative({ mealType: "prepared", enotaMere: "kg" })).toBe(true);
    expect(isPreparedFoodBulkNormative({ mealType: "prepared", enotaMere: "LTR" })).toBe(true);
    expect(isPreparedFoodBulkNormative({ mealType: "prepared", enotaMere: "porcija" })).toBe(false);
    expect(isPreparedFoodBulkNormative({ mealType: "ala_carte", enotaMere: "kg" })).toBe(false);
    expect(isPreparedFoodBulkNormative({})).toBe(false);
  });

  it("pred spletno raziskavo ustavi pripravljene jedi na kg/l", async () => {
    const create = vi.fn();
    const bulkFood: LocalNormative = {
      artikelId: 8, revision: 1, targetName: "Juha", mealType: "prepared", enotaMere: "l", rows: [],
    };
    await expect(researchNormative(bulkFood, create as never)).rejects.toThrow(PREPARED_BULK_COMPARISON_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });

  it("reuses only a fresh tenant-scoped result with an unchanged deterministic normative fingerprint", async () => {
    clearNormativeComparisonCache();
    const local: LocalNormative = { artikelId: 7, revision: 3, targetName: "Golaž", rows: [
      { normativRowId: 2, ingredientId: 20, ingredientName: "Čebula", quantity: 0.1, unit: "KG" },
      { normativRowId: 1, ingredientId: 10, ingredientName: "Meso", quantity: 100, unit: "g" },
    ] };
    const result = { generatedAt: "2026-09-07T06:00:00.000Z", localNormative: local, rows: [], sources: [
      { url: "https://allrecipes.com/a", title: "A", checkedAt: "2026-09-07T06:00:00.000Z", pageDate: null },
    ], warnings: [], disclaimer: "Informativno." };
    let calls = 0;
    const loader = async () => { calls += 1; return result; };

    const first = await getCachedNormativeComparison(local, 11, loader, { now: 1_000, ttlMs: 100 });
    const hit = await getCachedNormativeComparison({ ...local, rows: [...local.rows].reverse() }, 11, loader, { now: 1_050, ttlMs: 100 });
    expect(first.cacheHit).toBe(false);
    expect(hit).toEqual({ comparison: result, cacheHit: true, coalesced: false });
    expect(hit.comparison.generatedAt).toBe(first.comparison.generatedAt);
    expect(hit.comparison.sources[0]?.checkedAt).toBe(first.comparison.sources[0]?.checkedAt);
    expect(calls).toBe(1);

    await getCachedNormativeComparison(local, 11, loader, { now: 1_101, ttlMs: 100 });
    await getCachedNormativeComparison({ ...local, revision: 4 }, 11, loader, { now: 1_110, ttlMs: 100 });
    await getCachedNormativeComparison(local, 12, loader, { now: 1_120, ttlMs: 100 });
    await getCachedNormativeComparison({ ...local, targetName: "Goveji golaž" }, 11, loader, { now: 1_124, ttlMs: 100 });
    await getCachedNormativeComparison({
      ...local,
      rows: local.rows.map(row => row.normativRowId === 1 ? { ...row, quantity: 101 } : row),
    }, 11, loader, { now: 1_125, ttlMs: 100 });
    await getCachedNormativeComparison({
      ...local,
      rows: local.rows.map(row => row.normativRowId === 1 ? { ...row, unit: "kg" } : row),
    }, 11, loader, { now: 1_126, ttlMs: 100 });
    await getCachedNormativeComparison(local, 11, loader, { now: 1_130, ttlMs: 100, forceRefresh: true });
    expect(calls).toBe(8);
    expect(buildNormativeComparisonCacheKey(local, 11)).not.toBe(buildNormativeComparisonCacheKey(local, 12));
  });

  it("coalesces concurrent misses and preserves the last good value when refresh fails", async () => {
    clearNormativeComparisonCache();
    const local: LocalNormative = { artikelId: 9, revision: 1, targetName: "Juha", rows: [
      { normativRowId: 3, ingredientId: 30, ingredientName: "Voda", quantity: 1, unit: "l" },
    ] };
    const original = { generatedAt: "2026-09-07T06:00:00.000Z", localNormative: local, rows: [], sources: [], warnings: [], disclaimer: "Informativno." };
    let resolveLoader!: (value: typeof original) => void;
    let calls = 0;
    const loader = () => {
      calls += 1;
      return new Promise<typeof original>(resolve => { resolveLoader = resolve; });
    };
    const first = getCachedNormativeComparison(local, 22, loader, { now: 1_000, ttlMs: 1_000 });
    const concurrent = getCachedNormativeComparison(local, 22, loader, { now: 1_001, ttlMs: 1_000 });
    expect(calls).toBe(1);
    resolveLoader(original);
    expect((await first).cacheHit).toBe(false);
    expect(await concurrent).toEqual({ comparison: original, cacheHit: false, coalesced: true });

    await expect(getCachedNormativeComparison(local, 22, async () => {
      calls += 1;
      throw new Error("research failed");
    }, { now: 1_100, ttlMs: 1_000, forceRefresh: true })).rejects.toThrow("research failed");
    const afterFailedRefresh = await getCachedNormativeComparison(local, 22, async () => {
      calls += 1;
      return { ...original, generatedAt: "2026-09-07T06:05:00.000Z" };
    }, { now: 1_101, ttlMs: 1_000 });
    expect(afterFailedRefresh).toEqual({ comparison: original, cacheHit: true, coalesced: false });
    expect(calls).toBe(2);
  });

  it("bounds distinct in-flight paid research per tenant", async () => {
    clearNormativeComparisonCache();
    const releases: Array<(value: any) => void> = [];
    const pending = Array.from({ length: NORMATIVE_COMPARISON_MAX_IN_FLIGHT_PER_TENANT }, (_, index) => {
      const local: LocalNormative = { artikelId: 100 + index, revision: 1, targetName: `Jed ${index}`, rows: [
        { normativRowId: 100 + index, ingredientId: 200 + index, ingredientName: `Sestavina ${index}`, quantity: 1, unit: "g" },
      ] };
      return getCachedNormativeComparison(local, 33, () => new Promise(resolve => releases.push(resolve)), { now: 1_000 });
    });
    const overflowLocal: LocalNormative = { artikelId: 999, revision: 1, targetName: "Preveč", rows: [
      { normativRowId: 999, ingredientId: 999, ingredientName: "Preveč", quantity: 1, unit: "g" },
    ] };
    await expect(getCachedNormativeComparison(overflowLocal, 33, async () => {
      throw new Error("loader must not run");
    }, { now: 1_000 })).rejects.toThrow("RESEARCH_BUSY");
    releases.forEach((release, index) => release({
      generatedAt: "2026-09-07T06:00:00.000Z",
      localNormative: { artikelId: 100 + index, revision: 1, targetName: `Jed ${index}`, rows: [] },
      rows: [], sources: [], warnings: [], disclaimer: "Informativno.",
    }));
    await Promise.all(pending);
  });

  it("globalna meja zavrne presežek brez zagona loaderja in po zaključku sprosti kapaciteto", async () => {
    clearNormativeComparisonCache();
    const releases: Array<(value: any) => void> = [];
    const pending = Array.from({ length: NORMATIVE_COMPARISON_MAX_IN_FLIGHT }, (_, index) => {
      const local: LocalNormative = { artikelId: 1_000 + index, revision: 1, targetName: `Global ${index}`, rows: [
        { normativRowId: 1_000 + index, ingredientId: 2_000 + index, ingredientName: `Sestavina ${index}`, quantity: 1, unit: "g" },
      ] };
      return getCachedNormativeComparison(local, 10_000 + index, () => new Promise(resolve => releases.push(resolve)), { now: 2_000 });
    });
    const overflowLoader = vi.fn(async () => {
      throw new Error("loader se ne sme zagnati");
    });
    const overflow: LocalNormative = { artikelId: 9_999, revision: 1, targetName: "Presežek", rows: [] };

    await expect(getCachedNormativeComparison(overflow, 99_999, overflowLoader, { now: 2_000 }))
      .rejects.toThrow("RESEARCH_BUSY");
    expect(overflowLoader).not.toHaveBeenCalled();

    releases.forEach((release, index) => release({
      generatedAt: "2026-09-07T06:00:00.000Z",
      localNormative: { artikelId: 1_000 + index, revision: 1, targetName: `Global ${index}`, rows: [] },
      rows: [], sources: [], warnings: [], disclaimer: "Informativno.",
    }));
    await Promise.all(pending);

    const afterReleaseLoader = vi.fn(async () => ({
      generatedAt: "2026-09-07T06:01:00.000Z",
      localNormative: overflow,
      rows: [], sources: [], warnings: [], disclaimer: "Informativno.",
    }));
    await expect(getCachedNormativeComparison(overflow, 99_999, afterReleaseLoader, { now: 2_001 }))
      .resolves.toMatchObject({ cacheHit: false });
    expect(afterReleaseLoader).toHaveBeenCalledOnce();
  });

  it("globalno kapaciteto sprosti tudi po napaki vseh aktivnih loaderjev", async () => {
    clearNormativeComparisonCache();
    const rejects: Array<(reason: Error) => void> = [];
    const pending = Array.from({ length: NORMATIVE_COMPARISON_MAX_IN_FLIGHT }, (_, index) => {
      const local: LocalNormative = { artikelId: 3_000 + index, revision: 1, targetName: `Napaka ${index}`, rows: [] };
      return getCachedNormativeComparison(local, 20_000 + index, () => new Promise((_resolve, reject) => rejects.push(reject)), { now: 3_000 });
    });
    const settled = Promise.allSettled(pending);
    rejects.forEach(reject => reject(new Error("raziskava ni uspela")));
    expect((await settled).every(result => result.status === "rejected")).toBe(true);

    const recovered: LocalNormative = { artikelId: 8_888, revision: 1, targetName: "Ponovni poskus", rows: [] };
    const recoveredLoader = vi.fn(async () => ({
      generatedAt: "2026-09-07T06:02:00.000Z",
      localNormative: recovered,
      rows: [], sources: [], warnings: [], disclaimer: "Informativno.",
    }));
    await expect(getCachedNormativeComparison(recovered, 88_888, recoveredLoader, { now: 3_001 }))
      .resolves.toMatchObject({ cacheHit: false });
    expect(recoveredLoader).toHaveBeenCalledOnce();
  });

  it("signs only fresh, non-noop numeric(10,4) proposals", () => {
    const old = process.env.POS_NORMATIVE_PROPOSAL_SECRET;
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "comparison-test-secret";
    const payload = { v: 1 as const, artikelId: 1, expectedRevision: 1, normativRowId: 1, ingredientId: 2,
      expectedQuantity: "10", localUnit: "g", proposedQuantity: "11", sourceUrl: "https://allrecipes.com/a", sourceTitle: "A",
      generatedAt: "2025-01-01T00:00:00.000Z" };
    expect(signNormativeProposal({ ...payload, proposedQuantity: "10" })).toBeNull();
    const signed = signNormativeProposal(payload)!;
    expect(verifyNormativeProposal(signed, Date.parse("2025-01-01T00:10:00.000Z"))?.expectedRevision).toBe(1);
    expect(verifyNormativeProposal(signed, Date.parse("2025-01-01T00:31:00.000Z"))).toBeNull();
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = old;
  });
  it("normalizes safe kg/g, l/ml and count units only", () => {
    expect(normalizeQuantity(1, "kg")?.value.toString()).toBe("1000000");
    expect(normalizeQuantity(1000, "g")?.value.toString()).toBe("1000000");
    expect(normalizeQuantity(1, "l")?.value.toString()).toBe("1000");
    expect(normalizeQuantity(1000, "ml")?.value.toString()).toBe("1000");
    expect(normalizeQuantity(2, "pieces")?.dimension).toBe("count");
    expect(normalizeQuantity(1, "cup")).toBeNull();
    expect(normalizeQuantity(1, null)).toBeNull();
  });

  it("uses portions, reports incompatible/missing and handles zero percentages", () => {
    const local: LocalNormative = { artikelId: 1, revision: 1, targetName: "Golaž", rows: [
      { normativRowId: 1, ingredientId: 1, ingredientName: "Meso", quantity: 100, unit: "g" },
      { normativRowId: 2, ingredientId: 2, ingredientName: "Juha", quantity: 10, unit: "ml" },
      { normativRowId: 3, ingredientId: 3, ingredientName: "Čebula", quantity: 0, unit: "g" },
    ] };
    const result = compareNormative(local, [
      { ingredient: "Meso", quantity: 1, unit: "kg", servings: 10, sourceUrl: "https://allrecipes.com/a" },
      { ingredient: "Juha", quantity: 1, unit: "g", servings: 1, sourceUrl: "https://allrecipes.com/a" },
      { ingredient: "Čebula", quantity: 2, unit: "g", servings: 1, sourceUrl: "https://allrecipes.com/a" },
    ]);
    expect(result[0]).toMatchObject({ status: "comparable", difference: 0, percentDifference: 0 });
    expect(result[0]).toMatchObject({ comparisonUnit: "g", localNormalizedQuantity: 100, externalNormalizedQuantity: 100, sourceUrl: "https://allrecipes.com/a" });
    expect(result[1].status).toBe("incomparable");
    expect(result[2]).toMatchObject({ status: "comparable", percentDifference: null });
    expect(compareNormative(local, []).every(row => row.status === "missing")).toBe(true);
  });

  it("keeps every verified finding for an ingredient instead of selecting the first source", () => {
    const local: LocalNormative = { artikelId: 1, revision: 1, targetName: "Golaž", rows: [{ normativRowId: 1, ingredientId: 1, ingredientName: "Meso", quantity: 100, unit: "g" }] };
    const rows = compareNormative(local, [
      { ingredient: "Meso", quantity: 100, unit: "g", servings: 1, sourceUrl: "https://allrecipes.com/a" },
      { ingredient: "Meso", quantity: 120, unit: "g", servings: 1, sourceUrl: "https://bbcgoodfood.com/a" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.sourceUrl)).toEqual(["https://allrecipes.com/a", "https://bbcgoodfood.com/a"]);
    expect(rows[1]).toMatchObject({ comparisonUnit: "g", difference: 20, percentDifference: 20 });
  });

  it("uses only actual safe tool-result URLs and their metadata", () => {
    const sources = filterResearchSources([{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://allrecipes.com/a", title: "Actual title", page_age: "2024-01-01" }] }], [
      "https://allrecipes.com/a", "https://bbcgoodfood.com/a",
    ], "2025-01-01T00:00:00.000Z");
    expect(sources).toEqual([{ url: "https://allrecipes.com/a", title: "Actual title", pageDate: "2024-01-01", checkedAt: "2025-01-01T00:00:00.000Z" }]);
    expect(isSafeResearchUrl("http://example.com")).toBe(false);
    expect(isSafeResearchUrl("https://127.0.0.1/a")).toBe(false);
    expect(isSafeResearchUrl("https://facebook.com/a")).toBe(false);
    expect(isSafeResearchUrl("https://allrecipes.com.evil.example/a")).toBe(false);
    const adversarial = filterResearchSources([
      { type: "text", url: "https://allrecipes.com/a", title: "forged" },
      { type: "tool_use", input: { url: "https://allrecipes.com/a", title: "forged" } },
      { type: "web_search_tool_result", content: [{ type: "custom", url: "https://allrecipes.com/a", title: "forged" }] },
    ], ["https://allrecipes.com/a"]);
    expect(adversarial).toEqual([]);
  });

  it("accepts an injected research creator and returns only its checked citation", async () => {
    const local: LocalNormative = { artikelId: 1, revision: 1, targetName: "Golaž", rows: [{ normativRowId: 1, ingredientId: 1, ingredientName: "Meso", quantity: 100, unit: "g" }] };
    const create = async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://allrecipes.com/golaz", title: "Preverjen recept", page_age: "2024-01-01" }] },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://bbcgoodfood.com/golaz", title: "Drugi preverjen recept", page_age: "2024-02-01" }] },
      { type: "text", text: '{"findings":[{"ingredient":"Meso","quantity":400,"unit":"g","servings":4,"sourceUrl":"https://allrecipes.com/golaz"},{"ingredient":"Meso","quantity":480,"unit":"g","servings":4,"sourceUrl":"https://bbcgoodfood.com/golaz"}]}' },
    ] });
    const result = await researchNormative(local, create as never);
    expect(result.sources[0]).toMatchObject({ title: "Preverjen recept", url: "https://allrecipes.com/golaz" });
    expect(result.rows[0].status).toBe("comparable");
  });

  it("aborts the injected SDK request when the research timeout expires", async () => {
    const local: LocalNormative = { artikelId: 1, revision: 1, targetName: "Golaž", rows: [{ normativRowId: 1, ingredientId: 1, ingredientName: "Meso", quantity: 100, unit: "g" }] };
    let aborted = false;
    const create = (_params: unknown, options?: { signal?: AbortSignal }) => new Promise<{ content: unknown[] }>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    });
    await expect(researchNormative(local, create as never, 5)).rejects.toThrow("aborted");
    expect(aborted).toBe(true);
  });
});