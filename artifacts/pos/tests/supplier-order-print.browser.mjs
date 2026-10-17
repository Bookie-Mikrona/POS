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
  return value.normalize("NFC").replace(/[\s\u00a0\u202f]+/g, " ").trim();
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
          script: `return Boolean(document.querySelector('[data-testid="text-supplier-order-print-instructions"]')?.textContent?.includes("KONEC-NAVODILA-100"))`,
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

    const url = `http://127.0.0.1:${port}/pos/tests/browser/supplier-order-print.html`;
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
          expression: `Boolean(document.querySelector('[data-testid="text-supplier-order-print-instructions"]')?.textContent?.includes("KONEC-NAVODILA-100"))`,
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
    const tablePages = pages.filter(page => /POSTAVKA-\d{3}/.test(page));
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

    for (let number = 1; number <= 55; number += 1) {
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

    const boundingBoxes = run(process.env.PDFTOTEXT_BIN ?? "pdftotext", ["-bbox-layout", pdfPath, "-"]);
    const pdfPages = [...boundingBoxes.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
    assert.equal(pdfPages.length, pageCount, "PDF text geometry page count differs from pdfinfo.");

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

    console.log(`Supplier-order print ${selectedBrowser} regression passed: ${pageCount} PDF pages, ${tablePages.length} table pages, ${notePages.length} note pages, 55 rows, and 100 note paragraphs.`);
  } finally {
    devTools?.close();
    await stopProcessGroup(browserProcess);
    if (vite) await vite.close();
    await rm(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

await main();
