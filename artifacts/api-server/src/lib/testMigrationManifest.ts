export type TestMigrationClassification = "legacy" | "schema" | "integrity" | "privacy" | "audit";

export type TestMigrationManifestEntry = {
  file: string;
  classification: TestMigrationClassification;
  dependsOn?: readonly string[];
};

export type MigrationFile = {
  file: string;
  content: string;
};

export type LegacyMigrationExclusion = {
  file: string;
  reason: string;
};

export const TEST_MIGRATION_POLICY_START = 167;

const baselineExclusionReason =
  "Migracija 000–059 je del zgodovinske temeljne sheme, ki mora obstajati pred tem dopolnilnim testnim runnerjem; ločeno ponovno izvajanje ni pregledano glede prekrivanja in vrstnega reda.";

const baselineLegacyExclusions: readonly LegacyMigrationExclusion[] = [
  "000-pre-init.sql",
  "001-vat-tables.sql",
  "002-vat-code-seed.sql",
  "003-journal-entry-lines-vat.sql",
  "003-vat-submissions.sql",
  "004-goods-receipts.sql",
  "005-opening-balance-account.sql",
  "006-ddv-resolver.sql",
  "007-ddv-resolver-v2.sql",
  "008-mize-pozicija.sql",
  "009-receipt-date.sql",
  "0009_uvoz_prejemnic.sql",
  "010-pos-booking-vat-codes.sql",
  "0010_eracun_polja.sql",
  "011-pos-booking-vat5.sql",
  "0011_profil_tip.sql",
  "012-ddv-zakljucek-settings.sql",
  "0012_bizbox_polja.sql",
  "013-furs-vat-codes-new.sql",
  "014-osnovna-sredstva.sql",
  "015-os-refaktor.sql",
  "016-os-roles.sql",
  "017-os-amortizacija-nastavitve.sql",
  "018-journal-entries-amortizacija-unique.sql",
  "019-os-amortizacija-leto.sql",
  "020-os-amortizacija-obracun.sql",
  "021-os-glk-temeljnica-id.sql",
  "022-os-pravilo-zacetka-amortizacije.sql",
  "023-os-obracun-pravilo.sql",
  "024-datum-odtujitve.sql",
  "025-os-oslabitev.sql",
  "026-os-oslabitev-metoda.sql",
  "027-os-oslabitev-nova-letna.sql",
  "028-os-dobavitelj.sql",
  "029-recovery.sql",
  "029-skupni-partnerji.sql",
  "030-cost-centers-ext.sql",
  "031-mize-oblika.sql",
  "032-performance-indexes.sql",
  "033-enote-cost-center.sql",
  "034-finance-prejemnice-nabavni-konti.sql",
  "035-pos-invoice-links.sql",
  "036-pos-receipt-booking-sources.sql",
  "037-blagajniski-premiki.sql",
  "038-darilni-boni.sql",
  "039-darilni-boni-idempotency.sql",
  "040-pos-terminal-references-unique.sql",
  "041-pos-card-reference-reservations.sql",
  "042-pos-card-reference-global-unique.sql",
  "043-ssp-studentski-boni.sql",
  "044-pos-booking-symmetric-vat-matrix.sql",
  "045-pos-booking-monthly-frequency.sql",
  "046-received-invoice-eslog.sql",
  "047-z-porocila.sql",
  "048-eracun-email-kanal.sql",
  "049-eracun-status-poslano-email.sql",
  "050-eracun-bizbox-dostavni-status.sql",
  "051-bizbox-nastavitve.sql",
  "052-os-amortizacija-nastavitve-unique.sql",
  "053-schema-drift-cleanup.sql",
  "054-artikli-vrsta-storitev-default.sql",
  "055-izmene-cost-center.sql",
  "056-viva-payment-identifiers.sql",
  "057-furs-certifikat-company.sql",
  "058-furs-remove-legacy-certifikat.sql",
  "059-izmene-cost-center-label-snapshot.sql",
].map(file => ({ file, reason: baselineExclusionReason }));

