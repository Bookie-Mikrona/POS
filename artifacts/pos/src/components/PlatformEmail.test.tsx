import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformEmail } from "./PlatformEmail";

const status = { configured: true, present: { host: true, from: true, user: true, password: true }, portValid: true, missing: [] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => status });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function readyToSend() {
  render(<PlatformEmail />);
  await screen.findByLabelText("Prejemnik preizkusa");
  fireEvent.change(screen.getByLabelText("Prejemnik preizkusa"), { target: { value: "admin@example.org" } });
  fireEvent.change(screen.getByLabelText("Ponovite naslov prejemnika"), { target: { value: "admin@example.org" } });
  expect(screen.getByRole("button", { name: "Pošlji globalni preizkus" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("global SMTP controls", () => {
  it("sends only on explicit confirmation, displays acceptance and cooldown", async () => {
    await readyToSend();
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByRole("button", { name: "Pošlji globalni preizkus" }));
    await screen.findByText(/SMTP strežnik je sprejel preizkus za admin@example.org/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      recipient: "admin@example.org", confirmRecipient: "admin@example.org", confirmed: true,
    });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/superadmin\/email\/test$/);
    expect(screen.getByRole("button", { name: /Ponovitev čez/ })).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resets confirmation when the address changes", async () => {
    await readyToSend();
    fireEvent.change(screen.getByLabelText("Prejemnik preizkusa"), { target: { value: "other@example.org" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Pošlji globalni preizkus" })).toBeDisabled();
  });

  it.each([403, 502, 429])("shows sending error %s without a unit request", async code => {
    await readyToSend();
    fetchMock.mockResolvedValueOnce({ ok: false, status: code, headers: new Headers({ "Retry-After": "60" }), json: async () => ({ error: "Preizkus ni uspel." }) });
    fireEvent.click(screen.getByRole("button", { name: "Pošlji globalni preizkus" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Preizkus ni uspel.");
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("/api/superadmin/email"))).toBe(true);
  });

  it("shows load failure and supports an explicit refresh", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<PlatformEmail />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Stanja globalnega pošiljanja ni mogoče prebrati.");
    expect(screen.queryByRole("button", { name: "Pošlji globalni preizkus" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Osveži stanje" }));
    await waitFor(() => expect(screen.getByText(/Konfiguracija je pripravljena/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
