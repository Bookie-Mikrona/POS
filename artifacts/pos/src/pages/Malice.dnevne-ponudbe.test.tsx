import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MalicePage from "./Malice";

const createOffer = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const updateOffer = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const offers = vi.hoisted(() => ({ current: [] as any[] }));
const assignments = vi.hoisted(() => [
  ...[101, 102].map(artikelId => ({ id: artikelId, artikelId, groupId: 1, role: "main", active: true })),
  { id: 1031, artikelId: 103, groupId: 1, role: "main", active: true, velikostPice: "mala" },
  { id: 1032, artikelId: 103, groupId: 1, role: "main", active: true, velikostPice: "druzinska" },
  ...[201, 202].map(artikelId => ({ id: artikelId, artikelId, groupId: null, role: "soup", active: true })),
  ...[301, 302].map(artikelId => ({ id: artikelId, artikelId, groupId: null, role: "dessert", active: true })),
]);

vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetMalicaBootstrap: () => ({
    data: { groups: [{ id: 1, name: "Malica 1", code: "M1", sortOrder: 1, active: true }], assignments, prices: [] },
    isLoading: false,
  }),
  useListArtikli: () => ({
    data: assignments.map(a => ({ id: a.artikelId, ime: `Jed ${a.artikelId}` })),
  }),
  useListMalicaDailyOffers: () => ({ data: offers.current, isLoading: false }),
  useCreateMalicaDailyOffer: () => ({ mutateAsync: createOffer, isPending: false }),
  useUpdateMalicaDailyOffer: () => ({ mutateAsync: updateOffer, isPending: false }),
  usePublishMalicaDailyOffer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloseMalicaDailyOffer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MalicePage /></QueryClientProvider>);
}

describe("Dnevne malice — več izbir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offers.current = [];
  });

  it("shrani več glavnih jedi iste skupine, dve juhi in dve sladici", async () => {
    showPage();
    for (const id of [101, 102, 201, 202, 301, 302]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `Jed ${id}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

    await waitFor(() => expect(createOffer).toHaveBeenCalledWith({
      data: {
        businessDate: format(new Date(), "yyyy-MM-dd"),
        mainItems: [
          { groupId: 1, artikelId: 101, position: 0, enabled: true },
          { groupId: 1, artikelId: 102, position: 1, enabled: true },
        ],
        includedCourses: [
          { courseType: "soup", artikelId: 201, quantity: 1, enabled: true },
          { courseType: "soup", artikelId: 202, quantity: 1, enabled: true },
          { courseType: "dessert", artikelId: 301, quantity: 1, enabled: true },
          { courseType: "dessert", artikelId: 302, quantity: 1, enabled: true },
        ],
      },
    }));
  });

  it("v dnevni ponudbi shrani isto pico kot ločeni velikosti", async () => {
    showPage();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jed 103 (Mala)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Jed 103 (Družinska)" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

    await waitFor(() => expect(createOffer).toHaveBeenCalledWith({
      data: {
        businessDate: format(new Date(), "yyyy-MM-dd"),
        mainItems: [
          { groupId: 1, artikelId: 103, position: 0, enabled: true, velikostPice: "mala" },
          { groupId: 1, artikelId: 103, position: 1, enabled: true, velikostPice: "druzinska" },
        ],
        includedCourses: [],
      },
    }));
  });

  it("ob urejanju osnutka ohrani druge jedi iste skupine", async () => {
    offers.current = [{
      id: 11,
      status: "draft",
      businessDate: format(new Date(), "yyyy-MM-dd"),
      mainItems: [
        { id: 1, groupId: 1, artikelId: 101, position: 0, enabled: true },
        { id: 2, groupId: 1, artikelId: 102, position: 1, enabled: true },
      ],
      includedCourses: [
        { id: 3, courseType: "soup", artikelId: 201, quantity: 1, enabled: true },
        { id: 4, courseType: "soup", artikelId: 202, quantity: 1, enabled: true },
      ],
    }];
    showPage();
    expect(screen.getByRole("checkbox", { name: "Jed 101" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Jed 102" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Jed 202" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Jed 101" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));
    await waitFor(() => expect(updateOffer).toHaveBeenCalledWith({
      offerId: 11,
      data: {
        mainItems: [{ id: 2, groupId: 1, artikelId: 102, position: 1, enabled: true }],
        includedCourses: [
          { id: 3, courseType: "soup", artikelId: 201, quantity: 1, enabled: true },
          { id: 4, courseType: "soup", artikelId: 202, quantity: 1, enabled: true },
        ],
      },
    }));
  });
});