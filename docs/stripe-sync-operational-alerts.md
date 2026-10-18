# Stripe synchronization operational alerts

The platform webhook responds as before (retryable synchronization failures return
503). Monitoring and notification delivery run separately from that response.
Connect webhooks are not included in the platform synchronization monitor.

## Configuration

- `STRIPE_SYNC_ALERT_EMAIL`: operational email recipient(s).
- Existing `SMTP_HOST`, `SMTP_PORT` (default 465), `SMTP_FROM`, and optional
  `SMTP_USER` / `SMTP_PASSWORD`: primary transport, using verified TLS.
- Optional **secret** `STRIPE_SYNC_ALERT_FALLBACK_URL`: HTTPS endpoint accepting a
  JSON POST. Treat the full URL as a credential if it contains a private path or
  token. The endpoint must accept this generic JSON contract; provider-specific
  Slack/Teams message formats need an adapter. URL user/password authentication
  and redirects are deliberately not supported.

The fallback is contacted only if SMTP is missing, throws, times out, or rejects
one or more recipients. HTTP 2xx confirms fallback acceptance. Requests have a
five-second timeout and no automatic retries. Neither transport's response,
recipient, URL, nor raw error is included in monitor logs.

Both transports carry only these incident facts:

```json
{"status":"open","firstDetectedAt":"2026-10-18T10:00:00.000Z","failureCount":3}
```

Recovery uses `status: "resolved"`, the same incident start, and the total failure
count. No Stripe event IDs, account IDs, customer/payment details, request bodies,
or underlying exception messages are forwarded.

## Shared incident state and limits

The existing PostgreSQL `system_settings` store holds the monitor state under
`stripe_sync_failure_monitor`. No schema migration is required. All replicas lock
the same row when recording an observation. Three failures in five minutes open
an incident. Further alerts have a shared fifteen-minute cooldown, including
when both transports fail. An open incident retains its original start until a
successful synchronization closes it. A restart does not reset the cooldown.

The claim is committed **before** delivery and shared by both transports: there
is no per-process fallback decision or local-state fallback when PostgreSQL is
unavailable. Store failures produce a sanitized error log. If both channels fail,
or a process exits after claiming but before delivering, there is no durable
delivery queue; the next eligible failure after cooldown can try again. This is
best-effort operational notification, not guaranteed delivery. Concurrent requests
are observed in database lock order.

Verification: the monitor and transport unit tests cover success/failover and
failure containment; the shared integration test uses a unique disposable settings
key to exercise concurrent replicas and monitor recreation without touching the
actual operational incident. The webhook integration tests verify unchanged 503
responses, even when delivery hangs.
