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

  it("prikaže ime vsake enote namesto interne oznake v referenci", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ temeljnice: [
      { id: "one", entryDate: "2026-09-28", reference: "POS:PRODAJA:2026-09-28:E309",
        description: "Dnevna prodaja POS — 2026-09-28", enotaIme: "Križišče",
        status: "draft", postedAt: null, skupajDebet: 62.4, vrstice: [], posArchive: true },
      { id: "two", entryDate: "2026-09-28", reference: "POS:PRODAJA:2026-09-28:E310",
        description: "Dnevna prodaja POS — 2026-09-28", enotaIme: "Jadran",
        status: "draft", postedAt: null, skupajDebet: 10, vrstice: [], posArchive: true },
    ], canTransfer: true }));
    vi.stubGlobal("fetch", fetch);
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Pokaži" }));
    expect(await screen.findByText("Dnevna prodaja POS · Križišče")).not.toBeNull();
    expect(screen.getByText("Dnevna prodaja POS · Jadran")).not.toBeNull();
    expect(screen.queryByText(/E309|E310/)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Izberi za prenos: Dnevna prodaja POS · Križišče" })).not.toBeNull();
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

  it.each(["xlsx", "csv"] as const)("izvozi %s za trenutni interval tudi brez odprtega seznama", async format => {
    const create = vi.fn().mockReturnValue("blob:test-export");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response("export-bytes", {
      headers: { "Content-Type": format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<Temeljnice />);
    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2026-09-01" } });
    fireEvent.change(dates[1], { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: format === "csv" ? "Izvozi CSV" : "Izvozi Excel" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe(`/pos/api/temeljnice/izvoz?od=2026-09-01&do=2026-09-30&format=${format}`);
    expectAuthenticated(fetch.mock.calls[0][1]);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(`temeljnice-2026-09-01-2026-09-30.${format}`);
    expect(create).toHaveBeenCalled();
    click.mockRestore();
  });

  it("ob praznem obdobju ali napaki ne sproži prenosa datoteke", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "V izbranem obdobju ni temeljnic za izvoz." }, 404)));
    render(<Temeljnice />);
    fireEvent.click(screen.getByRole("button", { name: "Izvozi Excel" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Izvoz ni uspel", description: expect.stringContaining("ni temeljnic"), variant: "destructive",
    })));
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});