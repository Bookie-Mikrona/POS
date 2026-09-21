---
name: Clerk host-aware SDK
description: Zakaj POS uporablja isti Clerk React SDK in host-aware helper kot ERP.
---

POS mora za Clerk uporabljati `@clerk/react`, enako kot ERP, kadar potrebuje host-aware izbiro publishable keyja.

**Why:** Zastareli `@clerk/clerk-react` sicer podpira `ClerkProvider`, vendar prek svojega `internal` podmodula ne izvozi `publishableKeyFromHost`. Mešanje obeh React SDK-jev za provider in hooke tvega ločena contexta.

**How to apply:** Pri spremembah POS Clerk inicializacije uporabi `publishableKeyFromHost(window.location.hostname, VITE_CLERK_PUBLISHABLE_KEY)` iz `@clerk/react/internal` in `VITE_CLERK_PROXY_URL`, kot ERP. Provider in POS Clerk hooki naj ostanejo iz istega `@clerk/react` paketa.