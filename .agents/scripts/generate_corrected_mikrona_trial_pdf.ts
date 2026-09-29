/** Generate a read-only review copy of Mikrona's corrected 2025 trial balance. */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateTrialBalancePdf } from "../../artifacts/api-server/src/lib/report-pdf";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const companyId = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const reconciliation = readFileSync(
  path.join(root, "reports/mikrona-2025-pdf-gk-reconciliation.csv"), "utf8",
).trim().split(/\r?\n/);
const headers = reconciliation.shift()!.split(",");
const sql = `SELECT json_object_agg(code, json_build_object('id', id, 'name', name, 'type', type))
  FROM accounts WHERE company_id = '${companyId}'`;
const result = spawnSync("psql", ["-X", "-A", "-t", "-c", sql], {
  encoding: "utf8",
  env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
});
if (result.status !== 0) throw new Error(result.stderr || "Branje GK ni uspelo.");
const accounts = JSON.parse(result.stdout.trim()) as Record<string, { id: string; name: string; type: string }>;

const index = (column: string) => {
  const i = headers.indexOf(column);
  if (i < 0) throw new Error(`Manjka stolpec ${column}`);
  return i;
};
const fields = [
  "gk_otv_d", "gk_otv_c", "gk_prom_d", "gk_prom_c", "gk_all_d", "gk_all_c",
] as const;
const rows = reconciliation.map((line) => {
  const cells = line.split(",");
  if (cells.length !== headers.length || cells[index("ujemanje")] !== "DA")
    throw new Error("Primerjalna vrstica ni popolna ali se ne ujema z oddanim izpisom.");
  const code = cells[index("novi_konto")]!;
  const account = accounts[code];
  if (!account) throw new Error(`Manjka konto ${code}`);
  const amounts = fields.map((field) => cells[index(field)]!);
  return {
    accountId: account.id, accountCode: code, accountName: account.name,
    accountType: account.type,
    openingBalanceDebit: amounts[0]!, openingBalanceCredit: amounts[1]!,
    turnoverDebit: amounts[2]!, turnoverCredit: amounts[3]!,
    balanceDebit: amounts[4]!, balanceCredit: amounts[5]!,
  };
});
if (rows.length !== 65) throw new Error(`Pričakovanih 65 kontov, najdenih ${rows.length}`);
const sum = (key: keyof typeof rows[number]) =>
  rows.reduce((total, row) => total + Number(row[key]), 0).toFixed(2);
async function main() {
  const pdf = await generateTrialBalancePdf({
    companyName: "MIKRONA, PODJETJE ZA RAČUNALNIŠKI INŽENIRING, D.O.O.",
    dateFrom: "2025-01-01", dateTo: "2025-12-31", rows,
    totalOpeningBalanceDebit: sum("openingBalanceDebit"),
    totalOpeningBalanceCredit: sum("openingBalanceCredit"),
    totalTurnoverDebit: sum("turnoverDebit"),
    totalTurnoverCredit: sum("turnoverCredit"),
    totalBalanceDebit: sum("balanceDebit"),
    totalBalanceCredit: sum("balanceCredit"),
  });
  const destination = path.join(root, "reports/mikrona-2025-bruto-bilanca-popravljena.pdf");
  writeFileSync(destination, pdf);
  console.log(`Izpisano ${rows.length} preverjenih kontov: ${destination}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });