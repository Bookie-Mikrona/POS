/**
 * Reproduces the live POS plan/reconnect scenario with disposable fixtures.
 *
 * Run in an environment with Playwright installed and a private fixture adapter:
 *   POS_BASE_URL=https://<development-host> \
 *   POS_FIXTURE_ADAPTER=/private/path/pos-reconnect-fixtures.mjs \
 *   node tests/pos-plan-reconnect.browser.mjs
 *
 * The adapter contract is:
 *   createFixtures() -> {
 *     storageStates: { superadmin, targetA, targetB, control },
 *     targetCompany: { id, label }, targetUnit: { id },
 *     controlCompany: { id, label }, controlUnit: { id }
 *   }
 *   verifyRestoredExtended(fixtures) // read-only DB assertion
 *   cleanupFixtures(fixtures)        // exact-ID DB + Clerk cleanup
 *   verifyNoFixtureRows(fixtures)    // read-only zero-row assertion
 *
 * The adapter owns private fixture IDs and credentials. This script never prints
 * them and does not read or change SUPER_ADMIN_IDS, workflow configuration, or
 * production settings. Fixture setup should provide two target admins and one
 * separate control admin, all on Extended POS units with checkout + events.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const baseUrl = required("POS_BASE_URL").replace(/\/+$/, "");
const adapterPath = resolve(required("POS_FIXTURE_ADAPTER"));
const adapter = await import(pathToFileURL(adapterPath).href);
for (const name of ["createFixtures", "verifyRestoredExtended", "cleanupFixtures", "verifyNoFixtureRows"]) {
  if (typeof adapter[name] !== "function") {
    throw new Error(`Fixture adapter must export ${name}()`);
  }
}

const instrumentation = () => {
  const state = (window.__posPlanReconnect = { events: [], readers: [] });
  const sseBodies = new WeakSet();
  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const rawUrl = typeof input === "string" ? input : request?.url ?? input.url;
    const url = new URL(rawUrl, location.href);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers ?? undefined);
    const isAuth = method === "GET" && url.pathname.endsWith("/api/pos/auth/me");
    const isSse =
      method === "GET" &&
      url.pathname.endsWith("/api/events") &&
      (headers.get("accept") ?? "").toLowerCase().includes("text/event-stream");

    if (isAuth) state.events.push({ kind: "authRequest", at: Date.now() });
    if (isSse) state.events.push({ kind: "sseRequest", at: Date.now() });

    try {
      const response = await fetchOriginal(input, init);
      if (isAuth) {
        const body = await response.clone().json().catch(() => null);
        const capabilities =
          body?.capabilities ?? body?.posPlanCapabilities ?? body?.unit?.capabilities ?? [];
        state.events.push({
          kind: "authData",
          status: response.status,
          plan: body?.posPlan ?? body?.plan ?? body?.company?.posPlan ?? null,
          companyId: body?.companyId ?? body?.company?.id ?? null,
          unitId: body?.enota?.id ?? body?.unit?.id ?? body?.enotaId ?? body?.unitId ?? null,
          eventsCap: Array.isArray(capabilities)
            ? capabilities.includes("events")
            : Boolean(capabilities?.events),
          at: Date.now(),
        });
      }
      if (isSse) {
        const contentType = response.headers.get("content-type") ?? "";
        const accepted =
          response.status === 200 &&
          contentType.toLowerCase().split(";")[0].trim() === "text/event-stream";
        state.events.push({
          kind: accepted ? "sseOpen" : "sseResponse",
          status: response.status,
          contentType,
          at: Date.now(),
        });
        if (accepted && response.body) sseBodies.add(response.body);
      }
      return response;
    } catch (error) {
      if (isSse) state.events.push({ kind: "sseFetchError", at: Date.now() });
      throw error;
    }
  };

  const getReader = ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader = function (...args) {
    const reader = Reflect.apply(getReader, this, args);
    if (!sseBodies.has(this)) return reader;
    const read = reader.read.bind(reader);
    reader.read = async (...readArgs) => {
      const result = await read(...readArgs);
      if (result.done) state.events.push({ kind: "readerDone", at: Date.now() });
      return result;
    };
    state.readers.push(reader);
    return reader;
  };

  const addListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type !== "auth:pos-plan-changed" || typeof listener !== "function") {
      return Reflect.apply(addListener, this, [type, listener, options]);
    }
    const wrapped = function (event) {
      state.events.push({ kind: "planEvent", at: Date.now() });
      return listener.call(this, event);
    };
    return Reflect.apply(addListener, this, [type, wrapped, options]);
  };
};

const contexts = [];
const pages = {};
const documentRequests = {};
const routeAborts = { targetA: 0, targetB: 0 };
let browser;
let fixtures;
let primaryError;

async function snapshot(page) {
  const value = await page.evaluate(() => {
    const events = window.__posPlanReconnect?.events ?? [];
    const count = (kind) => events.filter((event) => event.kind === kind).length;
    const auth = events.filter((event) => event.kind === "authData");
    return {
      docs: performance.getEntriesByType("navigation").length,
      authRequests: count("authRequest"),
      auth200: auth.filter((event) => event.status === 200).length,
      authHistory: auth,
      latestPlan: auth.at(-1)?.plan ?? null,
      sseRequests: count("sseRequest"),
      sseOpens: count("sseOpen"),
      sseErrors: count("sseFetchError"),
      readerDone: count("readerDone"),
      planEvents: count("planEvent"),
      dogodki: document.querySelectorAll('a[href$="/dogodki"]').length,
    };
  });
  return { ...value, docs: documentRequests[Object.keys(pages).find((key) => pages[key] === page)] };
}

async function waitForValue(getValue, predicate, message, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await getValue();
    if (predicate(value)) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${message}; last value: ${JSON.stringify(value)}`);
}

function compact(value) {
  return {
    docs: value.docs,
    authRequests: value.authRequests,
    auth200: value.auth200,
    latestPlan: value.latestPlan,
    sseRequests: value.sseRequests,
    sseOpens: value.sseOpens,
    sseErrors: value.sseErrors,
    readerDone: value.readerDone,
    planEvents: value.planEvents,
    dogodki: value.dogodki,
  };
}

async function installAbortRoute(page, key) {
  await page.route("**/api/events*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isSse =
      request.method() === "GET" &&
      url.pathname.endsWith("/api/events") &&
      (request.headers()["accept"] ?? "").toLowerCase().includes("text/event-stream");
    if (isSse) {
      routeAborts[key] += 1;
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
}

