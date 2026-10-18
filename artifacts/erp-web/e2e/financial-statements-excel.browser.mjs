/**
 * Real protected ERP page, development Clerk session and Chromium downloads.
 * Only business API data is synthetic; no application auth hooks are replaced.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import ExcelJS from "exceljs";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { clerkClient } = requireApi("@clerk/express");
assert(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"), "Only development Clerk may be used");
const origin = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80";
const out = fileURLToPath(new URL("../../../generated-artifacts/financial-statements-excel/", import.meta.url));
await mkdir(out, { recursive: true });
const company = {
  id: "financial-xlsx-browser", naziv: "Preizkus Čebelica d.o.o.",
  role: "owner", modules: ["erp"], podjetjeDavcna: "12345678",
  createdAt: "2026-01-01", employerControlledTipsEnabled: false,
};
const prefix = `/api/companies/${company.id}`;
const side = (balance) => ({
  sections: [{
    class: "0", label: "Preizkusni razdelek",
    items: [{ accountId: "a", accountCode: "0010000", accountName: "=Naziv čšž", balance }],
    subtotal: balance,
  }], total: balance,
});
const reports = {
  "balance-sheet": {
    current: { aktiva: side("1234.56"), pasiva: side("1234.56") },
    compare: { aktiva: side("1000"), pasiva: side("1000") },
  },
  "income-statement": {
    current: { revenue: side("1234.56"), expenses: side("1300"), netResult: "-65.44" },
    compare: { revenue: side("1000"), expenses: side("900"), netResult: "100" },
  },
};
const violations = [];
const requests = [];
const errors = [];
const results = [];
let user, browser, page, stage = "setup";
try {
  user = await clerkClient.users.createUser({
    emailAddress: [`financial-xlsx-${crypto.randomUUID()}+clerk_test@example.com`],
    skipPasswordRequirement: true, firstName: "Excel", lastName: "Test",
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.name));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.continue(); // real Clerk is untouched
    const p = url.pathname;
    const reject = async () => {
      violations.push(`${request.method()} ${p}`);
      await route.fulfill({ status: 500, json: { error: "Unexpected test request" } });
    };
    if (request.method() !== "GET") return reject();
    const responses = {
      "/api/me": { id: user.id, firstName: "Excel", lastName: "Test", isSuperAdmin: false },
      "/api/companies": { companies: [company] },
      "/api/admin/system": { erpOwnerCompanyId: company.id, company },
      [`${prefix}/periods`]: { periods: [] },
      [`${prefix}/open-items`]: { items: [], totalRemaining: "0" },
      [`${prefix}/aged-analysis`]: { buckets: [], totalRemaining: "0" },
      [`${prefix}/bank-balance`]: { totalBalance: null, accounts: [] },
      [`${prefix}/bank-balance-history`]: { points: [] },
    };
    const type = p.slice(`${prefix}/reports/`.length);
    if (p.startsWith(`${prefix}/reports/`) && Object.hasOwn(reports, type)) {
      // This generated endpoint scopes the company in its URL.
      if (!request.headers().authorization?.startsWith("Bearer ")) return reject();
      requests.push({ type, params: Object.fromEntries(url.searchParams) });
      return route.fulfill({ json: reports[type] });
    }
    if (!Object.hasOwn(responses, p)) return reject();
    return route.fulfill({ json: responses[p] });
  });

  stage = "anonymous route denied";
  await page.goto(`${origin}/porocila`);
  await page.waitForFunction(() => window.Clerk?.loaded);
  await expect(page.getByRole("button", { name: "Prikaži poročilo", exact: true })).toHaveCount(0);
  stage = "development ticket sign-in";
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
  await page.evaluate(async token => {
    const attempt = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: token });
    if (attempt.status !== "complete") throw new Error("Development sign-in incomplete");
    await window.Clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.waitForURL(/\/(company-select|dashboard)$/);
  // A single ERP company can be selected automatically by the real provider.
  if (new URL(page.url()).pathname === "/company-select") {
    const choice = page.getByRole("button").filter({ hasText: company.naziv });
    await Promise.race([
      page.waitForURL("**/dashboard"),
      choice.click().catch(async () => page.waitForURL("**/dashboard")),
    ]);
  }
  await page.waitForURL("**/dashboard");
  const sessionId = await page.evaluate(() => window.Clerk.session.id);

  for (const width of [1440, 390]) {
    stage = `${width}: open report`;
    // Use the real SPA link before shrinking, when the mobile sidebar is closed.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Poročila", exact: true }).click();
    await page.waitForURL("**/porocila");
    await page.setViewportSize({ width, height: 1000 });
    for (const type of ["balance-sheet", "income-statement"]) {
      const balance = type === "balance-sheet";
      const title = balance ? "Bilanca stanja" : "Izkaz poslovnega izida";
      stage = `${width} ${type}`;
      await page.getByRole("tab", { name: title, exact: true }).click();
      const panel = page.getByRole("tabpanel");
      stage = `${width} ${type}: filters`;
      await panel.getByRole("checkbox").check();
      const dates = panel.locator('input[type="date"]');
      const values = balance
        ? ["2026-06-30", "2025-12-31"]
        : ["2026-01-01", "2026-06-30", "2025-01-01", "2025-06-30"];
      for (const [i, value] of values.entries()) await dates.nth(i).fill(value);
      await panel.getByRole("button", { name: "Prikaži poročilo", exact: true }).click();
      const button = panel.getByRole("button", { name: "Izvozi XLSX", exact: true });
      stage = `${width} ${type}: report response`;
      await expect(button).toBeEnabled();
      // The second viewport may reuse the real React Query cache.
      const appliedRequestCount = requests.length;
      assert.deepEqual(requests.findLast(request => request.type === type), { type, params: balance
        ? { asOf: values[0], compareAsOf: values[1] }
        : { dateFrom: values[0], dateTo: values[1], compareDateFrom: values[2], compareDateTo: values[3] } });
      // Change ALL draft fields, including comparison enablement, without applying.
      for (let i = 0; i < values.length; i++) await dates.nth(i).fill("2024-02-02");
      await panel.getByRole("checkbox").uncheck();
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, "Export must fit the viewport");
      await button.focus();
      await expect(button).toBeFocused();
      stage = `${width} ${type}: injected failure`;

      // Fail the actual browser Blob URL allocation once; do not replace the
      // exporter, anchor click or download event with a fake.
      await page.evaluate(() => {
        const original = URL.createObjectURL;
        URL.createObjectURL = function (...args) {
          URL.createObjectURL = original;
          throw new Error("Preizkusna napaka prenosa");
        };
      });
      const failedDownloads = [];
      const onDownload = download => failedDownloads.push(download.suggestedFilename());
      page.on("download", onDownload);
      const dialogPromise = page.waitForEvent("dialog");
      await page.keyboard.press("Enter");
      const dialog = await dialogPromise;
      assert.equal(dialog.message(), "Napaka pri izvozu XLSX: Preizkusna napaka prenosa");
      await dialog.accept();
      await expect(button).toBeEnabled();
      assert.deepEqual(failedDownloads, [], "Failed export must not produce a partial file");
      page.off("download", onDownload);

      await button.focus();
      stage = `${width} ${type}: actual download`;
      const downloadPromise = page.waitForEvent("download");
      await page.keyboard.press("Enter");
      const download = await downloadPromise;
      const filename = balance ? "bilanca-stanja-2026-06-30.xlsx"
        : "izkaz-poslovnega-izida-2026-01-01-2026-06-30.xlsx";
      assert.equal(download.suggestedFilename(), filename);
      const saved = path.join(out, `${width}-${filename}`);
      await download.saveAs(saved);
      assert.equal(await download.failure(), null);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(saved);
      assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [title]);
      const sheet = workbook.worksheets[0];
      assert.equal(sheet.getCell("A1").value, company.naziv);
      assert.equal(sheet.getCell("B3").value, balance ? "30.06.2026" : "01.01.2026 – 30.06.2026");
      assert.equal(sheet.getCell("B4").value, balance ? "31.12.2025" : "01.01.2025 – 30.06.2025");
      const findRow = label => {
        const row = sheet.getRows(1, sheet.rowCount).find(row => row.getCell(2).value === label);
        assert(row, `Missing workbook row: ${label}`);
        return row;
      };
      assert.equal(findRow("=Naziv čšž").getCell(1).value, "0010000");
      const total = findRow(balance ? "SKUPAJ PASIVA" : "POSLOVNI IZID OBDOBJA");
      assert.equal(total.getCell(3).value, balance ? 1234.56 : -65.44);
      assert.equal(total.getCell(4).value, balance ? 1000 : 100);
      assert.equal(total.getCell(3).numFmt, "#,##0.00");
      assert.equal(requests.length, appliedRequestCount, "Draft edits and exports must not requery");
      assert.equal(await page.evaluate(() => window.Clerk.session?.id), sessionId);
      await expect(button).toBeEnabled();
      await page.screenshot({ path: path.join(out, `${width}-${type}.png`) });
      results.push(`PASS ${width}px ${title}: real XLSX, company/period/comparison, draft isolation, keyboard access, failure and retry`);
    }
  }
  assert.deepEqual(violations, [], "No financial writes or unexpected business requests");
  assert.deepEqual(errors, [], "No uncaught application errors");
  await writeFile(path.join(out, "results.txt"), `${results.join("\n")}\n`);
  console.log(results.join("\n"));
} catch (error) {
  // Do not log SDK errors, headers, tickets, sessions or authentication traces.
  console.error(`Financial XLSX regression failed at: ${stage} (${error.name})`);
  if (error.code === "ERR_ASSERTION") console.error(error.message);
  if (violations.length) console.error(violations.join("\n"));
  if (page) {
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    await writeFile(path.join(out, "failure-page.txt"), await page.locator("body").innerText().catch(() => ""));
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
