# ERP browser regressions

## Amortization conflict → existing journal details

With the ERP development preview running:

```sh
pnpm --filter @workspace/erp-web run test:amortization:navigation
```

Uses real development Clerk sign-in with a disposable user and one-use ticket,
the actual protected routes, company selector, amortization dialog, journal page
and detail sheet. Refuses non-test Clerk keys and removes the user in `finally`.
Requires Chromium (`CHROMIUM_PATH` overrides `/repl/tools/bin/chromium`).
No auth bypass, saved session, identity mocks or database changes are used.

All business API calls are intercepted and fail closed. Only the exact synthetic
preview and confirmation POST payloads are allowed; confirmation returns HTTP
409. Unexpected endpoints and other writes fail the run and never reach the
backend. Clerk traffic remains real. This verifies frontend behavior, not backend
amortization calculations or authorization.

Checks both draft and posted conflicts plus a mixed conflict where the second
link must open the second entry. The real journal controls persist **2026 /
Osnutek**, excluding the **2025** target entries from list responses. After
**Odpri obstoječo temeljnico**, the amortization modal must unmount and the real
detail sheet must display the exact ID, status, period, reference, description,
accounts, debit/credit lines and totals. Company and Clerk session stay unchanged.

Synthetic signed-in screenshots and `results.txt` are stored only under ignored,
non-deployed `generated-artifacts/amortization-existing-entry/`. No auth state,
SDK errors, tokens, session values or traces are recorded.

Verified on 2026-10-18: all three signed-in scenarios passed, as did the four
existing amortization-conflict component tests. The temporary Clerk user was
removed successfully. Signed-in journal details were visually inspected.

## Signed-in financial-statement Excel downloads

```sh
pnpm --filter @workspace/erp-web run test:financial-statements:browser
```

Requires the running ERP development preview, existing development Clerk secrets
and Chromium (`CHROMIUM_PATH` overrides `/repl/tools/bin/chromium`). Refuses live
Clerk keys. Creates one disposable Clerk user, signs in with a real one-use ticket
in a fresh browser context, and deletes the user in `finally`. No auth bypass,
mocked identity hooks, saved login state or credentials are added to the app.

The real protected `/porocila` page is checked at 1440px and 390px. For both
Bilanca stanja and Izkaz poslovnega izida, actual browser downloads are saved and
reopened with ExcelJS. Checks company, applied dates and comparison dates, account
text/codes, numeric totals and formats after all draft dates and the comparison
checkbox have changed without applying. The export button must fit the viewport,
accept keyboard activation, recover after an injected Blob URL allocation error
without a partial download, and successfully download on retry.

Business API responses alone are synthetic and fail-closed; unexpected requests
and all financial writes fail the test. This verifies live Clerk sign-in and
frontend request scoping, not backend report calculations or tenant authorization.
No SDK errors, login tickets, session state or browser traces are recorded.
XLSX files, synthetic signed-in screenshots and `results.txt` are stored only in
ignored/non-deployed `generated-artifacts/financial-statements-excel/`.

## Large dimension-report Excel export

```sh
node artifacts/erp-web/e2e/dimension-report-excel.browser.mjs
```

Runs an isolated, disposable Vite test server and Chromium using the real report
page, styles, module worker and ExcelJS. Only company/report hooks are fixtures;
the production app's authentication is unchanged. This is not a signed-in or
backend authorization test. Requires installed development `puppeteer-core` and
Chromium (`CHROMIUM_PATH` can override its location).

Checks 20,000 dimensions with 150-character Slovenian names, every downloaded
code/name, the final debit/credit/balance totals and exact worksheet row count.
During export, a 20ms heartbeat must have no gap above 1 second and the print
control must respond within 1 second. These are regression ceilings, not a
guarantee for every device. Records actual timing in
`generated-artifacts/dimension-report-excel/results.json`.

Oversize row/text fixtures and an injected worker-allocation failure must show
an error without a partial download. The button is re-enabled and retry after
failure must complete. Allocation failure is simulated, not a deliberate
browser-wide out-of-memory crash. The workbook/worker unit tests also cover
message deserialization failure, cloning failure, timeout, and Excel's cell limit.
Downloads and screenshots remain in the ignored `generated-artifacts/` directory.

## Bank-import session recovery

### Live-browser regression

Run against the running ERP development preview from the workspace root:

```sh
node artifacts/erp-web/e2e/bank-import-session.browser.mjs
```

The script requires the existing development Clerk configuration, Chromium and
`puppeteer-core` in the development tooling. It refuses production Clerk keys.
It creates two disposable test users and removes them in `finally`, including
when an assertion fails. No credentials, tickets or session IDs are recorded.

