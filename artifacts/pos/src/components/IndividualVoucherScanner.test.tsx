import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IndividualVoucherScanner,
  type IndividualVoucherPreview,
} from "./IndividualVoucherScanner";

const mockPosFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pos-auth-headers", () => ({
  posFetch: mockPosFetch,
}));

function ScannerHarness() {
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<IndividualVoucherPreview | null>(null);
  return (
    <IndividualVoucherScanner
      value={value}
      onChange={setValue}
      onVerified={setPreview}
      payableCents={2500}
    />
  );
}

describe("IndividualVoucherScanner", () => {
  let frameCallback: FrameRequestCallback | undefined;
  const trackStop = vi.fn();

  beforeEach(() => {
    mockPosFetch.mockReset();
    frameCallback = undefined;
    trackStop.mockReset();
    mockPosFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "0aaf02a3-2a51-4ce3-949e-f5214b6597c2",
        codeSuffix: "7K9P",
        balanceCents: 3200,
        currency: "EUR",
        status: "active",
        expiresAt: null,
      }),
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 77;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }),
      },
    });
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: class {
        detect = vi.fn().mockResolvedValue([{ rawValue: "individual-voucher-secret-code" }]);
        constructor(_options?: { formats?: string[] }) {}
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "BarcodeDetector");
  });

  it("keeps the video mounted for camera startup and verifies the scanned code immediately", async () => {
    const { container } = render(<ScannerHarness />);
    const video = screen.getByLabelText("Predogled kamere za skeniranje bona");
    Object.defineProperty(video, "srcObject", { configurable: true, writable: true, value: null });
    Object.defineProperty(video, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });

    fireEvent.click(screen.getByRole("button", { name: /zaženi kamero/i }));
    await screen.findByRole("button", { name: /ustavi kamero/i });
    expect(video).toBeInTheDocument();
    expect(frameCallback).toBeDefined();

    await act(async () => {
      frameCallback?.(0);
      await waitFor(() => expect(mockPosFetch).toHaveBeenCalledTimes(1));
    });

    expect(mockPosFetch.mock.calls[0][0]).toContain("/api/darilni-boni/individualni/preveri");
    expect(JSON.parse(mockPosFetch.mock.calls[0][1].body)).toEqual({
      code: "individual-voucher-secret-code",
    });
    expect(await screen.findByTestId("preview-individual-voucher")).toHaveTextContent("…7K9P");
    expect(screen.getByTestId("preview-individual-voucher")).toHaveTextContent("32.00 EUR");
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")).toBe(video);
  });
});