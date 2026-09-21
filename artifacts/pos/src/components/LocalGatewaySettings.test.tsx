import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const pairMock = vi.fn();
const clearMock = vi.fn();
const authorityMock = vi.fn();
const probeMock = vi.fn();
const checkMock = vi.fn();
let saved: { baseUrl?: string; clientId?: string } | undefined;
vi.mock("@/lib/gatewayClient", () => ({
  checkLocalGateway: (...args: unknown[]) => checkMock(...args),
  gatewayFetch: vi.fn().mockResolvedValue({ supportedOffline: [], service: "gateway", protocolVersion: "2", singleWriter: true }),
  getLocalGatewayConfig: () => saved,
  pairLocalGateway: (...args: unknown[]) => pairMock(...args),
  probeLocalGateway: (...args: unknown[]) => probeMock(...args),
  clearLocalGateway: (...args: unknown[]) => clearMock(...args),
  setLocalGatewayAuthorityEnabled: (...args: unknown[]) => authorityMock(...args),
}));

import { LocalGatewaySettings } from "./LocalGatewaySettings";

describe("LocalGatewaySettings pairing/authority", () => {
  beforeEach(() => {
    localStorage.clear(); saved = undefined; pairMock.mockReset(); clearMock.mockReset();
    authorityMock.mockReset(); probeMock.mockResolvedValue({ diagnosticTime: "now", pendingEventCount: 0 });
    checkMock.mockResolvedValue({ online: true, health: { diagnosticTime: "now", pendingEventCount: 0 } });
    pairMock.mockResolvedValue({ clientId: "client-1" });
  });

  it("requires manager confirmation before pairing and enables authority after confirmation", async () => {
    render(<LocalGatewaySettings />);
    fireEvent.change(screen.getByLabelText("Ročni LAN URL"), { target: { value: "http://gateway" } });
    fireEvent.change(screen.getByLabelText("Ime tega POS odjemalca"), { target: { value: "POS 1" } });
    fireEvent.change(screen.getByLabelText("Enkratna 6-mestna pairing koda"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Seznani ta POS" }));
    expect(pairMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Seznani ta POS" }));
    await waitFor(() => expect(pairMock).toHaveBeenCalled());
    expect(authorityMock).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Vključeno")).toBeTruthy();
  });

  it("disables without clearing pairing and only forget clears credentials", async () => {
    saved = { baseUrl: "http://gateway", clientId: "client-1" };
    localStorage.setItem("bookie.local-gateway.enabled", "1");
    render(<LocalGatewaySettings />);
    fireEvent.click(document.getElementById("local-gateway-enabled")!);
    await waitFor(() => expect(authorityMock).toHaveBeenLastCalledWith(false));
    expect(clearMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Pozabi pairing/i }));
    await waitFor(() => expect(clearMock).toHaveBeenCalled());
  });
});