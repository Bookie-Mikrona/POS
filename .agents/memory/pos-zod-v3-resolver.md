---
name: POS Zod resolver types
description: Avoid Zod v3/v4 schema type mismatches in POS React Hook Form resolver schemas.
---

For POS forms using `@hookform/resolvers/zod` with Zod v3, import the schema API explicitly from `zod/v3`.

**Why:** The workspace also uses Zod v4 types. Explicitly selecting Zod v3 in the POS forms made the schemas compatible with the installed v3 resolver without casts or dependency changes.

**How to apply:** Use `zod/v3` for schemas passed to the v3 React Hook Form resolver in the POS package. Do not change validation behavior or suppress schema incompatibilities with type assertions.
