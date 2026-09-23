export const releaseTestManifest = Object.freeze({
  api: Object.freeze({
    label: "API pogodbeni in varnostni testi",
    suites: Object.freeze({
      "pos-capability-audit": "src/middlewares/pos.capability-audit.test.ts",
      "temporary-unit-validation": "src/routes/pos/enote.temporary-validation.test.ts",
      "pos-events-integration": "src/routes/pos/events.integration.test.ts",
      "admin-role-access": "src/routes/admin.roles.test.ts",
      "inventory-serialization": "src/lib/inventory-serialization.test.ts",
      "event-policy": "src/lib/eventPolicy.test.ts",
      "event-transfer-diagnostics": "src/lib/eventTransferDiagnostics.test.ts",
      "event-transfer-loader": "src/lib/loadEventTransferDiagnostics.test.ts",
      "event-transfer-detail": "src/lib/loadEventTransferDetail.test.ts",
      "stripe-adapter-contract": "src/lib/stripeClient.test.ts",
      "stripe-sync-failure-monitor": "src/lib/stripeSyncFailureMonitor.test.ts",
      "public-profile-image-retention": "src/lib/publicProfileImageRetention.test.ts",
      "object-storage-boundaries": "src/lib/objectStorage.test.ts",
       "public-visits-integration": "src/routes/publicVisits.integration.test.ts",
       "malice-rules": "src/lib/malice-rules.test.ts",
       "malice-order-claims": "src/routes/pos/narocila.malica-claims.test.ts",
       "daily-lunch-mutation": "src/routes/pos/daily-lunch.test.ts",
       "daily-lunch-mutation-wiring": "src/routes/pos/daily-lunch.mutation-wiring.test.ts",
       "restored-pos-migration": "src/lib/restoredPosMigration.test.ts",
    }),
  }),
  "public-stripe-webhook": Object.freeze({
    label: "Javni Stripe webhook integracijski test",
    suites: Object.freeze({
      "public-stripe-webhook-integration":
        "src/app.public-stripe-webhook.integration.test.ts",
    }),
  }),
  "offline-native": Object.freeze({
    label: "Native offline fiskalna sinhronizacija",
    suites: Object.freeze({
      "offline-fiscal-native":
        "src/routes/pos/offline-fiscal-sync.native.integration.test.ts",
    }),
  }),
  "offline-cloud": Object.freeze({
    label: "Cloud-offline fiskalna sinhronizacija",
    suites: Object.freeze({
      "offline-fiscal-cloud":
        "src/routes/pos/offline-fiscal-sync.cloud-offline.integration.test.ts",
    }),
  }),
});