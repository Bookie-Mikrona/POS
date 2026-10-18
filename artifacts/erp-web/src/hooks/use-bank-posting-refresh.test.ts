import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useBankPostingRefresh } from "./use-bank-posting-refresh";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("osveževanje opozoril brez ponovnega odpiranja strani", () => {
  it.each(["focus", "visibilitychange"])("odstrani opozorilo po dogodku %s", async event => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "payment-1", status: "draft" }));
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
    fetchMock.mockResolvedValue(Response.json({ id: "payment-1", status: "posted" }));
    act(() => (event === "focus" ? window : document).dispatchEvent(new Event(event)));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/companies/company/payments/payment-1",
      expect.objectContaining({ cache: "no-store" }));
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
      pending[0].resolve(Response.json({ id: "payment-1", status: "posted" }));
      pending[1].resolve(Response.json({ id: "payment-1", status: "posted" }));
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
      .mockResolvedValueOnce(Response.json({ id: "other-payment", status: "posted" }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = vi.fn();
    const { unmount } = renderHook(() =>
      useBankPostingRefresh("user", "company", ["a", "b", "c", "a"], resolved));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resolved).not.toHaveBeenCalled();
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
