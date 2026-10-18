---
name: Vite browser test mocks
description: Why Vite identity mocks can be silently bypassed by resolution and dependency optimization.
---

For isolated browser harnesses, do not assume a Vite plugin's bare-import
`resolveId` sees every import: alias resolution and dependency prebundling can
resolve an import before that hook handles it.

**Why:** A synthetic page mounted the real company and authentication hooks even
though its test plugin appeared to replace them. This was a test-server
resolution issue, not an application authentication failure.

**How to apply:** Keep substitutions exclusively in the test-server configuration.
Use an explicit exact alias and optimizer exclusion for dependency mocks; account
for resolved absolute IDs when substituting local modules. Never fix a harness by
weakening the normal application's authentication.