const reviewedLegacyFeatureExclusions: readonly LegacyMigrationExclusion[] = [
  {
    file: "077-prepared-food-correction.sql",
    reason: "Odvisna je od tabel iz 075/076; ponovno izvajanje z dejanskim testnim bootstrapom še ni ločeno preverjeno.",
  },
  {
    file: "078-prepared-food-waste-record-number.sql",
    reason: "Vsebuje podatkovni backfill in NOT NULL prehod; idempotentnost na delno migriranih podatkih še ni ločeno preverjena.",
  },
  {
    file: "079-plate-waste.sql",
    reason: "Funkcionalnost ostankov s krožnikov ni del trenutnega testnega bootstrap obsega; vključitev zahteva ločen pregled fixture odvisnosti.",
  },
  {
    file: "080-plate-waste-correction-integrity.sql",
    reason: "Odvisna je od 079 in dodaja ne-idempotenten imenovan constraint; brez ločenega pregleda je ni varno ponovno izvajati.",
  },
  {
    file: "117-happy-hour-cene-pic.sql",
    reason: "Posega v artikle in ponovno gradi constrainte; vključitev zahteva ločen idempotentnostni test na testni shemi.",
  },
  {
    file: "118-pos-allergens.sql",
    reason: "Odvisna je od artiklov, prejemnic in documents; celotna veriga odvisnosti v testnem bootstrapu še ni ločeno potrjena.",
  },
  {
    file: "120-pos-contract-monthly-invoices.sql",
    reason: "Odvisna je od računovodskih in POS tabel ter ustvarja indekse; ločen pregled vrstnega reda in ponovnega zagona še manjka.",
  },
  {
    file: "164-pos-multicourse-vat-split.sql",
    reason: "Odvisna je od 163 in dodaja constraint; ponovni zagon na dejanski testni shemi še ni ločeno potrjen.",
  },
];

export const legacyMigrationExclusions: readonly LegacyMigrationExclusion[] = [
  ...baselineLegacyExclusions,
  ...reviewedLegacyFeatureExclusions,
];

