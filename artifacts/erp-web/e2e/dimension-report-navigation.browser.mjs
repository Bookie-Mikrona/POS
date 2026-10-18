/**
 * Real ERP routes + real development Clerk session. Only business API responses
 * are synthetic. Never run against production or reuse the builder's session.
 * From the workspace root:
 *   node artifacts/erp-web/e2e/dimension-report-navigation.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { clerkClient } = requireApi("@clerk/express");
assert(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"), "Only development Clerk may be used");
const origin = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80";
const out = path.join(root, "generated-artifacts/dimension-report-navigation");
await mkdir(out, { recursive: true });

const companies = ["a", "b"].map(suffix => ({
  id: `dimension-navigation-${suffix}`, naziv: `Analitika Test ${suffix.toUpperCase()}`,
  role: "owner", modules: ["erp"], podjetjeDavcna: "12345678",
  createdAt: "2026-01-01", employerControlledTipsEnabled: false,
}));
const company = companies[0];
const prefix = `/api/companies/${company.id}`;
const periods = [2025, 2026].map(year => ({
  id: `period-${year}`, name: `Obdobje ${year}`, status: "open",
  startDate: `${year}-01-01`, endDate: `${year}-12-31`,
}));
const account = { id: "navigation-account", code: "4000000", name: "Testni stroški",
  isActive: true, allowsPosting: true };
const target = {
  id: "untagged-target", companyId: company.id, periodId: periods[0].id,
  periodName: periods[0].name, status: "posted", sourceType: "manual",
  entryDate: "2025-06-15", reference: "NAV-2025-001",
  description: "Temeljnica zunaj filtrov", totalDebit: "125.50", totalCredit: "125.50",
  createdAt: "2025-06-15T12:00:00Z",
  lines: [
    { id: "target-debit", accountId: account.id, accountCode: account.code,
      accountName: account.name, side: "debit", amount: "125.50",
      description: "Izvorna neoznačena knjižba" },
    { id: "target-credit", accountId: "offset-account", accountCode: "2200000",
      accountName: "Testne obveznosti", side: "credit", amount: "125.50" },
  ],
};
const decoy = { ...target, id: "filtered-draft", periodId: periods[1].id,
  periodName: periods[1].name, entryDate: "2026-10-01", status: "draft",
  reference: "NAV-2026-002", description: "Druga temeljnica na seznamu", lines: [] };
const filters = {
  companyId: company.id, dimensionType: "project", dateFrom: "2025-04-01",
  dateTo: "2025-09-30", accountId: account.id,
};
let revision = 1;
function report() {
  const amount = revision === 1 ? "125.50" : "246.80";
  return {
    ...filters, rows: [{
      id: "project-result", code: "P-TEST", name: `Projekt — osvežitev ${revision}`,
      totalDebit: amount, totalCredit: "0", balance: amount, accounts: [],
    }],
    grandTotalDebit: amount, grandTotalCredit: "0", grandTotalBalance: amount,
    untaggedDebit: "125.50", untaggedCredit: "0", untaggedBalance: "125.50",
    untaggedCount: 1, untaggedPage: 1, untaggedPageSize: 20,
    untaggedLines: [{
      lineId: "target-debit", entryId: target.id, entryDate: target.entryDate,
      reference: target.reference, entryDescription: target.description,
      description: target.lines[0].description, accountCode: account.code,
      accountName: account.name, side: "debit", amount: "125.50",
    }],
  };
}

const reports = [];
const lists = [];
const details = [];
const violations = [];
const pageErrors = [];
const results = [];
let user;
let browser;
let page;
let stage = "setup";
try {
  user = await clerkClient.users.createUser({
    emailAddress: [`dimensions-${crypto.randomUUID()}+clerk_test@example.com`],
    skipPasswordRequirement: true, firstName: "Navigation", lastName: "Test",
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // A fresh context cannot read, clear or replace any existing user's session.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", error => pageErrors.push(error.name));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    // Clerk's own API is deliberately untouched; all app business APIs,
    // including unexpected endpoints/writes, must be blocked or fulfilled.
    if (url.origin !== origin) return route.continue();
    const p = url.pathname;
    const reject = async reason => {
      violations.push(reason);
      await route.fulfill({ status: 500, json: { error: "Unexpected test request" } });
    };
    if (request.method() !== "GET") return reject(`${request.method()} ${p}`);
    const responses = {
      "/api/me": { id: user.id, firstName: "Navigation", lastName: "Test", isSuperAdmin: false },
      "/api/companies": { companies },
      "/api/admin/system": { erpOwnerCompanyId: company.id, company },
      [`${prefix}/periods`]: { periods },
      [`${prefix}/accounts`]: { accounts: [account] },
      [`${prefix}/cost-centers`]: { costCenters: [] },
      [`${prefix}/projects`]: { projects: [] },
      [`${prefix}/departments`]: { departments: [] },
      // The real company selector briefly mounts the real dashboard.
      [`${prefix}/open-items`]: { items: [], totalRemaining: "0" },
      [`${prefix}/aged-analysis`]: { buckets: [], totalRemaining: "0" },
      [`${prefix}/bank-balance`]: { totalBalance: null, accounts: [] },
      [`${prefix}/bank-balance-history`]: { points: [] },
    };
    if (p === `${prefix}/reports/dimensions`) {
      if (request.headers()["x-company-id"] !== company.id) return reject("Report company header mismatch");
      reports.push({ params: Object.fromEntries(url.searchParams), revision, stage });
      return route.fulfill({ json: report() });
    }
    if (p === `${prefix}/entries`) {
      lists.push(Object.fromEntries(url.searchParams));
      // Actually apply the list filters: the target may never leak into the
      // filtered result and accidentally make a broken deep link appear to work.
      const entries = [target, decoy].filter(entry =>
        (!url.searchParams.has("periodId") || entry.periodId === url.searchParams.get("periodId")) &&
        (!url.searchParams.has("status") || entry.status === url.searchParams.get("status")));
      return route.fulfill({ json: { entries } });
    }
    if (p === `${prefix}/entries/${target.id}`) {
      details.push({ id: target.id, stage });
      return route.fulfill({ json: target });
    }
    if (!Object.hasOwn(responses, p)) return reject(`Unexpected endpoint ${p}`);
    return route.fulfill({ json: responses[p] });
  });

  stage = "real development sign-in";
  await page.goto(origin);
  await page.waitForFunction(() => window.Clerk?.loaded);
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
  await page.evaluate(async token => {
    const attempt = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: token });
    if (attempt.status !== "complete") throw new Error("Development sign-in did not complete");
    await window.Clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.waitForURL("**/company-select");
  await page.getByRole("button").filter({ hasText: company.naziv }).click();
  await page.waitForURL("**/dashboard");
  const sessionId = await page.evaluate(() => window.Clerk.session.id);
  // Poison the obsolete global company fallback. Report headers must still
  // follow the real, user-scoped CompanyProvider selection.
  await page.evaluate(other => localStorage.setItem("erp_active_company", JSON.stringify(other)), companies[1]);

  async function choose(control, name) {
    await control.click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  async function checkContext() {
    assert.equal(await page.evaluate(() => window.Clerk.session?.id), sessionId, "Session must not change");
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem(`erp_active_company_${window.Clerk.user.id}`))?.id), company.id);
    await expect(page.locator("header")).toContainText(company.naziv);
  }
  async function checkReportFilters() {
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), filters);
    await expect(page.getByLabel("Dimenzija", { exact: true })).toHaveText("Projekti");
    await expect(page.getByLabel("Obdobje od", { exact: true })).toHaveValue("01.04.2025");
    await expect(page.getByLabel("Obdobje do", { exact: true })).toHaveValue("30.09.2025");
    await expect(page.getByLabel("Konto (neobvezno)", { exact: true })).toHaveText(`${account.code} — ${account.name}`);
    await checkContext();
  }

  stage = "restrict journal list through real controls";
  await page.getByRole("button", { name: "Temeljnice", exact: true }).click();
  const combos = page.getByRole("combobox");
  await choose(combos.nth(0), periods[1].name);
  await choose(combos.nth(2), "Osnutek");
  await expect(page.getByRole("cell", { name: decoy.description, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: target.description, exact: true })).toHaveCount(0);
  await expect.poll(() => lists.some(p => p.periodId === periods[1].id && p.status === "draft")).toBe(true);

  stage = "configure report through real controls";
  await page.getByRole("button", { name: "Analitika", exact: true }).click();
  await choose(page.getByLabel("Dimenzija", { exact: true }), "Projekti");
  await page.getByLabel("Obdobje od", { exact: true }).fill("01.04.2025");
  await page.getByLabel("Obdobje do", { exact: true }).fill("30.09.2025");
  await choose(page.getByLabel("Konto (neobvezno)", { exact: true }), `${account.code} — ${account.name}`);
  await page.getByRole("button", { name: "Prikaži poročilo", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Projekt — osvežitev 1", exact: true })).toBeVisible();
  await expect.poll(() => reports.at(-1)?.params).toEqual({
    dimensionType: filters.dimensionType, dateFrom: filters.dateFrom,
    dateTo: filters.dateTo, accountId: account.id, groupBy: "account",
    untaggedPage: "1", untaggedPageSize: "20",
  });
  await checkReportFilters();
  const reportUrl = page.url();
  results.push("PASS: Real Clerk session and CompanyProvider; project, nondefault dates and account selected through real report controls.");

  stage = "open out-of-filter journal from warning";
  const warning = page.getByRole("table", { name: "Knjižbe brez dimenzije" });
  await warning.getByRole("link", { name: `Odpri temeljnico ${target.reference}`, exact: true }).click();
  await page.waitForURL(`**/temeljnice?id=${target.id}`);
  const dialog = page.getByRole("dialog", { name: "Detajli temeljnice" });
  await expect(dialog).toBeVisible();
  for (const text of [`ID: ${target.id}`, target.reference, target.description, target.periodName,
    target.lines[0].description, "2200000 — Testne obveznosti"]) {
    await expect(dialog).toContainText(text);
  }
  await expect(dialog.getByRole("table").getByRole("row")).toHaveCount(4); // header, 2 lines, totals
  await expect(dialog).toContainText("125.50");
  await expect(dialog).not.toContainText(decoy.description);
  assert(details.some(d => d.id === target.id && d.stage === stage));
  // The background list still has the restrictive period AND status.
  await expect(page.locator('[role="combobox"]').nth(0)).toHaveText(periods[1].name);
  await expect(page.locator('[role="combobox"]').nth(2)).toHaveText("Osnutek");
  assert.notEqual(target.periodId, periods[1].id);
  assert.notEqual(target.status, "draft");
  await checkContext();
  results.push("PASS: Warning link opens the exact journal ID and full balanced lines despite persisted 2026/draft list filters excluding this 2025/posted entry.");

  stage = "browser Back must fetch fresh report";
  // Model another actor changing data, without a write, cache invalidation,
  // explicit refetch, page reload or waiting for the five-minute staleTime.
  revision = 2;
  const beforeBack = reports.length;
  await page.goBack();
  await expect(page).toHaveURL(reportUrl);
  await expect(dialog).toBeHidden();
  await checkReportFilters();
  await expect.poll(() => reports.length, { timeout: 10_000 }).toBeGreaterThan(beforeBack);
  assert(reports.slice(beforeBack).some(r => r.revision === 2 && r.stage === "browser Back must fetch fresh report"));
  assert.deepEqual(reports.at(-1).params, {
    dimensionType: filters.dimensionType, dateFrom: filters.dateFrom,
    dateTo: filters.dateTo, accountId: account.id, groupBy: "account",
    untaggedPage: "1", untaggedPageSize: "20",
  });
  await expect(page.getByRole("cell", { name: "Projekt — osvežitev 2", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Projekt — osvežitev 1", exact: true })).toHaveCount(0);
  await expect(page.getByText("Debet skupaj: 246,80 EUR", { exact: true })).toBeVisible();
  await expect(warning.getByRole("link", { name: `Odpri temeljnico ${target.reference}`, exact: true })).toBeVisible();
  assert.deepEqual(violations, [], "No writes or unexpected business APIs may reach the backend");
  assert.deepEqual(pageErrors, [], "No uncaught application errors");
  await page.screenshot({ path: path.join(out, "restored-report.png") });
  results.push("PASS: Browser Back preserves exact URL/company/dimension/date range/account and same live Clerk session; a new scoped request replaces cached report rows and totals.");
  results.push("PASS: All business API calls safely intercepted; no financial writes or unexpected endpoints.");
  await writeFile(path.join(out, "results.txt"), `${results.join("\n")}\n`);
  console.log(results.join("\n"));
} catch (error) {
  // Never log SDK errors, tickets, sessions, request headers or browser traces.
  console.error(`Dimension navigation regression failed at: ${stage} (${error.name})`);
  if (violations.length) console.error(violations.join("\n"));
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    // Body contains only this test's synthetic business data, never auth state.
    await writeFile(path.join(out, "failure-page.txt"),
      await page.locator("body").innerText().catch(() => ""));
  }
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally {
    if (user) {
      try { await clerkClient.users.deleteUser(user.id); }
      catch { console.error("Disposable development user cleanup failed"); process.exitCode = 1; }
    }
  }
}
