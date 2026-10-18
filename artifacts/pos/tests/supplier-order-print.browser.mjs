import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(testsDir, "..");
const longOrderNumber = "N-2026-0948-IZREDNO-DOLGA-ŠTEVILKA-NAROČILA-Z-LOKACIJO-RESTAVRACIJA-TRG-REPUBLIKE-001234567890";
const longSupplierName = "Preizkusni dobavitelj za gostinske obrate – lokalna in sezonska živila, pijače ter oskrba več poslovnih enot z ločenimi dostavami za osrednjo kuhinjo";
const lineCount = 60;
const continuationSupplierName = longSupplierName.length > 42
  ? `${longSupplierName.slice(0, 41).trimEnd()}…`
  : longSupplierName;
const tallRowNumber = 44;
const tallArticleDetails = Array.from({ length: 8 }, (_, index) =>
  `TALL-ARTICLE-DETAIL-${String(index + 1).padStart(3, "0")} Complete specification and handling notes for this exceptionally large printed supplier-order item.`,
).join(" ");
const tallSupplierDetails = Array.from({ length: 6 }, (_, index) =>
  `TALL-SUPPLIER-DETAIL-${String(index + 1).padStart(3, "0")} Supplier reference, packaging, origin, and delivery information for this exceptionally large ordered item.`,
).join(" ");
const tallSupplierCode = `TALL-SUPPLIER-CODE-START-${"R7Q".repeat(36)}-TALL-SUPPLIER-CODE-END`;
const oversizedArticleDetails = Array.from({ length: 120 }, (_, index) =>
  `OVERSIZED-ARTICLE-DETAIL-${String(index + 1).padStart(3, "0")} Complete product specification, storage requirements, handling instructions, quality certification, and delivery preparation information.`,
).join(" ");
const oversizedSupplierDetails = Array.from({ length: 80 }, (_, index) =>
  `OVERSIZED-SUPPLIER-DETAIL-${String(index + 1).padStart(3, "0")} Supplier item reference, package description, origin, quality assurance, delivery instructions, and product traceability details.`,
).join(" ");
const oversizedSupplierCode =
  `OVERSIZED-SUPPLIER-CODE-START-${"R7Q".repeat(300)}-OVERSIZED-SUPPLIER-CODE-END`;
const originalEnv = {
  PORT: process.env.PORT,
  BASE_PATH: process.env.BASE_PATH,
  NODE_ENV: process.env.NODE_ENV,
  REPL_ID: process.env.REPL_ID,
};

async function getAvailablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

function normalizeText(value) {
  return value
    .normalize("NFC")
    .replace(/[\uFB00-\uFB06]/g, ligature => ({
      "\uFB00": "ff",
      "\uFB01": "fi",
      "\uFB02": "fl",
      "\uFB03": "ffi",
      "\uFB04": "ffl",
      "\uFB05": "st",
      "\uFB06": "st",
    })[ligature])
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s/g, "");
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function connectDevTools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pendingCommands = new Map();
  const eventListeners = new Map();
  let nextCommandId = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools.")), { once: true });
  });

  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") {
      const pending = pendingCommands.get(message.id);
      if (!pending) return;
      pendingCommands.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    for (const listener of eventListeners.get(message.method) ?? []) {
      listener(message.params);
    }
  });
  socket.addEventListener("close", () => {
    for (const pending of pendingCommands.values()) {
      pending.reject(new Error("Chromium DevTools connection closed."));
    }
    pendingCommands.clear();
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++nextCommandId;
      return new Promise((resolve, reject) => {
        pendingCommands.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(method, listener) {
      const listeners = eventListeners.get(method) ?? new Set();
      listeners.add(listener);
      eventListeners.set(method, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) eventListeners.delete(method);
      };
    },
    close() {
      socket.close();
    },
  };
}

async function findPageTarget(browserProcess, profileDir, browserLogs) {
  const activePortPath = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chromium exited before DevTools was ready:\n${browserLogs.join("")}`);
    }

    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).split("\n");
      const port = Number(portLine);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // Chromium creates the DevTools endpoint asynchronously after startup.
    }

    await delay(100);
  }

  throw new Error(`Chromium DevTools did not start in time:\n${browserLogs.join("")}`);
}

function decimalToken(value) {
  return new Intl.NumberFormat("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function readAttributes(raw) {
  return Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]+)"/g)].map((match) => [match[1], match[2]]));
}

function readWords(markup) {
  return [...markup.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match => ({
    ...readAttributes(match[1]),
    text: match[2]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'"),
  }));
}

function readBlocks(markup) {
  return [...markup.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)].map(match => {
    const words = readWords(match[2]);
    return {
      ...readAttributes(match[1]),
      words,
      text: words.map(word => word.text).join(" "),
    };
  });
}

function assertShortOrderPages(pages, expectedStartIndex) {
  const orderCases = [
    {
      number: "ONE-ROW-ORDER-CASE",
      supplier: "Enovrstični preizkusni dobavitelj",
      item: "ONE-ROW-SUPPLIER-ITEM",
      code: "SUPPLIER-CODE",
      article: "ONE-ROW-ARTICLE",
      quantity: "2",
      unitPrice: decimalToken(3.5),
      amount: decimalToken(7),
      instruction: "ONE-ROW-SUPPLIER-INSTRUCTION",
    },
    {
      number: "EMPTY-ORDER-CASE",
      supplier: "Dobavitelj praznega osnutka",
      totalPlaceholder: "—",
    },
    {
      number: "NO-INSTRUCTIONS-ORDER-CASE",
      supplier: "Dobavitelj brez navodil",
      item: "NO-INSTRUCTIONS-SUPPLIER-ITEM",
      code: "INSTRUCTIONS-SUPPLIER-CODE",
      article: "NO-INSTRUCTIONS-ARTICLE",
      quantity: "3",
      unitPrice: decimalToken(1.2),
      amount: decimalToken(3.6),
    },
  ];
  const orderMarkers = orderCases.map(orderCase => orderCase.number);

  for (const [caseIndex, orderCase] of orderCases.entries()) {
    const page = pages[expectedStartIndex + caseIndex];
    assert(page, `${orderCase.number} is missing from the PDF.`);
    assert(page.includes(orderCase.number), `${orderCase.number} is not on its expected page.`);
    assert(
      orderMarkers.filter(marker => page.includes(marker)).length === 1,
      `${orderCase.number} shares a page with another short supplier order.`,
    );
    assert(page.includes(orderCase.supplier), `${orderCase.number} supplier is missing.`);
    if (orderCase.item) assert(page.includes(orderCase.item), `${orderCase.number} supplier item details are missing.`);
    if (orderCase.code) assert(page.includes(orderCase.code), `${orderCase.number} supplier code is missing.`);
    if (orderCase.instruction) assert(page.includes(orderCase.instruction), `${orderCase.number} supplier instructions are missing.`);

    if (orderCase.article) {
      const articleLine = page.split("\n").map(normalizeText)
        .find(line => line.includes(orderCase.article));
      assert(articleLine, `${orderCase.number} article is missing.`);
      assert(
        new RegExp(`(?:^|\\s)${orderCase.quantity}(?:\\s|$)`).test(articleLine),
        `${orderCase.number} article quantity is missing.`,
      );
      assert(articleLine.includes(orderCase.unitPrice), `${orderCase.number} article unit price is missing.`);
      assert(articleLine.includes(orderCase.amount), `${orderCase.number} article amount is missing.`);
    }

    const totalLine = page.split("\n").map(normalizeText).find(line => line.includes("Skupaj"));
    assert(totalLine?.includes(orderCase.totalPlaceholder ?? orderCase.amount), `${orderCase.number} total is missing or incomplete.`);
    assert(
      !page.includes("Navodilo dobavitelju") || Boolean(orderCase.instruction),
      `${orderCase.number} printed an empty supplier-instructions section.`,
    );
  }
}

function stopProcessGroup(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();

  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  return Promise.race([exited, delay(5_000)]).then(() => {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  });
}

async function sendWebDriverCommand(baseUrl, route, { method = "POST", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(`WebDriver ${route} failed (${response.status}): ${JSON.stringify(result)}`);
  }
  return result.value;
}

async function waitForWebDriver(baseUrl, child, logs) {
  const deadline = Date.now() + 20_000;
  let spawnError;
  child.once("error", error => { spawnError = error; });

  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      throw new Error(`Firefox WebDriver exited before startup:\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The driver starts asynchronously and may not accept requests immediately.
    }
    await delay(100);
  }

  throw new Error(`Firefox WebDriver did not start in time:\n${logs.join("")}`);
}

