import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const migrations = [
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
  "167-qr-gost-order-feedback.sql",
  "168-pos-normative-web-apply-audit.sql",
  "169-qr-feedback-device-privacy.sql",
  "171-pos-actor-audit-clerk-identity.sql",
  "172-qr-order-device-retention-index.sql",
  "173-viva-refund-actor-status-audit.sql",
  "174-viva-refund-manual-resolution.sql",
  "179-returnable-packaging.sql",
  "180-pos-returnable-packaging-account.sql",
  "181-pos-credit-note-allocations.sql",
  "182-embalazni-prometi-reversals.sql",
  "183-pos-booking-packaging-reconciliation-safe.sql",
  "184-artikel-dobavitelj-naziv-only.sql",
  "188-account-cost-center-policy.sql",
  "198-pos-returnable-packaging-writeoff.sql",
] as const;
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptsDir, "../../../lib/db/src/migrations");

try {
  for (const migration of migrations) {
    const sql = await readFile(path.join(migrationsDir, migration), "utf8");
    await pool.query(sql);
    console.log(`Izvedena post-merge migracija: ${migration}`);
  }
} finally {
  await pool.end();
}