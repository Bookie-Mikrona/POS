import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const authState = vi.hoisted(() => ({ loading: false }));

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { id: "test-superadmin", vloga: "superadmin", moraZamenjatiGeslo: false },
    loading: authState.loading,
    authStatus: "authenticated",
    logout: vi.fn(),
  }),
}));

vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: () => "test-publishable-key",
}));

// Stub page contents, not Wouter or the application's route registrations.
vi.mock("@/pages/SuperAdmin", () => ({
  default: function SuperAdminPageProbe() {
    const [location] = useLocation();
    return <h1 data-testid="superadmin-page">SuperAdminPage: {location}</h1>;
  },
}));

vi.mock("@/pages/not-found", () => ({
  default: () => <h1 data-testid="not-found-page">404</h1>,
}));

let appRouting: typeof import("./App");

beforeAll(async () => {
  // App captures BASE_URL at module initialization, as it does in production.
  vi.stubEnv("BASE_URL", "/pos/");
  appRouting = await import("./App");
});

beforeEach(() => {
  authState.loading = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function renderAt(path: string, children: React.ReactNode) {
  const { hook } = memoryLocation({ path, static: true });
  return render(<Router base="/pos" hook={hook}>{children}</Router>);
}

function captureDocumentRedirect(path: string) {
  const replace = vi.fn();
  // jsdom's native Location.replace is non-configurable and cannot navigate.
  // Keep the DOM window intact; override only the location on a window facade.
  const testWindow = Object.create(window);
  Object.defineProperty(testWindow, "location", {
    value: { ...window.location, pathname: path, replace },
  });
  vi.stubGlobal("window", testWindow);
  return replace;
}

describe("POS SuperAdmin route registrations", () => {
  it.each([
    "/superadmin",
    "/superadmin/eposta",
    "/superadmin/backup",
    "/superadmin/profil",
    "/superadmin/testi",
  ])("renders SuperAdminPage rather than 404 at /pos%s", async (path) => {
    renderAt(`/pos${path}`, <appRouting.PosPageRoutes />);

    expect(await screen.findByTestId("superadmin-page"))
      .toHaveTextContent(`SuperAdminPage: ${path}`);
    expect(screen.queryByTestId("not-found-page")).not.toBeInTheDocument();
  });

  it.each(["/superadmin/neznana-stran", "/superadmin-podobna"])(
    "does not treat an unregistered path %s as a SuperAdmin route",
    async (path) => {
      renderAt(`/pos${path}`, <appRouting.PosPageRoutes />);

      expect(await screen.findByTestId("not-found-page")).toBeInTheDocument();
      expect(screen.queryByTestId("superadmin-page")).not.toBeInTheDocument();
    },
  );
});

describe("authenticated SuperAdmin entry into POS", () => {
  it.each(["/pos", "/pos/", "/pos/login", "/pos/meni", "/pos/nastavitve"])(
    "keeps the document redirect inside /pos from %s",
    (path) => {
      const replace = captureDocumentRedirect(path);
      renderAt(path, <appRouting.AuthGate />);

      expect(replace).toHaveBeenCalledWith("/pos/superadmin");
      expect(replace.mock.calls.every(([destination]) => destination === "/pos/superadmin"))
        .toBe(true);
      expect(screen.queryByTestId("not-found-page")).not.toBeInTheDocument();
      expect(screen.queryByTestId("superadmin-page")).not.toBeInTheDocument();
    },
  );

  it("does not redirect before the auth session has finished loading", () => {
    authState.loading = true;
    const replace = captureDocumentRedirect("/pos/");
    renderAt("/pos/", <appRouting.AuthGate />);

    expect(screen.getByText("Nalagam...")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});