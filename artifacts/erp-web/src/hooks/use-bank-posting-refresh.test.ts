import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { postedPaymentIds, useBankPostingRefresh } from "./use-bank-posting-refresh";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("osveževanje opozoril brez ponovnega odpiranja strani", () => {
  it.each(["focus", "visibilitychange"])("odstrani opozorilo po dogodku %s", async event => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ payments: [{ id: "payment-1", status: "draft" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => {
      const [warnings, setWarnings] = useState(["payment-1"]);
      const [resolve] = useState(() => (posted: Set<string>) =>
        setWarnings(current => current.filter(id => !posted.has(id))));
      useBankPostingRefresh("user", "company", warnings, resolve);
      return warnings;
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual(["payment-1"]);
    fetchMock.mockResolvedValue(Response.json({ payments: [{ id: "payment-1", status: "posted" }] }));
    act(() => (event === "focus" ? window : document).dispatchEvent(new Event(event)));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/companies/company/payments/statuses",
      expect.objectContaining({ method: "POST", cache: "no-store", body: JSON.stringify({ paymentIds: ["payment-1"] }) }));
  });

  it("poveže zahteve z uporabnikom in podjetjem ter zavrne zastarel odgovor", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise<Response>(resolve => {
      pending.push({ resolve, signal: options.signal });
    })));
    const resolved = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ user, company }) => useBankPostingRefresh(user, company, ["payment-1", "payment-1"], resolved),
      { initialProps: { user: "user-a" as string | undefined, company: "company-a" } },
    );
    act(() => window.dispatchEvent(new Event("focus")));
    expect(pending[0].signal.aborted).toBe(true);
    rerender({ user: "user-b", company: "company-b" });
    expect(pending[1].signal.aborted).toBe(true);
    await act(async () => {
      pending[0].resolve(Response.json({ payments: [{ id: "payment-1", status: "posted" }] }));
      pending[1].resolve(Response.json({ payments: [{ id: "payment-1", status: "posted" }] }));
    });
    expect(resolved).not.toHaveBeenCalled();
    rerender({ user: undefined, company: "company-b" });
    expect(pending[2].signal.aborted).toBe(true);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(pending).toHaveLength(3);
    unmount();
  });

  it("ne preverja skritega dokumenta in ohrani opozorila ob neuspešnem preverjanju", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ payments: [{ id: "other-payment", status: "posted" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = vi.fn();
    const { unmount } = renderHook(() =>
      useBankPostingRefresh("user", "company", ["a", "b", "c", "a"], resolved));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resolved).not.toHaveBeenCalled();
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("paketno preverjanje neuspelih knjiženj", () => {
  const posted = "00000000-0000-4000-a000-000000000001";
  const draft = "00000000-0000-4000-a000-000000000002";
  const foreign = "00000000-0000-4000-a000-000000000003";
  const voided = "00000000-0000-4000-a000-000000000004";
  const ids = [posted, draft, foreign, voided];
  it("pošlje eno zahtevo in razreši samo izrecno knjižene zahtevane ID-je", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      payments: [{ id: posted, status: "posted" }, { id: draft, status: "draft" },
        { id: voided, status: "void" }, { id: "unrequested", status: "posted" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await postedPaymentIds("company-1", ids)).toEqual(new Set([posted]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/company-1/payments/statuses");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ paymentIds: ids });
  });
  it("ne razreši manjkajočih ID-jev ali neuspešnih poizvedb", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ payments: [] })));
    expect(await postedPaymentIds("company-1", ids)).toEqual(new Set());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "No access" }, { status: 403 })));
    await expect(postedPaymentIds("company-1", ids)).rejects.toThrow();
  });
  it("združi podvojene ID-je in brez ID-jev ne pošilja zahtev", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ payments: [{ id: posted, status: "posted" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await postedPaymentIds("company-1", [])).toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await postedPaymentIds("company-1", [posted, posted])).toEqual(new Set([posted]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ paymentIds: [posted] });
  });
  it("večji uvoz razdeli v omejene pakete brez posameznih zahtev", async () => {
    const manyIds = Array.from({ length: 501 }, (_, index) =>
      `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`);
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ payments: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await postedPaymentIds("company-1", manyIds)).toEqual(new Set());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).paymentIds.length)).toEqual([500, 1]);
  });
});
