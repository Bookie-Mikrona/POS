---
name: Razvojna orodja in okolje
description: Kazalo posebnosti zaganjalnikov, preverjanja, paketov in prikazovanja datotek v tem projektu.
---

- [lib/db rebuild](libdb-rebuild-migracija.md) — zastarele deklaracije po spremembi sheme.
- [OpenAPI generator](openapi-uuid-generator.md) — omejitve uuid/uri in nepovezan drift generiranih datotek.
- [Podvojen API watcher](api-workflow-duplicate-watcher.md) — stari child proces lahko še drži port.
- [Ponovni zagon compute](compute-restart-ui.md) — obnovitev razvojnega okolja in workflowov.
- [Razvojni 502](dev-preview-main-run.md) — glavni Run in posamezni workflowi niso isto stanje.
- [TypeScript pomnilnik](typescript-memory-budget.md) — pomnilniški proračun obsežnega preverjanja.
- [API bundle](api-bundle-workspace-dependencies.md) — workspace odvisnosti po produkcijskem pruning-u.
- [PNPM overrides](pnpm-security-overrides.md) — varnostne pripone se ne združijo med workspace konfiguracijami.
- [Python PDF](python-pdf-generator.md) — razlika med uv runtime in neposrednim python3.
- [PNPM delovni imenik](pnpm-filter-cwd.md) — exec se izvede v mapi paketa.
- [CodeExecution poti](codeexecution-shell-paths.md) — skriti CR v izhodnih vrsticah.
- [Prenosi sredstev](present-asset-paths.md) — omejitve Unicode imen pri prenosih iz knjižnice.
- [PDF blob ogled](blob-pdf-preview.md) — iframe sandbox blokira Chromium PDF viewer; dovoli le preverjen PDF ali rastrsko sliko.
- [Vrstni red patch odsekov](apply-patch-hunk-order.md) — kontekst od začetka proti koncu.
- [Recharts testi](recharts-tooltip-testing.md) — omejitve postavitve in hover v jsdom.
- [Radix izbirniki v jsdom](radix-select-jsdom.md) — navadni MouseEvent ne prenese pointerType; ne sklepaj, da je izbirnik pokvarjen.
- [Časovniki plačilnih testov](payment-test-polling-timers.md) — nepreklicljive mikronaloge lahko podvojijo izdajo le v celotnem testnem teku.
- [Native ESM API](api-native-esm-loader.md) — zastoj CJS sonde ni dokaz nedelujočega API.
- [DB runtime scope](database-runtime-read-scope.md) — managed razvojna poizvedba lahko vrne drugačne podatke kot API; pred sklepanjem preveri dejansko povezavo aplikacije.
- [Orodja testerja](testing-runtime-capabilities.md) — manjkajoč callback v testerju ne pomeni, da ga nima glavni agent.
