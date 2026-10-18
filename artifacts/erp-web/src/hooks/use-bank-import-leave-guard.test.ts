import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useBankImportLeaveGuard } from "./use-bank-import-leave-guard";

function unloadIsBlocked() {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("zaščita neobnovljivega opozorila", () => {
  it("namesti in odstrani zaščito brez API klicev", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { rerender, unmount } = renderHook(({ enabled }) => useBankImportLeaveGuard(enabled), {
      initialProps: { enabled: false },
    });
    expect(unloadIsBlocked()).toBe(false);
    rerender({ enabled: true });
    expect(unloadIsBlocked()).toBe(true);
    rerender({ enabled: false });
    expect(unloadIsBlocked()).toBe(false);
    rerender({ enabled: true });
    unmount();
    expect(unloadIsBlocked()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["pushState", "replaceState"] as const)("potrdi notranji odhod prek %s", method => {
    const initialUrl = window.location.href;
    const originalPush = window.history.pushState;
    const originalMethod = window.history[method];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderHook(() => useBankImportLeaveGuard(true));
    window.history[method](null, "", "/payments");
    expect(window.location.href).toBe(initialUrl);
    expect(unloadIsBlocked()).toBe(true);
    confirm.mockReturnValue(true);
    window.history[method](null, "", "/payments");
    expect(window.location.pathname).toBe("/payments");
    expect(unloadIsBlocked()).toBe(false);
    expect(window.history[method]).toBe(originalMethod);
    unmount();
    originalPush.call(window.history, null, "", initialUrl);
  });

  it("preklic koraka nazaj obnovi URL pred usmerjevalnikom", () => {
    const initialUrl = window.location.href;
    const original = window.history.pushState;
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderHook(() => useBankImportLeaveGuard(true));
    const router = vi.fn();
    window.addEventListener("popstate", router);
    original.call(window.history, null, "", "/previous");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(window.location.href).toBe(initialUrl);
    expect(router).not.toHaveBeenCalled();
    expect(unloadIsBlocked()).toBe(true);
    window.removeEventListener("popstate", router);
    unmount();
  });

  it("potrjen korak nazaj prepusti usmerjevalniku", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = renderHook(() => useBankImportLeaveGuard(true));
    const router = vi.fn();
    window.addEventListener("popstate", router);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router).toHaveBeenCalledOnce();
    expect(unloadIsBlocked()).toBe(false);
    window.removeEventListener("popstate", router);
    unmount();
  });

  it("izrecna potrditev odstrani zaščito, preklic jo ohrani", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useBankImportLeaveGuard(true));
    expect(result.current()).toBe(false);
    expect(unloadIsBlocked()).toBe(true);
    confirm.mockReturnValue(true);
    expect(result.current()).toBe(true);
    expect(unloadIsBlocked()).toBe(false);
  });

  it("prekliče klik povezave, potrjen klik pa odstrani zaščito brez druge potrditve", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderHook(() => useBankImportLeaveGuard(true));
    const anchor = document.createElement("a");
    anchor.href = "/payments";
    anchor.addEventListener("click", event => event.preventDefault());
    document.body.append(anchor);
    anchor.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(unloadIsBlocked()).toBe(true);
    confirm.mockReturnValue(true);
    anchor.click();
    window.history.replaceState(null, "", window.location.href);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(unloadIsBlocked()).toBe(false);
    anchor.remove();
    unmount();
  });
});
