# Bank-import session recovery

## Live-browser regression

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
