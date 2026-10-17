import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const regressionScript = path.join(testsDir, "supplier-order-print.browser.mjs");

for (const browser of ["chromium", "firefox"]) {
  const result = spawnSync(process.execPath, [regressionScript], {
    env: { ...process.env, SUPPLIER_ORDER_PRINT_BROWSER: browser },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
