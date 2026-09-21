import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceDir = resolve(packageDir, "../..");
const sourcePdf = resolve(
  workspaceDir,
  "attached_assets/RS_-2024-081-02384-OB~P001-0000_1787343578694.pdf",
);
const outputFile = resolve(packageDir, "src/lib/generatedSrs2024ChartSource.ts");

interface SourceAccount {
  code: string;
  name: string;
}

function isDocumentDecoration(line: string): boolean {
  const text = line.trim();
  return (
    text === "" ||
    text === "Konto" ||
    text === "Naziv konta" ||
    text === "Priloga 1" ||
    text.startsWith("Uradni list Republike Slovenije") ||
    text.startsWith("Stran ") ||
    text.startsWith("Št. ") ||
    /^\d+\/35$/.test(text)
  );
}

function extractSourceAccounts(layoutText: string): SourceAccount[] {
  const accounts: SourceAccount[] = [];
  let current: { code: string; nameParts: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const name = current.nameParts.join(" ").replace(/\s+/g, " ").trim();
    if (!name) {
      throw new Error(`Konto ${current.code} v uradnem PDF-ju nima naziva.`);
    }
    accounts.push({ code: current.code, name });
    current = null;
  };

  for (const line of layoutText.split(/\r?\n/)) {
    const accountMatch = line.match(/^ {2}(\d{2,6})(?:\s+(.*))?$/);
    if (accountMatch) {
      flush();
      const inlineName = accountMatch[2]?.trim() ?? "";
      current = {
        code: accountMatch[1],
        nameParts: inlineName ? [inlineName] : [],
      };
      continue;
    }

    if (
      /^ {2}(?:RAZRED \d|Konto\b)/.test(line) ||
      isDocumentDecoration(line)
    ) {
      flush();
      continue;
    }

    // Nadaljevanje naziva je vedno v stolpcu "Naziv konta", nikoli v levem
    // stolpcu s kodo. Tako številke let (npr. 2013) ne postanejo konti.
    if (current && line.slice(0, 12).trim() === "") {
      current.nameParts.push(line.trim());
    }
  }
  flush();

  const codes = new Set<string>();
  for (const account of accounts) {
    if (!/^\d{2}$|^\d{3}$|^\d{4}$|^\d{6}$/.test(account.code)) {
      throw new Error(`Nepričakovana dolžina konta ${account.code}.`);
    }
    if (codes.has(account.code)) {
      throw new Error(`Uradni PDF vsebuje podvojen konto ${account.code}.`);
    }
    codes.add(account.code);
  }

  if (accounts.length !== 1701) {
    throw new Error(
      `Iz uradnega PDF-ja je bilo prebranih ${accounts.length} kontov, pričakovanih pa je 1701.`,
    );
  }

  return accounts;
}

const layoutText = execFileSync("pdftotext", ["-layout", sourcePdf, "-"], {
  encoding: "utf8",
});
const accounts = extractSourceAccounts(layoutText);
const generatedSource = `/**
 * Samodejno ustvarjeno iz Uradnega lista RS št. 81/2024, Priloga 1
 * (Enotni kontni načrt). Ne urejaj ročno; za osvežitev zaženi
 * \`pnpm --filter @workspace/api-server run generate:srs-chart\`.
 */

export interface OfficialSrs2024SourceAccount {
  code: string;
  name: string;
}

export const OFFICIAL_SRS_2024_SOURCE: readonly OfficialSrs2024SourceAccount[] = ${JSON.stringify(
  accounts,
  null,
  2,
)} as const;
`;

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, generatedSource, "utf8");