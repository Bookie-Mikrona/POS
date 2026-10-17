import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate, PosDeviceProviders, PosOperationalProviders } from "./App";
import { NastavitveProvider, useNastavitve } from "@/contexts/NastavitveContext";
import { HappyHourProvider } from "@/contexts/HappyHourContext";
import { createPosEventStream } from "@/lib/posEventStream";

vi.mock("@/lib/posEventStream", () => ({
  createPosEventStream: vi.fn(() => ({ addEventListener: vi.fn(), close: vi.fn() })),
}));

const state = vi.hoisted(() => ({
  user: { vloga: "superadmin", enotaId: undefined as number | undefined, ime: "Test" },
  settings: vi.fn(() => ({ data: { nazivRestavracije: "STALE" }, isLoading: false })),
  kds: vi.fn(() => ({ data: undefined })),
  gateway: vi.fn(),
  device: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: state.user, loading: false, authStatus: "authenticated", logout: vi.fn() }),
}));
vi.mock("@clerk/react/internal", () => ({ publishableKeyFromHost: () => "test-key" }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetNastavitve: state.settings,
  useGetKdsNastavitve: state.kds,
}));
vi.mock("@/lib/gatewayOfflineStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gatewayOfflineStore")>(),
  GatewayOfflineProvider: ({ children }: { children: React.ReactNode }) => {
    state.gateway();
    return children;
  },
}));
vi.mock("@/contexts/NapravaContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/contexts/NapravaContext")>(),
  NapravaProvider: ({ children }: { children: React.ReactNode }) => {
    state.device();
    return children;
  },
}));
vi.mock("@/pages/SuperAdmin", () => ({
  default: () => <h1>Platform test page</h1>,
}));

beforeEach(() => {
  state.user = { vloga: "superadmin", enotaId: undefined, ime: "Test" };
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aktiven: false }) }));
  vi.stubGlobal("EventSource", vi.fn().mockImplementation(function () {
    return { addEventListener: vi.fn(), close: vi.fn() };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function SettingsProbe() {
  const { nastavitve } = useNastavitve();
  return <span>{nastavitve?.nazivRestavracije ?? "no unit settings"}</span>;
}

describe("non-operational platform context", () => {
  it("renders the platform route without unit providers or background requests", async () => {
    const { hook } = memoryLocation({ path: "/pos/superadmin", static: true });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <PosOperationalProviders>
            <Router base="/pos" hook={hook}><AuthGate /></Router>
          </PosOperationalProviders>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Platform test page")).toBeInTheDocument();
    vi.useFakeTimers();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pos:sim-changed"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.settings).not.toHaveBeenCalled();
    expect(state.gateway).not.toHaveBeenCalled();
    expect(state.device).not.toHaveBeenCalled();
    expect(state.kds).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }));
    expect(fetch).not.toHaveBeenCalled();
    expect(createPosEventStream).not.toHaveBeenCalled();
  });

  it("hides cached settings and stops the settings query when the role changes", () => {
    state.user = { ...state.user, vloga: "admin", enotaId: 1 };
    const { rerender } = render(<NastavitveProvider><SettingsProbe /></NastavitveProvider>);
    expect(screen.getByText("STALE")).toBeInTheDocument();
    state.settings.mockClear();
    state.user = { ...state.user, vloga: "superadmin" };
    rerender(<NastavitveProvider><SettingsProbe /></NastavitveProvider>);
    expect(screen.getByText("no unit settings")).toBeInTheDocument();
    expect(state.settings).not.toHaveBeenCalled();
  });

  it("keeps the operational providers for an ordinary POS session", async () => {
    state.user = { ...state.user, vloga: "admin", enotaId: 1 };
    render(<QueryClientProvider client={new QueryClient()}>
      <NastavitveProvider><PosOperationalProviders>
        <PosDeviceProviders><span>POS session</span></PosDeviceProviders>
      </PosOperationalProviders></NastavitveProvider>
    </QueryClientProvider>);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("api/happy-hour"), expect.anything(),
    ));
    expect(state.gateway).toHaveBeenCalled();
    expect(state.device).toHaveBeenCalled();
    expect(createPosEventStream).toHaveBeenCalledOnce();
  });

  it.each(["superadmin", "admin"])("does not poll Happy Hour without a unit (%s)", async (vloga) => {
    vi.useFakeTimers();
    state.user = { ...state.user, vloga };
    render(<HappyHourProvider><span>no unit</span></HappyHourProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).not.toHaveBeenCalled();
  });
});