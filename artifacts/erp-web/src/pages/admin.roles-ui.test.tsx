import "@testing-library/jest-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminPage from "./admin";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

const allModulesCompany = {
  id: "company-all",
  podjetjeDavcna: "11111111",
  naziv: "Podjetje z vsemi moduli",
  kratekNaziv: null,
  modules: ["erp", "pos", "osnovna_sredstva"],
  userCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const inactiveModuleCompany = {
  ...allModulesCompany,
  id: "company-inactive",
  naziv: "Podjetje brez OS",
  modules: ["erp", "pos"],
};

const adminUser = {
  clerkUserId: "user-accountant",
  email: "racunovodja@example.test",
  firstName: "Ana",
  lastName: "Kovač",
  imageUrl: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActiveAt: null,
  imaAktivnoSejo: false,
  banned: false,
  isSuperAdmin: false,
  companies: [{
    companyId: allModulesCompany.id,
    naziv: allModulesCompany.naziv,
    role: "accountant",
    sistem: "erp",
    createdAt: "2026-01-01T00:00:00.000Z",
  }],
};

function response(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

describe("Administracija – enoten prikaz dostopov modulov", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/users") return response({ users: [adminUser] });
      if (url === "/api/admin/companies") {
        return response({ companies: [allModulesCompany, inactiveModuleCompany] });
      }
      if (url.endsWith("/pos-roles")) {
        return response({ users: [{ clerkUserId: "user-accountant", vloga: "admin", ime: "Ana", priimek: "Kovač", enotaId: 1, enotaIme: "Enota 1", blagajnaId: 1, blagajnaIme: "B1", aktiven: true }] });
      }
      if (url.endsWith("/os-roles")) {
        return response({ users: [{ id: "os-role-1", clerkUserId: "user-accountant", role: "os_admin", createdAt: "2026-01-01T00:00:00.000Z" }] });
      }
      if (url.endsWith("/roles")) {
        return response({ users: [{ id: "erp-role-1", clerkUserId: "user-accountant", role: "accountant", createdAt: "2026-01-01T00:00:00.000Z" }] });
      }
      if (url.includes("/enote")) return response({ enote: [{ id: 1, ime: "Enota 1", aktiven: true, prostorId: "P1", prostorNaziv: "Prostor 1" }] });
      if (url.includes("/companies/")) return response(allModulesCompany);
      throw new Error(`Unexpected GET ${url}`);
    }));
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

  it("prikaže vse aktivne module po vzorcu seznam uporabnikov pred obrazcem", async () => {
    renderAdminPage();
    fireEvent.click(await screen.findByRole("button", { name: /Podjetje z vsemi moduli/ }));

    for (const moduleName of ["Glavne knjige", "POS gostinstva", "Osnovnih sredstev"]) {
      expect(await screen.findByText(`Dostop do ${moduleName}`)).toBeInTheDocument();
      expect(screen.getByText(`Obstoječi uporabniki ${moduleName}`)).toBeInTheDocument();
    }

    const glkTitle = screen.getByText("Dostop do Glavne knjige");
    const glkSection = glkTitle.parentElement?.parentElement;
    expect(glkSection).not.toBeNull();
    const glkUsers = within(glkSection as HTMLElement).getByText("Obstoječi uporabniki Glavne knjige");
    const glkAssign = within(glkSection as HTMLElement).getByRole("button", { name: "Dodeli" });
    expect(glkUsers.compareDocumentPosition(glkAssign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(glkSection as HTMLElement).getAllByText("Računovodja").length).toBeGreaterThan(0);
    const posSection = screen.getByText("Dostop do POS gostinstva").parentElement?.parentElement;
    const osSection = screen.getByText("Dostop do Osnovnih sredstev").parentElement?.parentElement;
    expect(within(posSection as HTMLElement).getByText("Admin podjetja")).toBeInTheDocument();
    expect(within(osSection as HTMLElement).getByText("OS Admin")).toBeInTheDocument();
  });

  it("za neaktivni modul prikaže skupno opozorilo", async () => {
    renderAdminPage();
    fireEvent.click(await screen.findByRole("button", { name: /Podjetje brez OS/ }));

    expect(await screen.findByText("⚠ Modul Osnovna sredstva ni aktiven. Aktivirajte ga zgoraj.")).toBeInTheDocument();
  });
});