---
name: FURS certificate scope
description: Business-premise certificate overrides are legacy disk-path settings and conflict with the intended company-wide uploaded certificate flow.
---

FURS certificate material should have one coherent company-level source of truth. The business-premise `certifikatPot` and `certifikatGeslo` fields are a legacy on-server-file-path fallback; they are not appropriate as the normal configuration path in Replit.

**Why:** A premises override is returned to the browser, including its password, and the current uploaded-P12 flow stores its extracted PEM/key under a different scope from the company-level FURS reader. The database-first certificate resolver also takes the global PEM/key over the premises path, so the UI claim that the premise value “overrides” the global setting is not generally true.

**How to apply:** Before altering this UI, safely migrate existing premise-based credentials because active installations may still depend on them. Use a single company-scoped, encrypted private-certificate store, return only configured/expiry status, and do not return certificate paths, passwords, PEM, or private keys in GET responses.