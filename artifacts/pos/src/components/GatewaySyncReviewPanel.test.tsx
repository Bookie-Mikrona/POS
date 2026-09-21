import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();
const mockToast = vi.fn();
vi.mock("@/lib/pos-auth-headers", () => ({ posFetch: (...args: unknown[]) => mockFetch(...args) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { vloga: "admin" } }) }));

import { GatewaySyncReviewPanel } from "./GatewaySyncReviewPanel";

const review = { id: "r1", deviceId: "device-1", gatewaySeq: 7, reason: "PAYLOAD_OR_SEQUENCE_CONFLICT",
  createdAt: "2025-01-02T13:04:00Z", existingPayloadHash: "old", incomingPayloadHash: "new" };
const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe("GatewaySyncReviewPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset(); mockToast.mockReset();
    mockFetch.mockResolvedValue(ok({ reviews: [review] }));
  });

  it("requires explicit confirmation and resolves then refreshes", async () => {
    render(<GatewaySyncReviewPanel />);
    expect(await screen.findByText("Dogodek #7")).toBeTruthy();
    expect(screen.getByText(/02\. 01\. 2025, 13:04/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Opomba (neobvezno)"), { target: { value: "pregledano" } });
    fireEvent.click(screen.getByRole("button", { name: /preskoči sporni lokalni dogodek/i }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/KEEP_CLOUD_SKIP_LOCAL — potrdi/i)).toBeTruthy();
    mockFetch.mockResolvedValueOnce(ok({ resolution: "KEEP_CLOUD_SKIP_LOCAL" }))
      .mockResolvedValueOnce(ok({ reviews: [] }));
    fireEvent.click(screen.getByRole("button", { name: /KEEP_CLOUD_SKIP_LOCAL — potrdi/i }));
    await waitFor(() => expect(screen.queryByText("Dogodek #7")).toBeNull());
    const post = mockFetch.mock.calls.find(call => call[1]?.method === "POST");
    expect(post?.[0]).toContain("/gateway-reviews/r1/resolve");
    expect(JSON.parse(post?.[1].body)).toEqual({ note: "pregledano", resolution: "KEEP_CLOUD_SKIP_LOCAL" });
    expect(mockToast).toHaveBeenCalled();
  });

  it("keeps review visible when resolve fails", async () => {
    render(<GatewaySyncReviewPanel />);
    await screen.findByText("Dogodek #7");
    fireEvent.click(screen.getByRole("button", { name: /preskoči sporni lokalni dogodek/i }));
    mockFetch.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole("button", { name: /KEEP_CLOUD_SKIP_LOCAL — potrdi/i }));
    await waitFor(() => expect(screen.getByText("Dogodek #7")).toBeTruthy());
    expect(screen.getByText("Sporne uskladitve ni mogoče razrešiti.")).toBeTruthy();
  });
});