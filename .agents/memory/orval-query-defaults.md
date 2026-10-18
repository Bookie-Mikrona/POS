---
name: Orval-generated query defaults
description: Generated Zod query schemas can reference default constants before initialization.
---

Keep query defaults at the API boundary instead of in OpenAPI when Orval emits a schema that references its generated default constant before declaring it. Keep client query parameters optional and let the route apply the default.

**Why:** This can cause both a TypeScript use-before-declaration error and a runtime temporal-dead-zone failure when the generated module loads.

**How to apply:** After changing an OpenAPI query default, regenerate with the workspace codegen command and verify both library typechecking and module import.
