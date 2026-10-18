# Development-only report exporter contract

Run explicitly from the workspace root:

```sh
RUN_CLERK_EXPORT_HISTORY_INTEGRATION=1 pnpm --filter @workspace/api-server run test:clerk-export-history:live
```

This test is excluded from normal tests and release checks. Without the opt-in
flag it skips, even when invoked with the separate configuration. It requires
the existing development Clerk secret (`sk_test_`) and at least one development
account with a primary email. It refuses production execution and live keys.
Do not copy keys or user IDs into commands, test fixtures or logs.

The test uses the installed Clerk SDK against the fixed Clerk API endpoint,
allows only `GET /v1/users` and `GET /v1/users/count`, disables SDK telemetry,
and refuses redirects. The installed SDK makes both list and count requests for
each paginated result. Use Vitest's default `NODE_ENV=test` for the guarded transport.
It discovers one account,
checks the SDK pagination envelope and camel-case user fields, checks a mixed
existing/nonexistent `userId` filter and a missing-only filter, then runs the
same exporter resolver as the history route. A final local projection of the
actual resource checks primary-email fallback even when the discovered account
has a name or only one email address. No remote user is changed or deleted.

Only test status is printed; actual SDK errors and response values are not
reported. A failed run emits a fixed, redacted message. Inspect the safe
configuration guards first; do not enable response/debug logging to diagnose it.
