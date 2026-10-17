import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateAllergenNormativePdf } from "./allergen-normative-pdf";
import { registerPdfFonts } from "./pdf-fonts";
import { generateJournalExportPdf, generatePosInvoicePdf, generateReceivedInvoicePdf } from "./external-export-pdf";

function extract(buffer: Buffer): string {
  return execFileSync("pdftotext", ["-layout", "-", "-"], { input: buffer, encoding: "utf8" });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file)
      : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [file] : [];
  });
}

describe("Unicode pisave v strežniških PDF-jih", () => {
  it("vsak PDFDocument registrira obe DejaVu pisavi, tudi pretvorbe slik za OCR", () => {
    const failures: string[] = [];
    let constructors = 0;
    for (const file of sourceFiles(path.join(import.meta.dirname, ".."))) {
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const functions = new Map<string, ts.FunctionDeclaration>();
      function index(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
        ts.forEachChild(node, index);
      }
      index(ast);
      function check(node: ts.Node) {
        // Catch built-in font regressions even in otherwise Unicode-aware renderers.
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "font" && node.arguments[0]
          && ts.isStringLiteral(node.arguments[0])) {
          expect(node.arguments[0].text, file).not.toMatch(/^(Helvetica|Times|Courier|Symbol|ZapfDingbats)/);
        }
        if (ts.isNewExpression(node) && node.expression.getText(ast) === "PDFDocument") {
          constructors++;
          const declaration = node.parent;
          if (!ts.isVariableDeclaration(declaration)) throw new Error(`Neznan vzorec PDF: ${file}`);
          const variable = declaration.name.getText(ast);
          let scope: ts.Node = declaration;
          while (scope.parent && !ts.isBlock(scope)) scope = scope.parent;
          const body = scope.getText(ast);
          const helper = /\b(registerFonts|setup|registerPdfFonts)\s*\(/g;
          let registrationBody = body;
          for (const match of body.matchAll(helper)) {
            if (match[1] === "registerPdfFonts") {
              registrationBody += readFileSync(path.join(import.meta.dirname, "pdf-fonts.ts"), "utf8");
            } else {
              registrationBody += functions.get(match[1]!)?.getText(ast) ?? "";
            }
          }
          const directRegistrations = body.match(new RegExp(`\\b${variable}\\.registerFont\\(`, "g")) ?? [];
          const callsHelper = [...body.matchAll(helper)].length > 0;
          if ((!callsHelper && directRegistrations.length < 2)
            || !registrationBody.includes(".registerFont(")
            || !(source + registrationBody).includes("DejaVuSans.ttf")
            || !(source + registrationBody).includes("DejaVuSans-Bold.ttf")) {
            failures.push(`${path.relative(path.join(import.meta.dirname, ".."), file)}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          }
        }
        ts.forEachChild(node, check);
      }
      check(ast);
    }
    expect(constructors).toBeGreaterThan(0);
    expect(failures, "PDF konstruktorji brez obeh Unicode pisav").toEqual([]);
  });

  it("ohrani male in velike šumnike v navadni, krepki in privzeti pisavi na več straneh", async () => {
    const doc = new PDFDocument();
    registerPdfFonts(doc);
    const done = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.text("Privzeto: čšž ČŠŽ");
    doc.font("DejaVuSans-Bold").text("Krepko: čšž ČŠŽ");
    doc.addPage().font("DejaVuSans").text("Druga stran: čšž ČŠŽ");
    doc.end();
    const pdf = await done;
    const text = extract(pdf);
    for (const label of ["Privzeto", "Krepko", "Druga stran"]) expect(text).toContain(`${label}: čšž ČŠŽ`);
    expect(pdf.toString("latin1")).toContain("DejaVuSans-Bold");
    expect(pdf.toString("latin1")).not.toContain("/BaseFont /Helvetica");
  });

  it("ohrani šumnike v vseh podatkih javnega alergenskega normativa in pri prelomih strani", async () => {
    const pdf = await generateAllergenNormativePdf({
      enotaId: 1,
      artikel: { ime: "ČŠŽ čšž", revision: 2, hash: null, verifiedBy: "Špela Černe Žagar", verifiedAt: null },
      sestavine: Array.from({ length: 65 }, () => ({ ime: "Žlička čičerike s ščepcem soli", kolicina: "1.000" })),
      izracun: {
        potrjen: true, alergeni: [{ koda: "GLUTEN", naziv: "Žita, ki vsebujejo gluten" }],
        alergeniSledi: [{ koda: "OREŠČKI", naziv: "Oreščki" }],
        izvori: [{ artikelId: 1, artikel: "Čičerika", vir: "Proizvajalčeva deklaracija", documentId: "ŽČŠ" }],
        opozorila: ["Preveri količino in svežino."],
      },
    });
    const text = extract(pdf);
    for (const value of [
      "Artikel: ČŠŽ čšž", "Špela Černe Žagar", "ni izračunan", "Čas izvoza",
      "Sestavine / količine", "Žlička čičerike s ščepcem soli", "Žita, ki vsebujejo gluten",
      "Oreščki", "Proizvajalčeva deklaracija", "ŽČŠ", "Preveri količino in svežino.",
    ]) expect(text).toContain(value);
    expect(text.split("\f").filter(page => page.trim()).length).toBeGreaterThan(1);
    expect(pdf.toString("latin1")).not.toContain("/BaseFont /Helvetica");
  });

  it("ohrani šumnike v izvozu temeljnic in obeh vrstah računov", async () => {
    const name = "ČŠŽ čšž";
    const journal = await generateJournalExportPdf([{
      id: "test", companyName: name, documentDate: null, entryDate: "2026-10-17",
      reference: name, description: name, status: "knjiženo",
      lines: [{
        accountCode: "110", accountName: name, debit: "1.00", credit: "1.00", partner: name,
        partnerId: null, partnerTaxId: null, partnerVatId: null, partnerRegistrationNumber: null,
        partnerAddress: name, costCenter: name, vatCode: null, vatRate: null,
        vatAmount: "0.00", date: "2026-10-17", reference: name, description: name,
      }],
    }]);
    const issued = await generatePosInvoicePdf({
      companyName: name, invoiceNumber: name, issuedAt: "17.10.2026", customerName: name,
      customerAddress: name, paymentMethod: "gotovina", total: "1.00", vat: "0.00",
      items: [{ name, quantity: "1", unitPrice: "1.00", total: "1.00", vatRate: "0" }],
    });
    const received = await generateReceivedInvoicePdf({
      supplierName: name, customerName: name, invoiceNumber: name, invoiceDate: "17.10.2026",
      dueDate: null, currency: "EUR", netTotal: "1.00", vatTotal: "0.00", grossTotal: "1.00",
      items: [{ name, quantity: "1", unitPrice: "1.00", total: "1.00", vatRate: "0" }],
    });
    for (const pdf of [journal, issued, received]) {
      expect(extract(pdf).match(/ČŠŽ čšž/g)!.length).toBeGreaterThanOrEqual(3);
      expect(pdf.toString("latin1")).not.toContain("/BaseFont /Helvetica");
    }
  });
});
