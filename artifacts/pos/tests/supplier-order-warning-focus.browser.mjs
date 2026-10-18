import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(testsDir, "..");
const apiMockPath = path.join(testsDir, "browser", "supplier-order-warning-api-mock.ts");
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
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function waitForEvent(devTools, eventName, timeoutMilliseconds = 5_000) {
  let unsubscribe = () => {};
  let timeout;
  const eventPromise = new Promise(resolve => {
    unsubscribe = devTools.onEvent(eventName, params => resolve(params));
    timeout = setTimeout(() => resolve(null), timeoutMilliseconds);
  });
  return eventPromise.finally(() => {
    clearTimeout(timeout);
    unsubscribe();
  });
}

function connectDevTools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const eventListeners = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools.")), { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of eventListeners.get(message.method) ?? []) {
      listener(message.params);
    }
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error("Chromium DevTools connection closed."));
    pending.clear();
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(method, listener) {
      const listeners = eventListeners.get(method) ?? new Set();
      listeners.add(listener);
      eventListeners.set(method, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) eventListeners.delete(method);
      };
    },
    close() {
      socket.close();
    },
  };
}

async function findPageTarget(browserProcess, profileDir, logs) {
  const activePortPath = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chromium exited before DevTools was ready:\n${logs.join("")}`);
    }
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).split("\n");
      const response = await fetch(`http://127.0.0.1:${Number(portLine)}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find(target => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // Chromium creates its DevTools endpoint asynchronously during startup.
    }
    await delay(100);
  }
  throw new Error(`Chromium DevTools did not start in time:\n${logs.join("")}`);
}

