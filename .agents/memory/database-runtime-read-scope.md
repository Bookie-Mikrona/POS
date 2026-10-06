---
name: Database query target versus application runtime
description: Managed development queries and the API runtime can return different business data even for the same record ID.
---

When a managed development database query contradicts the user or the app, verify the same fields through the existing API runtime's database connection before declaring data absent.

**Why:** On 2026-10-06, a managed development query returned an empty company e-mail, while a read through the API's existing database client returned the stored e-mail for that same company. An initial delivery-test explanation was therefore incorrect. Matching record IDs do not prove matching database targets or current contents.

**How to apply:** Use a narrow read of the disputed fields through the app's normal database client, without displaying connection strings or secrets. Do not infer production access from the discrepancy or change database configuration. Resolve the target before any mutation.
