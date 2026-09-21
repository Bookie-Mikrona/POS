import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

throw new Error(
  "generate-company-chart.ts je zastarel: COMPANY_CHART_SOURCE je ročno urejen po SIR 2024 in se ne sme regenerirati iz PDF-ja.",
);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceDir = resolve(packageDir, "../..");
const sourcePdf = resolve(
  workspaceDir,
  "attached_assets/kontni_plan_pravi_1787350691930.pdf",
);
const outputFile = resolve(packageDir, "src/lib/generatedCompanyChartSource.ts");
const EXPECTED_ACCOUNT_COUNT = 266;

interface SourceAccount {
  code: string;
  name: string;
}

interface PdfWord {
  xMin: number;
  text: string;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"');
}

function parseWords(lineXml: string): PdfWord[] {
  const words: PdfWord[] = [];
  const wordPattern = /<word xMin="([^"]+)"[^>]*>([\s\S]*?)<\/word>/g;

  for (const match of lineXml.matchAll(wordPattern)) {
    const text = decodeHtml(match[2]).trim();
    if (text) words.push({ xMin: Number(match[1]), text });
  }

  return words.sort((left, right) => left.xMin - right.xMin);
}

function extractSourceAccounts(bboxText: string): SourceAccount[] {
  const accounts: SourceAccount[] = [];
  const codes = new Set<string>();

  const addAccount = (code: string, name: string): void => {
    if (!/^(?:\d{3}|\d{7})$/.test(code)) {
      throw new Error(`Neveljavna končna koda ${code}.`);
    }
    if (!name) {
      throw new Error(`Konto ${code} v prilogi nima naziva.`);
    }
    if (codes.has(code)) {
      throw new Error(`Priloga vsebuje podvojen konto ${code}.`);
    }
    codes.add(code);
    accounts.push({ code, name });
  };

  for (const line of bboxText.matchAll(/<line [^>]*>([\s\S]*?)<\/line>/g)) {
    const words = parseWords(line[1]);
    const separatorIndex = words.findIndex((word) => word.text === "–");
    if (separatorIndex === -1) continue;

    // Koda in naziv sta vedno na desni strani oznake alineje. Besedilo pred
    // pomišljajem lahko pomeni posamezen konto ali skupni sintetični naslov.
    const label = words
      .slice(0, separatorIndex)
      .filter((word) => word.xMin >= 95)
      .map((word) => word.text)
      .join(" ");
    const name = words
      .slice(separatorIndex + 1)
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (/^\d{3}$/.test(label)) {
      addAccount(label, name);
      continue;
    }

    if (/^\d{4}$/.test(label)) {
      // Uporabnik je določil, da vsak 4-mestni konto postane 7-mesten
      // z dodanimi tremi ničlami.
      addAccount(`${label}000`, name);
      continue;
    }

    const rangeMatch = label.match(/^(\d{3}) do (\d{3})$/);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (from > to || Math.floor(from / 100) !== Math.floor(to / 100)) {
        throw new Error(`Neveljaven razpon sintetičnih kontov ${label}.`);
      }
      for (let code = from; code <= to; code += 1) {
        addAccount(String(code).padStart(3, "0"), name);
      }
      continue;
    }

    const listMatch = label.match(/^(\d{3}) \/ (\d{3})$/);
    if (listMatch) {
      addAccount(listMatch[1], name);
      addAccount(listMatch[2], name);
    }
  }

  // Nekaj skupnih naslovov v PDF-ju zajema več 3-mestnih skupin (na primer
  // 740 Finančni odhodki vsebuje tudi analitiko 7420). Za takšno analitiko
  // ustvarimo edino manjkajočo sintetično raven z nazivom nadrejenega naslova.
  for (const account of [...accounts]) {
    if (account.code.length !== 7) continue;

    const parentCode = account.code.slice(0, 3);
    if (codes.has(parentCode)) continue;

    const parentName = accounts.find(
      (candidate) =>
        candidate.code.length === 3 &&
        candidate.code.slice(0, 2) === parentCode.slice(0, 2),
    )?.name;
    if (!parentName) {
      throw new Error(
        `Analitični konto ${account.code} nima opisa za sintetičnega starša ${parentCode}.`,
      );
    }
    addAccount(parentCode, parentName);
  }

  if (accounts.length !== EXPECTED_ACCOUNT_COUNT) {
    throw new Error(
      `Iz priloge je bilo prebranih ${accounts.length} končnih kontov, pričakovanih pa je ${EXPECTED_ACCOUNT_COUNT}.`,
    );
  }

  return accounts;
}

const bboxText = execFileSync("pdftotext", ["-bbox-layout", sourcePdf, "-"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const accounts = extractSourceAccounts(bboxText);
const generatedSource = `/**
 * Samodejno ustvarjeno iz priloge »kontni plan pravi«.
 * Vsi 4-mestni konti iz priloge so pretvorjeni v 7-mestne z dodanimi tremi
 * končnimi ničlami. Ne urejaj ročno; za osvežitev zaženi
 * \`pnpm --filter @workspace/api-server run generate:company-chart\`.
 */

export interface CompanyChartSourceAccount {
  code: string;
  name: string;
   requiresPartner?: boolean;
   isCash?: boolean;
   taxBehavior?: "input" | "output" | "none";
   isOpenItem?: boolean;
}

export const COMPANY_CHART_SOURCE: readonly CompanyChartSourceAccount[] = ${JSON.stringify(
  accounts,
  null,
 2,
)} as const;
`;

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, generatedSource, "utf8");