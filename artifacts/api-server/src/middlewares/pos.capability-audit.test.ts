import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const auditInternals = vi.hoisted(() => ({
  mountPath: Symbol.for("bookie.pos-capability-audit.mount-path"),
}));

vi.mock("express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("express")>();
  const OriginalRouter = actual.Router;
  const AuditedRouter = (...args: Parameters<typeof OriginalRouter>) => {
    const router = OriginalRouter(...args);
    const internalRouter = router as unknown as {
      stack: Array<{
        handle?: { stack?: unknown[] };
        [key: symbol]: unknown;
      }>;
      use: (...args: unknown[]) => unknown;
    };
    const originalUse = router.use.bind(router);
    router.use = ((...useArgs: unknown[]) => {
      const mountPath = typeof useArgs[0] === "string" ? useArgs[0] : "";
      const before = internalRouter.stack.length;
      const result = (originalUse as (...args: unknown[]) => unknown)(...useArgs);
      for (const layer of internalRouter.stack.slice(before)) {
        if (layer.handle?.stack) layer[auditInternals.mountPath] = mountPath;
      }
      return result;
    }) as typeof router.use;
    return router;
  };
  return { ...actual, Router: AuditedRouter };
});

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return { ...actual, getAuth: () => ({ userId: null }) };
});

import express, { Router, type IRouter } from "express";
import request from "supertest";
import { requireUnitCapability, resolveUnitCapability, resolveUnitCapabilities } from "./pos";
import {
  default as posRouter,
  invalidPreCapabilityRouteMounts,
  preCapabilityRouteMounts,
  protectedPosRouterMounts,
  type PreCapabilityRouteMount,
  type ProtectedPosRouterMount,
} from "../routes/pos";

type ExpressLayer = {
  route?: {
    path: string | string[];
    methods?: Record<string, boolean>;
  };
  handle?: {
    stack?: ExpressLayer[];
  };
  [auditInternals.mountPath]?: string;
};

function joinPath(prefix: string, routePath: string): string {
  const joined = `${prefix}/${routePath}`.replace(/\/+/g, "/");
  return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

function collectRouterPaths(router: IRouter, prefix: string): string[] {
  const stack = (router as unknown as { stack?: ExpressLayer[] }).stack ?? [];
  return stack.flatMap(layer => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      return paths.map(path => joinPath(prefix, path));
    }
    if (layer.handle?.stack) {
      return collectRouterPaths(
        layer.handle as unknown as IRouter,
        joinPath(prefix, layer[auditInternals.mountPath] ?? ""),
      );
    }
    return [];
  });
}

function findUnmappedRoutes(mounts: ProtectedPosRouterMount[]): string[] {
  return mounts
    .flatMap(mount => collectRouterPaths(mount.childRouter, mount.prefix))
    .filter(path => resolveUnitCapabilities(path) === null)
    .sort();
}

function collectPreCapabilityMountPaths(mount: PreCapabilityRouteMount): string[] {
  return mount.kind === "route"
    ? [mount.mountPath]
    : collectRouterPaths(mount.childRouter, mount.mountPath);
}

function collectRouterEndpoints(router: IRouter, prefix: string): string[] {
  const stack = (router as unknown as { stack?: ExpressLayer[] }).stack ?? [];
  return stack.flatMap(layer => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.entries(layer.route.methods ?? {})
        .filter(([, enabled]) => enabled)
        .map(([method]) => method);
      return paths.flatMap(path => methods.map(method =>
        `${method.toLowerCase()} ${joinPath(prefix, path)}`,
      ));
    }
    if (layer.handle?.stack) {
      return collectRouterEndpoints(
        layer.handle as unknown as IRouter,
        joinPath(prefix, layer[auditInternals.mountPath] ?? ""),
      );
    }
    return [];
  });
}

