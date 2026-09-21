import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCloud = vi.fn();
const updateCloud = vi.fn();
const openGateway = vi.fn();
const navigate = vi.fn();
let gatewayState: any;

vi.mock("@workspace/api-client-react", () => ({
  useListMize: () => ({ data: [{ id: 1, ime: "CLOUD TABLE", stevilka: 1, status: "prosta", dovoljeneMize: [] }] }),
  useListAktivnaNarocila: () => ({ data: [{ id: 9, mizaId: 1, status: "odprto", stevilkaNarocila: 9, postavke: [], skupaj: 5 }] }),
  useCreateNarocilo: () => ({ mutate: createCloud, isPending: false }),
  useUpdateNarocilo: () => ({ mutate: updateCloud, isPending: false }),
  useListProstori: () => ({ data: [] }),
  useReleaseRezervacijaMize: () => ({ mutate: vi.fn() }),
  getGetNarociloQueryKey: vi.fn(), getListMizeQueryKey: vi.fn(), getListAktivnaNarocilaQueryKey: vi.fn(),
  getListArtikliQueryKey: vi.fn(), getListArtikliQueryOptions: vi.fn(() => ({})),
  getListKategorijeQueryKey: vi.fn(), getListKategorijeQueryOptions: vi.fn(() => ({})),
}));
vi.mock("@/lib/gatewayOfflineStore", () => ({ useGatewayOfflineContext: () => gatewayState }));
vi.mock("@/contexts/NapravaContext", () => ({ useNaprava: () => ({ naprava: null, napravaKljuc: null }) }));
vi.mock("@/contexts/AutoStartContext", () => ({ useAutoStart: () => ({ block: vi.fn(), isBlocked: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-kds", () => ({ useQrWaiterRequests: () => ({ data: [] }), useUpdateQrWaiterRequest: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/use-glasovni-ukaz", () => ({ useGlasovniUkaz: () => ({ zacni: vi.fn(), poslusam: false }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn(), prefetchQuery: vi.fn() }) }));
vi.mock("wouter", () => ({ Link: ({ children, ...props }: any) => <a {...props}>{children}</a>, useLocation: () => ["/", navigate], useSearch: () => "" }));
vi.mock("@/components/RezervacijaDialog", () => ({ RezervacijaDialog: () => null }));
vi.mock("@/components/RazpolozljivostMizDialog", () => ({ RazpolozljivostMizDialog: () => null }));
vi.mock("@/components/TelefonNarociloDialog", () => ({ TelefonNarociloDialog: () => null }));

import Home from "./Home";

const base = () => ({
  scope: { companyId: "c", enotaId: 1 }, mode: "gateway", effectiveAuthority: "GATEWAY",
  enabled: true, healthy: false, cloudHealthy: true, snapshot: null, watermark: 0,
  pendingEventCount: 0, pendingLocalEvents: 0, primed: false, primeVersion: 0,
  pinnedOrderIds: new Set(), cloudBlocked: true, openOrder: openGateway,
  prime: vi.fn(), authorityForOrder: () => "GATEWAY",
});

describe("Home gateway authority", () => {
  beforeEach(() => {
    createCloud.mockReset(); updateCloud.mockReset(); openGateway.mockReset(); navigate.mockReset();
    gatewayState = base();
  });

  it("blocks cloud entities and mutations while gateway is latched but unavailable", () => {
    render(<Home />);
    expect(screen.getByTestId("gateway-recovery-block")).toHaveTextContent("Cloud ustvarjanje");
    expect(screen.queryByText("CLOUD TABLE")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Direktna prodaja" })[0]!);
    expect(createCloud).not.toHaveBeenCalled();
    expect(updateCloud).not.toHaveBeenCalled();
  });

  it("keeps the blocked route when UI authority toggle is off", () => {
    gatewayState = { ...base(), enabled: false };
    render(<Home />);
    expect(screen.getByTestId("gateway-recovery-block")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Direktna prodaja" })[0]!);
    expect(createCloud).not.toHaveBeenCalled();
  });

  it("uses gateway openOrder and local navigation with a healthy snapshot", async () => {
    openGateway.mockResolvedValue({ orderId: "local-1", version: 1, projection: { orderId: "local-1", status: "open", lines: [] } });
    gatewayState = { ...base(), healthy: true, snapshot: { orders: [], tables: [], kdsJobs: [], lastEventSeq: 1 } };
    render(<Home />);
    fireEvent.click(screen.getAllByRole("button", { name: "Direktna prodaja" })[0]!);
    await waitFor(() => expect(openGateway).toHaveBeenCalled());
    expect(createCloud).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/narocilo/local:local-1"));
  });
});