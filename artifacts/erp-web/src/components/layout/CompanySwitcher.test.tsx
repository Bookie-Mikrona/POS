import "@testing-library/jest-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompanySwitcher } from "./Shell";

const apiMocks = vi.hoisted(() => ({
  useGetMe: vi.fn(),
  useListCompanies: vi.fn(),
  getAuthToken: vi.fn(),
}));
const companyMocks = vi.hoisted(() => ({
  useCompany: vi.fn(),
  setActiveCompany: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: "user_test" }, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }),
  useAuth: () => ({ getToken: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => apiMocks);
vi.mock("@/contexts/CompanyContext", () => companyMocks);

const activeCompany = {
  id: "company-active",
  naziv: "Aktivno podjetje",
  kratekNaziv: "Aktivno",
  podjetjeDavcna: "11111111",
  createdAt: "2026-01-01T00:00:00.000Z",
  role: "owner" as const,
};

function renderSwitcher() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompanySwitcher />
    </QueryClientProvider>,
  );
}

function openSwitcher() {
  const trigger = screen.getByRole("button");
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

describe("CompanySwitcher", () => {
  beforeEach(() => {
    apiMocks.getAuthToken.mockResolvedValue("test-token");
    companyMocks.setActiveCompany.mockReset();
    companyMocks.useCompany.mockReturnValue({
      activeCompany,
      setActiveCompany: companyMocks.setActiveCompany,
    });
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    Object.defineProperty(window, "PointerEvent", {
      writable: true,
      value: MouseEvent,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("superadminu prikaže vsa podjetja iz zaščitenega admin seznama", async () => {
    apiMocks.useGetMe.mockReturnValue({ data: { isSuperAdmin: true } });
    apiMocks.useListCompanies.mockReturnValue({ data: { companies: [activeCompany] } });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        companies: [
          activeCompany,
          {
            id: "company-foreign",
            naziv: "Podjetje brez uporabnikove vloge",
            kratekNaziv: "Brez vloge",
            podjetjeDavcna: "22222222",
            createdAt: "2026-01-02T00:00:00.000Z",
            modules: [],
            userCount: 0,
          },
        ],
      }), { status: 200 }),
    );

    renderSwitcher();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/companies",
      expect.objectContaining({ credentials: "include" }),
    ));
    openSwitcher();

    const foreignCompany = await screen.findByText("Podjetje brez uporabnikove vloge");
    expect(foreignCompany).toBeInTheDocument();
    fireEvent.click(foreignCompany);

    expect(companyMocks.setActiveCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "company-foreign",
        naziv: "Podjetje brez uporabnikove vloge",
      }),
    );
  });

  it("ne-superadminu pusti samo podjetja z njegovo vlogo", async () => {
    apiMocks.useGetMe.mockReturnValue({ data: { isSuperAdmin: false } });
    apiMocks.useListCompanies.mockReturnValue({
      data: {
        companies: [
          activeCompany,
          {
            ...activeCompany,
            id: "company-own",
            naziv: "Moje drugo podjetje",
            podjetjeDavcna: "33333333",
            role: "viewer" as const,
          },
        ],
      },
    });

    renderSwitcher();
    openSwitcher();

    expect(await screen.findByText("Moje drugo podjetje")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});