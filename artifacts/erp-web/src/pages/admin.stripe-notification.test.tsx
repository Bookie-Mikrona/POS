import "@testing-library/jest-dom";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeOperationalNotificationTest } from "./admin";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

function renderTest() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StripeOperationalNotificationTest />
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Stripe notification test control", () => {
  it("sends only on click, disables repeat clicks and shows SMTP acceptance", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    renderTest();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pošlji testno Stripe obvestilo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("button")).toBeDisabled();
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/stripe-sync/test-notification");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer test-token");
    resolve(new Response(JSON.stringify({ success: true, code: "sent" })));
    expect(await screen.findByText(/Poštni strežnik je sprejel/)).toBeInTheDocument();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it.each([
    ["recipient_missing", "Prejemnik operativnih Stripe obvestil ni nastavljen."],
    ["recipient_invalid", "Naslov prejemnika operativnih Stripe obvestil ni veljaven."],
    ["smtp_unconfigured", "Skupne SMTP nastavitve manjkajo"],
    ["delivery_failed", "Pošiljanje ni uspelo."],
  ])("shows the safe reason %s", async (code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, code }))));
    renderTest();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(message));
  });

  it("hides raw request failures and lets the administrator retry", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("private@example.test secret-password"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, code: "sent" })));
    vi.stubGlobal("fetch", fetchMock);
    renderTest();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Testne zahteve ni bilo mogoče dokončati/)).toBeInTheDocument();
    expect(screen.queryByText(/private@example.test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Poštni strežnik je sprejel/)).toBeInTheDocument();
  });
});
