import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(testsDir, "..");
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
    waitForEvent(method, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        const listeners = eventListeners.get(method) ?? new Set();
        const onEvent = params => {
          clearTimeout(timeout);
          listeners.delete(onEvent);
          if (listeners.size === 0) eventListeners.delete(method);
          resolve(params);
        };
        const timeout = setTimeout(() => {
          listeners.delete(onEvent);
          if (listeners.size === 0) eventListeners.delete(method);
          reject(new Error(`Timed out waiting for Chromium event ${method}.`));
        }, timeoutMs);
        listeners.add(onEvent);
        eventListeners.set(method, listeners);
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

async function main() {
  const chromium = process.env.CHROMIUM_BIN ?? "/repl/tools/bin/chromium";
  if (!existsSync(chromium)) {
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

    const pageLoaded = devTools.waitForEvent("Page.loadEventFired");
    await devTools.send("Page.navigate", { url });
    await pageLoaded;

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

    const pdfInfo = run(process.env.PDFINFO_BIN ?? "pdfinfo", [pdfPath]);
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
    assert(Number.isInteger(pageCount) && pageCount >= 3, `Expected a multi-page PDF; got ${pageCount} pages.`);

    const extracted = run(process.env.PDFTOTEXT_BIN ?? "pdftotext", ["-layout", pdfPath, "-"]);
    const normalizedPdfText = normalizeText(extracted);
    const pages = extracted.split("\f").map(normalizeText).filter(Boolean);
    assert.equal(pages.length, pageCount, "Extracted PDF page count differs from pdfinfo.");
    const tablePages = pages.filter(page => /POSTAVKA-\d{3}/.test(page));
    const notePages = pages.filter(page => /NAVODILO-\d{3}/.test(page));
    assert(tablePages.length >= 2, `Expected table rows on multiple pages; got ${tablePages.length} table pages.`);
    assert(notePages.length >= 2, `Expected long supplier instructions to continue across pages; got ${notePages.length} note pages.`);

    const headerLabels = ["artikel", "pakiranje", "količina paketov", "cena paketa", "znesek"];
    for (const [index, page] of tablePages.entries()) {
      const normalizedPage = page.toLocaleLowerCase("sl");
      for (const label of headerLabels) {
        assert(
          normalizedPage.includes(label),
          `Table page ${index + 1} is missing its repeated header label "${label}".`,
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

    for (let number = 1; number <= 100; number += 1) {
      const marker = `NAVODILO-${String(number).padStart(3, "0")}`;
      assert(normalizedPdfText.includes(marker), `Printed PDF is missing long-note section ${marker}.`);
    }
    assert(normalizedPdfText.includes("KONEC-NAVODILA-100"), "The end of the long supplier instruction is missing.");
    assert(!normalizedPdfText.includes("INTERNAL-NOTE-MUST-NOT-PRINT"), "Internal note leaked into the PDF.");

    const boundingBoxes = run(process.env.PDFTOTEXT_BIN ?? "pdftotext", ["-bbox-layout", pdfPath, "-"]);
    const pdfPages = [...boundingBoxes.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
    assert.equal(pdfPages.length, pageCount, "PDF text geometry page count differs from pdfinfo.");

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

      for (const line of match[2].matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/g)) {
        const words = [...line[1].matchAll(/<word\b([^>]*)>/g)]
          .map(word => readAttributes(word[1]))
          .sort((left, right) => Number(left.xMin) - Number(right.xMin));
        for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
          assert(
            Number(words[wordIndex].xMin) >= Number(words[wordIndex - 1].xMax) - 0.5,
            `Text overlaps on page ${pageIndex + 1}.`,
          );
        }
      }
    }

    console.log(`Supplier-order print browser regression passed: ${pageCount} PDF pages, ${tablePages.length} table pages, ${notePages.length} note pages, 55 rows, and 100 note paragraphs.`);
  } finally {
    devTools?.close();
    if (browserProcess && browserProcess.exitCode === null) {
      const exited = new Promise(resolve => browserProcess.once("exit", resolve));
      browserProcess.kill("SIGTERM");
      await Promise.race([exited, delay(5_000)]);
      if (browserProcess.exitCode === null) browserProcess.kill("SIGKILL");
    }
    if (vite) await vite.close();
    await rm(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

await main();