async function cancelCurrentReader(page) {
  await page.evaluate(async () => {
    const reader = window.__posPlanReconnect?.readers.at(-1);
    if (!reader) throw new Error("No POS SSE reader was observed");
    await reader.cancel("test-only disconnected interval");
  });
}

function assertAuthIdentity(state, companyId, unitId, role) {
  assert(state.authHistory.length >= 1, `${role} should have auth/me data`);
  for (const auth of state.authHistory) {
    assert.equal(auth.status, 200, `${role} auth/me should be HTTP 200`);
    assert.equal(auth.companyId, companyId, `${role} auth/me should match its company`);
    assert.equal(auth.unitId, unitId, `${role} auth/me should match its selected unit`);
  }
}

async function selectTargetPlan(superPage, targetCompany, planLabel) {
  if ((await superPage.getByRole("combobox").count()) === 0) {
    await superPage.getByRole("button").filter({ hasText: targetCompany.label }).first().click();
  }
  const selector = superPage.getByRole("combobox").first();
  await selector.waitFor({ state: "visible" });
  await selector.click();
  const apiPath = `/api/superadmin/podjetja/${targetCompany.id}/pos-paket`;
  const responsePromise = superPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith(apiPath),
  );
  await superPage.getByRole("option", { name: planLabel, exact: true }).click();
  const response = await responsePromise;
  const body = await response.json();
  assert.equal(response.status(), 200, `${planLabel} PUT should succeed`);
  assert.equal(body.plan, planLabel.toLowerCase());
  assert.equal(body.companyId, targetCompany.id);
  return { status: response.status(), plan: body.plan, companyMatched: true };
}