const legacyRequiredMigrations = [
  "060-enforce-pos-integrity-constraints.sql",
  "061-telefon-narocila-in-priprava.sql",
  "062-narocniki-naselja-dostava.sql",
  "063-dostava-narocila.sql",
  "064-cti-dohodni-klici.sql",
  "065-enote-cti-token.sql",
  "066-qr-meni.sql",
  "067-qr-gost-narocila.sql",
  "068-dostava-storitev-snapshot.sql",
  "069-qr-alkohol-brez-cakanja.sql",
  "070-artikli-slika-url.sql",
  "071-artikli-opis-slike.sql",
  "072-pizza-velikosti-in-normativi.sql",
  "073-cene-pic-po-velikostih.sql",
  "074-qr-naprava-nadaljevanje-narocila.sql",
  "075-prepared-and-composite-food.sql",
  "076-prepared-food-waste-records.sql",
  "081-prepared-food-waste-financial-data.sql",
  "082-table-reservations.sql",
  "083-table-reservation-subscribers.sql",
  "084-multiple-table-reservations.sql",
  "085-qr-menu-geofence.sql",
  "086-qr-menu-wifi-fallback.sql",
  "087-qr-menu-wifi-credentials.sql",
  "088-card-tips.sql",
  "089-z-report-tips.sql",
  "090-qr-order-tip.sql",
  "091-tip-ledger.sql",
  "092-tip-fee-kind.sql",
  "093-tip-booking-accounts.sql",
  "094-pos-racun-idempotency.sql",
  "095-pos-card-payment-attempt-idempotency.sql",
  "096-pos-furs-lifecycle.sql",
  "097-pos-racun-atomic-numbering.sql",
  "098-pos-card-payment-attempt-receipt-binding.sql",
  "099-pos-furs-payload-snapshot-storno.sql",
  "100-pos-furs-signing-context.sql",
  "101-pos-racun-finalization-plan.sql",
  "102-pos-kds-persistent.sql",
  "103-pos-persistent-print-queue.sql",
  "104-pos-x-cash-reconciliation.sql",
  "105-pos-delivery-operations.sql",
  "106-pos-sync-quick-switch.sql",
  "107-tip-pool-operational-ledger.sql",
  "108-pos-z-tip-breakdown.sql",
  "109-tip-payment-method.sql",
  "110-tip-ledger-integrity.sql",
  "111-pos-category-revenue-accounts.sql",
  "112-company-furs-vat-code-links.sql",
  "113-menu-item-vat-context.sql",
  "114-purchase-source-documents.sql",
  "115-pos-gift-voucher-card-payment-attempt.sql",
  "116-document-approval-actors.sql",
  "119-kadrovske-ure.sql",
  "121-unit-hospitality-profiles.sql",
  "122-pos-events.sql",
  "123-event-unit-preparation.sql",
  "124-serialize-pos-inventory-movements.sql",
  "125-validate-publish-constraints.sql",
  "126-enote-temporary-integrity.sql",
  "127-pos-event-company-integrity.sql",
  "128-pos-event-preparation-company-integrity.sql",
  "129-pos-event-staff-period-integrity.sql",
  "130-pos-event-staff-terminal-status.sql",
  "131-pos-events-status-integrity.sql",
  "132-pos-events-type-integrity.sql",
  "133-pos-stock-transfer-enum-integrity.sql",
  "134-pos-stock-transfer-status-transitions.sql",
  "135-pos-stock-transfer-terminal-immutability.sql",
  "136-pos-stock-transfer-terminal-delete.sql",
  "137-pos-event-stock-movement-integrity.sql",
  "138-pos-stock-transfer-movement-completeness.sql",
  "139-pos-stock-transfer-cancel-without-movements.sql",
  "140-pos-stock-transfer-no-draft-movements.sql",
  "141-stock-movement-actor-source-snapshots.sql",
  "142-payment-attempt-and-furs-claim-audit.sql",
  "143-pos-kds-unit-configuration.sql",
  "144-pos-kds-dispatch.sql",
  "145-reservations-archive-history.sql",
  "146-qr-gost-order-idempotency.sql",
  "147-pos-floor-plans.sql",
  "148-pos-offline-fiscal-receipts.sql",
  "149-pos-offline-fiscal-claim.sql",
  "150-pos-offline-furs-v1-artifacts.sql",
  "151-pos-racun-finalization-source-operation.sql",
  "152-pos-offline-authority-bundles.sql",
  "153-pos-local-receipt-identity.sql",
  "154-pos-offline-provisioning-sync-auth.sql",
  "155-pos-offline-furs-transport-attempts.sql",
  "156-pos-offline-furs-v2-core.sql",
  "157-pos-offline-furs-eor-review.sql",
  "158-pos-article-image-versions.sql",
  "159-pos-multicourse-kds-release.sql",
  "160-pos-multicourse-menu-and-qr-waiter.sql",
  "161-pos-simulation-card-provider.sql",
  "162-pos-multicourse-course-food-allowlist.sql",
  "163-pos-generic-multicourse-menus.sql",
  "165-pos-ai-agent.sql",
  "166-pos-multicourse-kds-cancellation.sql",
] as const;

