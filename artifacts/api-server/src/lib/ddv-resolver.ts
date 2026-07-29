/**
 * DDV razreševalnik — določi pravilno DDV stopnjo glede na kontekst:
 *   supply_kind (eat_in / to_go) × tax_category × added_sugar × nastavitve
 *
 * Pravila so shranjena v tabeli vat_rule in naložena ob prvem klicu (cache v procesu).
 * Za konfigurirano pravilo (configurable=true) se upošteva nastavitev toGoTopliNapitekStopnja.
 */

import { db, vatRuleTable, nastavitveTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type SupplyKind = "eat_in" | "to_go";
export type TaxCategory = "food" | "hot_beverage" | "cold_beverage" | "alcoholic" | "food_drink";

export interface ResolveRateInput {
  supplyKind: SupplyKind;
  taxCategory: TaxCategory;
  addedSugar: boolean;
  /** Nastavitve enote (kljuc→vrednost) — za configurable pravila */
  nastavitve: Record<string, string>;
  /** Privzeta stopnja (iz artikel.davek) — fallback ko nobeno pravilo ne velja */
  fallbackRate: number;
  /** Ali je podjetje DDV zavezanec — če ne, vedno vrni 0 */
  jeDdvZavezanec: boolean;
}

export interface ResolveRateResult {
  rate: number;
  ruleId: number | null;
  ruleLabel: string | null;
}

// Tip pravila (runtime cache)
interface VatRuleRow {
  id: number;
  priority: number;
  supplyKind: string | null;
  taxCategory: string | null;
  addedSugar: boolean | null;
  rate: string;
  configurable: boolean;
  label: string;
}

let rulesCache: VatRuleRow[] | null = null;

/**
 * Privzeta DDV pravila — vstavijo se samodejno pri prvem zagonu ali ko kakšno manjka.
 * Vsako pravilo je identificirano z unikatnim label-om; manjkajoča se dodajo idempotentno.
 *
 * COLD_BEVERAGE — razlika sladkano/nesladkano:
 *   - addedSugar=true → 22 % v vsakem primeru (sladke gaziranke, nektarji s sladkorjem)
 *   - addedSugar=false/null → 9,5 % to-go, 22 % za mizo
 *   Pravila za sladkane imajo višjo prioriteto (5) pred splošnimi (10).
 *
 * FOOD_DRINK — „napitki, ki se davčno štejejo za jed" (gosta vroča čokolada, smoothie,
 *   frappé, zamrznjeni jogurt): 9,5 % tako za mizo kot to-go (FURS: priprava jedi).
 */
const DEFAULT_VAT_RULES: Omit<VatRuleRow, "id">[] = [
  { priority: 10, supplyKind: "eat_in",  taxCategory: "food",          addedSugar: null,  rate: "9.50",  configurable: false, label: "Hrana na mestu" },
  { priority: 10, supplyKind: "to_go",   taxCategory: "food",          addedSugar: null,  rate: "9.50",  configurable: false, label: "Hrana za s seboj" },
  { priority: 10, supplyKind: "eat_in",  taxCategory: "hot_beverage",  addedSugar: null,  rate: "22.00", configurable: false, label: "Topla pijača na mestu" },
  { priority: 20, supplyKind: "to_go",   taxCategory: "hot_beverage",  addedSugar: true,  rate: "22.00", configurable: false, label: "Topla pijača za s seboj (s sladkorjem)" },
  { priority: 30, supplyKind: "to_go",   taxCategory: "hot_beverage",  addedSugar: false, rate: "9.50",  configurable: true,  label: "Topla pijača za s seboj (brez sladkorja) — liberalno" },
  { priority: 35, supplyKind: "to_go",   taxCategory: "hot_beverage",  addedSugar: false, rate: "22.00", configurable: false, label: "Topla pijača za s seboj (brez sladkorja) — konservativno" },
  // cold_beverage: sladkane vedno 22 % (prioriteta 5 — pred splošnimi pri 10)
  { priority: 5,  supplyKind: null,      taxCategory: "cold_beverage", addedSugar: true,  rate: "22.00", configurable: false, label: "Sladkana hladna pijača (vedno 22 %)" },
  // cold_beverage: nesladkane — 22 % za mizo, 9,5 % za s seboj
  { priority: 10, supplyKind: "eat_in",  taxCategory: "cold_beverage", addedSugar: null,  rate: "22.00", configurable: false, label: "Hladna pijača na mestu" },
  { priority: 10, supplyKind: "to_go",   taxCategory: "cold_beverage", addedSugar: null,  rate: "9.50",  configurable: false, label: "Hladna pijača za s seboj" },
  { priority: 10, supplyKind: null,      taxCategory: "alcoholic",     addedSugar: null,  rate: "22.00", configurable: false, label: "Alkoholna pijača" },
  // food_drink: napitki, ki se davčno štejejo za jed (FURS: 9,5 % tudi za mizo)
  { priority: 10, supplyKind: null,      taxCategory: "food_drink",    addedSugar: null,  rate: "9.50",  configurable: false, label: "Pijača-jed (vroča čokolada, smoothie, frappé)" },
];

export async function loadVatRules(): Promise<VatRuleRow[]> {
  if (rulesCache) return rulesCache;
  const rows = await db.select().from(vatRuleTable).orderBy(vatRuleTable.priority);

  // Idempotentno dopolnjevanje — vstavi pravila, ki manjkajo (identificirana po label-u).
  // Deluje za sveže okolje (0 pravil) in za nadgradnje (manjkajoča pravila se dodajo).
  const obstojeciLabeli = new Set(rows.map(r => r.label));
  const manjkajoca = DEFAULT_VAT_RULES.filter(r => !obstojeciLabeli.has(r.label));
  if (manjkajoca.length > 0) {
    await db.insert(vatRuleTable).values(
      manjkajoca.map(r => ({
        priority: r.priority,
        supplyKind: r.supplyKind,
        taxCategory: r.taxCategory,
        addedSugar: r.addedSugar,
        rate: r.rate,
        configurable: r.configurable,
        label: r.label,
      }))
    );
    const osvezeno = await db.select().from(vatRuleTable).orderBy(vatRuleTable.priority);
    rulesCache = osvezeno as VatRuleRow[];
    return rulesCache;
  }

  rulesCache = rows as VatRuleRow[];
  return rulesCache;
}

/** Razveljavi cache (kliče se ob spremembi pravil) */
export function invalidateVatRulesCache(): void {
  rulesCache = null;
}

/**
 * resolveRate — vrne DDV stopnjo in ID pravila za dano situacijo.
 */
export function resolveRate(input: ResolveRateInput, rules: VatRuleRow[]): ResolveRateResult {
  if (!input.jeDdvZavezanec) {
    return { rate: 0, ruleId: null, ruleLabel: "Ni DDV zavezanec" };
  }

  const toGoSetting = input.nastavitve["toGoTopliNapitekStopnja"] ?? "konservativno";

  for (const rule of rules) {
    // Filtriraj po supply_kind
    if (rule.supplyKind !== null && rule.supplyKind !== input.supplyKind) continue;
    // Filtriraj po tax_category
    if (rule.taxCategory !== null && rule.taxCategory !== input.taxCategory) continue;
    // Filtriraj po added_sugar
    if (rule.addedSugar !== null && rule.addedSugar !== input.addedSugar) continue;
    // Konfigurirano pravilo — velja le pri nastavitvi "liberalno"
    if (rule.configurable && toGoSetting !== "liberalno") continue;

    return {
      rate: Number(rule.rate),
      ruleId: rule.id,
      ruleLabel: rule.label,
    };
  }

  // Noben ujetek — fallback na artikel.davek
  return { rate: input.fallbackRate, ruleId: null, ruleLabel: null };
}

/**
 * resolveSupplyKind — določi supply kind iz narocila.toGo in postavka.toGo
 */
export function resolveSupplyKind(narociloToGo: boolean, postavkaToGo: boolean): SupplyKind {
  return (narociloToGo || postavkaToGo) ? "to_go" : "eat_in";
}

/**
 * getNastavitveMap — preberi nastavitve za enoto iz baze
 */
export async function getNastavitveMap(enotaId: number): Promise<Record<string, string>> {
  const rows = await db
    .select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(eq(nastavitveTable.enotaId, enotaId));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.kljuc] = r.vrednost;
  return map;
}
