import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  setAuthTokenGetter, setBaseUrl, setEnotaIdGetter, setPosActorSessionGetter,
} from "@workspace/api-client-react";
import Temeljnice from "./Temeljnice";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/posCas", () => ({ poslovniDatumZaCas: () => "2026-10-04" }));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("POS Temeljnice — prijavljeni zahtevki", () => {
  beforeEach(() => {
    toast.mockClear();
    setBaseUrl("/pos");
    setAuthTokenGetter(async () => "test-token");
    setEnotaIdGetter(() => "309");
    setPosActorSessionGetter(() => "test-actor");
    localStorage.setItem("erp_active_company", JSON.stringify({ id: "test-company" }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setBaseUrl(null);
    setAuthTokenGetter(null);
    setEnotaIdGetter(null);
    setPosActorSessionGetter(null);
    localStorage.clear();
  });

  function expectAuthenticated(init: RequestInit) {
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("x-enota-id")).toBe("309");
    expect(headers.get("x-company-id")).toBe("test-company");
    expect(headers.get("x-pos-actor-session")).toBe("test-actor");
    expect(init.credentials).toBe("include");
  }

  it("naloži seznam prek POS poti z žetonom in aktivnim obsegom", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ temeljnice: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Pokaži" }));
    expect(await screen.findByText("V izbranem obdobju ni nobene temeljnice.")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/^\/pos\/api\/temeljnice\?od=.*&do=2026-10-04$/);
    expectAuthenticated(fetch.mock.calls[0][1]);
  });

  it("sinhronizacijo pošlje z enako prijavo", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ created: [], skipped: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Sinhroniziraj" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Ni podatkov" })));
    const [url, init] = fetch.mock.calls.find(call => call[1].method === "POST")!;
    expect(url).toBe("/pos/api/temeljnice/sync/2026-10-04");
    expectAuthenticated(init);
  });

  it("ob prehodnem 401 obnovi žeton in ponovno naloži seznam", async () => {
    const getter = vi.fn().mockResolvedValueOnce("old-token").mockResolvedValue("test-token");
    setAuthTokenGetter(getter);
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ message: "Unauthorized" }, 401))
      .mockResolvedValueOnce(json({ temeljnice: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Pokaži" }));
    expect(await screen.findByText("V izbranem obdobju ni nobene temeljnice.")).not.toBeNull();
    expect(getter).toHaveBeenCalledWith({ skipCache: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expectAuthenticated(fetch.mock.calls[1][1]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("prikaže dejansko strežniško napako namesto splošnega opozorila", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Manjkata parametra od in do" }, 400)));
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Pokaži" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("Manjkata parametra od in do"), variant: "destructive",
    })));
  });
});