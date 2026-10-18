/**
 * Real development Clerk + protected ERP routes; synthetic business APIs only.
 * Run against the running ERP development preview. Never reuse saved sessions.
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
const out = path.join(root, "generated-artifacts/amortization-existing-entry");
await mkdir(out, { recursive: true });

const company = {
  id: "amortization-navigation", naziv: "Amortizacija Test",
  role: "owner", osRole: "os_admin", modules: ["erp", "osnovna_sredstva"], podjetjeDavcna: "12345678",
  createdAt: "2026-01-01", employerControlledTipsEnabled: false,
};
// Two choices ensure we exercise the real company selector, not a stored choice.
const companies = [company, { ...company, id: "amortization-other", naziv: "Drugo testno podjetje" }];
const prefix = `/api/companies/${company.id}`;
const osPrefix = `/api/os/${company.id}/amortizacija`;
const periods = [2025, 2026].map(year => ({
  id: `period-${year}`, name: `Obdobje ${year}`, status: "open",
  startDate: `${year}-01-01`, endDate: `${year}-12-31`,
}));
const accounts = [
  { id: "expense", code: "4300000", name: "Amortizacija opreme" },
  { id: "correction", code: "0500000", name: "Popravek vrednosti opreme" },
].map(a => ({ ...a, isActive: true, allowsPosting: true }));
function entry(id, status, month, amount) {
  return {
    id, companyId: company.id, periodId: periods[0].id, periodName: periods[0].name,
    status, sourceType: "manual", entryDate: `2025-${month}-28`,
    reference: `AMORT:2025:${month}`, description: `Obstoječa amortizacija ${id}`,
    totalDebit: amount, totalCredit: amount, createdAt: `2025-${month}-28T12:00:00Z`,
    lines: accounts.map((a, i) => ({
      id: `${id}-${i}`, accountId: a.id, accountCode: a.code, accountName: a.name,
      side: i === 0 ? "debit" : "credit", amount, description: `Knjižba ${id} ${i}`,
    })),
  };
}
const draft = entry("existing-draft", "draft", "01", "125.50");
const posted = entry("existing-posted", "posted", "02", "246.80");
const decoy = {
  ...draft, id: "visible-decoy", periodId: periods[1].id, periodName: periods[1].name,
  entryDate: "2026-10-01", reference: "OTHER-2026", description: "Druga temeljnica na seznamu", lines: [],
};
const preview = {
  referenca: "AMORT:2025", leto: 2025, mesec: null, skupajBreme: "372.30",
  skupajDobro: "372.30", uravnotezeno: true, steviloSredstev: 1, brezKontov: 0,
  vrstice: [{
    kontoStroskaId: accounts[0].id, kontoStroskaCode: accounts[0].code,
    kontoStroskaName: accounts[0].name, kontoPopravkaId: accounts[1].id,
    kontoPopravkaCode: accounts[1].code, kontoPopravkaName: accounts[1].name,
    costCenterId: null, znesek: "372.30", steviloSredstev: 1,
  }],
};
const scenarios = [
  { name: "draft", entries: [draft], selected: draft, code: "DUPLICATE_PERIOD" },
  { name: "posted", entries: [posted], selected: posted, code: "DUPLICATE_PERIOD" },
  { name: "mixed-second-link", entries: [draft, posted], selected: posted, code: "MONTHLY_EXISTS_FOR_YEAR" },
];
const violations = [];
const pageErrors = [];
const requests = [];
const details = [];
const lists = [];
const results = [];
let scenario;
let user;
let browser;
let page;
let stage = "setup";
try {
  user = await clerkClient.users.createUser({
    emailAddress: [`amortization-${crypto.randomUUID()}+clerk_test@example.com`],
    skipPasswordRequirement: true, firstName: "Amortizacija", lastName: "Test",
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, serviceWorkers: "block",
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", error => pageErrors.push(error.name));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.continue(); // Clerk stays real.
    const p = url.pathname;
    const reject = async reason => {
      violations.push(reason);
      await route.fulfill({ status: 500, json: { error: "Unexpected test request" } });
    };
    // Only these two exact POST payloads are allowed, and neither is forwarded.
    if (p === `${osPrefix}/knjizenje` && request.method() === "POST" && scenario) {
      const body = request.postDataJSON();
      if (JSON.stringify(body) !== JSON.stringify({ leto: 2025, dryRun: body.dryRun }) ||
          typeof body.dryRun !== "boolean") return reject("Unexpected amortization payload");
      requests.push({ scenario: scenario.name, body, status: body.dryRun ? 200 : 409 });
      return route.fulfill(body.dryRun ? { json: preview } : {
        status: 409,
        json: {
          error: "Amortizacijska temeljnica za to obdobje že obstaja.",
          code: scenario.code,
          existingEntries: scenario.entries.map(e => ({ entryId: e.id, status: e.status })),
        },
      });
    }
    if (request.method() !== "GET") return reject(`${request.method()} ${p}`);
    const responses = {
      "/api/me": { id: user.id, firstName: "Amortizacija", lastName: "Test", isSuperAdmin: false },
      "/api/companies": { companies },
      "/api/admin/system": { erpOwnerCompanyId: company.id, company },
      [`${prefix}/periods`]: { periods },
      [`${prefix}/accounts`]: { accounts },
      [`${prefix}/cost-centers`]: { costCenters: [] },
      [`${prefix}/projects`]: { projects: [] },
      [`${prefix}/departments`]: { departments: [] },
      // The real selector briefly mounts the dashboard.
      [`${prefix}/open-items`]: { items: [], totalRemaining: "0" },
      [`${prefix}/aged-analysis`]: { buckets: [], totalRemaining: "0" },
      [`${prefix}/bank-balance`]: { totalBalance: null, accounts: [] },
      [`${prefix}/bank-balance-history`]: { points: [] },
      [`${osPrefix}/nastavitve`]: {
        kontoStroskaId: accounts[0].id, kontoStroskaCode: accounts[0].code,
        kontoPopravkaId: accounts[1].id, kontoPopravkaCode: accounts[1].code,
        osLeto: 2025, zadnjiObracunLeto: null, hasGlkModule: true,
        praviloZacetkaAmortizacije: "naslednji_dan",
      },
      [osPrefix]: {
        leto: Number(url.searchParams.get("leto")), doMeseca: null,
        predogled: true, zastarel: false, zastarelRazlog: null,
        skupajRacunovodska: "372.30", skupajDavcna: "372.30",
        steviloSredstev: 0, brezSkupine: 0, polnoOdpisanih: 0, aktivnih: 0,
        sredstva: [], poKontih: [], poStroskovnihMestih: [],
      },
      [`${osPrefix}/obracun`]: [],
      [`${osPrefix}/obracun/leta`]: [],
    };
    if (p === `${prefix}/entries`) {
      const params = Object.fromEntries(url.searchParams);
      const entries = [draft, posted, decoy].filter(e =>
        (!params.periodId || e.periodId === params.periodId) &&
        (!params.status || e.status === params.status));
      lists.push({ params, ids: entries.map(e => e.id), scenario: scenario?.name });
      return route.fulfill({ json: { entries } });
    }
    const target = [draft, posted].find(e => p === `${prefix}/entries/${e.id}`);
    if (target) {
      details.push({ id: target.id, scenario: scenario?.name });
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
  await page.waitForURL(/\/(company-select|dashboard)$/);
  if (new URL(page.url()).pathname === "/company-select") {
    await page.getByRole("button").filter({ hasText: company.naziv })
      .filter({ hasText: "Glavna knjiga" }).click();
  }
  await page.waitForURL("**/dashboard");
  const sessionId = await page.evaluate(() => window.Clerk.session.id);
  results.push("PASS: Real development Clerk sign-in, protected routes and company selection; no auth mocks or saved session.");

  stage = "restrict journal list using real controls";
  await page.getByRole("button", { name: "Temeljnice", exact: true }).click();
  async function choose(control, name) {
    await control.click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  await choose(page.getByRole("combobox").nth(0), periods[1].name);
  await choose(page.getByRole("combobox").nth(2), "Osnutek");
  await expect(page.getByRole("cell", { name: decoy.description, exact: true })).toBeVisible();
  await expect.poll(() => lists.some(l =>
    l.params.periodId === periods[1].id && l.params.status === "draft" &&
    l.ids.length === 1 && l.ids[0] === decoy.id)).toBe(true);

  for (scenario of scenarios) {
    stage = `${scenario.name}: prepare preview and receive HTTP 409`;
    // Open the other module's route without a full reload of the ticket session.
    // Real wouter/ProtectedRoute/CompanyProvider still handle this navigation;
    // the interaction under test below uses the actual conflict button.
    await page.evaluate(() => {
      history.pushState(null, "", "/amortizacijski-obracun");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForURL("**/amortizacijski-obracun");
    await page.getByRole("button", { name: "Knjižbo", exact: true }).click();
    const amortDialog = page.getByRole("dialog");
    await expect(amortDialog).toContainText("Vrsta obračuna");
    await expect(amortDialog).toContainText("Letni obračun — 2025");
    await amortDialog.getByRole("button", { name: "Pripravi predogled", exact: true }).click();
    await expect(amortDialog).toContainText(preview.referenca);
    const responsePromise = page.waitForResponse(response =>
      response.url() === `${origin}${osPrefix}/knjizenje` && response.status() === 409);
    await amortDialog.getByRole("button", { name: "Ustvari osnutek temeljnice", exact: true }).click();
    assert.equal((await responsePromise).status(), 409);
    const warning = amortDialog.getByRole("alert");
    await expect(warning).toContainText("Amortizacijska temeljnica za to obdobje že obstaja.");
    const links = warning.getByRole("button", { name: "Odpri obstoječo temeljnico", exact: true });
    await expect(links).toHaveCount(scenario.entries.length);
    for (let i = 0; i < scenario.entries.length; i++) {
      await expect(links.nth(i).locator("..")).toContainText(
        scenario.entries[i].status === "draft" ? "Osnutek" : "Potrjena");
    }

    stage = `${scenario.name}: open exact journal details outside list filters`;
    const beforeDetails = details.length;
    const selectedIndex = scenario.entries.indexOf(scenario.selected);
    await links.nth(selectedIndex).click();
    await page.waitForURL(`**/temeljnice?id=${scenario.selected.id}`);
    // Explicitly check the old Radix modal is gone, not just hidden by the sheet.
    await expect(page.getByRole("dialog", { name: /Predogled knjižbe/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Odpri obstoječo temeljnico" })).toHaveCount(0);
    const sheet = page.getByRole("dialog", { name: "Detajli temeljnice", exact: true });
    await expect(sheet).toBeVisible();
    const selected = scenario.selected;
    for (const text of [
      `ID: ${selected.id}`, selected.reference, selected.description, selected.periodName,
      selected.status === "draft" ? "Osnutek" : "Knjiženo",
      ...selected.lines.map(line => `${line.accountCode} — ${line.accountName}`),
      ...selected.lines.map(line => line.description),
    ]) await expect(sheet).toContainText(text);
    const rows = sheet.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(4); // header, debit, credit, totals
    await expect(rows.nth(1).getByRole("cell").nth(1)).toHaveText(selected.totalDebit);
    await expect(rows.nth(2).getByRole("cell").nth(2)).toHaveText(selected.totalCredit);
    await expect(rows.nth(3).getByRole("cell").nth(1)).toHaveText(selected.totalDebit);
    await expect(rows.nth(3).getByRole("cell").nth(2)).toHaveText(selected.totalCredit);
    await expect(sheet).not.toContainText(decoy.description);
    await expect(page.locator('[role="combobox"]').nth(0)).toHaveText(periods[1].name);
    await expect(page.locator('[role="combobox"]').nth(2)).toHaveText("Osnutek");
    await expect(page.getByRole("cell", { name: selected.description, exact: true })).toHaveCount(0);
    // First visits must fetch by ID; repeat links may legitimately use cached detail.
    if (scenario.name !== "mixed-second-link") {
      assert(details.slice(beforeDetails).some(d => d.id === selected.id && d.scenario === scenario.name));
    }
    assert(lists.some(l => l.params.periodId === periods[1].id && l.params.status === "draft" &&
      !l.ids.includes(selected.id)), "Target must really be absent from the filtered response");
    assert.equal(await page.evaluate(() => window.Clerk.session?.id), sessionId);
    await expect(page.locator("header")).toContainText(company.naziv);
    assert.deepEqual(requests.filter(r => r.scenario === scenario.name).map(r => r.status), [200, 409]);
    await page.screenshot({ path: path.join(out, `${scenario.name}.png`) });
    results.push(`PASS: ${scenario.name}: real HTTP 409, correct conflict status/link, amortization modal unmounted, exact ${selected.id} details and balanced lines despite persisted 2026/draft filters; same Clerk session.`);
    await sheet.getByRole("button", { name: "Zapri", exact: true }).click();
    await expect(sheet).toBeHidden();
  }
  assert.deepEqual(violations, [], "No unexpected endpoints or writes may reach the backend");
  assert.deepEqual(pageErrors, [], "No uncaught application errors");
  results.push("PASS: All business requests intercepted; only 3 synthetic previews and 3 synthetic conflict POSTs, no backend writes.");
  await writeFile(path.join(out, "results.txt"), `${results.join("\n")}\n`);
  console.log(results.join("\n"));
} catch (error) {
  // Do not log SDK errors, credentials, ticket/session values or traces.
  console.error(`Amortization navigation regression failed at: ${stage} (${error.name})`);
  console.error(error.stack?.split("\n").filter(line =>
    line.trimStart().startsWith("at ") && line.includes("amortization-existing-entry.browser.mjs")).join("\n"));
  if (violations.length) console.error(violations.join("\n"));
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
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
