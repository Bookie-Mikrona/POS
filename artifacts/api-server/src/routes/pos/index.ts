/**
 * POS Gostinstvo — ruter za vse POS endpoint-e.
 *
 * Generirani API klient (@workspace/api-client-react) kliče poti brez /pos/ prefiksa
 * (npr. /api/enote, /api/artikli). Rute so zato montirane direktno na koren.
 *
 * Izjema: auth ruta ostane na /pos/auth/me ker jo AuthContext kliče direktno s tem URL-om.
 *
 * Zahteve za večino rut:
 *   Authorization: Bearer <clerk-jwt>   (Clerk)
 *   X-Enota-Id: <integer>               (aktivna poslovna enota)
 */

import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import {
  requireEnota,
  requirePosCompany,
  posActorContext,
  requireVerifiedPosActor,
  requireSpecificUnitCapability,
  requireUnitCapability,
  type PosRequest,
} from "../../middlewares/pos";
import { posOrderOperationIdempotency } from "../../middlewares/pos-operation-idempotency";
import { addClient, removeClient } from "../../lib/pos-sse";

import enoteRouter from "./enote";
import kategorijeRouter from "./kategorije";
import artikliRouter from "./artikli";
import mizeRouter from "./mize";
import prostoriRouter from "./prostori";
import narocilaRouter from "./narocila";
import racuniRouter, {
  batchStatusUpdateHandler,
  zahtevajCronSecret,
} from "./racuni";
import nastavitveRouter from "./nastavitve";
import natakariRouter from "./natakari";
import izmeneRouter from "./izmene";
import blagajneRouter from "./blagajne";
import poslovniProstoriRouter from "./poslovni-prostori";
import napraveRouter from "./naprave";
import statistikeRouter from "./statistike";
import certifikatRouter from "./certifikat";
import fursRegisterRouter from "./furs-register";
import fursDiagnostikaRouter from "./furs-diagnostika";
import kupecRouter from "./kupec";
import glasovniSinonimiRouter from "./glasovni-sinonimi";
import glasovniUkazRouter from "./glasovni-ukaz";
import dnevniMeniRouter from "./dnevni-meni";
import modSkupineRouter from "./modifikatorske-skupine";
import inventureRouter from "./inventure";
import prejemniceRouter from "./prejemnice";
import izdajniceRouter from "./izdajnice";
import zacetneZalogeRouter from "./zacetne-zaloge";
import zalogeRouter from "./zaloge";
import simRouter from "./sim";
import agentRouter from "./agent";
import posAuthRouter from "./auth";
import posAdminUporabnikiRouter from "./admin-uporabniki";
import terminalRouter from "./terminal";
import temeljniceRouter from "./temeljnice";
import blagajniskiPremikiRouter from "./blagajniski-premiki";
import uvozPrejemniceRouter from "./uvoz-prejemnic";
import uvozProfiliRouter from "./uvoz-profili";
import zPorocilaRouter from "./z-porocila";
import bizboxNastavitveRouter from "./bizbox-nastavitve";
import naseljaRouter from "./naselja";
import narocnikiRouter from "./narocniki";
import ctiRouter, { ctiIncomingRouter } from "./cti";
import dostavaRouter from "./dostava";
import preparedFoodRouter from "./prepared-food";
import plateWasteRouter from "./plate-waste";
import kdsRouter from "./kds";
import quickSwitchRouter from "./quick-switch";
import eventsRouter from "./events";
import offlineFiscalRouter from "./offline-fiscal";
import offlineFiscalSyncRouter, { gatewayReviewRouter } from "./offline-fiscal-sync";
import multicourseMenuRouter from "./multicourse-menu";
import embalazaRouter from "./embalaza";

const router: IRouter = Router();

export type ProtectedPosRouterMount = {
  prefix: string;
  childRouter: IRouter;
  before?: RequestHandler[];
};

type PreCapabilityAuthorization =
  "unit-capability" | "clerk-auth" | "agent-token" | "company-admin" |
  "cron-secret" | "cti-token" | "device-signature" | "public-bootstrap";

export type PreCapabilityEndpointPolicy = {
  routePath: string;
  routeMethod: "get" | "post" | "put" | "delete";
  authorization: PreCapabilityAuthorization;
  capability?: "checkout" | "simulation";
  description: string;
  accessProbe: {
    method: "get" | "post" | "put" | "delete";
    path: string;
    expectedStatus: number;
  };
};

type PreCapabilityRouteBase = {
  /** Dejanski prefix/path, pod katerim je handler nameščen v Express routerju. */
  mountPath: string;
  /** Resnične politike posameznih efektivnih poti z izvršljivim HTTP dokazom. */
  policies: PreCapabilityEndpointPolicy[];
};

