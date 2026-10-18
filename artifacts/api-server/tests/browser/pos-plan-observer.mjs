import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const apiPath = url => new URL(url).pathname.replace(/^\/pos\/api\//, "/api/");
const isAuth = url => apiPath(url) === "/api/pos/auth/me";
const isEvents = url => apiPath(url) === "/api/events";
const isFiniteApi = url => apiPath(url).startsWith("/api/") && !isEvents(url);

// Attach before navigation/login. Count requests as well as responses so a
// failed or still-in-flight duplicate cannot hide behind a successful response.
export function observeSession(page, companyId, unitId) {
  const state = {
    authRequests: 0, auth: [], documents: 0, streams: [], failures: [],
    pending: new Set(), errors: [], activeApi: new Map(), lastApiActivity: Date.now(),
  };
  const record = task => {
    state.pending.add(task);
    task.catch(error => state.errors.push(String(error)))
      .finally(() => state.pending.delete(task));
  };
  page.on("request", request => {
    if (isFiniteApi(request.url())) {
      state.activeApi.set(request, apiPath(request.url()));
      state.lastApiActivity = Date.now();
    }
    if (isAuth(request.url())) state.authRequests++;
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) state.documents++;
    if (isEvents(request.url())) state.streams.push({
      unitId: Number(new URL(request.url()).searchParams.get("enota_id")),
      status: null, contentType: null,
    });
  });
  page.on("response", response => {
    if (isAuth(response.url())) record((async () => {
      state.auth.push({ status: response.status(), body: await response.json() });
    })());
    if (isEvents(response.url())) {
      const stream = state.streams.at(-1);
      stream.status = response.status();
      stream.contentType = response.headers()["content-type"];
    }
  });
  page.on("requestfailed", request => {
    if (state.activeApi.delete(request)) state.lastApiActivity = Date.now();
    if (isAuth(request.url()) || isEvents(request.url())) {
      state.failures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
    }
  });
  page.on("requestfinished", request => {
    if (state.activeApi.delete(request)) state.lastApiActivity = Date.now();
  });

  const snapshot = () => ({
    requests: state.authRequests, responses: state.auth.length,
    documents: state.documents, streams: state.streams.length,
  });
  const eventsLink = page.getByRole("link", { name: "Dogodki in slavja", exact: true });
  async function settled() {
    // refreshAuthorization also awaits invalidateQueries. An auth response is
    // not the end of that refresh: retries may still be running (up to 4s gaps).
    // Six seconds of finite-API quiet prevents the next plan event from being
    // coalesced into the previous refresh. The streaming SSE request is excluded.
    await expect.poll(
      () => state.activeApi.size === 0 && Date.now() - state.lastApiActivity >= 6_000,
      { timeout: 60_000, message: "finite API work (including authorization invalidations) must settle" },
    ).toBe(true);
  }
  async function healthy(plan) {
    assert.deepEqual(state.errors, [], "observer failed to read response");
    assert.deepEqual(state.failures, [], "auth/SSE request failure");
    assert.equal(state.pending.size, 0);
    assert.equal(state.streams.length, 1, "SSE reconnect or missing stream");
    assert.equal(state.streams[0].status, 200);
    assert.match(state.streams[0].contentType ?? "", /^text\/event-stream/);
    assert.equal(state.streams[0].unitId, unitId, "SSE must use the authenticated unit");
    for (const response of state.auth) {
      assert.equal(response.status, 200);
      assert.equal(response.body.companyId, companyId);
      assert.equal(response.body.enotaId, unitId);
    }
    assert.equal(state.auth.at(-1)?.body.posPlan, plan);
    assert.equal(state.auth.at(-1)?.body.enotaCapabilities.includes("events"), plan === "extended");
    if (plan === "extended") await expect(eventsLink).toBeVisible();
    else await expect(eventsLink).toHaveCount(0);
  }
  return {
    page, state, snapshot, healthy,
    async baseline() {
      // Initial auth plus the real SSE-open refresh must finish before measuring.
      await expect.poll(() => state.auth.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
      await expect.poll(() => state.streams[0]?.status).toBe(200);
      await expect.poll(() => state.pending.size).toBe(0);
      await settled();
      await healthy("extended");
      const before = snapshot();
      await page.waitForTimeout(6_000);
      assert.deepEqual(snapshot(), before, "startup SSE-open refresh has not settled");
      await healthy("extended");
      return before;
    },
    async transition(before, delta, plan) {
      await expect.poll(() => state.auth.length, { timeout: 20_000 }).toBe(before.responses + delta);
      await expect.poll(() => state.pending.size).toBe(0);
      await healthy(plan);
      // Observe the negative assertion too: late duplicates/cross-tenant refreshes
      // must fail rather than pass at the first instant the UI looks right.
      await settled();
      assert.deepEqual(snapshot(), {
        requests: before.requests + delta, responses: before.responses + delta,
        documents: before.documents, streams: before.streams,
      }, "exact per-session refresh counts, no navigation/reconnect");
      await healthy(plan);
      return snapshot();
    },
  };
}
