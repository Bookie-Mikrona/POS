export const releaseTestManifest = Object.freeze({
  pos: Object.freeze({
    label: "POS release testi",
    suites: Object.freeze({
      "unit-profiles": "src/lib/unitProfiles.test.ts",
      "auth-access": "src/contexts/AuthContext.access.test.tsx",
      "auth-problem": "src/PosAuthProblem.test.tsx",
      "local-gateway-settings": "src/components/LocalGatewaySettings.test.tsx",
      "gateway-offline-store": "src/lib/gatewayOfflineStore.test.ts",
      "gateway-client": "src/lib/gatewayClient.test.ts",
      "kds-hook": "src/hooks/use-kds.test.ts",
      "menu-meal-type": "src/pages/Menu.mealType.test.tsx",
    }),
  }),
});
