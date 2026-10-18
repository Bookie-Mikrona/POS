export const releaseTestManifest = Object.freeze({
  erp: Object.freeze({
    label: "ERP release testi",
    suites: Object.freeze({
      "server-pdf-only": "src/lib/server-pdf-only.test.ts",
      "event-transfer-diagnostics-csv": "src/lib/eventTransferDiagnosticsCsv.test.ts",
      "admin-diagnostics-export": "src/pages/admin.diagnostics-export.test.tsx",
      "bank-invalid-accounts": "src/pages/bancni-izpis.invalid-accounts.test.tsx",
      "bank-matching": "src/pages/bancni-izpis.matching.test.ts",
      "payment-forced-save": "src/pages/placila.force.test.tsx",
      "bank-import-leave-guard": "src/hooks/use-bank-import-leave-guard.test.ts",
      "supplier-payment-duplicates": "src/pages/placila.test.tsx",
    }),
  }),
});
