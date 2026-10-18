// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const erpRoot = fileURLToPath(new URL("../../", import.meta.url));
const forbiddenPackage = /^(?:npm:)?(?:html2canvas|jspdf)(?:$|[/@])/i;
const dependencySections = [
  "dependencies", "devDependencies", "optionalDependencies", "peerDependencies",
] as const;

function forbiddenDependencies(manifest: Record<string, unknown>): string[] {
  return dependencySections.flatMap((section) =>
    Object.entries((manifest[section] ?? {}) as Record<string, string>)
      .filter(([name, version]) =>
        forbiddenPackage.test(name) || forbiddenPackage.test(version))
      .map(([name]) => `${section}.${name}`),
  );
}

function forbiddenReferences(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visit(node: ts.Node) {
    // Inspect literals rather than import declarations only: this also covers
    // import(), require(), re-exports, and constants used in lazy imports.
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) &&
      forbiddenPackage.test(node.text)
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      violations.push(`${fileName}:${line + 1}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(fullPath);
    }
    // Tests intentionally contain examples of prohibited imports.
    return entry.isFile() &&
      /\.[cm]?[jt]sx?$/.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ? [fullPath] : [];
  });
}

describe("ERP PDF reports stay on the existing server export", () => {
  it("does not declare browser PDF renderer dependencies", () => {
    const manifest = JSON.parse(readFileSync(path.join(erpRoot, "package.json"), "utf8"));
    expect(forbiddenDependencies(manifest),
      "ERP PDF reports must use the server export, not html2canvas or jspdf",
    ).toEqual([]);
  });

  it("does not reference browser PDF renderers anywhere in ERP application source", () => {
    const files = sourceFiles(path.join(erpRoot, "src"));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) =>
      forbiddenReferences(path.relative(erpRoot, file), readFileSync(file, "utf8")));
    expect(violations,
      "Remove browser PDF rendering and use the existing server PDF export",
    ).toEqual([]);
  });

  describe("guard regression cases", () => {
    it.each(dependencySections)("rejects both packages and npm aliases in %s", (section) => {
      for (const name of ["html2canvas", "jspdf"]) {
        expect(forbiddenDependencies({ [section]: { [name]: "^1.0.0" } }))
          .toEqual([`${section}.${name}`]);
        expect(forbiddenDependencies({ [section]: { renderer: `npm:${name}@^1.0.0` } }))
          .toEqual([`${section}.renderer`]);
      }
    });

    it.each([
      'import renderer from "html2canvas";',
      'import { jsPDF } from "jspdf";',
      'export { jsPDF } from "jspdf";',
      'const renderer = require("html2canvas");',
      'const pdf = await import("jspdf");',
      'const canvas = import("html2canvas/dist/html2canvas.esm.js");',
      'const pdf = import(`jspdf/dist/jspdf.es.min.js`);',
      'const name = "jspdf"; const pdf = import(name);',
      'const pdf = import(`jspdf/${build}`);',
    ])("detects prohibited reference: %s", (source) => {
      expect(forbiddenReferences("nested/report.tsx", source)).toHaveLength(1);
      expect(forbiddenReferences("nested/report.tsx", source)[0])
        .toMatch(/^nested\/report\.tsx:1:/);
    });

    it("allows server exports, unrelated modules, and comments about the old implementation", () => {
      expect(forbiddenDependencies({ dependencies: { exceljs: "^4.4.0" } })).toEqual([]);
      expect(forbiddenReferences("report.ts", `
        // Do not bring back import("jspdf") or html2canvas.
        import { apiFetch } from "@/lib/api";
        const excel = import("exceljs");
        const pdf = apiFetch("/api/reports/dimensions/pdf");
      `)).toEqual([]);
    });
  });
});