export const testMigrationManifest: readonly TestMigrationManifestEntry[] = [
  ...legacyRequiredMigrations.map(file => ({ file, classification: "legacy" as const })),
  { file: "167-qr-gost-order-feedback.sql", classification: "schema" },
  { file: "168-pos-normative-web-apply-audit.sql", classification: "audit" },
  {
    file: "169-qr-feedback-device-privacy.sql",
    classification: "privacy",
    dependsOn: ["167-qr-gost-order-feedback.sql"],
  },
  { file: "170-pos-course-name-snapshot.sql", classification: "schema" },
  { file: "171-pos-actor-audit-clerk-identity.sql", classification: "audit" },
  { file: "172-qr-order-device-retention-index.sql", classification: "privacy" },
  { file: "173-viva-refund-actor-status-audit.sql", classification: "audit" },
  {
    file: "174-viva-refund-manual-resolution.sql",
    classification: "integrity",
    dependsOn: ["173-viva-refund-actor-status-audit.sql"],
  },
  { file: "175-restrict-linked-invoice-delete.sql", classification: "integrity" },
  { file: "265-viva-refund-four-eyes.sql", classification: "integrity", dependsOn: ["174-viva-refund-manual-resolution.sql"] },
  { file: "176-pos-receipt-payment-details.sql", classification: "schema" },
  { file: "177-invoice-payment-instructions.sql", classification: "schema" },
  { file: "178-bank-statement-evidence.sql", classification: "audit" },
  { file: "179-returnable-packaging.sql", classification: "schema" },
  {
    file: "180-pos-returnable-packaging-account.sql",
    classification: "schema",
    dependsOn: ["179-returnable-packaging.sql"],
  },
  {
    file: "181-pos-credit-note-allocations.sql",
    classification: "audit",
    dependsOn: ["180-pos-returnable-packaging-account.sql"],
  },
  {
    file: "182-embalazni-prometi-reversals.sql",
    classification: "audit",
    dependsOn: ["181-pos-credit-note-allocations.sql"],
  },
  {
    file: "183-pos-booking-packaging-reconciliation-safe.sql",
    classification: "audit",
    dependsOn: ["182-embalazni-prometi-reversals.sql"],
  },
  {
    file: "184-artikel-dobavitelj-naziv-only.sql",
    classification: "integrity",
    dependsOn: ["183-pos-booking-packaging-reconciliation-safe.sql"],
  },
  {
    file: "185-pos-receipt-lifecycle.sql",
    classification: "schema",
    dependsOn: ["184-artikel-dobavitelj-naziv-only.sql"],
  },
  {
    file: "186-pos-receipt-line-treatments.sql",
    classification: "schema",
    dependsOn: ["185-pos-receipt-lifecycle.sql"],
  },
  {
    file: "187-prejemnice-placano-z-gotovino.sql",
    classification: "schema",
    dependsOn: ["186-pos-receipt-line-treatments.sql"],
  },
  {
    file: "188-account-cost-center-policy.sql",
    classification: "schema",
    dependsOn: ["187-prejemnice-placano-z-gotovino.sql"],
  },
  {
    file: "189-counterparty-identity-uniqueness.sql",
    classification: "integrity",
    dependsOn: ["188-account-cost-center-policy.sql"],
  },
  {
    file: "190-employer-controlled-tips-opt-in.sql",
    classification: "schema",
    dependsOn: ["189-counterparty-identity-uniqueness.sql"],
  },
  {
    file: "191-tip-distribution-profiles.sql",
    classification: "schema",
    dependsOn: ["190-employer-controlled-tips-opt-in.sql"],
  },
  {
    file: "192-offline-gateway-events.sql",
    classification: "schema",
    dependsOn: ["191-tip-distribution-profiles.sql"],
  },
  {
    file: "193-offline-gateway-sync-reviews.sql",
    classification: "schema",
    dependsOn: ["192-offline-gateway-events.sql"],
  },
  {
    file: "194-offline-fiscal-source-order-ref.sql",
    classification: "schema",
    dependsOn: ["193-offline-gateway-sync-reviews.sql"],
  },
  {
    file: "195-offline-gateway-receipt-line-mappings.sql",
    classification: "schema",
    dependsOn: ["194-offline-fiscal-source-order-ref.sql"],
  },
  {
    file: "196-offline-gateway-sync-checkpoints.sql",
    classification: "schema",
    dependsOn: ["195-offline-gateway-receipt-line-mappings.sql"],
  },
  {
    file: "197-offline-fiscal-finalization-retry.sql",
    classification: "schema",
    dependsOn: ["196-offline-gateway-sync-checkpoints.sql"],
  },
  {
    file: "198-pos-returnable-packaging-writeoff.sql",
    classification: "schema",
    dependsOn: ["197-offline-fiscal-finalization-retry.sql"],
  },
  {
    file: "199-company-pos-plans.sql",
    classification: "schema",
    dependsOn: ["198-pos-returnable-packaging-writeoff.sql"],
  },
  {
    file: "220-restored-pos-public-features.sql",
    classification: "schema",
    dependsOn: ["199-company-pos-plans.sql"],
  },
  {
    file: "221-public-voucher-stripe-connect.sql",
    classification: "schema",
    dependsOn: ["220-restored-pos-public-features.sql"],
  },
  {
    file: "221-bookie-old-financial-invoices.sql",
    classification: "schema",
    dependsOn: ["221-public-voucher-stripe-connect.sql"],
  },
  {
    file: "222-pos-individual-voucher-redemption-holds.sql",
    classification: "schema",
    dependsOn: ["221-public-voucher-stripe-connect.sql"],
  },
  {
    file: "223-company-offboarding-cases.sql",
    classification: "schema",
    dependsOn: ["222-pos-individual-voucher-redemption-holds.sql"],
  },
  {
    file: "224-generic-purchase-articles.sql",
    classification: "schema",
    dependsOn: ["223-company-offboarding-cases.sql"],
  },
  {
    file: "225-pizza-dough-settings.sql",
    classification: "schema",
    dependsOn: ["224-generic-purchase-articles.sql"],
  },
  {
    file: "226-pos-drained-yield.sql",
    classification: "schema",
    dependsOn: ["225-pizza-dough-settings.sql"],
  },
  {
    file: "227-pos-source-price-semantics.sql",
    classification: "schema",
    dependsOn: ["226-pos-drained-yield.sql"],
  },
  {
    file: "228-polizdelki-brez-racunovodske-vrste.sql",
    classification: "schema",
    dependsOn: ["227-pos-source-price-semantics.sql"],
  },
  {
    file: "229-pos-nested-modifier-source.sql",
    classification: "schema",
    dependsOn: ["228-polizdelki-brez-racunovodske-vrste.sql"],
  },
  {
    file: "230-pos-small-equipment-no-valuation.sql",
    classification: "schema",
    dependsOn: ["229-pos-nested-modifier-source.sql"],
  },
  {
    file: "231-pos-drobni-inventar-predloge.sql",
    classification: "schema",
    dependsOn: ["230-pos-small-equipment-no-valuation.sql"],
  },
  {
    file: "232-inventura-document-path.sql",
    classification: "schema",
    dependsOn: ["231-pos-drobni-inventar-predloge.sql"],
  },
  {
    file: "233-drobni-inventar-vhodni-ddv.sql",
    classification: "schema",
    dependsOn: ["232-inventura-document-path.sql"],
  },
  {
    file: "234-drobni-inventar-skupine.sql",
    classification: "schema",
    dependsOn: ["233-drobni-inventar-vhodni-ddv.sql"],
  },
  {
    file: "235-invoice-line-asset-type.sql",
    classification: "schema",
    dependsOn: ["234-drobni-inventar-skupine.sql"],
  },
  {
    file: "236-pos-line-packaging-snapshot.sql",
    classification: "schema",
    dependsOn: ["235-invoice-line-asset-type.sql"],
  },
  {
    file: "237-purchase-article-eslog-units.sql",
    classification: "schema",
    dependsOn: ["236-pos-line-packaging-snapshot.sql"],
  },
  {
    file: "238-bookie-old-ar-settlements.sql",
    classification: "schema",
    dependsOn: ["237-purchase-article-eslog-units.sql", "221-bookie-old-financial-invoices.sql"],
  },
  {
    file: "239-document-fx-source-type.sql",
    classification: "schema",
    dependsOn: ["221-bookie-old-financial-invoices.sql"],
  },
  {
    file: "240-document-gross-expense-source-type.sql",
    classification: "schema",
    dependsOn: ["239-document-fx-source-type.sql"],
  },
  {
    file: "241-annual-reports.sql",
    classification: "schema",
    dependsOn: [],
  },
  {
    file: "242-partner-ledger-settlements.sql",
    classification: "schema",
    dependsOn: ["241-annual-reports.sql"],
  },
  {
    file: "243-payment-batch-bank-metadata.sql",
    classification: "schema",
    dependsOn: ["242-partner-ledger-settlements.sql"],
  },
  {
    file: "244-payment-batch-idempotency-fingerprint.sql",
    classification: "schema",
    dependsOn: ["243-payment-batch-bank-metadata.sql"],
  },
  {
    file: "245-payment-batch-instruction-lifecycle.sql",
    classification: "schema",
    dependsOn: ["244-payment-batch-idempotency-fingerprint.sql"],
  },
  {
    file: "246-bookie-old-ap-settlements.sql",
    classification: "schema",
    dependsOn: ["245-payment-batch-instruction-lifecycle.sql"],
  },
  {
    file: "247-bookie-old-native-ledger-evidence.sql",
    classification: "schema",
    dependsOn: ["246-bookie-old-ap-settlements.sql"],
  },
  {
    file: "248-payment-ledger-allocations.sql",
    classification: "schema",
    dependsOn: ["247-bookie-old-native-ledger-evidence.sql"],
  },
  {
    file: "249-annual-report-history.sql",
    classification: "schema",
    dependsOn: ["241-annual-reports.sql"],
  },
  {
    file: "250-pos-article-kds-exclusion.sql",
    classification: "schema",
  },
  {
    file: "251-prepared-dessert-batches.sql",
    classification: "schema",
    dependsOn: ["250-pos-article-kds-exclusion.sql"],
  },
  {
    file: "252-automatic-allergen-research.sql",
    classification: "schema",
    dependsOn: ["251-prepared-dessert-batches.sql"],
  },
  {
    file: "253-pos-booking-drafts.sql",
    classification: "schema",
  },
  {
    file: "254-prepared-norm-portion.sql",
    classification: "schema",
  },
  {
    file: "255-partner-liability-payment-scope.sql",
    classification: "integrity",
    dependsOn: ["248-payment-ledger-allocations.sql"],
  },
  {
    file: "257-modifikator-privzet-schema.sql",
    classification: "schema",
  },
  {
    file: "258-malica-pizza-sizes.sql",
    classification: "schema",
    dependsOn: ["257-modifikator-privzet-schema.sql"],
  },
  {
    file: "259-family-pizza-dough-settings.sql",
    classification: "schema",
    dependsOn: ["258-malica-pizza-sizes.sql"],
  },
  {
    file: "260-pos-supplier-orders.sql",
    classification: "schema",
    dependsOn: ["259-family-pizza-dough-settings.sql"],
  },
  {
    file: "261-pos-supplier-order-notes.sql",
    classification: "schema",
    dependsOn: ["260-pos-supplier-orders.sql"],
  },
  {
    file: "262-pos-supplier-package-change-reviews.sql",
    classification: "audit",
    dependsOn: ["261-pos-supplier-order-notes.sql"],
  },
  {
    file: "263-erp-smtp-settings.sql",
    classification: "schema",
  },
  {
    file: "265-viva-refund-evidence.sql",
    classification: "integrity",
    dependsOn: ["174-viva-refund-manual-resolution.sql"],
  },
  {
    file: "264-amortizacija-active-entry-unique.sql",
    classification: "integrity",
  },
  {
    file: "265-viva-refund-aging-alerts.sql",
    classification: "schema",
    dependsOn: ["174-viva-refund-manual-resolution.sql"],
  },
];

