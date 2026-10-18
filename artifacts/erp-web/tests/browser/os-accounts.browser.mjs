import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test, expect } from "@playwright/test";

let server;
let origin;

test.beforeAll(async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  // Only this loopback test server substitutes identity. Real OsDialog,
  // OsCombobox, Radix portals/focus scopes and cmdk all run unmodified.
  server = await createServer({
    configFile: false, root, base: "/", logLevel: "error",
    cacheDir: "node_modules/.vite-os-accounts",
    plugins: [
      {
        name: "isolated-os-accounts",
        enforce: "pre",
        resolveId(id) {
          if (id === "test-clerk") return "\0test-clerk";
        },
        load(id) {
          if (id === "\0test-clerk") return "export const useAuth = () => ({ getToken: async () => null });";
          if (id === path.join(root, "src/contexts/CompanyContext.tsx"))
            return "export const useCompany = () => ({});";
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (new URL(req.url, "http://test").pathname !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml("/", `<!doctype html><html lang="sl">
              <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
              <body><div id="root"></div><script type="module"
              src="/tests/browser/os-accounts-harness.tsx"></script></body></html>`));
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

// Never focus(), click() or fill(): even reaching a trigger must use real Tab.
async function tabTo(page, target) {
  for (let n = 0; n < 40; n++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

for (const editing of [false, true]) {
  test(`${editing ? "urejanje" : "novo sredstvo"}: konta samo s tipkovnico`, async ({ page }) => {
    const errors = [];
    const requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
    });
    await page.goto(`${origin}/${editing ? "?edit" : ""}`);
    await tabTo(page, page.getByRole("button", { name: "Odpri sredstvo" }));
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: editing ? "Uredi osnovno sredstvo" : "Novo osnovno sredstvo", exact: true,
    });
    await expect(dialog).toBeVisible();
    const name = dialog.getByPlaceholder("npr. Osebno vozilo Golf");
    await tabTo(page, name);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Stroj - tipkovnica");
    const state = async () => JSON.parse(await page.getByTestId("form").textContent());
    const defaults = "— privzeto iz nastavitev modula —";
    const fields = [
      { label: "Konto stroška amortizacije", field: "kontoStroskaId", code: "432000",
        selected: "4320001 — Amortizacija strojev", id: "expense-2", old: "4320000" },
      { label: "Konto popravka vrednosti", field: "kontoPopravkaId", code: "050000",
        selected: "0500001 — Popravek vrednosti strojev", id: "correction-2", old: "0500000" },
    ];
    for (const field of fields) {
      const trigger = page.getByRole("combobox", { name: field.label, exact: true });
      await expect(trigger).toHaveText(editing ? new RegExp(field.old) : defaults);
      await tabTo(page, trigger);
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const search = page.getByPlaceholder("Išči konto…");
      await expect(search).toBeFocused();
      await page.keyboard.type(field.code);
      const options = page.getByRole("option");
      await expect(options).toHaveCount(2);
      await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
      await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowUp");
      await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveText(field.selected);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
      expect((await state())[field.field]).toBe(field.id);
      await expect(dialog).toBeVisible();

      // Escape dismisses only the nested popover, not the enclosing form.
      const beforeEscape = await state();
      await page.keyboard.press("Space");
      await expect(search).toBeFocused();
      await page.keyboard.type("9999999");
      await expect(page.getByText("Ni zadetkov.", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(search).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(dialog).toBeVisible();
      expect(await state()).toEqual(beforeEscape);
      await expect(name).toHaveValue("Stroj - tipkovnica");
    }

    // Reset each override independently, preserving every other form field.
    for (const field of fields) {
      const trigger = page.getByRole("combobox", { name: field.label, exact: true });
      await tabTo(page, trigger);
      const beforeReset = await state();
      await page.keyboard.press("Enter");
      const search = page.getByPlaceholder("Išči konto…");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("option")).toHaveCount(5);
      await page.keyboard.press("Home");
      await expect(page.getByRole("option", { name: defaults, exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveText(defaults);
      expect(await state()).toEqual({ ...beforeReset, [field.field]: "" });
    }
    await tabTo(page, dialog.getByRole("button", { name: editing ? "Posodobi" : "Shrani", exact: true }));
    await page.keyboard.press("Enter");
    await expect.poll(async () => JSON.parse(await page.getByTestId("saved").textContent()))
      .toEqual(await state());
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