// SSE tok za kuhinjo in blagajne — zahteva auth
// Klient kliče /api/events (useRealtimeSync.ts)
const requireCheckoutEvents = requireSpecificUnitCapability("checkout");
const eventsHandler: RequestHandler = (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("event: ping\ndata: {}\n\n");

  const napravaId = typeof req.query.napravaId === "string" ? req.query.napravaId : null;
  addClient(res, napravaId, (req as PosRequest).companyId);

  const keepalive = setInterval(() => {
    try { res.write("event: ping\ndata: {}\n\n"); }
    catch { clearInterval(keepalive); }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepalive);
    removeClient(res);
  });
};

export type PreCapabilityRouteMount = PreCapabilityRouteBase & (
  | {
    kind: "router";
    childRouter: IRouter;
    before?: RequestHandler[];
  }
  | {
    kind: "route";
    method: "get" | "post";
    handler: RequestHandler;
    before: RequestHandler[];
  }
);

/** Enotni izvršljivi inventar vseh poti, ki morajo ostati pred globalnim prehodom. */
export const preCapabilityRouteMounts: PreCapabilityRouteMount[] = [
  {
    kind: "route", method: "get", mountPath: "/events",
    policies: [{
      routePath: "/events", routeMethod: "get",
      authorization: "unit-capability", capability: "checkout",
      description: "SSE zahteva aktivno enoto z zmožnostjo checkout.",
      accessProbe: { method: "get", path: "/events", expectedStatus: 401 },
    }],
    before: [requireEnota, requireCheckoutEvents], handler: eventsHandler,
  },
  {
    kind: "router", mountPath: "/pos",
    policies: [{
      routePath: "/pos/auth/me", routeMethod: "get", authorization: "clerk-auth",
      description: "POS auth router preveri Clerk sejo brez zahtevane aktivne enote.",
      accessProbe: { method: "get", path: "/pos/auth/me", expectedStatus: 401 },
    }],
    childRouter: posAuthRouter,
  },
  {
    kind: "router", mountPath: "",
    policies: [
      {
        routePath: "/print/agent/pozeni.bat", routeMethod: "get", authorization: "public-bootstrap",
        description: "Statični BAT zaganjalnik je namerno javna datoteka brez podatkov podjetja ali skrivnosti.",
        accessProbe: { method: "get", path: "/print/agent/pozeni.bat", expectedStatus: 200 },
      },
      {
        routePath: "/print/agent/skript.ps1", routeMethod: "get", authorization: "agent-token",
        description: "Dinamični PS1 se generira le za agent token, ki obstaja v DB.",
        accessProbe: { method: "get", path: "/print/agent/skript.ps1", expectedStatus: 400 },
      },
      {
        routePath: "/print/agent/heartbeat", routeMethod: "post", authorization: "agent-token",
        description: "Heartbeat je vezan na enoto, razrešeno iz agent tokena.",
        accessProbe: { method: "post", path: "/print/agent/heartbeat", expectedStatus: 403 },
      },
      {
        routePath: "/print/agent/naloge", routeMethod: "get", authorization: "agent-token",
        description: "Prevzem tiskalne naloge je vezan na agent token iste enote.",
        accessProbe: { method: "get", path: "/print/agent/naloge", expectedStatus: 403 },
      },
      {
        routePath: "/print/agent/naloge/:id/izvrseno", routeMethod: "post", authorization: "agent-token",
        description: "Potrditev tiskalne naloge je vezana na agent token iste enote.",
        accessProbe: {
          method: "post", path: "/print/agent/naloge/1/izvrseno", expectedStatus: 403,
        },
      },
    ],
    childRouter: agentRouter,
  },
  {
    kind: "router", mountPath: "",
    policies: [
      {
        routePath: "/sim", routeMethod: "get",
        authorization: "unit-capability", capability: "simulation",
        description: "Branje simulacije zahteva aktivno enoto in simulation zmožnost.",
        accessProbe: { method: "get", path: "/sim", expectedStatus: 401 },
      },
      ...([
        ["post", "/sim/datum"],
        ["delete", "/sim/datum"],
        ["post", "/sim/reset"],
        ["post", "/sim/zacetne-zaloge"],
      ] as const).map(([routeMethod, routePath]) => ({
        routePath, routeMethod,
        authorization: "unit-capability" as const,
        capability: "simulation" as const,
        description: "Sprememba simulacije zahteva aktivno enoto in simulation zmožnost.",
        accessProbe: { method: routeMethod, path: routePath, expectedStatus: 401 },
      })),
    ],
    childRouter: simRouter,
  },
  {
    kind: "router", mountPath: "",
    policies: ([
      ["get", "/pos/admin/podjetja/:companyId/uporabniki", "/pos/admin/podjetja/00000000-0000-4000-8000-000000000000/uporabniki"],
      ["post", "/pos/admin/podjetja/:companyId/uporabniki", "/pos/admin/podjetja/00000000-0000-4000-8000-000000000000/uporabniki"],
      ["put", "/pos/admin/podjetja/:companyId/uporabniki/:id", "/pos/admin/podjetja/00000000-0000-4000-8000-000000000000/uporabniki/1"],
      ["delete", "/pos/admin/podjetja/:companyId/uporabniki/:id", "/pos/admin/podjetja/00000000-0000-4000-8000-000000000000/uporabniki/1"],
    ] as const).map(([routeMethod, routePath, probePath]) => ({
      routePath, routeMethod,
      authorization: "company-admin" as const,
      description: "Upravljanje POS uporabnikov zahteva Clerk sejo in vlogo administratorja podjetja.",
      accessProbe: { method: routeMethod, path: probePath, expectedStatus: 401 },
    })),
    childRouter: posAdminUporabnikiRouter,
  },
  {
    kind: "router", mountPath: "/enote",
    policies: ([
      ["get", "/enote", "/enote"],
      ["get", "/enote/current-public-ip", "/enote/current-public-ip"],
      ["post", "/enote", "/enote"],
      ["put", "/enote/:id", "/enote/1"],
      ["delete", "/enote/:id", "/enote/1"],
    ] as const).map(([routeMethod, routePath, probePath]) => ({
      routePath, routeMethod,
      authorization: "company-admin" as const,
      description: "Upravljanje enot zahteva Clerk sejo in dostop do izbranega podjetja.",
      accessProbe: { method: routeMethod, path: probePath, expectedStatus: 401 },
    })),
    before: [requirePosCompany], childRouter: enoteRouter,
  },
  {
    kind: "route", method: "post",
    mountPath: "/racuni/eracun/batch-status-update",
    policies: [{
      routePath: "/racuni/eracun/batch-status-update", routeMethod: "post",
      authorization: "cron-secret",
      description: "Scheduled batch uporablja izključno časovno varen cron secret.",
      accessProbe: {
        method: "post", path: "/racuni/eracun/batch-status-update", expectedStatus: 401,
      },
    }],
    before: [zahtevajCronSecret], handler: batchStatusUpdateHandler,
  },
  {
    kind: "router", mountPath: "",
    policies: [{
      routePath: "/cti/dohodni-klic", routeMethod: "post", authorization: "cti-token",
      description: "MacroDroid dohodni klic preveri žeton aktivne enote.",
      accessProbe: { method: "post", path: "/cti/dohodni-klic", expectedStatus: 401 },
    }],
    childRouter: ctiIncomingRouter,
  },
  {
    kind: "router", mountPath: "",
    policies: ([
      ["post", "/offline-fiscal/sync/receipts/ingest", "/offline-fiscal/sync/receipts/ingest"],
      ["get", "/offline-fiscal/sync/receipts/status/:operationId", "/offline-fiscal/sync/receipts/status/00000000-0000-4000-8000-000000000000"],
      ["get", "/offline-fiscal/sync/config", "/offline-fiscal/sync/config"],
      ["post", "/offline-fiscal/sync/gateway-events/ingest", "/offline-fiscal/sync/gateway-events/ingest"],
      ["get", "/offline-fiscal/sync/gateway-events/status", "/offline-fiscal/sync/gateway-events/status"],
    ] as const).map(([routeMethod, routePath, probePath]) => ({
      routePath, routeMethod,
      authorization: "device-signature" as const,
      description: "Offline sync preveri aktivno napravo, RSA podpis, čas in nonce.",
      accessProbe: { method: routeMethod, path: probePath, expectedStatus: 400 },
    })),
    childRouter: offlineFiscalSyncRouter,
  },
];

