import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRealtimeSync } from "./useRealtimeSync";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(),
}));

const mockUseNastavitve = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => mockUseNastavitve(),
}));

import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";

const mockUseAuth = vi.mocked(useAuth);
const mockUseQueryClient = vi.mocked(useQueryClient);

describe("useRealtimeSync", () => {
  let EventSourceSpy: ReturnType<typeof vi.fn>;
  let esInstance: { addEventListener: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockUseNastavitve.mockReturnValue({
      nastavitve: { toastTocilnicaAktiven: true },
      nastavitveLoading: false,
    });
    // Return a stable object so queryClient reference stays the same across renders,
    // preventing the useEffect from re-running due to a reference change.
    mockUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as ReturnType<typeof useQueryClient>);

    esInstance = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    };
    EventSourceSpy = vi.fn().mockImplementation(function () {
      return esInstance;
    });
    vi.stubGlobal("EventSource", EventSourceSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ne ustvari EventSource, ko moraZamenjatiGeslo=true", () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        username: "test",
        ime: "Test",
        vloga: "blagajnik",
        podjetjeDavcna: "12345678",
        moraZamenjatiGeslo: true,
      },
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    renderHook(() => useRealtimeSync());

    expect(EventSourceSpy).not.toHaveBeenCalled();
  });

  it("ustvari EventSource, ko moraZamenjatiGeslo=false", () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        username: "test",
        ime: "Test",
        vloga: "blagajnik",
        podjetjeDavcna: "12345678",
        moraZamenjatiGeslo: false,
      },
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    renderHook(() => useRealtimeSync());

    expect(EventSourceSpy).toHaveBeenCalledOnce();
  });

  it("ob izklopu utiša samo toast iz točilnice", () => {
    mockUseNastavitve.mockReturnValue({
      nastavitve: { toastTocilnicaAktiven: false },
      nastavitveLoading: false,
    });
    mockUseAuth.mockReturnValue({
      user: {
        id: 1, username: "test", ime: "Test", vloga: "blagajnik",
        podjetjeDavcna: "12345678", moraZamenjatiGeslo: false,
      },
      loading: false, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn(),
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderHook(() => useRealtimeSync());
    const preparedHandler = esInstance.addEventListener.mock.calls.find(
      ([eventName]) => eventName === "postavkaPripravljena",
    )?.[1] as (event: MessageEvent) => void;

    act(() => preparedHandler(new MessageEvent("postavkaPripravljena", {
      data: JSON.stringify({
        postavkaId: 1, narociloId: 2, ime: "Pijača", kolicina: 1,
        opomba: null, mizaIme: "Miza 1", mizaStevilka: 1, vir: "tocilnica",
      }),
    })));
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "gotov-toast" }));

    act(() => preparedHandler(new MessageEvent("postavkaPripravljena", {
      data: JSON.stringify({
        postavkaId: 3, narociloId: 2, ime: "Jed", kolicina: 1,
        opomba: null, mizaIme: "Miza 1", mizaStevilka: 1, vir: "kuhinja",
      }),
    })));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "gotov-toast" }));
  });

  it("ne ustvari EventSource, ko ni prijavljenega uporabnika", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    renderHook(() => useRealtimeSync());

    expect(EventSourceSpy).not.toHaveBeenCalled();
  });

  it("ob odjavi zapre EventSource, ob ponovni prijavi ustvari novega", () => {
    const activeUser = {
      id: 1,
      username: "test",
      ime: "Test",
      vloga: "blagajnik" as const,
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    };

    mockUseAuth.mockReturnValue({
      user: activeUser,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    const { rerender } = renderHook(() => useRealtimeSync());

    expect(EventSourceSpy).toHaveBeenCalledTimes(1);
    const firstInstance = esInstance;

    // Simulate logout: user becomes null
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    rerender();

    expect(firstInstance.close).toHaveBeenCalledTimes(1);
    expect(EventSourceSpy).toHaveBeenCalledTimes(1);

    // Simulate login again: fresh user
    const secondInstance = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    };
    EventSourceSpy.mockImplementation(function () {
      return secondInstance;
    });

    mockUseAuth.mockReturnValue({
      user: activeUser,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    rerender();

    expect(EventSourceSpy).toHaveBeenCalledTimes(2);
    expect(secondInstance.close).not.toHaveBeenCalled();
  });

  it("ob napaki (npr. 401) zapre EventSource in ne ustvari novega do ponovne prijave", () => {
    const activeUser = {
      id: 1,
      username: "test",
      ime: "Test",
      vloga: "blagajnik" as const,
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    };

    mockUseAuth.mockReturnValue({
      user: activeUser,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    const { rerender } = renderHook(() => useRealtimeSync());

    expect(EventSourceSpy).toHaveBeenCalledTimes(1);

    // Capture the error listener registered on the EventSource
    const errorCall = esInstance.addEventListener.mock.calls.find(
      ([eventName]) => eventName === "error"
    );
    expect(errorCall).toBeDefined();
    const errorHandler = errorCall![1] as () => void;

    // Simulate an error event (e.g. server returned 401 for the SSE endpoint)
    act(() => {
      errorHandler();
    });

    // Hook must close the EventSource to stop the browser from auto-reconnecting
    expect(esInstance.close).toHaveBeenCalledTimes(1);

    // No new EventSource should be created while the user object is still the same
    rerender();
    expect(EventSourceSpy).toHaveBeenCalledTimes(1);

    // After the user logs back in (user object identity changes), a new EventSource is created
    const secondInstance = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    };
    EventSourceSpy.mockImplementation(function () {
      return secondInstance;
    });

    mockUseAuth.mockReturnValue({
      user: { ...activeUser },
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    });

    rerender();

    expect(EventSourceSpy).toHaveBeenCalledTimes(2);
    expect(secondInstance.close).not.toHaveBeenCalled();
  });
});