describe("inventar zaščite POS API poti", () => {
  it.each([
    ["/dnevni-meni", "/dnevni-meni"],
    ["/malice", "/malice"],
    ["/kosila", "/daily-lunch-offers"],
  ])("navigacija %s ima isto zmožnost kot vse nameščene poti %s", (navPath, apiPrefix) => {
    // Beremo dejanski odjemalski seznam, ne druge testne kopije zmožnosti.
    // Brez runtime uvoza iz drugega artefakta ali nalaganja React odjemalca.
    const clientSource = readFileSync(
      new URL("../../../pos/src/lib/unitProfiles.ts", import.meta.url), "utf8",
    );
    const navigationBlock = clientSource.match(
      /export const NAV_CAPABILITY_BY_PATH\b[^=]*=\s*\{([\s\S]*?)\n\};/,
    );
    expect(navigationBlock).not.toBeNull();
    const navigation = Object.fromEntries(
      [...navigationBlock![1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)]
        .map(([, path, capability]) => [path, capability]),
    );
    // Navigacija je ožja od strežnika: meni prikažemo le enotam s kuhinjo ali
    // pripravljeno hrano, API pa ostane zaščiten z zmožnostjo »menu«.
    expect(navigation[navPath]).toBeUndefined();
    const anyBlock = clientSource.match(
      /export const NAV_ANY_CAPABILITY_BY_PATH\b[^=]*=\s*\{([\s\S]*?)\n\};/,
    );
    expect(anyBlock).not.toBeNull();
    expect(anyBlock![1]).toMatch(new RegExp(`"${navPath}"\\s*:\\s*\\["kitchen", "prepared_food"\\]`));
    const paths = protectedPosRouterMounts
      .flatMap(mount => collectRouterPaths(mount.childRouter, mount.prefix))
      .filter(path => path === apiPrefix || path.startsWith(`${apiPrefix}/`));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(resolveUnitCapabilities(path), path).toEqual(["menu"]);
    }
  });

  it("vse montirane KDS poti dovolijo kuhinjo ali točilnico", () => {
    const paths = protectedPosRouterMounts
      .flatMap(mount => collectRouterPaths(mount.childRouter, mount.prefix))
      .filter(path => path === "/kds" || path.startsWith("/kds/"));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(resolveUnitCapabilities(path)).toEqual(["kitchen", "bar"]);
      expect(resolveUnitCapability(path)).toBe("kitchen");
    }
    expect(resolveUnitCapabilities("/narocila/42/postavke/7/pripravljeno")).toEqual(["kitchen"]);
  });
  it("klice QR natakarja varuje z zmožnostjo QR menija", () => {
    expect(resolveUnitCapability("/qr-waiter-requests")).toBe("qr_menu");
    expect(resolveUnitCapability("/qr-waiter-requests/123")).toBe("qr_menu");
  });

  it("upravljanje QR miz varuje z zmožnostjo QR menija", () => {
    expect(resolveUnitCapability("/qr-admin")).toBe("qr_menu");
    expect(resolveUnitCapability("/qr-admin/import")).toBe("qr_menu");
  });

  it("X- in Z-poročilo obravnava kot jedrni del zaključka blagajne", () => {
    expect(resolveUnitCapability("/x-porocilo")).toBe("checkout");
    expect(resolveUnitCapability("/x-porocilo/uskladitev-gotovine")).toBe("checkout");
    expect(resolveUnitCapability("/z-porocilo/zakljuci")).toBe("checkout");
    expect(resolveUnitCapability("/operativna-porocila")).toBe("operational_reports");
  });

  it("offline sync pred globalnim prehodom zahteva podpis naprave", () => {
    expect(preCapabilityRouteMounts.flatMap(mount => mount.policies)).toContainEqual(
      expect.objectContaining({
        routePath: "/offline-fiscal/sync/config",
        authorization: "device-signature",
      }),
    );
  });

  it("ima vsaka dejansko nameščena poslovna pot določeno zmožnost", () => {
    expect(protectedPosRouterMounts.length).toBeGreaterThan(0);
    expect(findUnmappedRoutes(protectedPosRouterMounts)).toEqual([]);
  });

  it("pregled pade za nov nepreslikan modul", () => {
    const articleRouter = Router();
    articleRouter.get("/artikli", (_req, res) => res.json({ ok: true }));
    const unknownRouter = Router();
    unknownRouter.use("/unknown", articleRouter);

    expect(findUnmappedRoutes([
      ...protectedPosRouterMounts,
      { prefix: "", childRouter: unknownRouter },
    ])).toContain("/unknown/artikli");
  });

  it("dejanska pred-globalna montaža in audit bereta isti inventar", () => {
    const stack = (posRouter as unknown as { stack: ExpressLayer[] }).stack;
    const gateIndex = stack.findIndex(layer => layer.handle === requireUnitCapability);
    expect(gateIndex).toBeGreaterThan(0);
    const preGatePaths = stack.slice(0, gateIndex).flatMap(layer => {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        return paths;
      }
      if (layer.handle?.stack) {
        return collectRouterPaths(
          layer.handle as unknown as IRouter,
          layer[auditInternals.mountPath] ?? "",
        );
      }
      return [];
    });
    const inventoryPaths = preCapabilityRouteMounts.flatMap(collectPreCapabilityMountPaths);

    expect([...new Set(preGatePaths)].sort()).toEqual([...new Set(inventoryPaths)].sort());
  });

  it("ima vsak pred-globalni vnos svojo dejansko nameščeno avtorizacijo in opis", () => {
    expect(invalidPreCapabilityRouteMounts(preCapabilityRouteMounts)).toEqual([]);
    for (const mount of preCapabilityRouteMounts) {
      const actualEndpoints = mount.kind === "route"
        ? [`${mount.method} ${mount.mountPath}`]
        : collectRouterEndpoints(mount.childRouter, mount.mountPath);
      const declaredEndpoints = mount.policies.map(policy =>
        `${policy.routeMethod} ${policy.routePath}`,
      );
      expect([...new Set(actualEndpoints)].sort()).toEqual([...new Set(declaredEndpoints)].sort());
    }
  });

  it("ohrani varnostno pomemben vrstni red pred globalnim prehodom", () => {
    expect(preCapabilityRouteMounts.map(mount => mount.policies[0]?.routePath)).toEqual([
      "/events",
      "/pos/auth/me",
      "/print/agent/pozeni.bat",
      "/sim",
      "/pos/admin/podjetja/:companyId/uporabniki",
      "/enote",
      "/racuni/eracun/batch-status-update",
      "/cti/dohodni-klic",
      "/offline-fiscal/sync/receipts/ingest",
    ]);
  });

  it("na HTTP meji dokaže vsako deklarirano avtorizacijo ali javno izjemo", async () => {
    const app = express();
    app.use(posRouter);
    const previousCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "capability-audit-test-secret";
    try {
      for (const policy of preCapabilityRouteMounts.flatMap(mount => mount.policies)) {
        const probe = policy.accessProbe;
        const response = await request(app)[probe.method](probe.path);
        expect(response.status, `${policy.routeMethod} ${policy.routePath}: ${response.text}`)
          .toBe(probe.expectedStatus);
      }
    } finally {
      if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCronSecret;
    }
  });

  it("pregled zavrne novo pred-globalno pot brez izrecnega middlewarea", () => {
    const unprotectedRouter = Router();
    unprotectedRouter.get("/unknown", (_req, res) => res.json({ ok: true }));
    const unprotectedMount: PreCapabilityRouteMount = {
      kind: "router",
      mountPath: "",
      policies: [],
      childRouter: unprotectedRouter,
    };

    expect(invalidPreCapabilityRouteMounts([
      ...preCapabilityRouteMounts,
      unprotectedMount,
    ])).toContain("<brez-prefixa>");
  });
});