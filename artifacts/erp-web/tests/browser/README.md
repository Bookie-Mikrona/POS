# Journal dimension table regression

## Asset account keyboard regression

```sh
CHROMIUM_PATH="$(command -v chromium)" pnpm --filter @workspace/erp-web run test:os-accounts:browser
```

Runs Chromium at desktop and narrow widths, for both new and existing assets.
The isolated loopback Vite harness mounts the real `OsDialog` and `OsCombobox`,
stylesheet, Radix dialogs/popovers and cmdk. Only identity is substituted in the
test server; application authentication and normal Vite configuration are untouched.
No API, credentials or database are needed, and any API request fails the test.

All user actions use the keyboard (no clicks, scripted focus or fill): Tab to
both labelled account fields, code search with two matching accounts, ArrowDown /
ArrowUp and Enter selection, focus return, Escape with no matches without closing
the asset form or losing edits, and independent resets to module defaults.
The final save callback is checked against the complete current form state.
This verifies component interaction, not signed-in routing or backend persistence.
Failure screenshots and traces go to `generated-artifacts/os-accounts/`.

## Journal dimension table

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
