// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCurrentScopeToken, configureScope, GatewayOfflineProvider,
  isCurrent, useGatewayOfflineContext,
} from "./gatewayOfflineStore";

const fixture = vi.hoisted(() => ({
  user: { companyId: "isolated-company", enotaId: 917 },
  health: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("@/lib/gatewayClient", () => ({
  checkLocalGateway: fixture.health,
  getLocalGatewayConfig: () => ({ url: "https://gateway.invalid" }),
  isLocalGatewayAuthorityEnabled: () => true,
  probeCloudApiReachability: async () => true,
  gatewayPosService: () => ({ snapshot: fixture.snapshot }),
  GatewayConflictError: class extends Error {},
}));

function Probe() {
  const state = useGatewayOfflineContext();
  return <output data-testid="scope">{JSON.stringify({
    scope: state.scope, snapshot: state.snapshot, watermark: state.watermark,
    pinned: [...state.pinnedOrderIds], primed: state.primed,
  })}</output>;
}

afterEach(() => {
  cleanup();
  configureScope(null);
  localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("gateway operational tree lifecycle", () => {
  it("clears global unit state and polling on platform transition, then restarts POS", async () => {
    vi.useFakeTimers();
    fixture.health.mockResolvedValue({ online: true, health: { authorityMode: "CLOUD" } });
    fixture.snapshot.mockResolvedValue({
      orders: [{ orderId: "draft-only", cloudOrderId: null }], tables: [], kdsJobs: [], lastEventSeq: 42,
    });
    const view = render(<><GatewayOfflineProvider><span>POS</span></GatewayOfflineProvider><Probe /></>);
    await act(async () => {});
    expect(screen.getByTestId("scope").textContent).toContain("draft-only");
    const token = captureCurrentScopeToken();
    view.rerender(<Probe />);
    expect(isCurrent(token)).toBe(false);
    expect(JSON.parse(screen.getByTestId("scope").textContent!)).toEqual({
      scope: null, snapshot: null, watermark: 0, pinned: [], primed: false,
    });
    const calls = fixture.health.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fixture.health).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<><GatewayOfflineProvider><span>POS again</span></GatewayOfflineProvider><Probe /></>);
    await act(async () => {});
    expect(fixture.health).toHaveBeenCalledTimes(calls + 1);
    expect(screen.getByTestId("scope").textContent).toContain("isolated-company");
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fixture.health).toHaveBeenCalledTimes(calls + 2);
  });

  it("ignores an old in-flight snapshot resolved after the operational tree unmounts", async () => {
    let resolveSnapshot!: (value: unknown) => void;
    fixture.health.mockResolvedValue({ online: true, health: { authorityMode: "CLOUD" } });
    fixture.snapshot.mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve; }));
    const view = render(<><GatewayOfflineProvider><span>POS</span></GatewayOfflineProvider><Probe /></>);
    await act(async () => {});
    const token = captureCurrentScopeToken();
    view.rerender(<Probe />);
    await act(async () => {
      resolveSnapshot({ orders: [{ orderId: "old-unit" }], tables: [], kdsJobs: [], lastEventSeq: 99 });
    });
    expect(isCurrent(token)).toBe(false);
    expect(screen.getByTestId("scope").textContent).not.toContain("old-unit");
    expect(JSON.parse(screen.getByTestId("scope").textContent!).snapshot).toBeNull();
  });
});
