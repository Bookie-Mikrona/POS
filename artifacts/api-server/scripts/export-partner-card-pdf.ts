/** Read-only administrative export, using exactly the application's card engine. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { pool } from "@workspace/db";
import { loadCard } from "../src/routes/partnerLedger";
import { renderPartnerCardPdf } from "../src/lib/partner-ledger-pdf";

async function main() {
  const [companyId, partnerId, accountId, dateTo, output] = process.argv.slice(2);
  if (!companyId || !partnerId || !accountId || !dateTo || !output) {
    throw new Error("Uporaba: export-partner-card-pdf.ts companyId partnerId accountId YYYY-MM-DD output.pdf");
  }
  const card = await loadCard(companyId, { partnerId, accountId, dateTo, mode: "posted" });
  const pdf = await renderPartnerCardPdf(card);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, pdf);
  const sum = (field: "debit" | "credit" | "openDebit" | "openCredit") =>
    card.lines.reduce((total, line) => total.plus(line[field]), new Decimal(0)).toFixed(2);
  console.log(JSON.stringify({ output, lines: card.lines.length, closingBalance: card.closingBalance,
    debit: sum("debit"), credit: sum("credit"), openDebit: sum("openDebit"), openCredit: sum("openCredit") }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Izvoz ni uspel"); process.exitCode = 1; })
  .finally(() => pool.end());