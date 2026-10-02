import { DOMParser } from "@xmldom/xmldom";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";
import { AjpesXmlInputError, generateAjpesXml, type AjpesXmlInput } from "./xml";

const temporaryDirectories: string[] = [];
const schemaPath = resolve(import.meta.dirname, "schema/LP_V1_3.xsd");
const javaValidatorPath = resolve(import.meta.dirname, "schema/ValidateAjpesXsd.java");

function amounts(overrides: Record<string, string | number> = {}): Record<string, string | number> {
  return Object.fromEntries([
    ...AJPES_GD_AOP_CATALOG_2025.aops.map(({ id }) => [id, 0]),
    ...Object.entries(overrides),
  ]);
}

function input(overrides: Partial<AjpesXmlInput> = {}): AjpesXmlInput {
  return {
    year: 2025,
    company: {
      registrationNumber: "0000000001",
      name: "Družba & sinovi",
      registeredOffice: 'Koper <center> "A"',
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      accountingMethod: 2,
      size: 1,
    },
    current: amounts({ "002": "12.345", "001": "1.2", "284": "-0.01" }),
    previous: amounts({ "001": 0, "002": "12.34", "284": "3" }),
    generatedAt: new Date("2026-03-01T12:34:56.000Z"),
    ...overrides,
  };
}

function validateWithOfficialSchema(xml: string): void {
  const directory = mkdtempSync(join(tmpdir(), "ajpes-lp-"));
  temporaryDirectories.push(directory);
  const xmlPath = join(directory, "annual-report.xml");
  writeFileSync(xmlPath, xml, "utf8");
  const result = spawnSync("java", [javaValidatorPath, schemaPath, xmlPath], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AJPES LP 2025 XML exporter", () => {
  it("emits a parseable GD document accepted by the published AJPES LP v1.3 XSD", () => {
    const xml = generateAjpesXml(input());
    const parseErrors: string[] = [];
    const document = new DOMParser({
      onError: (level, message) => {
        if (level === "error" || level === "fatalError") parseErrors.push(message);
      },
    }).parseFromString(xml, "application/xml");

    expect(parseErrors).toEqual([]);
    expect(document.documentElement?.nodeName).toBe("AjpesDokument");
    expect(document.getElementsByTagName("Ident").item(0)?.getAttribute("Vrsta")).toBe("LP");
    expect(document.getElementsByTagName("Osnovni_podatki").item(0)?.getAttribute("vrstaPoslovnegaSubjekta")).toBe("GD");
    expect(document.getElementsByTagName("OSN_Maticna_stevilka").item(0)?.textContent).toBe("0000000001");
    expect(document.getElementsByTagName("OSN_Ime").item(0)?.textContent).toBe("Družba & sinovi");
    expect(document.getElementsByTagName("OSN_Sedez").item(0)?.textContent).toBe('Koper <center> "A"');

    const aops = Array.from(document.getElementsByTagName("AOP"));
    expect(aops).toHaveLength(263);
    expect(aops.slice(0, 3).map((aop) => aop.getAttribute("ID"))).toEqual(["001", "002", "003"]);
    expect(aops[0].getElementsByTagName("PODATEK").item(0)?.textContent).toBe("1.20");
    expect(aops[1].getElementsByTagName("PODATEK").item(0)?.textContent).toBe("12.35");
    expect(aops.find((aop) => aop.getAttribute("ID") === "284")
      ?.getElementsByTagName("PODATEK").item(0)?.textContent).toBe("-0.01");

    validateWithOfficialSchema(xml);
    expect(readFileSync(schemaPath, "utf8")).toContain("element name=\"AjpesDokument\"");
  });

  it("escapes XML text and rounds signed euro amounts to cents", () => {
    const xml = generateAjpesXml(input({
      company: { registrationNumber: "1234567", name: "A & B <C>" },
      current: amounts({ "001": "-1.235" }),
      previous: amounts({ "001": "-1.234" }),
    }));
    expect(xml).toContain("<OSN_Ime>A &amp; B &lt;C&gt;</OSN_Ime>");
    expect(xml).toContain('<PODATEK TIP="T">-1.24</PODATEK>');
    expect(xml).toContain('<PODATEK TIP="P">-1.23</PODATEK>');
  });

  it("rejects unsupported years instead of using a newer/older schema speculatively", () => {
    expect(() => generateAjpesXml({ ...input(), year: 2026 } as unknown as AjpesXmlInput)).toThrow(AjpesXmlInputError);
  });

  it("rejects missing and mismatched report amounts rather than silently filling zeroes", () => {
    expect(() => generateAjpesXml(input({ current: {}, previous: {} }))).toThrow(/at least one AOP/);
    const missingPrevious = amounts();
    delete missingPrevious["001"];
    expect(() => generateAjpesXml(input({ previous: missingPrevious }))).toThrow(/sets must match exactly/);
    const unexpectedIds = amounts();
    delete unexpectedIds["001"];
    unexpectedIds["999"] = 1;
    expect(() => generateAjpesXml(input({
      current: unexpectedIds,
      previous: unexpectedIds,
    }))).toThrow(/official 2025 GD catalogue/);
  });

  it("rejects malformed company data, period dates, AOP identifiers, and non-decimal amounts", () => {
    expect(() => generateAjpesXml(input({ company: { registrationNumber: "123" } }))).toThrow(/registrationNumber/);
    expect(() => generateAjpesXml(input({
      company: { registrationNumber: "1234567", periodStart: "2025-02-30", periodEnd: "2025-12-31" },
    }))).toThrow(/valid calendar date/);
    expect(() => generateAjpesXml(input({ current: { "01": 1 }, previous: { "01": 1 } }))).toThrow(/invalid AOP ID/);
    expect(() => generateAjpesXml(input({
      current: amounts({ "001": "1,25" }),
      previous: amounts(),
    }))).toThrow(/decimal amount/);
  });

  it("contains the granular official leaf catalogue and supports optional disclosure text", () => {
    const catalog = AJPES_GD_AOP_CATALOG_2025.aops;
    expect(catalog).toHaveLength(263);
    const hiddenLeaf = catalog.find(({ id }) => id === "112");
    expect(hiddenLeaf).toMatchObject({
      form: "IPI",
      label: "Čisti prihodki od prodaje proizvodov in storitev razen najemnin",
      aopColumnVisible: false,
    });
    expect(catalog.find(({ id }) => id === "111")?.formula).toBe("112 do 114");

    const xml = generateAjpesXml(input({
      notes: {
        explanations: "Pojasnila & dodatna razkritja",
        disclosure4: "Razkritje <4>",
        profitAllocationProposal: "Predlog",
      },
    }));
    expect(xml).toContain("<Pojasnila>Pojasnila &amp; dodatna razkritja</Pojasnila>");
    expect(xml).toContain("<Razkritje_informacij_iz_4_tocke>Razkritje &lt;4&gt;</Razkritje_informacij_iz_4_tocke>");
    expect(xml).toContain("<Predlog_razporeditve_dobicka>Predlog</Predlog_razporeditve_dobicka>");
    validateWithOfficialSchema(xml);
  });
});