function handlersForPreCapabilityMount(mount: PreCapabilityRouteMount): RequestHandler[] {
  return mount.kind === "router"
    ? [...(mount.before ?? []), mount.childRouter]
    : [...mount.before, mount.handler];
}

export function invalidPreCapabilityRouteMounts(
  mounts: PreCapabilityRouteMount[],
): string[] {
  return mounts.flatMap(mount => {
    const invalidPolicy = mount.policies.length === 0 || mount.policies.some(policy =>
      !policy.routePath.startsWith("/") || !policy.description.trim()
      || !policy.accessProbe.path.startsWith("/"),
    );
    return invalidPolicy
      ? [mount.mountPath || "<brez-prefixa>"]
      : [];
  });
}

for (const mount of preCapabilityRouteMounts) {
  const handlers = handlersForPreCapabilityMount(mount);
  if (mount.kind === "route") {
    router[mount.method](mount.mountPath, ...handlers);
  } else if (mount.mountPath) {
    router.use(mount.mountPath, ...handlers);
  } else {
    router.use(...handlers);
  }
}

// Vse ostale POS rute — zahtevajo Clerk JWT + X-Enota-Id
router.use(requireEnota, requireUnitCapability);
router.use(gatewayReviewRouter);

export const actorRequiredPosRoutes = [
  ["post", "/darilni-boni/izdaja"],
  ["post", "/racuni"],
  ["post", "/racuni/retry-furs-batch"],
  ["post", "/racuni/:id/ponovi-furs"],
  ["post", "/racuni/:id/poslovna-finalizacija"],
  ["post", "/racuni/:id/storniraj"],
  ["patch", "/racuni/:id"],
  ["post", "/terminal/card-payment-attempts/:paymentAttemptId/recovery/select"],
  ["post", "/terminal/simulation/pay"],
  ["post", "/terminal/pay"],
  ["post", "/terminal/payten/android/start"],
  ["post", "/terminal/payten/android/bridge"],
  ["post", "/terminal/payten/android/confirm"],
  ["post", "/terminal/payten/android/timeout"],
  ["post", "/terminal/sumup/pay"],
  ["post", "/terminal/viva/pay"],
  ["post", "/terminal/viva/tap-to-pay/start"],
  ["post", "/terminal/viva/tap-to-pay/confirm"],
  ["post", "/terminal/viva/terminal/pay"],
  ["delete", "/terminal/viva/terminal/refund"],
] as const;

