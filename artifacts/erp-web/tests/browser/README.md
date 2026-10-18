# Journal dimension table regression

From the workspace root:

```sh
CHROMIUM_PATH="$(command -v chromium)" pnpm --filter @workspace/erp-web run test:dimensions:browser
```

With Playwright's installed Chromium, omit `CHROMIUM_PATH`. The command runs at
1440 × 1000 and 390 × 844. It starts and closes its own loopback-only Vite test
server; no running API, login credentials or database fixtures are required.

The harness mounts the real `temeljnice.tsx` page, generated API hooks, stylesheet,
table, dimension badges and detail sheet. Only identity context is replaced in
the test-only server. All API requests are intercepted with synthetic responses;
unexpected endpoints or writes fail the test. Nothing is added to the normal app
configuration or authentication flow.

Coverage includes nine long dimension names, empty and omitted dimension arrays,
the separate Dimenzije column, eight correctly aligned cells per row, full
accessible labels and titles, text containment, horizontal scroll reachability,
and opening the correct detail sheet/API ID from each row, including a badge click.

Failure screenshots and traces are written under
`generated-artifacts/journal-dimensions/`, outside version control and deployment.
These tests are separate from the jsdom/Vitest suites because layout assertions
need actual browser geometry.
