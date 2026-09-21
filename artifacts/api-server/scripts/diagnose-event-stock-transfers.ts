import { pool } from "@workspace/db";
import { z } from "zod";
import { loadEventTransferDiagnostics } from "../src/lib/loadEventTransferDiagnostics";

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const input = z.object({
  companyId: z.string().uuid(),
  unitId: z.coerce.number().int().positive().optional(),
}).safeParse({
  companyId: valueAfter("--company-id"),
  unitId: valueAfter("--unit-id"),
});

if (!input.success) {
  console.error(
    "Uporaba: pnpm --filter @workspace/api-server diagnose:event-transfers -- "
    + "--company-id <UUID> [--unit-id <ID>]",
  );
  process.exitCode = 2;
} else {
  const { companyId, unitId } = input.data;
  try {
    const report = await loadEventTransferDiagnostics(companyId, unitId);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.violationCount > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}