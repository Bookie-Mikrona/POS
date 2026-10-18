import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test, expect } from "@playwright/test";
import { companyId, period, entries, dimensionGroups } from "./journal-dimensions-fixtures.mjs";

let server;
let origin;

test.beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  // Test-only server: no application login bypass, fixture route or mock is
  // included in the normal Vite config or production entry point.
  server = await createServer({
    configFile: false, root, base: "/", logLevel: "error",
    cacheDir: "node_modules/.vite-journal-dimensions",
    plugins: [
      {
        name: "isolated-journal-identity",
        enforce: "pre",
        resolveId(id) {
          if (id === "test-clerk") return "\0test-clerk";
        },
        load(id) {
          if (id === "\0test-clerk") return "export const useAuth = () => ({ getToken: async () => null });";
          if (id === path.join(root, "src/contexts/CompanyContext.tsx")) return `export const useCompany = () => ({
            activeCompany: { id: ${JSON.stringify(companyId)}, role: "owner" }
          });`;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml("/", `<!doctype html><html lang="sl">
              <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
              <body><div id="root"></div><script type="module"
              src="/tests/browser/journal-dimensions-harness.tsx"></script></body></html>`));
          });
        },
      },
      react(), tailwindcss({ optimize: false }),
    ],
    resolve: {
      alias: [
        { find: "@clerk/react", replacement: "test-clerk" },
        { find: "@", replacement: path.join(root, "src") },
      ],
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: { exclude: ["@clerk/react", "test-clerk"] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
});

test.afterAll(async () => { await server?.close(); });

test("celotna tabela ohrani vse dimenzije, poravnavo in pravilno odpiranje", async ({ page }) => {
  const errors = [];
  const detailRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  // Every API request must be synthetic, read-only and explicitly accounted for.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.method()).toBe("GET");
    const prefix = `/api/companies/${companyId}`;
    const responses = {
      [`${prefix}/periods`]: { periods: [period] },
      [`${prefix}/cost-centers`]: { costCenters: [] },
      [`${prefix}/projects`]: { projects: [] },
      [`${prefix}/departments`]: { departments: [] },
      [`${prefix}/entries`]: {
        entries: url.searchParams.get("status") === "draft"
          ? entries.filter(entry => entry.status === "draft") : entries,
      },
    };
    const entry = entries.find(entry => url.pathname === `${prefix}/entries/${entry.id}`);
    if (entry) {
      detailRequests.push(entry.id);
      await route.fulfill({ json: { ...entry, lines: [] } });
    } else {
      expect(Object.keys(responses), `Unexpected API request: ${url.pathname}`).toContain(url.pathname);
      await route.fulfill({ json: responses[url.pathname] });
    }
  });
  await page.goto(origin);
  const table = page.getByRole("table");
  await expect(table).toHaveCount(1);
  const headers = table.getByRole("columnheader");
  await expect(headers).toHaveText(["Datum", "Opis", "Dimenzije", "Referenca", "Izvor", "Obdobje", "Status", "Dejanja"]);
  await expect(table.locator("tbody > tr")).toHaveCount(entries.length);

  for (const entry of entries) {
    const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: entry.description, exact: true }) });
    const cells = row.getByRole("cell");
    await expect(cells).toHaveCount(8);
    await expect(cells.nth(1)).toHaveText(entry.description);
    await expect(cells.nth(3)).toHaveText(entry.reference);
    await expect(cells.nth(4)).toHaveText("Ročno");
    await expect(cells.nth(5)).toHaveText(period.name);
    await expect(cells.nth(6)).toHaveText(entry.status === "draft" ? "Osnutek" : "Knjiženo");
    await expect(cells.nth(7).getByRole("button", {
      name: entry.status === "draft" ? "Poknjiži" : "Storno", exact: true,
    })).toBeVisible();
    const dimensionCell = cells.nth(2);
    if (entry.id === "many-long-dimensions") {
      await expect(dimensionCell.locator("[aria-label]")).toHaveCount(9);
      for (const [type, names] of dimensionGroups) {
        for (const name of names) {
          const label = `${type}: ${name}`;
          const badge = dimensionCell.getByLabel(label, { exact: true });
          await badge.scrollIntoViewIfNeeded();
          await expect(badge).toBeVisible();
          await expect(badge).toHaveText(name);
          await expect(badge).toHaveAttribute("title", label);
          // No truncated, clipped or overlapping labels: use actual browser
          // geometry rather than jsdom's zero-sized rectangles.
          const geometry = await badge.evaluate(el => {
            const box = el.getBoundingClientRect();
            const cell = el.closest("td").getBoundingClientRect();
            const text = document.createRange();
            text.selectNodeContents(el);
            return {
              contained: box.left >= cell.left && box.right <= cell.right + 1 &&
                box.top >= cell.top && box.bottom <= cell.bottom + 1,
              fits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
              textFits: [...text.getClientRects()].every(rect =>
                rect.left >= box.left - 1 && rect.right <= box.right + 1),
              inViewport: box.left >= 0 && box.right <= innerWidth + 1,
            };
          });
          expect(geometry).toEqual({ contained: true, fits: true, textFits: true, inViewport: true });
        }
      }
    } else {
      await expect(dimensionCell).toBeEmpty();
    }
    // Each data cell must share the horizontal boundaries of its own header,
    // including the cells after Dimenzije on both populated and empty rows.
    const aligned = await row.evaluate(el => {
      const heads = el.closest("table").querySelectorAll("thead th");
      return [...el.cells].every((cell, index) => {
        const a = cell.getBoundingClientRect();
        const b = heads[index].getBoundingClientRect();
        return Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1;
      });
    });
    expect(aligned).toBe(true);
  }

  // On a phone, the last cell remains reachable via the table's scroll area.
  const lastAction = table.locator("tbody > tr").first().getByRole("button", { name: "Storno", exact: true });
  await lastAction.scrollIntoViewIfNeeded();
  expect(await lastAction.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 1;
  })).toBe(true);

  // Click a dimension badge as well as both dimensionless rows, then verify
  // the real detail sheet AND the requested entry ID (not just its heading).
  for (const entry of [...entries].reverse()) {
    const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: entry.description, exact: true }) });
    const target = entry.id === "many-long-dimensions"
      ? row.getByLabel(`Projekt: ${entry.projectNames[1]}`, { exact: true })
      : row.getByRole("cell").nth(2);
    await target.click();
    const detail = page.getByRole("dialog", { name: "Detajli temeljnice" });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`ID: ${entry.id}`);
    await expect(detail).toContainText(entry.description);
    await expect(detail).toContainText(entry.reference);
    await expect.poll(() => detailRequests.includes(entry.id)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  }
  expect(detailRequests).toEqual([...entries].reverse().map(entry => entry.id));
  expect(errors).toEqual([]);
});