async function waitForExpression(devTools, expression, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await devTools.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result?.value) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function evaluate(devTools, expression) {
  const result = await devTools.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function pressTab(devTools, shiftKey = false) {
  const modifiers = shiftKey ? 8 : 0;
  for (const type of ["keyDown", "keyUp"]) {
    await devTools.send("Input.dispatchKeyEvent", {
      type,
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      modifiers,
    });
  }
}

async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

const chromium = process.env.CHROMIUM_BIN ?? "/repl/tools/bin/chromium";
if (!existsSync(chromium)) {
  throw new Error(`Chromium was not found at ${chromium}; set CHROMIUM_BIN to a browser executable.`);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "supplier-order-warning-focus-"));
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
    resolve: {
      alias: [
        { find: "@workspace/api-client-react", replacement: apiMockPath },
      ],
    },
    optimizeDeps: {
      exclude: ["@workspace/api-client-react"],
    },
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await vite.listen();

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
  ], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  browserProcess.stderr.setEncoding("utf8");
  browserProcess.stderr.on("data", chunk => browserLogs.push(chunk));

  const pageTarget = await findPageTarget(browserProcess, profileDir, browserLogs);
  devTools = connectDevTools(pageTarget.webSocketDebuggerUrl);
  await devTools.ready;
  await devTools.send("Page.enable");
  await devTools.send("Runtime.enable");
  const pageErrors = [];
  devTools.onEvent("Runtime.exceptionThrown", params => {
    pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Unknown page error");
  });

  const url = `http://127.0.0.1:${port}/pos/tests/browser/supplier-order-warning-focus.html`;
  const navigation = await devTools.send("Page.navigate", { url });
  assert(!navigation.errorText, `Chromium could not navigate to the warning fixture: ${navigation.errorText}`);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="tab-supplier-orders"]'))`,
    "supplier orders tab",
  );
  assert.deepEqual(pageErrors, [], `Browser page errors before interaction: ${pageErrors.join("; ")}`);

  const mutationCountKey = "supplier-order-warning-test-mutation-count";
  await evaluate(devTools, `window.sessionStorage.setItem(${JSON.stringify(mutationCountKey)}, "0")`);
  await evaluate(devTools, `Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Novo naročilo"))?.click()`);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="supplier-order-editor-backdrop"]'))`,
    "clean supplier-order editor",
  );

  const cleanReloadLoad = waitForEvent(devTools, "Page.loadEventFired", 15_000);
  const cleanReloadPrompt = waitForEvent(devTools, "Page.javascriptDialogOpening", 1_500);
  const cleanReload = devTools.send("Page.reload");
  const unexpectedCleanPrompt = await cleanReloadPrompt;
  if (unexpectedCleanPrompt) {
    await devTools.send("Page.handleJavaScriptDialog", { accept: false });
  }
  assert.equal(unexpectedCleanPrompt, null, "A clean supplier-order editor must not trigger a native browser warning.");
  await Promise.all([cleanReload, cleanReloadLoad]);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="tab-supplier-orders"]'))`,
    "supplier orders tab after a clean reload",
  );

  await evaluate(devTools, `Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Novo naročilo"))?.click()`);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="supplier-order-editor-backdrop"]'))`,
    "supplier-order editor before editing",
  );
  const editedInstruction = "Dostavite pred 12. uro.";
  const instructionFieldExpression = `Array.from(document.querySelectorAll("textarea")).find(field => field.closest("label")?.textContent.includes("Navodilo dobavitelju"))`;
  await evaluate(devTools, `${instructionFieldExpression}?.focus()`);
  await devTools.send("Input.insertText", { text: editedInstruction });
  assert.equal(
    await evaluate(devTools, `${instructionFieldExpression}?.value ?? null`),
    editedInstruction,
    "Typing into the supplier instruction should change the draft.",
  );

  const cancelReload = devTools.send("Page.reload");
  const cancelPrompt = await waitForEvent(devTools, "Page.javascriptDialogOpening");
  assert(cancelPrompt, "Editing a supplier-order field should trigger the native browser warning on reload.");
  if (cancelPrompt.type !== "beforeunload") {
    await devTools.send("Page.handleJavaScriptDialog", { accept: false });
  }
  assert.equal(cancelPrompt.type, "beforeunload", "The browser should show its native beforeunload prompt.");
  await devTools.send("Page.handleJavaScriptDialog", { accept: false });
  await cancelReload;
  await waitForExpression(
    devTools,
    `${instructionFieldExpression}?.value === ${JSON.stringify(editedInstruction)}`,
    "the edited supplier instruction after canceling the native warning",
  );
  assert.equal(
    await evaluate(devTools, `window.sessionStorage.getItem(${JSON.stringify(mutationCountKey)})`),
    "0",
    "Canceling the native warning must not save the changed order.",
  );

  const acceptedReloadLoad = waitForEvent(devTools, "Page.loadEventFired", 15_000);
  const acceptedReload = devTools.send("Page.reload");
  const acceptPrompt = await waitForEvent(devTools, "Page.javascriptDialogOpening");
  assert(acceptPrompt, "The native browser warning should remain active after canceling a departure.");
  if (acceptPrompt.type !== "beforeunload") {
    await devTools.send("Page.handleJavaScriptDialog", { accept: false });
  }
  assert.equal(acceptPrompt.type, "beforeunload", "Confirming departure should resolve the native beforeunload prompt.");
  await devTools.send("Page.handleJavaScriptDialog", { accept: true });
  await Promise.all([acceptedReload, acceptedReloadLoad]);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="tab-supplier-orders"]'))`,
    "supplier orders page after confirming departure",
  );
  assert.equal(
    await evaluate(devTools, `window.sessionStorage.getItem(${JSON.stringify(mutationCountKey)})`),
    "0",
    "Confirming departure must not save the changed order automatically.",
  );
  assert.equal(
    await evaluate(devTools, `Boolean(document.querySelector('[data-testid="supplier-order-editor-backdrop"]'))`),
    false,
    "Confirming departure should leave the editor closed after the reload.",
  );

  await evaluate(devTools, `document.querySelector('[data-testid="tab-supplier-orders"]').click()`);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="button-open-supplier-order-704"]'))`,
    "supplier order row",
  );
  await evaluate(devTools, `document.querySelector('[data-testid="button-open-supplier-order-704"]').click()`);
  await waitForExpression(
    devTools,
    `Boolean(document.querySelector('[data-testid="button-print-supplier-order-704"]'))`,
    "supplier order detail",
  );
  await evaluate(devTools, `document.querySelector('[data-testid="button-print-supplier-order-704"]').click()`);
  await waitForExpression(devTools, `Boolean(document.querySelector('[role="alertdialog"]'))`, "print warning");

  const warningActions = [
    "button-dismiss-supplier-order-print-warning",
    "button-edit-supplier-order-from-print-warning",
    "button-continue-supplier-order-print",
  ];
  const printButtonId = "button-print-supplier-order-704";
  const backgroundButtonId = "button-close-supplier-order-detail";
  const warningFocused = await evaluate(
    devTools,
    `document.activeElement?.getAttribute('role') === "alertdialog"`,
  );
  assert.equal(warningFocused, true, "Opening the warning should focus the alert dialog.");

  const expectedFocusOrder = [
    warningActions[0],
    warningActions[1],
    warningActions[2],
    warningActions[0],
    warningActions[2],
    warningActions[1],
    warningActions[0],
    warningActions[2],
  ];
  const keyDirections = [false, false, false, false, true, true, true, true];
  for (let index = 0; index < expectedFocusOrder.length; index += 1) {
    await pressTab(devTools, keyDirections[index]);
    const activeTestId = await evaluate(
      devTools,
      `document.activeElement?.getAttribute('data-testid') ?? null`,
    );
    assert.equal(
      activeTestId,
      expectedFocusOrder[index],
      `${keyDirections[index] ? "Shift+Tab" : "Tab"} should focus ${expectedFocusOrder[index]}, got ${activeTestId}.`,
    );
    const focusStayedInWarning = await evaluate(devTools, `
      (() => {
        const warning = document.querySelector('[role="alertdialog"]');
        const active = document.activeElement;
        return Boolean(warning && active && warning.contains(active));
      })()
    `);
    assert.equal(focusStayedInWarning, true, "Tab focus must remain inside the print warning.");
    assert.notEqual(activeTestId, printButtonId, "The obscured print button must not be reachable while the warning is open.");
    assert.notEqual(activeTestId, backgroundButtonId, "Background content must not be reachable while the warning is open.");
  }

  await evaluate(devTools, `document.querySelector('[data-testid="${warningActions[0]}"]').click()`);
  await waitForExpression(
    devTools,
    `document.activeElement?.getAttribute('data-testid') === "${printButtonId}"`,
    "focus restoration to the print button",
  );
  assert.equal(
    await evaluate(devTools, `Boolean(document.querySelector('[role="alertdialog"]'))`),
    false,
    "The warning should close after returning to the order.",
  );
  assert.deepEqual(pageErrors, [], `Browser page errors during interaction: ${pageErrors.join("; ")}`);
  console.log("Supplier-order beforeunload and warning-focus regressions passed in real Chromium: clean drafts reload silently, changed drafts show the native prompt, and cancel/confirm preserve the expected save behavior.");
} finally {
  devTools?.close();
  await stopProcessGroup(browserProcess);
  await vite?.close();
  await rm(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
