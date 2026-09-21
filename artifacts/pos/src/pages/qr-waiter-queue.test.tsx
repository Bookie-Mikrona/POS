import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { QrWaiterQueue } from "./Home";

vi.mock("@/hooks/use-kds", () => ({
  useUpdateQrWaiterRequest: () => ({ isPending: false, mutate: vi.fn() }),
  useQrWaiterRequests: () => ({ data: [] }),
}));

describe("QrWaiterQueue", () => {
  it("shows outstanding authenticated QR waiter calls with acknowledgement actions", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <QrWaiterQueue
          mize={[{ id: 7, ime: "Terasa", stevilka: 7 } as any]}
          requests={[{ id: 12, enotaId: 1, mizaId: 7, qrNapravaId: "device", stanje: "caka", ustvarjeno: "2026-01-01T12:00:00Z", potrjeno: null, zakljuceno: null, actorClerkUserId: null }]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("qr-waiter-request-12")).toHaveTextContent("Terasa");
    expect(screen.getByRole("button", { name: "Potrdi" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Zaključi" })).toBeEnabled();
  });
});