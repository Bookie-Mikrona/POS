---
name: ERP Foundation
description: Arhitekturne odločitve za ERP dvostavno knjigovodstvo — skupna infrastruktura z FURS POS Web
---

# ERP Foundation

## Skupna infrastruktura z FURS POS Web
- **Baza**: Skupna PostgreSQL (`DATABASE_URL` runtime-managed, ne nastavljaj ročno)
- **Auth**: Skupni Clerk tenant (Replit-managed). Keys: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — auto-provisioned, ne nastavljaj ročno
- FURS POS Web je ločen Replit projekt, a deli bazo in Clerk tenant

**Why:** Uporabniki se prijavijo enkrat, dostopajo do vseh ERP modulov. Podjetja so skupna.

## Clerk setup
- Proxy middleware: `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- Backend: `@clerk/express` + `@clerk/shared` instalirani v api-server
- Frontend: `@clerk/react` + `@clerk/themes` instalirani v erp-web
- `vite.config.ts` MORA imeti `tailwindcss({ optimize: false })` — brez tega Clerk UI deluje v dev, ne pa v prod
- `index.css` MORA imeti `@layer theme, base, clerk, components, utilities;` pred `@import 'tailwindcss'`

## Multi-tenant pravilo
Vsak DB zapis bo imel `company_id` — križ-tenantski dostop ni mogoč. Obstoječe tabele poslovnih partnerjev so v skupni bazi (FURS POS Web jih upravlja).

## Denarne vrednosti
Vedno `numeric` tip v Drizzle (ne `real`, ne `doublePrecision`).

## Knjižbe
Knjiženih knjižb se ne briše — samo storno/korektivne knjižbe.

## Davčna pravila
Konfigurabilni davčni kodi z veljavnostjo `valid_from`/`valid_to`, ne trdo zapisani.
