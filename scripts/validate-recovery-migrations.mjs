import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activeDir = path.join(workspaceDir, "lib", "db", "src", "migrations");
const archiveDir = path.join(workspaceDir, "recovery", "historical-migrations");

const expectedArchive = [
  "198-pos-malice-core.sql.txt",
  "198-pos-returnable-packaging-writeoff.sql.txt",
  "199-malica-sale-idempotency.sql.txt",
  "200-malica-sale-line-link.sql.txt",
  "201-malica-course-line-link.sql.txt",
  "202-malica-sale-snapshots.sql.txt",
  "203-malica-sale-link-fks.sql.txt",
  "204-malica-one-published-offer.sql.txt",
  "205-malica-partner-price-versioning.sql.txt",
  "206-malica-contracts-beneficiaries.sql.txt",
  "207-malica-extra-course-snapshots.sql.txt",
  "208-malica-contract-sale-fields.sql.txt",
  "209-malica-immutable-facts.sql.txt",
  "210-malica-allocation-claims-vat.sql.txt",
  "211-malica-summary-invoice-batches.sql.txt",
  "212-malica-package-cancellation.sql.txt",
  "213-daily-lunch.sql.txt",
  "214-daily-lunch-snapshot-date-index.sql.txt",
  "215-public-reservations-vouchers.sql.txt",
  "216-voucher-delivery-retry.sql.txt",
  "217-voucher-delivery-alerts.sql.txt",
  "218-public-stripe-payment-reviews.sql.txt",
  "219-stripe-connection-alert.sql.txt",
];

function sequence(file) {
  const match = file.match(/^(\d+)[-_]/);
  return match ? Number(match[1]) : null;
}

export async function validateRecoveryMigrations() {
  const active = (await readdir(activeDir)).filter(file => file.endsWith(".sql"));
  const seen = new Map();
  const legacyDuplicatePrefixes = new Set([3, 9, 10, 11, 12, 29]);
  for (const file of active) {
    const number = sequence(file);
    if (number === null) continue;
    if (seen.has(number) && !legacyDuplicatePrefixes.has(number)) {
      throw new Error(`Duplicate active migration prefix ${number}: ${seen.get(number)}, ${file}`);
    }
    seen.set(number, file);
    if (number >= 200 && number <= 219) {
      throw new Error(`Historical migration is executable in active directory: ${file}`);
    }
  }

  const archive = (await readdir(archiveDir))
    .filter(file => file.endsWith(".sql.txt"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (archive.join("\n") !== expectedArchive.join("\n")) {
    throw new Error(
      `Historical archive inventory mismatch.\nExpected:\n${expectedArchive.join("\n")}\nActual:\n${archive.join("\n")}`,
    );
  }
  for (const file of archive) {
    const content = await readFile(path.join(archiveDir, file), "utf8");
    if (!/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i.test(content)) {
      throw new Error(`Historical archive file is unexpectedly empty or non-SQL: ${file}`);
    }
  }
  return { activeSqlFiles: active.length, archiveFiles: archive.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateRecoveryMigrations()
    .then(summary => console.log(
      `Recovery migration inventory is valid: ${summary.activeSqlFiles} active SQL files, ` +
      `${summary.archiveFiles} inert historical snapshots.`,
    ))
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}