for (const [method, path] of actorRequiredPosRoutes) {
  router[method](path, posActorContext, requireVerifiedPosActor);
}

/**
 * Enotni inventar vseh routerjev za globalnim requireUnitCapability.
 * Revizijski test bere isti seznam, zato nova nameščena poslovna pot ne more
 * obiti preverjanja preslikave v zmožnost.
 */
export const protectedPosRouterMounts: ProtectedPosRouterMount[] = [
  { prefix: "", childRouter: kategorijeRouter },
  { prefix: "", childRouter: artikliRouter },
  { prefix: "", childRouter: mizeRouter },
  { prefix: "", childRouter: prostoriRouter },
  { prefix: "", childRouter: narocilaRouter, before: [posActorContext, posOrderOperationIdempotency] },
  { prefix: "", childRouter: racuniRouter, before: [posActorContext] },
   { prefix: "", childRouter: offlineFiscalRouter },
  { prefix: "", childRouter: quickSwitchRouter },
  { prefix: "", childRouter: nastavitveRouter },
  { prefix: "", childRouter: natakariRouter },
  { prefix: "", childRouter: izmeneRouter },
  { prefix: "", childRouter: blagajneRouter },
  { prefix: "", childRouter: poslovniProstoriRouter },
  { prefix: "", childRouter: napraveRouter },
  { prefix: "", childRouter: statistikeRouter },
  { prefix: "", childRouter: certifikatRouter },
  { prefix: "", childRouter: fursRegisterRouter },
  { prefix: "", childRouter: fursDiagnostikaRouter },
  { prefix: "", childRouter: kupecRouter },
  { prefix: "", childRouter: glasovniSinonimiRouter },
  { prefix: "", childRouter: glasovniUkazRouter, before: [posActorContext] },
  { prefix: "", childRouter: dnevniMeniRouter },
  { prefix: "", childRouter: modSkupineRouter },
  { prefix: "", childRouter: inventureRouter },
  { prefix: "", childRouter: prejemniceRouter },
  { prefix: "", childRouter: izdajniceRouter },
  { prefix: "", childRouter: zacetneZalogeRouter },
  { prefix: "", childRouter: zalogeRouter },
  { prefix: "", childRouter: preparedFoodRouter },
  { prefix: "", childRouter: plateWasteRouter },
  { prefix: "", childRouter: kdsRouter },
  { prefix: "", childRouter: eventsRouter },
  { prefix: "", childRouter: terminalRouter },
  { prefix: "", childRouter: temeljniceRouter },
  { prefix: "", childRouter: blagajniskiPremikiRouter },
  { prefix: "/uvoz", childRouter: uvozPrejemniceRouter },
  { prefix: "/uvoz", childRouter: uvozProfiliRouter },
  { prefix: "", childRouter: zPorocilaRouter, before: [posActorContext] },
  { prefix: "", childRouter: bizboxNastavitveRouter },
  { prefix: "", childRouter: naseljaRouter },
  { prefix: "", childRouter: narocnikiRouter },
  { prefix: "", childRouter: ctiRouter },
  { prefix: "", childRouter: dostavaRouter },
  { prefix: "", childRouter: multicourseMenuRouter },
  { prefix: "", childRouter: embalazaRouter },
];

for (const mount of protectedPosRouterMounts) {
  const handlers = [requireEnota, ...(mount.before ?? []), mount.childRouter];
  if (mount.prefix) router.use(mount.prefix, ...handlers);
  else router.use(...handlers);
}

export default router;
