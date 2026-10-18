/**
 * node artifacts/erp-web/e2e/dimension-report-excel.browser.mjs
 * Isolated Vite test server mounts the REAL report page. Only business hooks and
 * CompanyContext are fixtures; no auth bypass is added to the application.
 * Real module worker, ExcelJS, DOM clicks and Chromium download are exercised.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = path.join(root, "artifacts/erp-web");
const require = createRequire(path.join(app, "package.json"));
const { createServer } = await import(require.resolve("vite"));
const { default: react } = await import(require.resolve("@vitejs/plugin-react"));
const { default: tailwindcss } = await import(require.resolve("@tailwindcss/vite"));
const { default: ExcelJS } = await import(require.resolve("exceljs"));
const packages = await readdir(path.join(root, "node_modules/.pnpm"));
const puppeteerPackage = packages.find(name => name.startsWith("puppeteer-core@"));
assert(puppeteerPackage, "puppeteer-core development tooling is required");
const { default: puppeteer } = await import(path.join(root, "node_modules/.pnpm",
  puppeteerPackage, "node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"));
const out = path.join(root, "generated-artifacts/dimension-report-excel");
await mkdir(out, { recursive: true });
const fixtureId = "\0dimension-excel-fixture";
let browser;
const server = await createServer({
  configFile: false, root: app, logLevel: "warn",
  resolve: { alias: { "@": path.join(app, "src") }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [root] } },
  plugins: [
    {
      name: "dimension-excel-test-fixtures", enforce: "pre",
      resolveId(source, importer) {
        if (importer?.endsWith("/src/pages/porocila-dimenzije.tsx") &&
          (source === "@workspace/api-client-react" || source.endsWith("/contexts/CompanyContext") ||
            source === "@/contexts/CompanyContext")) return fixtureId;
      },
      load(id) {
        if (id === fixtureId) return `
          import { largeDimensionReport } from "/e2e/dimension-report-fixture.ts";
          const count = Number(new URLSearchParams(location.search).get("rows") || 20000);
          const report = largeDimensionReport(count);
          if (!location.search.includes("textHeavy")) report.rows.forEach(r => r.name = r.name.slice(0, 150));
          Object.assign(report, { untaggedDebit:"0", untaggedCredit:"0", untaggedBalance:"0", untaggedLines:[] });
          export const useGetDimensionReport = () => ({data:report, isLoading:false, error:null});
          export const useListAccounts = () => ({data:{accounts:[]}});
          export const useCompany = () => ({activeCompany:{id:"fixture", naziv:report.companyName}});
          export const useSharedCompanyAccess = () => ({
            company:{id:"fixture", naziv:report.companyName, role:"owner"}, checking:false, failed:false,
          });
        `;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/__excel-test")) return next();
          const html = await vite.transformIndexHtml(req.url, `<!doctype html><html lang="sl"><body>
            <div id="root"></div><script type="module">
            import "/src/index.css";
            import React from "react"; import {createRoot} from "react-dom/client";
            import Page from "/src/pages/porocila-dimenzije.tsx";
            createRoot(document.getElementById("root")).render(React.createElement(Page));
            </script></body></html>`);
          res.setHeader("Content-Type", "text/html"); res.end(html);
        });
      },
    },
    react(),
    tailwindcss({ optimize: false }),
  ],
});
const results = [];
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out, eventsEnabled: true });
  const downloads = [];
  cdp.on("Browser.downloadWillBegin", event => downloads.push(event.suggestedFilename));
  const completed = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Download did not complete")), 90_000);
    const listener = event => {
      if (event.state === "completed" || event.state === "canceled") {
        clearTimeout(timer); cdp.off("Browser.downloadProgress", listener);
        event.state === "completed" ? resolve() : reject(new Error("Download canceled"));
      }
    };
    cdp.on("Browser.downloadProgress", listener);
  });
  async function open(query = "") {
    await page.goto(`${origin}/__excel-test?dimensionType=costCenter&dateFrom=2026-01-01&dateTo=2026-12-31${query}`);
    await page.waitForSelector('button[title="Izvozi v Excel"]');
  }
  async function start() {
    await page.evaluate(() => {
      window.print = () => { window.printAt = performance.now(); };
      window.ticks = [];
      window.tickTimer = setInterval(() => window.ticks.push(performance.now()), 20);
      window.exportStarted = performance.now();
    });
    await page.click('button[title="Izvozi v Excel"]');
  }
  await open();
  const finished = completed();
  await start();
  await page.waitForFunction(() => document.body.textContent.includes("Izvažam"));
  const clickStart = performance.now();
  await page.click('button[title="Natisni"]');
  const interactionMs = performance.now() - clickStart;
  assert(await page.evaluate(() => !!window.printAt), "Print control must respond during export");
  await finished;
  await page.waitForFunction(() => !document.body.textContent.includes("Izvažam"));
  const timing = await page.evaluate(() => {
    clearInterval(window.tickTimer);
    const times = [window.exportStarted, ...window.ticks, performance.now()];
    return { durationMs: performance.now() - window.exportStarted,
      maxHeartbeatGapMs: Math.max(...times.slice(1).map((t, i) => t - times[i])), ticks: window.ticks.length };
  });
  assert(timing.ticks > 10, "Main thread heartbeat must run while exporting");
  assert(timing.maxHeartbeatGapMs < 1000, `Main thread stalled: ${timing.maxHeartbeatGapMs}ms`);
  assert(interactionMs < 1000, `Toolbar interaction too slow: ${interactionMs}ms`);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0], "porocilo_dimenzije_Stroškovna_mesta_2026-01-01_2026-12-31.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(path.join(out, downloads[0])));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 20_008);
  for (let index = 0; index < 20_000; index++) {
    assert.equal(sheet.getCell(index + 8, 1).value, `${index}`.padStart(6, "0"));
    assert.equal(sheet.getCell(index + 8, 2).value,
      `${index}: Čebelarstvo, vzdrževanje in računovodstvo – Škofja Loka, Žužemberk; dolg slovenski naziv. `.repeat(5).slice(0, 150));
  }
  assert.equal(sheet.getCell("A20008").value, "SKUPAJ");
  assert.deepEqual([3, 4, 5].map(c => sheet.getCell(20008, c).value), [24691200, 40002000, -15310800]);
  results.push({ case: "20000 rows, 150-character Slovenian names", ...timing, interactionMs, rows: sheet.rowCount });
  await page.screenshot({ path: path.join(out, "report.png") });

  for (const [query, message] of [
    ["&rows=20001", "preveliko"],
    ["&rows=10000&textHeavy=1", "preveliko"],
  ]) {
    await open(query);
    await start();
    await page.waitForFunction(text => document.body.textContent.includes(text), {}, message);
    assert.equal(downloads.length, 1, "Oversize export must not download any partial file");
    assert.equal(await page.$eval('button[title="Izvozi v Excel"]', b => b.disabled), false);
    results.push({ case: query, rejectedWithoutDownload: true });
  }
  // Simulate an allocation/worker crash, without allocating enough RAM to crash Chromium.
  await open("&rows=50");
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.postMessage = () => setTimeout(() => this.onerror?.(new Event("error")), 100);
      }
    };
  });
  await start();
  await page.waitForFunction(() => document.body.textContent.includes("Izvoz v Excel ni uspel."));
  assert.equal(downloads.length, 1);
  assert.equal(await page.$eval('button[title="Izvozi v Excel"]', b => b.disabled), false);
  await page.evaluate(() => { window.Worker = Object.getPrototypeOf(window.Worker); });
  const retry = completed();
  await page.click('button[title="Izvozi v Excel"]');
  await retry;
  assert.equal(downloads.length, 2, "Retry after worker failure must succeed");
  assert.deepEqual(errors, []);
  results.push({ case: "worker allocation failure", noPartialDownload: true, retrySucceeded: true });
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
