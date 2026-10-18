/**
 * Live Clerk session regression (no mocked Clerk hooks or auth route).
 * Run from the workspace root:
 *   node artifacts/erp-web/e2e/bank-import-session.browser.mjs
 *
 * Uses disposable DEVELOPMENT Clerk users and real sign-in tickets/sign-out.
 * Business API responses alone are fixtures: no financial records are written.
 * Requires the ERP preview, its existing Clerk credentials, and puppeteer-core
 * plus Chromium in the development tooling. Tokens are never logged or saved.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { clerkClient } = requireApi("@clerk/express");
const packages = await readdir(path.join(root, "node_modules/.pnpm"));
const puppeteerPackage = packages.find(name => name.startsWith("puppeteer-core@"));
assert(puppeteerPackage, "Development tooling must include puppeteer-core");
const { default: puppeteer } = await import(path.join(root, "node_modules/.pnpm",
  puppeteerPackage, "node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
assert(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"), "Only development Clerk may be used");
const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80";
const out = path.join(root, "generated-artifacts/bank-import-session");
await mkdir(out, { recursive: true });

const companies = ["a", "b"].map((suffix, i) => ({
  id: `session-test-${suffix}`, naziv: `Session Test ${suffix.toUpperCase()}`,
  podjetjeDavcna: `${12345678 + i}`, role: "owner", modules: ["erp"],
  createdAt: "2026-10-01", employerControlledTipsEnabled: false,
}));
const accounts = [
  { id: "bank", code: "1100000", name: "Banka" },
  { id: "ar", code: "1200000", name: "Terjatve" },
  { id: "ap", code: "2200000", name: "Obveznosti" },
  { id: "custom", code: "4150000", name: "Provizije" },
].map(a => ({ ...a, isActive: true, allowsPosting: true }));
const transactions = [1, 2].map(i => ({
  id: `tx-${i}`, date: "2026-10-01", amount: i === 1 ? 25 : -5,
  reference: `REF-${i}`, counterpartyName: "Partner", counterpartyIban: null,
  description: `Vrstica ${i}`, currency: "EUR",
}));
const users = [];
const report = [];
let browser;
let currentUserId;
let writes = 0;
let parses = 0;
let matches = 0;

try {
  for (let i = 0; i < 2; i++) {
    users.push(await clerkClient.users.createUser({
      emailAddress: [`bank-session-${crypto.randomUUID()}+clerk_test@example.com`],
      skipPasswordRequirement: true, firstName: "Session", lastName: "Test",
    }));
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.setDefaultTimeout(30000);
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return request.continue();
    const p = url.pathname;
    let data = {};
    if (p === "/api/me") data = { id: currentUserId, firstName: "Session", lastName: "Test", isSuperAdmin: false };
    else if (p === "/api/companies") data = { companies };
    else if (p.endsWith("/accounts")) data = { accounts };
    else if (p.endsWith("/periods")) data = { periods: [{ id: "period", name: "2026", status: "open" }] };
    else if (p.endsWith("/counterparties")) data = { counterparties: [{ id: "partner", name: "Partner" }] };
    else if (p.endsWith("/payments")) {
      if (request.method() !== "GET") writes++;
      data = { payments: [] };
    } else if (p.endsWith("/register")) writes++;
    else if (p.endsWith("/invoices")) data = { invoices: [{ id: "invoice", arApAccountId: "ar" }] };
    else if (p.endsWith("/import-config")) data = { bankAccountId: "bank", arAccountId: "ar", apAccountId: "ap" };
    else if (p.endsWith("/bank-statements")) data = { statements: [] };
    else if (p.endsWith("/parse")) {
      parses++;
      data = { transactions, count: 2, skippedRows: [], sourceFilename: "session.csv", sourceSha256: "test",
        metadata: { statementDate: "2026-10-01", statementNumber: "1", currency: "EUR" } };
    } else if (p.endsWith("/match")) {
      matches++;
      const body = [
        ...transactions.map((transaction, i) => ({
          type: "suggestion", current: i + 1, total: 2,
          suggestion: { transaction, suggestions: i === 0 ? [{
            invoiceId: "invoice", invoiceNumber: "INV-1", counterpartyId: "partner",
            counterpartyName: "Partner", remainingAmount: "25.00", confidence: 1, matchReasons: [],
          }] : [] },
        })),
        { type: "complete", total: 2 },
      ].map(e => JSON.stringify(e)).join("\n");
      return request.respond({ status: 200, contentType: "application/x-ndjson", body });
    }
    return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });

  const waitText = text => page.waitForFunction(t => document.body.innerText.includes(t), {}, text);
  async function clickText(text, selector = "button, a, [role=menuitem]") {
    await page.waitForFunction((t, s) => [...document.querySelectorAll(s)].some(el => el.textContent.trim() === t), {}, text, selector);
    await page.evaluate((t, s) => [...document.querySelectorAll(s)].find(el => el.textContent.trim() === t).click(), text, selector);
  }
  async function navigate(route) {
    const link = await page.$(`a[href="${route}"]`);
    if (link) {
      await link.click();
      return;
    }
    await page.evaluate(route => {
      history.pushState(null, "", route);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
  }
  async function signIn(user) {
    console.log("Signing in through live Clerk");
    currentUserId = user.id;
    await page.waitForFunction(() => window.Clerk?.loaded);
    const ticket = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
    await page.evaluate(async token => {
      const attempt = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: token });
      if (attempt.status !== "complete") throw new Error("Clerk sign-in did not complete");
      await window.Clerk.setActive({ session: attempt.createdSessionId });
    }, ticket.token);
    await page.waitForFunction(id => window.Clerk.user?.id === id, {}, user.id);
    await page.waitForFunction(() => location.pathname === "/company-select");
    await waitText("Session Test A");
  }
  async function signOut() {
    console.log("Signing out through the application menu");
    // Use the application's actual menu, not a mocked hook or local state.
    await page.click("header button:has(.rounded-full)");
    await clickText("Odjava", "[role=menuitem]");
    await page.waitForFunction(() => window.Clerk?.loaded && !window.Clerk.user);
    await page.waitForFunction(() => !document.body.innerText.includes("INV-1"));
  }
  async function chooseCompany(index) {
    console.log(`Choosing fixture company ${index + 1}`);
    await navigate("/company-select");
    await page.waitForFunction(name => [...document.querySelectorAll("button")].some(el => el.textContent.includes(name)), {}, companies[index].naziv);
    await page.evaluate(name => [...document.querySelectorAll("button")].find(el => el.textContent.includes(name)).click(), companies[index].naziv);
    console.log("Company selection clicked");
    await page.waitForFunction(id => {
      const key = `erp_active_company_${window.Clerk.user.id}`;
      return JSON.parse(localStorage.getItem(key) ?? "null")?.id === id;
    }, {}, companies[index].id);
    console.log("Company selection persisted");
    await waitText("Nadzorna plošča");
    console.log("Dashboard rendered");
    await navigate("/bancni-izpis");
  }
  async function select(index, optionText) {
    const controls = await page.$$('[role="combobox"]');
    await controls[index].click();
    await page.waitForFunction(text => [...document.querySelectorAll('[role="option"]')].some(el => el.textContent.includes(text)), {}, optionText);
    const options = await page.$$('[role="option"]');
    for (const option of options) {
      if ((await option.evaluate(el => el.textContent)).includes(optionText)) {
        await option.click();
        break;
      }
    }
    await page.waitForFunction(() => !document.querySelector('[role="option"]'));
  }
  async function assertReview() {
    await waitText("INV-1");
    await waitText("Potrdi 2 transakcij");
    await page.waitForFunction(() => {
      const controls = [...document.querySelectorAll('[role="combobox"]')];
      return controls[0]?.textContent.includes("4150000") && controls[1]?.textContent.includes("Partner");
    });
    assert(await page.evaluate(() => document.querySelector("header").innerText.includes("Session Test A")));
    const rowControls = await page.$$eval('[role="combobox"]', els => els.map(el => el.textContent));
    assert(rowControls[0].includes("4150000"));
    assert(rowControls[1].includes("Partner"));
  }
  async function assertUpload() {
    await waitText("Nadaljuj");
    assert(!await page.evaluate(() => document.body.innerText.includes("INV-1")));
    assert(!await page.evaluate(() => document.body.innerText.includes("REF-2")));
  }

  await page.goto(origin);
  await signIn(users[0]);
  await chooseCompany(0);
  console.log("Opening protected import and entering review");
  await waitText("Nadaljuj");
  await page.waitForFunction(() => document.querySelectorAll('[role="combobox"]')[1]?.textContent.includes("1100000"));
  await select(0, "2026");
  await select(3, "4150000");
  const csvPath = path.join(out, "session.csv");
  await writeFile(csvPath, "date,amount\n2026-10-01,25\n2026-10-01,-5\n");
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile(csvPath);
  await clickText("Nadaljuj");
  await waitText("INV-1");
  await page.evaluate(() => [...document.querySelectorAll("button")].filter(el => el.textContent.includes("Brez računa"))[1].click());
  await select(1, "Partner");
  await assertReview();
  console.log("Initial review is ready");
  const firstSession = await page.evaluate(() => window.Clerk.session.id);
  report.push("PASS: Real Clerk sign-in, protected bank route, upload and changed standalone decision.");

  await signOut();
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.Clerk?.loaded && !window.Clerk.user);
  await navigate("/bancni-izpis");
  await page.waitForFunction(() => location.pathname === "/");
  report.push("PASS: Real application logout, signed-out reload, protected route denies anonymous access.");

  await signIn(users[0]);
  assert.notEqual(await page.evaluate(() => window.Clerk.session.id), firstSession);
  // Do not choose a company: CompanyProvider must restore it itself.
  await navigate("/bancni-izpis");
  await assertReview();
  await page.screenshot({ path: path.join(out, "restored-review.png") });
  await clickText("Nazaj na uvoz");
  const controlTexts = await page.$$eval('[role="combobox"]', els => els.map(el => el.textContent));
  ["2026", "1100000", "1200000", "4150000"].forEach((text, index) => assert(controlTexts[index].includes(text)));
  assert.equal(parses, 1);
  assert.equal(matches, 1);
  report.push("PASS: Same user/new Clerk session restores company A, review, accepted invoice, changed partner/account and all configured accounts/period; no reparse.");

  await signOut();
  await signIn(users[1]);
  assert.equal(await page.evaluate(() => localStorage.getItem(`erp_active_company_${window.Clerk.user.id}`)), null);
  await chooseCompany(0);
  await assertUpload();
  report.push("PASS: Another real Clerk user cannot inherit the first user's company selection or review.");

  await signOut();
  await signIn(users[0]);
  await navigate("/bancni-izpis");
  await assertReview();
  await chooseCompany(1);
  await assertUpload();
  await signOut();
  await page.reload({ waitUntil: "networkidle2" });
  await signIn(users[0]);
  await navigate("/bancni-izpis");
  await assertUpload();
  assert(await page.evaluate(() => document.querySelector("header").innerText.includes("Session Test B")));
  await chooseCompany(0);
  await assertReview();
  assert.equal(writes, 0);
  report.push("PASS: Company B restores independently after real logout/login, cannot inherit A's review; switching back preserves A. No financial writes.");
  await writeFile(path.join(out, "results.txt"), `${report.join("\n")}\n`);
  console.log(report.join("\n"));
} catch (error) {
  // Do not print Clerk error objects: they can contain request/ticket details.
  console.error(`Browser regression failed: ${error instanceof assert.AssertionError ? error.message : error.name}`);
  console.error(error.stack?.split("\n").filter(line => line.includes("bank-import-session.browser.mjs")).join("\n"));
  if (browser) {
    const pages = await browser.pages();
    const page = pages.at(-1);
    await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    const body = await page?.evaluate(() => document.body.innerText).catch(() => "");
    await writeFile(path.join(out, "failure-page.txt"), body ?? "");
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const user of users) {
    await clerkClient.users.deleteUser(user.id).catch(() => { process.exitCode = 1; });
  }
}
