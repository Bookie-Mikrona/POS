export const releaseTestManifest = Object.freeze({
  erp: Object.freeze({
    label: "ERP release testi",
    suites: Object.freeze({
      "event-transfer-diagnostics-csv": "src/lib/eventTransferDiagnosticsCsv.test.ts",
      "admin-diagnostics-export": "src/pages/admin.diagnostics-export.test.tsx",
      "bank-invalid-accounts": "src/pages/bancni-izpis.invalid-accounts.test.tsx",
      "bank-matching": "src/pages/bancni-izpis.matching.test.ts",
    }),
  }),
});