try {
  const launchOptions = process.env.PLAYWRIGHT_BROWSER_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL }
    : {};
  browser = await chromium.launch(launchOptions);
  fixtures = await adapter.createFixtures({
    initialPlan: "extended",
    targetAdmins: 2,
    controlAdmins: 1,
    unitCapabilities: ["checkout", "events"],
  });
  const roles = ["superadmin", "targetA", "targetB", "control"];
  for (const role of roles) {
    const context = await browser.newContext({ storageState: fixtures.storageStates[role] });
    context.setDefaultTimeout(15000);
    await context.addInitScript(instrumentation);
    contexts.push(context);
    pages[role] = await context.newPage();
    documentRequests[role] = 0;
    pages[role].on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === pages[role].mainFrame()) {
        documentRequests[role] += 1;
      }
    });
    await pages[role].goto(`${baseUrl}/pos/${role === "superadmin" ? "superadmin" : "nastavitve"}`);
  }

  const superPage = pages.superadmin;
  const targetPages = [pages.targetA, pages.targetB];
  for (const page of [pages.targetA, pages.targetB, pages.control]) {
    await page.getByRole("heading", { name: "Nastavitve sistema" }).waitFor();
  }
  await waitForValue(
    async () => Promise.all([pages.targetA, pages.targetB, pages.control].map(snapshot)),
    (states) =>
      states.every(
        (state) =>
          state.docs === 1 &&
          state.auth200 >= 2 &&
          state.latestPlan === "extended" &&
          state.sseOpens >= 1 &&
          state.dogodki === 1,
      ),
    "Initial Extended baseline did not settle",
  );

  const firstAborts = { targetA: routeAborts.targetA, targetB: routeAborts.targetB };
  await installAbortRoute(pages.targetA, "targetA");
  await installAbortRoute(pages.targetB, "targetB");
  await Promise.all([cancelCurrentReader(pages.targetA), cancelCurrentReader(pages.targetB)]);
  await Promise.all(
    targetPages.map((page) =>
      waitForValue(snapshot.bind(null, page), (state) => state.readerDone >= 1, "Target reader did not close"),
    ),
  );
  const litePut = await selectTargetPlan(superPage, fixtures.targetCompany, "Lite");
  await waitForValue(
    () => routeAborts,
    (counts) => counts.targetA > firstAborts.targetA && counts.targetB > firstAborts.targetB,
    "Target-only retry aborts were not observed",
  );
  const staleExtended = await Promise.all(targetPages.map(snapshot));
  for (const state of staleExtended) {
    assert.equal(state.auth200, 2);
    assert.equal(state.latestPlan, "extended");
    assert.equal(state.planEvents, 0);
    assert.equal(state.dogodki, 1);
    assert.equal(state.docs, 1);
  }
  await Promise.all(targetPages.map((page) => page.unroute("**/api/events*")));
  const liteRecovery = await Promise.all(
    targetPages.map((page) =>
      waitForValue(
        () => snapshot(page),
        (state) => state.auth200 >= 3 && state.latestPlan === "lite" && state.sseOpens >= 2,
        "Target did not recover to Lite",
      ),
    ),
  );
  for (const state of liteRecovery) {
    assert.equal(state.planEvents, 0);
    assert.equal(state.dogodki, 0);
    assert.equal(state.docs, 1);
  }

  const secondAborts = { targetA: routeAborts.targetA, targetB: routeAborts.targetB };
  await installAbortRoute(pages.targetA, "targetA");
  await installAbortRoute(pages.targetB, "targetB");
  await Promise.all([cancelCurrentReader(pages.targetA), cancelCurrentReader(pages.targetB)]);
  await Promise.all(
    targetPages.map((page) =>
      waitForValue(snapshot.bind(null, page), (state) => state.readerDone >= 2, "Second reader did not close"),
    ),
  );
  const extendedPut = await selectTargetPlan(superPage, fixtures.targetCompany, "Extended");
  await waitForValue(
    () => routeAborts,
    (counts) => counts.targetA > secondAborts.targetA && counts.targetB > secondAborts.targetB,
    "Second target-only retry aborts were not observed",
  );
  const staleLite = await Promise.all(targetPages.map(snapshot));
  for (const state of staleLite) {
    assert.equal(state.auth200, 3);
    assert.equal(state.latestPlan, "lite");
    assert.equal(state.planEvents, 0);
    assert.equal(state.dogodki, 0);
    assert.equal(state.docs, 1);
  }
  await Promise.all(targetPages.map((page) => page.unroute("**/api/events*")));
  const extendedRecovery = await Promise.all(
    targetPages.map((page) =>
      waitForValue(
        () => snapshot(page),
        (state) => state.auth200 >= 4 && state.latestPlan === "extended" && state.sseOpens >= 3,
        "Target did not recover to Extended",
      ),
    ),
  );
  for (const state of extendedRecovery) {
    assert.equal(state.planEvents, 0);
    assert.equal(state.dogodki, 1);
    assert.equal(state.docs, 1);
  }
  assertAuthIdentity(
    extendedRecovery[0],
    fixtures.targetCompany.id,
    fixtures.targetUnit.id,
    "targetA",
  );
  assertAuthIdentity(
    extendedRecovery[1],
    fixtures.targetCompany.id,
    fixtures.targetUnit.id,
    "targetB",
  );

  const control = await snapshot(pages.control);
  assert.equal(control.auth200, 2);
  assert.equal(control.latestPlan, "extended");
  assert.equal(control.sseOpens, 1);
  assert.equal(control.sseErrors, 0);
  assert.equal(control.planEvents, 0);
  assert.equal(control.dogodki, 1);
  assert.equal(control.docs, 1);
  assertAuthIdentity(
    control,
    fixtures.controlCompany.id,
    fixtures.controlUnit.id,
    "control",
  );

  await adapter.verifyRestoredExtended(fixtures);
  console.log(
    JSON.stringify({
      result: "PASS",
      puts: [litePut, extendedPut],
      targetA: compact(extendedRecovery[0]),
      targetB: compact(extendedRecovery[1]),
      control: compact(control),
      deliberateRouteAborts: routeAborts,
    }),
  );
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  for (const context of contexts) {
    try {
      await context.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    if (fixtures) await adapter.cleanupFixtures(fixtures);
    else await adapter.cleanupPartialFixtures?.();
    if (fixtures) await adapter.verifyNoFixtureRows(fixtures);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await browser?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    if (primaryError) {
      console.error(`Fixture cleanup failed after test error: ${cleanupErrors.length} error(s)`);
    } else {
      throw new AggregateError(cleanupErrors, "POS reconnect fixture cleanup failed");
    }
  }
}
