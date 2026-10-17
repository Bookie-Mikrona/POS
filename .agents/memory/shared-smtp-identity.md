---
name: Shared SMTP business identity
description: Why document senders must identify the issuing company despite using the central Mikrona relay.
---

The central Mikrona SMTP relay serves multiple issuing companies. The user requires recipients to see the document owner's business name, not just the relay's identity. A company's foreign-domain address must not become the visible sender address.

**Why:** Recipients previously saw only the central relay mailbox. Replacing it indiscriminately with each company's address would introduce DMARC alignment problems rather than solve the business-identity issue.

**How to apply:** Treat delivery infrastructure and document ownership as separate identities when adding mail flows. Resolve ownership from the actual document/company, never from an arbitrary recipient or company supplied in the request body.

## TLS hostname requirement

The Mikrona relay must be addressed as `mail.mikrona.si`, not an IP alias, with certificate verification enabled.

**Why:** The user specified a hostname-issued certificate; connecting through the former IP settings causes hostname verification failures. Changing the visible company identity does not justify weakening transport security.

**How to apply:** Preserve the DNS hostname when adjusting Mikrona delivery settings. Never disable certificate verification to make an IP-based configuration work.

## ERP credential lifecycle

ERP SMTP credentials use the existing durable application secret with a separate cryptographic derivation, rather than requiring another deployment secret.

**Why:** SMTP must be configurable from ERP without an additional infrastructure setup step. This makes rotation of the application's secret affect saved SMTP passwords as well.

**How to apply:** Before rotating the application secret, re-encrypt saved ERP SMTP credentials or arrange for owners to re-enter them afterward. Do not silently fall back to the shared environment SMTP credentials when a company's configuration is missing or cannot be decrypted.