Authentication is **not mocked**. Sign-in uses real Clerk one-use tickets and
`setActive`; logout uses the application's actual **Odjava** menu item.
`ClerkProvider`, protected routing, `CompanyProvider`, browser storage and the
bank-import page are the real application. This does not test entering a
password, email verification, or an external OAuth provider.

Only business API responses are intercepted with synthetic companies, accounts,
partners, invoices and statement lines. The script counts attempted financial
writes and requires zero. It does not prove backend tenant authorization or live
bank-file parsing; those are separate from session recovery.

The checks cover:

- Starting an upload and changing a row to a standalone transaction with a
  partner and a nondefault account, while preserving an accepted invoice match.
- Real logout, a full page reload while signed out, and denial of the protected
  bank-import route to the anonymous visitor.
- Real sign-in as the same user with a different session ID, without choosing
  the company again: company, review, accounts, period and decisions must restore.
- A second real Clerk user selecting the same company cannot inherit the review.
- Another company cannot inherit the original review, including across another
  logout/reload/login. Returning to the original company preserves its review.
- Recovery neither reparses/rematches the statement nor attempts payment writes.

### Recorded verification

On 2026-10-18 the command exited successfully with all five browser checks
passing, using the ERP's actual protected `/bancni-izpis` route. Both temporary
Clerk users were removed successfully. The restored signed-in page was also
visually inspected.

Run evidence is written under the ignored, non-deployed directory
`generated-artifacts/bank-import-session/`:

- `results.txt`: assertion results without identity or credential values.
- `restored-review.png`: the synthetic restored review.
- `failure-page.txt` and `failure.png`: diagnostic output if a run fails.

## Complementary component regressions

```sh
pnpm --filter @workspace/erp-web exec vitest run \
  src/pages/bancni-izpis.session.test.tsx \
  src/pages/bancni-izpis.matching.test.ts \
  src/pages/bancni-izpis.invalid-accounts.test.tsx \
  src/pages/bancni-izpis.dimensions.test.tsx \
  src/pages/bancni-izpis.accounts.test.tsx \
  src/lib/bank-import-dimensions.test.ts \
  src/lib/bank-import-draft.test.ts
```

These 67 tests passed after integration with partial-import recovery,
scoped posting-failure recovery, and departure protection for unsaved warnings.
Unlike the live-browser regression, the
component session tests simulate the SDK boundary; they additionally check the
30-minute expiry and React remounts in Strict Mode. The ERP TypeScript check
also passed. Expiry applies only to an unsubmitted review, never to recorded
statement registration or acknowledged payments.

# Signed-in ERP browser regressions


## Dimension report → journal → browser Back

With the ERP development preview running, from the workspace root:

```sh
pnpm --filter @workspace/erp-web run test:dimensions:navigation
```

Uses the installed Playwright dependency and Chromium (`CHROMIUM_PATH` can
override `/repl/tools/bin/chromium`). This is a live development Clerk test,
not the isolated table/layout harness in `tests/browser`. It refuses non-test
Clerk keys, creates one disposable test user and deletes it in `finally`.
The browser uses a fresh context: existing users' sessions are never reused,
changed or signed out. No authentication hooks, protected routes, company
context, router, API hooks or query cache are mocked.

All same-origin business API calls are intercepted with synthetic data;
unexpected endpoints and non-GET calls are blocked and fail the run. No
financial data is created or edited. Clerk's own network traffic remains real.
This checks frontend navigation and request scoping, not backend authorization.

The regression:

- Chooses a company using the real selector and sets the journal list to
  **2026 / Osnutek** using its controls.
- Opens Analitika and selects **Projekti**, **01.04.2025–30.09.2025** and a
  specific account using real controls.
- Clicks the warning's journal link and verifies the exact ID, reference,
  period, description and full debit/credit lines for a **2025 / Knjiženo**
  entry which is absent from the filtered list.
- Uses actual browser Back (no reload or manual cache reset) and verifies
  the exact report URL, rendered filters, active company and unchanged
  Clerk session.
- Changes the intercepted report response while the journal is open, then
  requires a new report request and visibly updated rows and totals on return,
  without waiting for the application's five-minute cache to expire.
- Seeds a conflicting legacy company selection and verifies report requests
  explicitly carry the active company's header as well as its URL.

Evidence (`results.txt`, `restored-report.png`, and failure-only diagnostics)
is written under the ignored, non-deployed
`generated-artifacts/dimension-report-navigation/`. Auth tokens, session IDs,
credentials and browser traces are never recorded.
