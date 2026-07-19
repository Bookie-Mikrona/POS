---
name: ERP foundation
description: Skupna Clerk + PostgreSQL infrastruktura z FURS POS Web; architecture decisions za ERP projekt
---

## Stack
- pnpm monorepo: React+Vite frontend (`artifacts/erp-web`), Express+Drizzle backend (`artifacts/api-server`)
- PostgreSQL via `@workspace/db`, Drizzle ORM
- Clerk auth (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`)
- OpenAPI spec → Orval codegen → `@workspace/api-client-react` + `@workspace/api-zod`

## Integrations (Task #11)
- Anthropic AI via Replit AI Integrations (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- Object Storage via `@workspace/integrations-anthropic-ai` + `@google-cloud/storage`
- Bucket env vars: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`

## Architecture decisions

### Denarne vrednosti
`numeric(18,2)` v DB, string v JSON — nikoli float.

### Audit log
Vedno znotraj `db.transaction()`.

### Hook pattern
`{ query: { enabled: !!companyId } as any }` — TanStack Query v5 workaround.

### OpenAPI omejitev
`format: email` prepovedano — Orval generira napačno Zod kodo.

### Poslovne napake
`throw Object.assign(new Error(...), { statusCode: 400 })` + `try/catch` → HTTP 400.

### Datumi v DB
`date({ mode: "string" })` — pri vhodu iz Zod (format: date) konvertiraj `Date → ISO string` z `.toISOString().slice(0, 10)`.

### OCR async flow
`setImmediate()` po HTTP 201 odzivu — OCR se izvaja asinhrono, polling na clientu.

## Zaključene naloge
- #4: General ledger & journal entries
- #5: AR/AP (partnerji, računi, posting logika)
- #6: Payments & saldakonti
- #7: DDV modul (vat_codes, knjiga IR/PR, DDV-O, frontend ddv.tsx)
- #11: AI OCR dokumenti (Anthropic Vision, Object Storage, dokumenti.tsx)

## Predlagane naloge (PROPOSED/PENDING)
- #8: Bančni izpiski
- #9: KPI dashboard
- #10: Dimenzije (cost centers, projects) na kontih in journal lines
- #12: Finančna poročila (bilanca stanja, izkaz poslovnega izida)
- #13: Boljše napake pri OCR brez partnerja/konta
- #14: Predogled dokumenta
- #15: AI OCR learning (feedback loop)
