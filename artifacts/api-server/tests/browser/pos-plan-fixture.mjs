import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";
import { clerkClient } from "@clerk/express";
import { inArray } from "drizzle-orm";
import {
  db, pool, companiesTable, enoteTable, posUporabnikiTable,
  companyModulesTable, companyPosPlansTable,
} from "@workspace/db";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

export async function withPlanFixture(run) {
  assert.equal(process.env.POS_PLAN_LIVE, "1", "Opt in with POS_PLAN_LIVE=1 (development DB only)");
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"), "Development Clerk required");
  const originalAllowlist = {
    present: Object.hasOwn(process.env, "SUPER_ADMIN_IDS"),
    value: process.env.SUPER_ADMIN_IDS,
  };
  const users = [];
  const companyIds = [];
  const unitIds = [];
  const cleanupErrors = [];
  let api, gateway, browser;
  const attempt = async action => {
    try { await action(); } catch (error) { cleanupErrors.push(error); }
  };
  let failure;
  try {
    const suffix = randomUUID();
    for (let i = 0; i < 4; i++) {
      const user = await clerkClient.users.createUser({
        emailAddress: [`pos-plan-${suffix}-${i}+clerk_test@example.com`],
        firstName: "POS Plan", lastName: "Regression",
        skipPasswordRequirement: true,
      });
      users.push(user.id);
    }
    const companies = [];
    for (const kind of ["target", "control"]) {
      const [company] = await db.insert(companiesTable).values({
        naziv: `POS plan regression ${kind} ${suffix}`,
        podjetjeDavcna: `TEST-PLAN-${kind}-${suffix}`,
      }).returning();
      companyIds.push(company.id);
      await db.insert(companyModulesTable).values({ companyId: company.id, module: "pos", enabledBy: users[0] });
      await db.insert(companyPosPlansTable).values({ companyId: company.id, plan: "extended", enabledBy: users[0] });
      const [unit] = await db.insert(enoteTable).values({
        companyId: company.id, ime: `Plan regression ${kind}`,
        capabilities: ["checkout", "events", "settings"],
      }).returning();
      unitIds.push(unit.id);
      companies.push({ ...company, unit });
    }
    for (let i = 1; i <= 3; i++) {
      const company = companies[i === 3 ? 1 : 0];
      await db.insert(posUporabnikiTable).values({
        clerkUserId: users[i], companyId: company.id, enotaId: company.unit.id,
        vloga: "admin_enote", ime: "Plan", priimek: "Regression",
      });
    }

    // IPC supplies the ephemeral port, avoiding races from reserving/freeing one.
    api = fork(fileURLToPath(new URL("./pos-plan-server.mjs", import.meta.url)), [], {
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env, NODE_ENV: "development", PORT: "0",
        SUPER_ADMIN_IDS: [originalAllowlist.value, users[0]].filter(Boolean).join(","),
      },
      // Never emit request bodies, credentials or Clerk responses to test output.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const apiPort = await Promise.race([
      once(api, "message").then(([message]) => {
        assert.equal(message.type, "ready");
        return message.port;
      }),
      once(api, "exit").then(([code]) => { throw new Error(`Isolated API exited (${code})`); }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Isolated API startup timeout")), 60_000);
        timer.unref();
      }),
    ]);
    const frontend = process.env.POS_PLAN_FRONTEND ?? "http://127.0.0.1:24730";
    const frontendUrl = new URL(frontend);
    assert.ok(["127.0.0.1", "localhost"].includes(frontendUrl.hostname), "Local development frontend only");
    const probe = await fetch(`${frontend}/pos/`);
    assert.equal(probe.status, 200, "Start the existing POS web workflow first");
    const apiProxy = createProxyMiddleware({ target: `http://127.0.0.1:${apiPort}`, changeOrigin: true });
    const posProxy = createProxyMiddleware({ target: frontend, changeOrigin: true });
    // Streaming proxy, not route.fetch(): real EventSource remains open.
    gateway = createServer((req, res) => {
      const isApi = req.url.startsWith("/api/") || req.url.startsWith("/pos/api/");
      if (req.url.startsWith("/pos/api/")) req.url = req.url.slice(4);
      (isApi ? apiProxy : posProxy)(req, res, () => {
        res.writeHead(502).end("Regression gateway could not proxy request");
      });
    });
    const port = await listen(gateway);
    await run({
      users, companies, origin: `http://127.0.0.1:${port}`,
      registerBrowser: value => { browser = value; },
    });
  } catch (error) {
    failure = error;
  } finally {
    await attempt(async () => { await browser?.close(); });
    await attempt(async () => {
      if (gateway) {
        gateway.closeAllConnections();
        await new Promise((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()));
      }
    });
    await attempt(async () => {
      if (api && api.exitCode === null && api.signalCode === null) {
        const exited = once(api, "exit");
        api.kill("SIGTERM");
        const killTimer = setTimeout(() => api.kill("SIGKILL"), 5_000);
        await exited;
        clearTimeout(killTimer);
      }
    });
    // The managed development process/settings were never changed. Exact
    // equality includes the difference between absent and empty allowlists.
    await attempt(async () => {
      assert.equal(Object.hasOwn(process.env, "SUPER_ADMIN_IDS"), originalAllowlist.present);
      assert.equal(process.env.SUPER_ADMIN_IDS, originalAllowlist.value);
    });
    await attempt(async () => {
      if (!companyIds.length) return;
      await db.transaction(async tx => {
        await tx.delete(posUporabnikiTable).where(inArray(posUporabnikiTable.companyId, companyIds));
        await tx.delete(enoteTable).where(inArray(enoteTable.companyId, companyIds));
        await tx.delete(companyPosPlansTable).where(inArray(companyPosPlansTable.companyId, companyIds));
        await tx.delete(companyModulesTable).where(inArray(companyModulesTable.companyId, companyIds));
        await tx.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
      });
      for (const [table, column] of [
        [companiesTable, companiesTable.id], [enoteTable, enoteTable.companyId],
        [posUporabnikiTable, posUporabnikiTable.companyId], [companyPosPlansTable, companyPosPlansTable.companyId],
        [companyModulesTable, companyModulesTable.companyId],
      ]) {
        assert.equal((await db.select().from(table).where(inArray(column, companyIds))).length, 0, "fixture cleanup");
      }
    });
    for (const id of users) await attempt(async () => {
      await clerkClient.users.deleteUser(id);
      await assert.rejects(clerkClient.users.getUser(id), error => error.status === 404);
    });
    await attempt(async () => { await pool.end(); });
    if (failure || cleanupErrors.length) {
      throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), "POS plan regression or cleanup failed");
    }
  }
}

export async function signIn(page, userId, origin, route) {
  await page.goto(`${origin}/pos/${route}`);
  await page.waitForFunction(() => window.Clerk?.loaded, { timeout: 45_000 });
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
  await page.evaluate(async token => {
    const result = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: token });
    if (result.status !== "complete") throw new Error("Clerk ticket sign-in incomplete");
    await window.Clerk.setActive({ session: result.createdSessionId });
  }, ticket.token);
}
