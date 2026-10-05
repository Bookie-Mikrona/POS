import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScannerBridgeSettings } from "./scanner-bridge";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Scanner Bridge settings", () => {
  it("offers the existing Windows bridge download and lists discovered scanners", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok", version: "1.2", scanners: [{ id: "hp", name: "HP OfficeJet" }],
    }))));
    render(<ScannerBridgeSettings />);
    expect(screen.getByRole("link", { name: "Prenesi ScannerBridge.exe" })).toHaveAttribute("href", "/api/downloads/ScannerBridge.exe");
    fireEvent.click(screen.getByRole("button", { name: "Preveri povezavo" }));
    expect(await screen.findByText("HP OfficeJet")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("v1.2");
  });

  it("distinguishes a reachable bridge without devices from a disconnected bridge", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", scanners: [] })))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    render(<ScannerBridgeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Preveri povezavo" }));
    expect(await screen.findByText(/Ni zaznanih skenerjev/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preveri povezavo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zaženite ScannerBridge.exe");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