async function printWithFirefox(url, tempDir) {
  const driverBinary = process.env.GECKODRIVER_BIN ?? "geckodriver";
  const driverPort = await getAvailablePort();
  const driverUrl = `http://127.0.0.1:${driverPort}`;
  const profileRoot = path.join(tempDir, "firefox-profile");
  await mkdir(profileRoot, { recursive: true });
  const driverLogs = [];
  const driverProcess = spawn(driverBinary, [
    "--host", "127.0.0.1",
    "--port", String(driverPort),
    "--profile-root", profileRoot,
    "--log", "error",
  ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  driverProcess.stdout.setEncoding("utf8");
  driverProcess.stderr.setEncoding("utf8");
  driverProcess.stdout.on("data", chunk => driverLogs.push(chunk));
  driverProcess.stderr.on("data", chunk => driverLogs.push(chunk));

  let sessionId;
  try {
    await waitForWebDriver(driverUrl, driverProcess, driverLogs);
    const firefoxOptions = { args: ["-headless"] };
    if (process.env.FIREFOX_BIN) firefoxOptions.binary = process.env.FIREFOX_BIN;
    const session = await sendWebDriverCommand(driverUrl, "/session", {
      body: {
        capabilities: {
          alwaysMatch: {
            browserName: "firefox",
            "moz:firefoxOptions": firefoxOptions,
          },
        },
      },
    });
    sessionId = session.sessionId;
    assert(sessionId, `Firefox WebDriver did not create a session: ${JSON.stringify(session)}`);
    const sessionUrl = `/session/${sessionId}`;
    await sendWebDriverCommand(driverUrl, `${sessionUrl}/timeouts`, {
      body: { implicit: 0, pageLoad: 30_000, script: 30_000 },
    });
    await sendWebDriverCommand(driverUrl, `${sessionUrl}/url`, { body: { url } });

    const renderDeadline = Date.now() + 30_000;
    let rendered = false;
    while (Date.now() < renderDeadline) {
      const result = await sendWebDriverCommand(driverUrl, `${sessionUrl}/execute/sync`, {
        body: {
          script: `return Boolean(document.body.textContent?.includes("ONE-ROW-ORDER-CASE"))`,
          args: [],
        },
      });
      if (result === true) {
        rendered = true;
        break;
      }
      await delay(100);
    }
    assert(rendered, "Firefox did not render the supplier order print fixture.");

    const pdfBase64 = await sendWebDriverCommand(driverUrl, `${sessionUrl}/print`, {
      body: {
        orientation: "portrait",
        scale: 1,
        background: true,
        shrinkToFit: false,
        page: {
          // WebDriver print dimensions are in centimeters.
          width: 21,
          height: 29.7,
          margin: {
            top: 1.4,
            right: 1.4,
            bottom: 1.4,
            left: 1.4,
          },
        },
      },
    });
    assert(typeof pdfBase64 === "string" && pdfBase64.startsWith("JVBER"), "Firefox print endpoint returned no PDF.");
    return Buffer.from(pdfBase64, "base64");
  } finally {
    if (sessionId) {
      await sendWebDriverCommand(driverUrl, `/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    await stopProcessGroup(driverProcess);
  }
}

async function main() {
  const selectedBrowser = process.env.SUPPLIER_ORDER_PRINT_BROWSER ?? "chromium";
  assert(
    selectedBrowser === "chromium" || selectedBrowser === "firefox",
    `Unsupported print test browser "${selectedBrowser}". Choose chromium or firefox.`,
  );
  const chromium = process.env.CHROMIUM_BIN ?? "/repl/tools/bin/chromium";
  if (selectedBrowser === "chromium" && !existsSync(chromium)) {
    throw new Error(`Chromium was not found at ${chromium}; set CHROMIUM_BIN to a browser executable.`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "supplier-order-print-"));
  const pdfPath = path.join(tempDir, "supplier-order.pdf");
  const port = await getAvailablePort();
  process.env.PORT = String(port);
  process.env.BASE_PATH = "/pos/";
  process.env.NODE_ENV = "test";
  delete process.env.REPL_ID;

  let vite;
  let browserProcess;
  let devTools;
  try {
    vite = await createViteServer({
      configFile: path.join(posRoot, "vite.config.ts"),
      logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: true },
    });
    await vite.listen();

    const url = `http://127.0.0.1:${port}/pos/tests/browser/supplier-order-print.html${selectedBrowser === "firefox" ? "?shortOnly=true" : ""}`;
    if (selectedBrowser === "chromium") {
      const profileDir = path.join(tempDir, "profile");
      const browserLogs = [];
      browserProcess = spawn(chromium, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-allow-origins=*",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "about:blank",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      browserProcess.stderr.setEncoding("utf8");
      browserProcess.stderr.on("data", chunk => browserLogs.push(chunk));

      const pageTarget = await findPageTarget(browserProcess, profileDir, browserLogs);
      devTools = connectDevTools(pageTarget.webSocketDebuggerUrl);
      await devTools.ready;
      await devTools.send("Page.enable");
      await devTools.send("Runtime.enable");
      const pageErrors = [];
      const exceptionListener = params => {
        pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Unknown page error");
      };
      const removePageErrorListener = devTools.onEvent("Runtime.exceptionThrown", exceptionListener);

      const navigation = await devTools.send("Page.navigate", { url });
      assert(!navigation.errorText, `Chromium could not navigate to the print fixture: ${navigation.errorText}`);

      const renderDeadline = Date.now() + 30_000;
      let rendered = false;
      while (Date.now() < renderDeadline) {
        const result = await devTools.send("Runtime.evaluate", {
          expression: selectedBrowser === "firefox"
            ? `Boolean(document.body.textContent?.includes("ONE-ROW-ORDER-CASE"))`
            : `Boolean(document.querySelector('[data-testid="text-supplier-order-print-instructions"]')?.textContent?.includes("KONEC-NAVODILA-100") && document.querySelector('[data-testid="receipt-print-document"]')?.textContent?.includes("PREJEMNICA-DOLGA-2026-1007"))`,
          returnByValue: true,
        });
        if (result.result?.value === true) {
          rendered = true;
          break;
        }
        await delay(100);
      }
      assert(rendered, `Supplier order print harness did not render: ${pageErrors.join("; ") || "instruction sentinel not found"}.`);
      assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);
      removePageErrorListener();
      await devTools.send("Emulation.setEmulatedMedia", { media: "print" });
      const printed = await devTools.send("Page.printToPDF", {
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        transferMode: "ReturnAsBase64",
      });
      await writeFile(pdfPath, Buffer.from(printed.data, "base64"));
    } else {
      await writeFile(pdfPath, await printWithFirefox(url, tempDir));
    }
    if (process.env.SUPPLIER_ORDER_PRINT_PDF_OUT) {
      await writeFile(process.env.SUPPLIER_ORDER_PRINT_PDF_OUT, await readFile(pdfPath));
    }

    const pdfInfo = run(process.env.PDFINFO_BIN ?? "pdfinfo", [pdfPath]);
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
    assert(Number.isInteger(pageCount) && pageCount >= 3, `Expected a multi-page PDF; got ${pageCount} pages.`);
    const pageSize = pdfInfo.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
    assert(pageSize, "Could not read the printed page dimensions.");
    assert(
      Math.abs(Number(pageSize[1]) - (210 / 25.4) * 72) <= 1
        && Math.abs(Number(pageSize[2]) - (297 / 25.4) * 72) <= 1,
      `Expected A4 portrait pages; got ${pageSize[1]} x ${pageSize[2]} pt.`,
    );

    const extracted = run(process.env.PDFTOTEXT_BIN ?? "pdftotext", ["-layout", pdfPath, "-"]);
    const normalizedPdfText = normalizeText(extracted);
    const pages = extracted.split("\f").map(normalizeText).filter(Boolean);
    assert.equal(pages.length, pageCount, "Extracted PDF page count differs from pdfinfo.");
    if (selectedBrowser === "firefox") {
      assert.equal(pageCount, 3, `Expected one A4 page per short order and no blank pages; got ${pageCount} pages.`);
      assertShortOrderPages(pages, 0);
      assert(!normalizedPdfText.includes("INTERNAL-NOTE-MUST-NOT-PRINT"), "Internal note leaked into the PDF.");
      console.log("Supplier-order print firefox regression passed: three short orders on exactly three nonblank A4 pages.");
      return;
    }

    const boundingBoxes = run(process.env.PDFTOTEXT_BIN ?? "pdftotext", ["-bbox-layout", pdfPath, "-"]);
    const pdfPages = [...boundingBoxes.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
    assert.equal(pdfPages.length, pageCount, "PDF text geometry page count differs from pdfinfo.");
    const lastOrderPageIndex = pages.findIndex(page => page.includes("ONE-ROW-ORDER-CASE")) - 1;
    assert(lastOrderPageIndex > 0, "Could not determine the final page of the multi-page supplier order.");
    if (selectedBrowser === "chromium") {
      const pageNumberPattern = /STRAN\s+(\d+)\s*\/\s*(\d+)/i;
      for (let pageIndex = 0; pageIndex <= lastOrderPageIndex; pageIndex += 1) {
        const pageNumber = pages[pageIndex].match(pageNumberPattern);
        assert(pageNumber, `Multi-page supplier order page ${pageIndex + 1} has no printed page number.`);
        assert.equal(Number(pageNumber[1]), pageIndex + 1, `Page ${pageIndex + 1} has an incorrect page number.`);
        assert.equal(Number(pageNumber[2]), pageCount, `Page ${pageIndex + 1} has an incorrect total page count.`);
      }
      for (const pageIndex of [lastOrderPageIndex + 1, lastOrderPageIndex + 2, lastOrderPageIndex + 3]) {
        assert(
          !pageNumberPattern.test(pages[pageIndex] ?? ""),
          `Single-page supplier order ${pageIndex - lastOrderPageIndex} is cluttered with a page number.`,
        );
      }
    }
    const tablePages = pages.filter(page => /(?:^|\s)POSTAVKA-\d{3}/.test(page));
    const notePages = pages.filter(page => /NAVODILO-\d{3}/.test(page));
    assert(
      tablePages.length >= 2,
      `Expected table rows on multiple pages; got ${tablePages.length} table pages. Extracted text: ${normalizeText(extracted).slice(0, 1_200)}`,
    );
    assert(
      notePages.length >= 2,
      `Expected long supplier instructions to continue across pages; got ${notePages.length} note pages.`,
    );

    const headerLabels = [
      ["artikel"],
      ["pakiranje"],
      ["količina", "paketov"],
      ["cena", "paketa"],
      ["znesek"],
    ];
    for (const [index, page] of tablePages.entries()) {
      const normalizedPage = page.toLocaleLowerCase("sl");
      for (const label of headerLabels) {
        assert(
          label.every(part => normalizedPage.includes(part)),
          `Table page ${index + 1} is missing a repeated header label "${label.join(" ")}".`,
        );
      }
    }

    for (let number = 1; number <= lineCount; number += 1) {
      const paddedNumber = String(number).padStart(3, "0");
      const articleName = `POSTAVKA-${paddedNumber}`;
      assert(normalizedPdfText.includes(articleName), `Printed PDF is missing ${articleName}.`);

      const page = pages.find(text => text.includes(articleName));
      assert(page, `No PDF page contains ${articleName}.`);
      const rowLine = page.split("\n").map(normalizeText).find(line => line.includes(articleName));
      assert(rowLine, `No extracted table row contains ${articleName}.`);

      const unitPrice = (number % 9) + 1.25;
      const amount = unitPrice * number;
      assert(rowLine.includes(String(number)), `${articleName} is missing quantity ${number}.`);
      assert(rowLine.includes(decimalToken(unitPrice)), `${articleName} is missing its unit price.`);
      assert(rowLine.includes(decimalToken(amount)), `${articleName} is missing its line amount.`);
    }

    const longRowNumber = 12;
    const paddedLongRowNumber = String(longRowNumber).padStart(3, "0");
    const longArticleName = `POSTAVKA-${paddedLongRowNumber} Izredno dolg naziv artikla za mleko polnomastno v gostinskem pakiranju z dodatno oznako kakovosti in podrobnim opisom`;
    const longSupplierItemName = "Dobaviteljev artikel mleko polnomastno za profesionalne kuhinje z dodatnim opisom pakiranja in enote za večje gostinske obrate";
    const longSupplierCode = `REF-${paddedLongRowNumber}-${"X7Q".repeat(30)}`;
    const longRowPageIndex = pages.findIndex(page => page.includes(`POSTAVKA-${paddedLongRowNumber}`));
    const longRowPage = pages[longRowPageIndex];
    assert(longRowPage, "No PDF page contains the complete long article name.");
    const precedingArticlePageIndex = pages.findIndex(page =>
      page.includes(`POSTAVKA-${String(longRowNumber - 1).padStart(3, "0")}`));
    assert(precedingArticlePageIndex >= 0, "The row before the long row is missing from the PDF.");
    assert.notEqual(
      longRowPageIndex,
      precedingArticlePageIndex,
      "The long row fixture no longer reaches a page boundary; move it to the page edge.",
    );
    const longRowLine = longRowPage.split("\n").map(normalizeText)
      .find(line => line.includes(`POSTAVKA-${paddedLongRowNumber}`));
    assert(longRowLine, "No printed table line contains the long article name.");
    const longUnitPrice = (longRowNumber % 9) + 1.25;
    const longAmount = longUnitPrice * longRowNumber;
    assert(
      new RegExp(`(?:^|\\s)${longRowNumber}(?:\\s|$)`).test(longRowLine),
      "Long row is missing its printed quantity.",
    );
    assert(longRowLine.includes(decimalToken(longUnitPrice)), "Long row is missing its unit price.");
    assert(longRowLine.includes(decimalToken(longAmount)), "Long row is missing its line amount.");

    for (let number = 1; number <= 100; number += 1) {
      const marker = `NAVODILO-${String(number).padStart(3, "0")}`;
      assert(normalizedPdfText.includes(marker), `Printed PDF is missing long-note section ${marker}.`);
    }
    assert(normalizedPdfText.includes("KONEC-NAVODILA-100"), "The end of the long supplier instruction is missing.");
    assert(!normalizedPdfText.includes("INTERNAL-NOTE-MUST-NOT-PRINT"), "Internal note leaked into the PDF.");

    const lastInstructionPageIndex = pages.findIndex(page => page.includes("KONEC-NAVODILA-100"));
    const oneRowPageIndex = pages.findIndex(page =>
      compactText(page).includes(compactText("ONE-ROW-ORDER-CASE")));
    const emptyOrderPageIndex = pages.findIndex(page => page.includes("EMPTY-ORDER-CASE"));
    const noInstructionsPageIndex = pages.findIndex(page =>
      compactText(page).includes(compactText("NO-INSTRUCTIONS-ORDER-CASE")));
    const mixedPricedPageIndex = pages.findIndex(page => page.includes("MIXED-PRICED-ORDER-CASE"));
    const fullyUnpricedPageIndex = pages.findIndex(page => page.includes("FULLY-UNPRICED-ORDER-CASE"));
    assert(lastInstructionPageIndex >= 0, "The long order's final instruction page is missing.");
    assert(oneRowPageIndex >= 0, "The one-row order is missing from the PDF.");
    assert(emptyOrderPageIndex >= 0, "The empty order is missing from the PDF.");
    assert(noInstructionsPageIndex >= 0, "The order without supplier instructions is missing from the PDF.");
    assert(mixedPricedPageIndex >= 0, "The mixed priced/unpriced order is missing from the PDF.");
    assert(fullyUnpricedPageIndex >= 0, "The fully unpriced order is missing from the PDF.");
    assert.equal(oneRowPageIndex, lastInstructionPageIndex + 1, "A blank page appeared before the one-row order.");
    assert.equal(emptyOrderPageIndex, oneRowPageIndex + 1, "The one-row order produced an unexpected extra page.");
    assert.equal(noInstructionsPageIndex, emptyOrderPageIndex + 1, "The empty order produced an unexpected extra page.");
    assert.equal(mixedPricedPageIndex, noInstructionsPageIndex + 1, "The order without instructions produced an unexpected extra page.");
    assert.equal(fullyUnpricedPageIndex, mixedPricedPageIndex + 1, "The mixed priced/unpriced order produced an unexpected extra page.");
    const receiptPageIndex = pages.findIndex(page =>
      compactText(page).includes(compactText("PREJEMNICA-DOLGA-2026-1007")));
    assert(receiptPageIndex >= 0, "The confirmed multi-page receipt is missing from the PDF.");
    const receiptPages = pages.slice(receiptPageIndex);
    const receiptText = normalizeText(receiptPages.join(" "));
    assert(!receiptText.includes("POS-DIALOG-MUST-NOT-PRINT"), "The POS dialog leaked into the printed receipt.");
    assert(!receiptText.includes("POS-BUTTON-MUST-NOT-PRINT"), "A POS button leaked into the printed receipt.");
    assert(!receiptText.includes("Tiskaj / shrani PDF"), "The print control leaked into the printed receipt.");
    assert(!receiptText.includes("Zapri"), "A dialog close control leaked into the printed receipt.");

    const receiptItemPages = receiptPages.filter(page => /PREJEMNICA-POSTAVKA-\d{3}/.test(page));
    const receiptCostPages = receiptPages.filter(page => /PREJEMNICA-STROSEK-\d{3}/.test(page));
    assert(receiptItemPages.length >= 2, "Expected receipt item rows to continue across multiple pages.");
    assert(receiptCostPages.length >= 2, "Expected dependent costs to continue across multiple pages.");
    for (const [pageIndex, page] of receiptPages.entries()) {
      const normalizedPage = page.toLocaleLowerCase("sl");
      if (/PREJEMNICA-POSTAVKA-\d{3}/.test(page)) {
        for (const label of ["artikel", "količina", "cena", "kos", "ddv", "znesek"]) {
          assert(
            normalizedPage.includes(label),
            `Receipt item page ${pageIndex + 1} is missing repeated table heading "${label}".`,
          );
        }
      }
      if (/PREJEMNICA-STROSEK-\d{3}/.test(page)) {
        for (const label of ["strošek", "ddv", "obravnava", "znesek"]) {
          assert(
            normalizedPage.includes(label),
            `Receipt cost page ${pageIndex + 1} is missing repeated table heading "${label}".`,
          );
        }
      }
    }

    const receiptGeometry = pdfPages;
    const receiptLineCount = 42;
    const receiptCostCount = 28;
    for (let number = 1; number <= receiptLineCount; number += 1) {
      const padded = String(number).padStart(3, "0");
      const marker = `PREJEMNICA-POSTAVKA-${padded}`;
      const itemPageIndex = pages.findIndex(page => page.includes(marker));
      assert(itemPageIndex >= receiptPageIndex, `Confirmed receipt is missing ${marker}.`);
      const pageMarkup = receiptGeometry[itemPageIndex];
      assert(pageMarkup, `${marker} has no PDF geometry page.`);
      const words = readWords(pageMarkup[2]);
      const markerWord = words.find(word => word.text === marker);
      assert(markerWord, `${marker} has no PDF text geometry.`);
      const itemStarts = words
        .filter(word => /^PREJEMNICA-POSTAVKA-\d{3}$/.test(word.text))
        .sort((left, right) => Number(left.yMin) - Number(right.yMin));
      const thisItemIndex = itemStarts.indexOf(markerWord);
      const nextItem = itemStarts[thisItemIndex + 1];
      const itemWords = words.filter(word =>
        Number(word.yMin) >= Number(markerWord.yMin) - 0.5
        && (!nextItem || Number(word.yMin) < Number(nextItem.yMin) - 0.5));
      const itemText = compactText(itemWords.map(word => word.text).join(" "));
      const unitPrice = 2.35 + number / 10;
      const amount = unitPrice * 2;
      const vatRate = number % 2 === 0 ? 9.5 : 22;
      const vatAmount = amount * vatRate / 100;
      const vatRateToken = new Intl.NumberFormat("sl-SI", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        useGrouping: false,
      }).format(vatRate);
      const expectedArticleName =
        `${marker} Ekološko polnomastno slovensko mleko za profesionalne kuhinje, z natančno navedbo porekla, načina pridelave in ustreznega gostinskega pakiranja`;
      const expectedSupplierName = `Dobaviteljev naziv: mleko izbrane kakovosti za gostinstvo ${padded}`;
      for (const [label, expected] of [
        ["complete Slovene article name", expectedArticleName],
        ["supplier item name", expectedSupplierName],
        ["quantity", "2L"],
        ["unit price", `${decimalToken(unitPrice)}EUR`],
        ["VAT rate", `${vatRateToken}%`],
        ["VAT amount", `${decimalToken(vatAmount)}EUR`],
        ["line amount", `${decimalToken(amount)}EUR`],
      ]) {
        assert(
          itemText.includes(compactText(expected)),
          `${marker} is missing or clipped ${label}.`,
        );
      }
    }

    for (let number = 1; number <= receiptCostCount; number += 1) {
      const padded = String(number).padStart(3, "0");
      const marker = `PREJEMNICA-STROSEK-${padded}`;
      const costPageIndex = pages.findIndex(page => page.includes(marker));
      assert(costPageIndex >= receiptPageIndex, `Confirmed receipt is missing ${marker}.`);
      const pageMarkup = receiptGeometry[costPageIndex];
      assert(pageMarkup, `${marker} has no PDF geometry page.`);
      const words = readWords(pageMarkup[2]);
      const markerWord = words.find(word => word.text === marker);
      assert(markerWord, `${marker} has no PDF text geometry.`);
      const costStarts = words
        .filter(word => /^PREJEMNICA-STROSEK-\d{3}$/.test(word.text))
        .sort((left, right) => Number(left.yMin) - Number(right.yMin));
      const thisCostIndex = costStarts.indexOf(markerWord);
      const nextCost = costStarts[thisCostIndex + 1];
      const costWords = words.filter(word =>
        Number(word.yMin) >= Number(markerWord.yMin) - 0.5
        && (!nextCost || Number(word.yMin) < Number(nextCost.yMin) - 0.5));
      const costText = compactText(costWords.map(word => word.text).join(" "));
      const amount = (3.41 + number / 10).toFixed(2);
      const handling = number % 2 === 0 ? "Vrednost zaloge" : "Ločen strošek";
      assert(costText.includes(compactText(`Dostava in odvisni stroški manipulacije ter hlajenja`)),
        `${marker} is missing or clipped its long Slovenian name.`);
      assert(costText.includes("22,0%"), `${marker} is missing or clipping its VAT rate.`);
      assert(costText.includes(compactText(handling)), `${marker} is missing its handling type.`);
      assert(costText.includes(compactText(`${decimalToken(Number(amount))}EUR`)),
        `${marker} is missing or clipping its amount.`);
    }

    const oneRowPage = pages[oneRowPageIndex];
    assert(oneRowPage.includes("Enovrstični preizkusni dobavitelj"), "The one-row order supplier is missing.");
    assert(oneRowPage.includes("ONE-ROW-SUPPLIER-INSTRUCTION"), "The one-row supplier instructions are missing.");
    assert(oneRowPage.includes("ONE-ROW-SUPPLIER-ITEM"), "The one-row supplier item details are missing.");
    assert(oneRowPage.includes("SUPPLIER-CODE"), "The one-row supplier code is missing.");
    const oneRowLine = oneRowPage.split("\n").map(normalizeText)
      .find(line => line.includes("ONE-ROW-ARTICLE"));
    assert(oneRowLine, "The one-row article is missing.");
    assert(
      new RegExp("(?:^|\\s)2(?:\\s|$)").test(oneRowLine),
      "The one-row article is missing its quantity.",
    );
    assert(oneRowLine.includes(decimalToken(3.5)), "The one-row article is missing its unit price.");
    assert(oneRowLine.includes(decimalToken(7)), "The one-row article is missing its amount.");
    const oneRowTotalLine = oneRowPage.split("\n").map(normalizeText)
      .find(line => line.includes("Skupaj"));
    assert(oneRowTotalLine?.includes(decimalToken(7)), "The one-row order total is missing or incomplete.");

    const emptyOrderPage = pages[emptyOrderPageIndex];
    assert(emptyOrderPage.includes("Dobavitelj praznega osnutka"), "The empty order supplier is missing.");
    const emptyOrderTotalLine = emptyOrderPage.split("\n").map(normalizeText)
      .find(line => line.includes("Skupaj"));
    assert(emptyOrderTotalLine?.includes("—"), "The empty order's total placeholder is missing.");
    assert(!emptyOrderPage.includes("Navodilo dobavitelju"), "The empty order printed a missing-instructions section.");

    const noInstructionsPage = pages[noInstructionsPageIndex];
    assert(noInstructionsPage.includes("Dobavitelj brez navodil"), "The order without instructions is missing its supplier.");
    assert(noInstructionsPage.includes("NO-INSTRUCTIONS-SUPPLIER-ITEM"), "Supplier item details are missing without instructions.");
    assert(
      noInstructionsPage.includes("INSTRUCTIONS-SUPPLIER-CODE"),
      "Supplier code is missing without instructions.",
    );
    assert(!noInstructionsPage.includes("Navodilo dobavitelju"), "An order without supplier instructions printed an empty section.");
    const noInstructionsLine = noInstructionsPage.split("\n").map(normalizeText)
      .find(line => line.includes("NO-INSTRUCTIONS-ARTICLE"));
    assert(noInstructionsLine, "The order without supplier instructions is missing its article.");
    assert(
      new RegExp("(?:^|\\s)3(?:\\s|$)").test(noInstructionsLine),
      "The order without instructions is missing its quantity.",
    );
    assert(noInstructionsLine.includes(decimalToken(1.2)), "The order without instructions is missing its unit price.");
    assert(noInstructionsLine.includes(decimalToken(3.6)), "The order without instructions is missing its amount.");
    const noInstructionsTotalLine = noInstructionsPage.split("\n").map(normalizeText)
      .find(line => line.includes("Skupaj"));
    assert(noInstructionsTotalLine?.includes(decimalToken(3.6)), "The order without instructions is missing its total.");

    const mixedPricedPage = pages[mixedPricedPageIndex];
    const mixedPricedLine = mixedPricedPage.split("\n").map(normalizeText)
      .find(line => line.includes("MIXED-PRICED-ARTICLE"));
    const mixedUnpricedLine = mixedPricedPage.split("\n").map(normalizeText)
      .find(line => line.includes("MIXED-UNPRICED-ARTICLE"));
    assert(mixedPricedLine, "The priced line is missing from the mixed-price order.");
    assert(mixedUnpricedLine, "The unpriced line is missing from the mixed-price order.");
    assert(mixedPricedLine.includes(decimalToken(3.5)), "The priced line is missing its unit price.");
    assert(mixedPricedLine.includes(decimalToken(7)), "The priced line is missing its amount.");
    assert.equal(
      (mixedUnpricedLine.match(/—/g) ?? []).length,
      2,
      "The unpriced line must show dashes for both its price and amount.",
    );
    assert(mixedPricedPage.includes("Vmesni seštevek ne vključuje postavk brez določene cene."),
      "The mixed-price order does not explain that unpriced lines are excluded.");
    const mixedTotalLine = mixedPricedPage.split("\n").map(normalizeText)
      .find(line => line.includes("Vmesni seštevek"));
    assert(mixedTotalLine?.includes(decimalToken(7)), "The mixed-price subtotal must include only the priced line.");
    assert(!mixedTotalLine?.includes(decimalToken(50)), "The mixed-price subtotal incorrectly includes the unpriced line.");

    const fullyUnpricedPage = pages[fullyUnpricedPageIndex];
    const fullyUnpricedLine = fullyUnpricedPage.split("\n").map(normalizeText)
      .find(line => line.includes("FULLY-UNPRICED-ARTICLE"));
    assert(fullyUnpricedLine, "The fully unpriced order's line is missing.");
    assert(
      (fullyUnpricedLine.match(/—/g) ?? []).length >= 2,
      "The fully unpriced line must show dashes for both its price and amount.",
    );
    assert(fullyUnpricedPage.includes("Vmesni seštevek ne vključuje postavk brez določene cene."),
      "The fully unpriced order does not explain that its line is excluded.");
    const fullyUnpricedTotalLine = fullyUnpricedPage.split("\n").map(normalizeText)
      .find(line => line.includes("Vmesni seštevek"));
    assert(fullyUnpricedTotalLine?.includes("—"), "The fully unpriced order's subtotal placeholder is missing.");
    assert(!fullyUnpricedPage.includes("EMPTY-ORDER-CASE"), "The fully unpriced order was confused with the empty order.");

    const oversizedOrderPageIndex = pages.findIndex(page => page.includes("OVERSIZED-ROW-ORDER-CASE"));
    assert(oversizedOrderPageIndex >= 0, "The oversized-row order is missing from the PDF.");
    assert.equal(
      oversizedOrderPageIndex,
      fullyUnpricedPageIndex + 1,
      "The fully unpriced order produced an unexpected extra page before the oversized-row order.",
    );
    const firstOversizedArticlePageIndex = pages.findIndex(page => page.includes("OVERSIZED-ARTICLE-START"));
    const lastOversizedArticlePageIndex = pages.findIndex(page => page.includes("OVERSIZED-ARTICLE-END"));
    assert(
      firstOversizedArticlePageIndex >= 0 && lastOversizedArticlePageIndex > firstOversizedArticlePageIndex,
      "The oversized article text did not continue onto a later page.",
    );
    const oversizedSupplierPageIndexes = pages
      .map((page, pageIndex) =>
        compactText(page).includes("OVERSIZED-SUPPLIER-DETAIL-001")
          || compactText(page).includes("OVERSIZED-SUPPLIER-DETAIL-080")
          || compactText(page).includes("OVERSIZED-SUPPLIER-CODE-START")
          || compactText(page).includes("OVERSIZED-SUPPLIER-CODE-END")
          ? pageIndex
          : -1)
      .filter(pageIndex => pageIndex >= 0);
    assert(
      oversizedSupplierPageIndexes.length >= 2,
      "The oversized supplier details and code did not continue across page fragments.",
    );
    const oversizedRowEndPageIndex = pages.findIndex(page =>
      compactText(page).includes("OVERSIZED-SUPPLIER-CODE-END"));
    assert(
      oversizedRowEndPageIndex > firstOversizedArticlePageIndex,
      "The oversized supplier details and code did not continue across page fragments.",
    );
    assert.equal(
      receiptPageIndex,
      oversizedRowEndPageIndex + 1,
      "A blank page appeared before the confirmed receipt.",
    );
    const expectedOversizedRowText = compactText(
      `OVERSIZED-ARTICLE-START ${oversizedArticleDetails} OVERSIZED-ARTICLE-END `
        + `OVERSIZED-SUPPLIER-START ${oversizedSupplierDetails} OVERSIZED-SUPPLIER-END · ${oversizedSupplierCode}`,
    );
    const oversizedRowWords = [];
    for (let pageIndex = firstOversizedArticlePageIndex; pageIndex <= oversizedRowEndPageIndex; pageIndex += 1) {
      const pageMarkup = pdfPages[pageIndex];
      assert(pageMarkup, `Oversized row fragment page ${pageIndex + 1} has no PDF geometry.`);
      const pageAttributes = readAttributes(pageMarkup[1]);
      const pageWords = readWords(pageMarkup[2]);
      const articleStartWord = pageIndex === firstOversizedArticlePageIndex
        ? pageWords.find(word => word.text === "OVERSIZED-ARTICLE-START")
        : undefined;
      const codeEndWord = pageIndex === oversizedRowEndPageIndex
        ? pageWords.find(word => word.text.includes("CODE-END"))
        : undefined;
      if (pageIndex === firstOversizedArticlePageIndex) {
        assert(articleStartWord, "The oversized article's first fragment has no PDF geometry.");
      }
      if (pageIndex === oversizedRowEndPageIndex) {
        assert(codeEndWord, "The oversized supplier-code ending has no PDF geometry.");
      }

      const tableHeaderTokens = new Set(["ARTIKEL", "PAKIRANJE", "KOLIČINA", "PAKETOV", "CENA", "ZNESEK"]);
      const tableHeaderWords = pageWords.filter(word =>
        tableHeaderTokens.has(word.text.toLocaleUpperCase("sl")));
      const packageHeader = tableHeaderWords.find(word =>
        word.text.toLocaleUpperCase("sl") === "PAKIRANJE");
      assert(packageHeader, `Oversized row fragment page ${pageIndex + 1} is missing its package column header.`);
      const tableHeaderBottom = Math.max(...tableHeaderWords.map(word => Number(word.yMax)));
      const firstColumnRightEdge = Number(packageHeader.xMin) - 1;
      const firstVisibleY = articleStartWord
        ? Number(articleStartWord.yMin) - 0.5
        : tableHeaderBottom;
      const lastVisibleY = codeEndWord ? Number(codeEndWord.yMax) + 0.5 : Number.POSITIVE_INFINITY;
      oversizedRowWords.push(...pageWords.filter(word =>
        Number(word.xMin) < firstColumnRightEdge
          && Number(word.yMin) >= firstVisibleY
          && Number(word.yMax) <= lastVisibleY)
        .sort((left, right) =>
          Number(left.yMin) - Number(right.yMin) || Number(left.xMin) - Number(right.xMin)));
    }
    const actualOversizedRowText = compactText(
      oversizedRowWords.map(word => word.text).join(" "),
    );
    assert.equal(
      actualOversizedRowText,
      expectedOversizedRowText,
      "The oversized article text, supplier details, or supplier code are clipped or missing between page fragments.",
    );
    const oversizedFirstFragmentWords = readWords(pdfPages[firstOversizedArticlePageIndex][2]);
    const firstOversizedArticleWord = oversizedFirstFragmentWords.find(
      word => word.text === "OVERSIZED-ARTICLE-START",
    );
    assert(firstOversizedArticleWord, "The oversized article's first fragment has no PDF geometry.");
    const oversizedRowTopWords = oversizedFirstFragmentWords.filter(word =>
      Math.abs(Number(word.yMin) - Number(firstOversizedArticleWord.yMin)) < 2);
    assert(oversizedRowTopWords.some(word => word.text === "7"), "The oversized row is missing its quantity.");
    assert(
      oversizedRowTopWords.some(word => word.text === decimalToken(4.25)),
      "The oversized row is missing its unit price.",
    );
    assert(
      oversizedRowTopWords.some(word => word.text === decimalToken(29.75)),
      "The oversized row is missing its amount.",
    );

    for (const [pageIndex, page] of pages.entries()) {
      const pageMarkup = pdfPages[pageIndex];
      assert(pageMarkup, `Supplier order page ${pageIndex + 1} has no PDF text geometry.`);
      if (selectedBrowser === "chromium" && pageIndex <= lastOrderPageIndex) {
        const pageAttributes = readAttributes(pageMarkup[1]);
        const pageHeight = Number(pageAttributes.height);
        const pageWords = readWords(pageMarkup[2]);
        const pageNumberWord = pageWords.find(word => word.text.toLocaleLowerCase("sl") === "stran");
        assert(pageNumberWord, `Supplier order page ${pageIndex + 1} has no page-number geometry.`);
        const pageNumberWords = pageWords.filter(word =>
          Number(word.yMin) < Number(pageNumberWord.yMax)
          && Number(word.yMax) > Number(pageNumberWord.yMin));
        assert(
          Number(pageNumberWord.yMin) >= pageHeight - (14 / 25.4) * 72,
          `Page number on supplier order page ${pageIndex + 1} overlaps the printable page content.`,
        );
        const pageContentWords = pageWords.filter(word => !pageNumberWords.includes(word));
        const pageContentBottom = Math.max(...pageContentWords.map(word => Number(word.yMax)));
        assert(
          pageContentBottom < Number(pageNumberWord.yMin),
          `Page number overlaps the table or supplier instructions on page ${pageIndex + 1}.`,
        );
      }

      if (!/(?:^|\s)POSTAVKA-\d{3}/.test(page)) continue;
      const blocks = readBlocks(pageMarkup[2]);
      const compactOrderNumber = compactText(longOrderNumber);
      const compactSupplierName = compactText(continuationSupplierName);
      const repeatedHeaderBlock = blocks.find(block => {
        const compactBlock = compactText(block.text);
        return compactBlock.includes(compactOrderNumber) && compactBlock.includes(compactSupplierName);
      });
      assert(repeatedHeaderBlock, `Table page ${pageIndex + 1} is missing its repeated order and supplier identifiers.`);

      const tableHeaderTokens = new Set(["ARTIKEL", "PAKIRANJE", "KOLIČINA", "PAKETOV", "CENA", "ZNESEK"]);
      const words = readWords(pageMarkup[2]);
      const firstArticleWord = words.find(word => /^POSTAVKA-\d{3}$/.test(word.text));
      assert(firstArticleWord, `Table page ${pageIndex + 1} has no article row geometry.`);
      const tableHeaderWords = words.filter(word =>
        tableHeaderTokens.has(word.text.toLocaleUpperCase("sl"))
        && Number(word.yMin) < Number(firstArticleWord.yMin));
      assert(tableHeaderWords.length > 0, `Table page ${pageIndex + 1} has no repeated column heading geometry.`);

      const repeatedContextBottom = Number(repeatedHeaderBlock.yMax);
      const tableHeaderTop = Math.min(...tableHeaderWords.map(word => Number(word.yMin)));
      const tableHeaderBottom = Math.max(...tableHeaderWords.map(word => Number(word.yMax)));
      assert(
        repeatedContextBottom < tableHeaderTop,
        `The repeated order context collides with the table headings on page ${pageIndex + 1}.`,
      );
      assert(
        tableHeaderBottom < Number(firstArticleWord.yMin),
        `The repeated table headings collide with order content on page ${pageIndex + 1}.`,
      );
    }

    const firstPage = pdfPages[0];
    assert(firstPage, "The printed PDF has no first page.");
    const headerBlocks = readBlocks(firstPage[2]);
    const longOrderBlock = headerBlocks.find(block =>
      compactText(block.text) === compactText(longOrderNumber));
    const longSupplierBlock = headerBlocks.find(block =>
      compactText(block.text) === compactText(longSupplierName));
    const createdBlock = headerBlocks.find(block =>
      block.words.some(word => word.text === "Ustvarjeno"));
    const deliveryBlock = headerBlocks.find(block =>
      compactText(block.text).includes("22.okt.2026"));
    assert(longOrderBlock, "The complete long order number is missing from the first-page PDF geometry.");
    assert(longSupplierBlock, "The complete long supplier name is missing from the first-page PDF geometry.");
    assert(createdBlock, "The creation date is missing from the first-page PDF geometry.");
    assert(deliveryBlock, "The expected delivery date is missing from the first-page PDF geometry.");
    assert(
      compactText(pages[0]).includes(compactText(longOrderNumber)),
      "The long order number is not fully visible on the first PDF page.",
    );
    const orderNumberBounds = Object.fromEntries(
      ["xMin", "yMin", "xMax", "yMax"].map(key => [key, Number(longOrderBlock[key])]),
    );
    const supplierNameBounds = Object.fromEntries(
      ["xMin", "yMin", "xMax", "yMax"].map(key => [key, Number(longSupplierBlock[key])]),
    );
    const createdDateBounds = Object.fromEntries(
      ["xMin", "yMin", "xMax", "yMax"].map(key => [key, Number(createdBlock[key])]),
    );
    const deliveryDateBounds = Object.fromEntries(
      ["xMin", "yMin", "xMax", "yMax"].map(key => [key, Number(deliveryBlock[key])]),
    );
    assert(orderNumberBounds.yMax - orderNumberBounds.yMin > 30, "The long order number did not wrap onto multiple lines.");
    assert(supplierNameBounds.yMax - supplierNameBounds.yMin > 20, "The long supplier name did not wrap onto multiple lines.");
    assert(
      orderNumberBounds.xMax <= createdDateBounds.xMin,
      "The long order number extends into the creation-date column.",
    );
    assert(
      supplierNameBounds.xMax <= deliveryDateBounds.xMin,
      "The long supplier name extends into the expected-delivery column.",
    );

    const longRowMarkup = pdfPages[longRowPageIndex];
    assert(longRowMarkup, "Long row has no PDF geometry page.");
    const longPageAttributes = readAttributes(longRowMarkup[1]);
    const longPageWidth = Number(longPageAttributes.width);
    const longRowWords = readWords(longRowMarkup[2]);
    const longArticleStart = longRowWords.find(word => word.text === `POSTAVKA-${paddedLongRowNumber}`);
    assert(longArticleStart, "Long article marker is missing from PDF geometry.");
    const nextArticleStart = longRowWords.find(word => word.text === `POSTAVKA-${String(longRowNumber + 1).padStart(3, "0")}`);
    const firstColumnRightEdge = longPageWidth * 0.39;
    const rowColumnText = longRowWords
      .filter(word => {
        const xMin = Number(word.xMin);
        const yMin = Number(word.yMin);
        return xMin < firstColumnRightEdge
          && yMin >= Number(longArticleStart.yMin) - 0.5
          && (!nextArticleStart || yMin < Number(nextArticleStart.yMin) - 0.5);
      })
      .sort((left, right) =>
        Number(left.yMin) - Number(right.yMin) || Number(left.xMin) - Number(right.xMin))
      .map(word => word.text)
      .join("");
    const expectedLongRowText = `${longArticleName}${longSupplierItemName}·${longSupplierCode}`;
    assert.equal(
      compactText(rowColumnText),
      compactText(expectedLongRowText),
      "Long article name, supplier item name, or code is clipped or split across pages.",
    );

    const paddedTallRowNumber = String(tallRowNumber).padStart(3, "0");
    const tallArticleName = `POSTAVKA-${paddedTallRowNumber} TALL-ARTICLE-START ${tallArticleDetails} TALL-ARTICLE-END`;
    const tallSupplierItemName = `TALL-SUPPLIER-START ${tallSupplierDetails} TALL-SUPPLIER-END`;
    const tallRowPageIndex = pages.findIndex(page => page.includes(`POSTAVKA-${paddedTallRowNumber}`));
    const previousTallRowPageIndex = pages.findIndex(page =>
      page.includes(`POSTAVKA-${String(tallRowNumber - 1).padStart(3, "0")}`));
    assert(tallRowPageIndex >= 0, "The exceptionally tall row is missing from the PDF.");
    assert(previousTallRowPageIndex >= 0, "The row before the exceptionally tall row is missing from the PDF.");
    assert.notEqual(
      tallRowPageIndex,
      previousTallRowPageIndex,
      "The exceptionally tall row was not moved away from the page boundary.",
    );
    const tallRowPage = pdfPages[tallRowPageIndex];
    assert(tallRowPage, "The exceptionally tall row has no PDF geometry page.");
    const tallPageAttributes = readAttributes(tallRowPage[1]);
    const tallPageHeight = Number(tallPageAttributes.height);
    const tallPageWords = readWords(tallRowPage[2]);
    const tallArticleStart = tallPageWords.find(word => word.text === `POSTAVKA-${paddedTallRowNumber}`);
    const nextTallArticleStart = tallPageWords.find(word =>
      word.text === `POSTAVKA-${String(tallRowNumber + 1).padStart(3, "0")}`);
    assert(tallArticleStart, "The exceptionally tall article marker is missing from PDF geometry.");
    const tallFirstColumnWords = tallPageWords
      .filter(word => {
        const xMin = Number(word.xMin);
        const yMin = Number(word.yMin);
        return xMin < Number(tallPageAttributes.width) * 0.39
          && yMin >= Number(tallArticleStart.yMin) - 0.5
          && (!nextTallArticleStart || yMin < Number(nextTallArticleStart.yMin) - 0.5);
      })
      .sort((left, right) =>
        Number(left.yMin) - Number(right.yMin) || Number(left.xMin) - Number(right.xMin));
    const tallFirstColumnText = tallFirstColumnWords.map(word => word.text).join("");
    const expectedTallFirstColumnText =
      `${tallArticleName}${tallSupplierItemName}·${tallSupplierCode}`;
    assert.equal(
      compactText(tallFirstColumnText),
      compactText(expectedTallFirstColumnText),
      "The exceptionally tall row was clipped or split across pages instead of moving intact.",
    );
    const tallRowContentHeight = Math.max(...tallFirstColumnWords.map(word => Number(word.yMax)))
      - Number(tallArticleStart.yMin);
    const freshPageRemaining = tallPageHeight
      - (14 / 25.4) * 72
      - Number(tallArticleStart.yMin);
    assert(
      tallRowContentHeight > 150,
      "The tall-row fixture is not tall enough to exercise page-boundary handling.",
    );
    assert(
      tallRowContentHeight <= freshPageRemaining,
      "The tall-row fixture no longer fits intact on a fresh page.",
    );
    const precedingTallPage = pdfPages[previousTallRowPageIndex];
    assert(precedingTallPage, "The page before the exceptionally tall row is missing.");
    const precedingPageAttributes = readAttributes(precedingTallPage[1]);
    const precedingPageWords = readWords(precedingTallPage[2]);
    const previousTallArticleStart = precedingPageWords.find(word =>
      word.text === `POSTAVKA-${String(tallRowNumber - 1).padStart(3, "0")}`);
    assert(previousTallArticleStart, "The row before the exceptionally tall row has no geometry.");
    const previousTallRowBottom = Math.max(
      ...precedingPageWords
        .filter(word => Number(word.yMin) >= Number(previousTallArticleStart.yMin) - 0.5)
        .map(word => Number(word.yMax)),
    );
    const previousPagePrintableBottom = Number(precedingPageAttributes.height) - (14 / 25.4) * 72;
    const previousPageRemaining = previousPagePrintableBottom - previousTallRowBottom;
    assert(
      tallRowContentHeight > previousPageRemaining,
      "The tall-row fixture could have fit in the remaining space on the previous page.",
    );
    const tallUnitPrice = (tallRowNumber % 9) + 1.25;
    const tallAmount = tallUnitPrice * tallRowNumber;
    const tallRowTopWords = tallPageWords.filter(word =>
      Math.abs(Number(word.yMin) - Number(tallArticleStart.yMin)) < 2);
    assert(tallRowTopWords.some(word => word.text === String(tallRowNumber)), "The tall row is missing its quantity.");
    assert(tallRowTopWords.some(word => word.text === decimalToken(tallUnitPrice)), "The tall row is missing its unit price.");
    assert(tallRowTopWords.some(word => word.text === decimalToken(tallAmount)), "The tall row is missing its amount.");

    const finalArticleNumber = String(lineCount).padStart(3, "0");
    const finalArticleName = `POSTAVKA-${finalArticleNumber}`;
    const finalArticlePageIndex = pages.findIndex(page => page.includes(finalArticleName));
    const lastTablePageIndex = pages.reduce(
      (lastIndex, page, pageIndex) => /(?:^|\s)POSTAVKA-\d{3}/.test(page) ? pageIndex : lastIndex,
      -1,
    );
    assert.equal(
      finalArticlePageIndex,
      lastTablePageIndex,
      "The final supplier-order item is not on the final table page.",
    );
    const finalOrderPage = pages[finalArticlePageIndex];
    assert(finalOrderPage, "The final supplier-order table page is missing.");
    const totalLines = finalOrderPage.split("\n").map(normalizeText)
      .filter(line => line.includes("Skupaj"));
    assert.equal(totalLines.length, 1, "The multi-page supplier-order total must print exactly once.");
    const mainOrderTotalCount = (
      pages.slice(0, lastOrderPageIndex + 1).join("\n").match(/\bSkupaj\b/g) ?? []
    ).length;
    assert.equal(mainOrderTotalCount, 1, "The multi-page supplier-order total is duplicated across pages.");
    const expectedOrderTotal = Array.from({ length: lineCount }, (_, index) => {
      const number = index + 1;
      return ((number % 9) + 1.25) * number;
    }).reduce((sum, amount) => sum + amount, 0);
    assert(
      totalLines[0].includes(decimalToken(expectedOrderTotal)),
      `The multi-page supplier-order total is missing ${decimalToken(expectedOrderTotal)}.`,
    );
    const finalOrderPageMarkup = pdfPages[finalArticlePageIndex];
    assert(finalOrderPageMarkup, "The final supplier-order page has no PDF geometry.");
    const finalOrderWords = readWords(finalOrderPageMarkup[2]);
    const finalArticleWord = finalOrderWords.find(word => word.text === finalArticleName);
    const totalLabelWord = finalOrderWords.find(word => word.text === "Skupaj");
    const totalAmountWord = finalOrderWords.find(word => word.text === decimalToken(expectedOrderTotal));
    assert(finalArticleWord, "The final supplier-order item has no PDF geometry.");
    assert(totalLabelWord, "The multi-page supplier-order total label is missing from PDF geometry.");
    assert(totalAmountWord, "The multi-page supplier-order total amount is missing from PDF geometry.");
    assert(
      Number(totalLabelWord.yMin) >= Number(finalArticleWord.yMin),
      "The supplier-order total appears before the final item.",
    );
    const finalItemWords = finalOrderWords.filter(word =>
      Number(word.yMin) >= Number(finalArticleWord.yMin) - 0.5
      && Number(word.yMin) < Number(totalLabelWord.yMin));
    const finalItemBottom = Math.max(...finalItemWords.map(word => Number(word.yMax)));
    assert(
      finalItemBottom <= Number(totalLabelWord.yMin) + 0.5,
      "The supplier-order total overlaps the final item.",
    );
    assert(
      Math.abs(Number(totalLabelWord.yMin) - Number(totalAmountWord.yMin)) <= 1,
      "The supplier-order total label and amount are split across lines.",
    );
    assert(
      Number(totalAmountWord.xMin) >= Number(totalLabelWord.xMax) - 0.5,
      "The supplier-order total amount overlaps its label.",
    );

    for (const [pageIndex, match] of pdfPages.entries()) {
      const pageAttributes = readAttributes(match[1]);
      const width = Number(pageAttributes.width);
      const height = Number(pageAttributes.height);
      assert(width > 0 && height > 0, `Page ${pageIndex + 1} has invalid dimensions.`);

      for (const word of match[2].matchAll(/<word\b([^>]*)>/g)) {
        const attributes = readAttributes(word[1]);
        const xMin = Number(attributes.xMin);
        const yMin = Number(attributes.yMin);
        const xMax = Number(attributes.xMax);
        const yMax = Number(attributes.yMax);
        assert(xMin >= -1 && yMin >= -1, `Text starts outside page ${pageIndex + 1}.`);
        assert(xMax <= width + 1 && yMax <= height + 1, `Text is clipped at page ${pageIndex + 1}.`);
      }

      const words = [...match[2].matchAll(/<word\b([^>]*)>/g)]
        .map(word => readAttributes(word[1]))
        .sort((left, right) => Number(left.yMin) - Number(right.yMin));
      const activeWords = [];
      for (const word of words) {
        const xMin = Number(word.xMin);
        const xMax = Number(word.xMax);
        const yMin = Number(word.yMin);
        const yMax = Number(word.yMax);
        for (let index = activeWords.length - 1; index >= 0; index -= 1) {
          if (Number(activeWords[index].yMax) <= yMin + 0.5) activeWords.splice(index, 1);
        }
        for (const active of activeWords) {
          const overlapsHorizontally =
            xMin < Number(active.xMax) - 0.5 && xMax > Number(active.xMin) + 0.5;
          const overlapsVertically =
            yMin < Number(active.yMax) - 0.5 && yMax > Number(active.yMin) + 0.5;
          assert(
            !overlapsHorizontally || !overlapsVertically,
            `Text overlaps on page ${pageIndex + 1}.`,
          );
        }
        activeWords.push(word);
      }
    }

    console.log(`Supplier-order and confirmed-receipt print ${selectedBrowser} regression passed: ${pageCount} PDF pages, ${tablePages.length} order table pages, ${receiptItemPages.length} receipt item pages, ${receiptCostPages.length} receipt cost pages, ${lineCount} order rows, ${receiptLineCount} receipt items, ${receiptCostCount} dependent costs, and 100 note paragraphs.`);
  } finally {
    devTools?.close();
    await stopProcessGroup(browserProcess);
    if (vite) await vite.close();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

await main();
