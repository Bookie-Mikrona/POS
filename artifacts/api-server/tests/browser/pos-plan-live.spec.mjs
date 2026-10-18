import assert from "node:assert/strict";
import { chromium, expect, test } from "@playwright/test";
import { withPlanFixture, signIn } from "./pos-plan-fixture.mjs";
import { observeSession } from "./pos-plan-observer.mjs";

test("Extended → Lite → Extended refreshes two open POS sessions, not another company", async () => {
  await withPlanFixture(async ({ users, companies, origin, registerBrowser }) => {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    });
    registerBrowser(browser);
    const contexts = await Promise.all(users.map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const [admin, ...posPages] = pages;
    const sessions = posPages.map((page, i) => {
      const company = companies[i === 2 ? 1 : 0];
      return observeSession(page, company.id, company.unit.id);
    });
    await Promise.all([
      signIn(admin, users[0], origin, "superadmin"),
      ...posPages.map((page, i) => signIn(page, users[i + 1], origin, "nastavitve")),
    ]);
    let baselines = await Promise.all(sessions.map(session => session.baseline()));
    // Real company card and Radix selector; no direct PUT, fake SSE or auth mock.
    const companyButton = admin.getByRole("button").filter({ hasText: companies[0].naziv });
    await expect(companyButton).toHaveCount(1);
    await companyButton.click();
    const card = companyButton.locator("..");
    const selector = card.getByRole("combobox");
    await expect(selector).toHaveText("Extended");

    for (const [plan, label] of [["lite", "Lite"], ["extended", "Extended"]]) {
      // onRefresh unmounts the cards while loading and remounts them collapsed.
      // Reopen the real card, never navigate/reload any of the POS sessions.
      await expect(companyButton).toBeVisible();
      if (!(await selector.isVisible())) await companyButton.click();
      await expect(selector).toHaveText(plan === "lite" ? "Extended" : "Lite");
      const endpoint = `/api/superadmin/podjetja/${companies[0].id}/pos-paket`;
      // Both listeners MUST be armed before either UI action.
      const requestPromise = admin.waitForRequest(request =>
        new URL(request.url()).pathname.replace(/^\/pos\/api\//, "/api/") === endpoint && request.method() === "PUT");
      const responsePromise = admin.waitForResponse(response =>
        new URL(response.url()).pathname.replace(/^\/pos\/api\//, "/api/") === endpoint && response.request().method() === "PUT");
      await selector.click();
      await admin.getByRole("option", { name: label, exact: true }).click();
      const [request, response] = await Promise.all([requestPromise, responsePromise]);
      assert.deepEqual(request.postDataJSON(), { plan });
      assert.equal(response.status(), 200, "real UI plan PUT must succeed");
      const body = await response.json();
      assert.equal(body.companyId, companies[0].id);
      assert.equal(body.plan, plan);
      await expect(admin.getByText("POS paket posodobljen", { exact: true })).toBeVisible();
      await expect(companyButton).toContainText(`POS ${label}`);
      // Measure all contexts concurrently, including the no-change control.
      try {
        baselines = await Promise.all(sessions.map((session, i) =>
          session.transition(baselines[i], i < 2 ? 1 : 0, i < 2 ? plan : "extended")));
      } catch (error) {
        console.log(JSON.stringify({
          failedTransition: plan,
          sessions: sessions.map(session => ({
            ...session.snapshot(), lastPlan: session.state.auth.at(-1)?.body.posPlan,
            pendingPaths: [...session.state.activeApi.values()],
          })),
        }));
        throw error;
      }
      console.log(JSON.stringify({
        transition: plan, put: { status: response.status(), plan: body.plan },
        sessions: baselines,
      }));
    }
    await expect(admin.getByRole("button").filter({ hasText: companies[1].naziv })).toContainText("POS Extended");
  });
});