const migrationHeader = /^(?:\uFEFF)?--[ \t]*test-bootstrap:[ \t]*(schema|integrity|privacy|audit|excluded)[ \t]*\r?\n(?:--[ \t]*test-bootstrap-reason:[ \t]*(\S(?:.*\S)?)[ \t]*\r?\n)?/;

export function buildValidatedTestMigrationPlan(
  manifest: readonly TestMigrationManifestEntry[],
  files: readonly MigrationFile[],
  legacyExclusions: readonly LegacyMigrationExclusion[] = legacyMigrationExclusions,
): readonly TestMigrationManifestEntry[] {
  const filesByName = new Map(files.map(file => [file.file, file]));
  const manifestIndexes = new Map<string, number>();
  const exclusionReasons = new Map<string, string>();

  manifest.forEach((entry, index) => {
    if (manifestIndexes.has(entry.file)) {
      throw new Error(`Testni migracijski manifest vsebuje podvojen vnos: ${entry.file}`);
    }
    if (!filesByName.has(entry.file)) {
      throw new Error(`Zahtevana testna migracija manjka na disku: ${entry.file}`);
    }
    const sequence = migrationSequence(entry.file);
    if (
      sequence !== null
      && sequence < TEST_MIGRATION_POLICY_START
      && entry.classification !== "legacy"
    ) {
      throw new Error(`Migracija pred 167 mora biti klasificirana kot legacy: ${entry.file}`);
    }
    manifestIndexes.set(entry.file, index);
  });

  for (const exclusion of legacyExclusions) {
    if (exclusionReasons.has(exclusion.file)) {
      throw new Error(`Legacy inventar vsebuje podvojeno izključitev: ${exclusion.file}`);
    }
    if (!exclusion.reason.trim()) {
      throw new Error(`Legacy izključitev nima razloga: ${exclusion.file}`);
    }
    if (!filesByName.has(exclusion.file)) {
      throw new Error(`Izključena legacy migracija manjka na disku: ${exclusion.file}`);
    }
    if (manifestIndexes.has(exclusion.file)) {
      throw new Error(`Legacy migracija ne sme biti hkrati izvedena in izključena: ${exclusion.file}`);
    }
    exclusionReasons.set(exclusion.file, exclusion.reason);
  }

  for (const file of files) {
    const sequence = migrationSequence(file.file);
    if (sequence === null) continue;
    if (sequence < TEST_MIGRATION_POLICY_START) {
      if (!manifestIndexes.has(file.file) && !exclusionReasons.has(file.file)) {
        throw new Error(`Legacy migracija nima pojasnjenega mesta v inventarju: ${file.file}`);
      }
      continue;
    }

    const header = file.content.match(migrationHeader);
    const directive = header?.[1];
    if (!directive) {
      throw new Error(
        `Migracija ${file.file} nima obvezne glave -- test-bootstrap: <classification>`,
      );
    }

    const manifestIndex = manifestIndexes.get(file.file);
    if (directive === "excluded") {
      const exclusionReason = header[2];
      if (!exclusionReason) {
        throw new Error(
          `Izključena migracija ${file.file} nima obveznega razloga v glavi -- test-bootstrap-reason: <reason>`,
        );
      }
      if (manifestIndex !== undefined) {
        throw new Error(`Izključena migracija ne sme biti v testnem manifestu: ${file.file}`);
      }
      continue;
    }
    if (manifestIndex === undefined) {
      throw new Error(`Klasificirana testna migracija manjka v manifestu: ${file.file}`);
    }
    if (manifest[manifestIndex]!.classification !== directive) {
      throw new Error(
        `Klasifikacija migracije ${file.file} se ne ujema: datoteka=${directive}, manifest=${manifest[manifestIndex]!.classification}`,
      );
    }
  }

  manifest.forEach((entry, index) => {
    for (const dependency of entry.dependsOn ?? []) {
      const dependencyIndex = manifestIndexes.get(dependency);
      if (dependencyIndex === undefined) {
        throw new Error(`Migracija ${entry.file} zahteva manjkajoč manifestni vnos ${dependency}`);
      }
      if (dependencyIndex >= index) {
        throw new Error(`Migracija ${entry.file} mora biti v manifestu za ${dependency}`);
      }
    }
  });

  return manifest;
}

function migrationSequence(file: string): number | null {
  const match = file.match(/^(\d+)[-_].+\.sql$/);
  return match ? Number(match[1]) : null;
}
