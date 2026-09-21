/**
 * Development-only, rerunnable bootstrap for GOSTILNA KRIŽIŠČE.
 *
 * It intentionally provisions only configuration data.  Guest QR ordering,
 * KDS progression and receipt finalisation must be run through their HTTP
 * handlers: they have security, stock and fiscal side effects which this
 * bootstrap must never forge.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  artikliTable, blagajneTable, db, enoteTable, kategorijeTable, kdsNastavitveTable,
  kdsPostajaMapiranjaTable, kdsPostajeTable, mizeTable, multicourseMenuCoursesTable,
  multicourseMenusTable, nastavitveTable, normativiTable, poslovniProstoriTable, prostoriTable,
} from "@workspace/db";

const companyId = "24399fa0-9d99-4571-a77f-808ee59146ac";
const marker = "[DEV-SCENARIO:GOSTILNA-KRIZISCE]";
const capabilities: typeof enoteTable.$inferInsert.capabilities = ["tables", "checkout", "shifts", "receipts", "kitchen", "bar", "menu", "inventory", "simulation", "settings", "qr_menu", "multi_course"];
const token = () => randomBytes(32).toString("base64url");

type Report = Record<string, unknown>;

async function one<T>(work: () => Promise<T[]>): Promise<T | undefined> {
  return (await work())[0];
}

async function main(): Promise<void> {
  const report: Report = { scenario: "gostilna-krizisce", companyId, marker, mode: "configuration-only" };
  const companyUnits = await db.select({ id: enoteTable.id, ime: enoteTable.ime })
    .from(enoteTable).where(eq(enoteTable.companyId, companyId));
  if (!companyUnits.length) throw new Error(`Podjetje ${companyId} ne obstaja.`);

  // Explicitly only read unit 309 (if present); it is never an update target.
  const defaultUnit = companyUnits.find(unit => unit.id === 309);
  report.companyDefaultsReadFromUnit309 = defaultUnit?.id ?? null;

  let unit = await one(() => db.select().from(enoteTable).where(and(
    eq(enoteTable.companyId, companyId), eq(enoteTable.ime, `${marker} Restavracija`),
  )));
  if (!unit) {
    [unit] = await db.insert(enoteTable).values({
      companyId, ime: `${marker} Restavracija`,
      opis: "Idempotentni razvojni scenarij za à la carte strežbo.",
      hospitalityProfile: "restaurant", serviceMode: "table_service", capabilities,
      qrLatitude: "46.068000", qrLongitude: "15.183000", qrWifiNetworks: [],
    }).returning();
  }
  if (!unit || unit.id === 309) throw new Error("Scenarij ni dobil ločene poslovne enote.");
  report.unitId = unit.id;

  const premiseId = "SIM-KRIZISCE-24399";
  let premise = await one(() => db.select().from(poslovniProstoriTable).where(and(
    eq(poslovniProstoriTable.enotaId, unit!.id), eq(poslovniProstoriTable.prostorId, premiseId),
  )));
  if (!premise) {
    [premise] = await db.insert(poslovniProstoriTable).values({
      enotaId: unit.id, prostorId: premiseId, naziv: "Gostilna Križišče — simulacija",
      tipProstora: "nepremicnina", ulica: "OBREŽJE", hisnaStevilka: "5",
      skupnost: "RADEČE", kraj: "RADEČE", postnaStevilka: "1433",
      // Deliberately conspicuous non-production cadastral test values.
      katastrskaStevilka: "TEST-KO-1433-9999", stevilkaStavbe: "TEST-STAVBA-24399",
      stevilkaDelaStavbe: "TEST-DEL-01", veljavnostOd: "2025-01-01",
    }).returning();
  }
  report.premise = { id: premise!.id, ppId: premiseId, fursMode: "simulacija", cadastral: {
    ko: premise!.katastrskaStevilka, building: premise!.stevilkaStavbe, part: premise!.stevilkaDelaStavbe,
  }};

  let register = await one(() => db.select().from(blagajneTable).where(and(
    eq(blagajneTable.enotaId, unit!.id), eq(blagajneTable.ppId, premiseId), eq(blagajneTable.bId, "B-KRIZISCE-SIM-01"),
  )));
  if (!register) [register] = await db.insert(blagajneTable).values({
    enotaId: unit.id, ppId: premiseId, bId: "B-KRIZISCE-SIM-01", ime: "Blagajna Križišče (simulacija)",
  }).returning();
  report.cashRegister = { id: register!.id, ppId: register!.ppId, bId: register!.bId };
  for (const [kljuc, vrednost] of [
    ["davcnaStevilka", "11928174"],
    ["idZaDdv", "SI11928174"],
    ["ponudnikDavcna", "84040653"],
    ["poslovniProstor", premiseId],
    ["elektronskaNaprava", "B-KRIZISCE-SIM-01"],
    ["fursNacin", "simulacija"],
    ["testniNacin", "true"],
  ] as const) {
    await db.insert(nastavitveTable).values({ enotaId: unit.id, kljuc, vrednost })
      .onConflictDoUpdate({
        target: [nastavitveTable.enotaId, nastavitveTable.kljuc],
        set: { vrednost },
      });
  }

  async function category(ime: string, barva: string) {
    let row = await one(() => db.select().from(kategorijeTable).where(and(eq(kategorijeTable.enotaId, unit!.id), eq(kategorijeTable.ime, ime))));
    if (!row) [row] = await db.insert(kategorijeTable).values({ enotaId: unit!.id, ime, barva }).returning();
    return row!;
  }
  const foodCategory = await category(`${marker} Jedi`, "#b45309");
  const wineCategory = await category(`${marker} Vina 0,1 l`, "#7f1d1d");
  const inputCategory = await category(`${marker} Sestavine`, "#475569");

  async function article(input: typeof artikliTable.$inferInsert) {
    let row = await one(() => db.select().from(artikliTable).where(and(eq(artikliTable.enotaId, unit!.id), eq(artikliTable.ime, input.ime))));
    if (!row) [row] = await db.insert(artikliTable).values(input).returning();
    return row!;
  }
  const foods = await Promise.all([
    article({ enotaId: unit.id, ime: `${marker} 1. Kremna juha iz jurčkov`, cena: "8.50", davek: "9.5", kategorijaId: foodCategory.id, mealType: "ala_carte", qrNaVoljo: true }),
    article({ enotaId: unit.id, ime: `${marker} 2. File postrvi z blitvo in krompirjem`, cena: "18.00", davek: "9.5", kategorijaId: foodCategory.id, mealType: "ala_carte", qrNaVoljo: true }),
    article({ enotaId: unit.id, ime: `${marker} 3. Goveji file s polento in korenjem`, cena: "27.00", davek: "9.5", kategorijaId: foodCategory.id, mealType: "ala_carte", qrNaVoljo: true }),
    article({ enotaId: unit.id, ime: `${marker} 4. Orehova potica z vaniljevo kremo`, cena: "7.50", davek: "9.5", kategorijaId: foodCategory.id, mealType: "ala_carte", qrNaVoljo: true }),
  ]);
  const wineNames = ["Merlot", "Teran", "Malvazija", "Laški rizling", "Renski rizling"];
  const wines = await Promise.all(wineNames.map((name, i) =>
    article({ enotaId: unit!.id, ime: `${marker} ${name} 0,1 l`, cena: String(3.8 + i / 10), davek: "22", kategorijaId: wineCategory.id,
      enotaMere: "dl", jeAlkohol: true, taxCategory: "alcoholic", mealType: "ala_carte", qrNaVoljo: true })));
  const ingredientNames = [
    "Jurčki", "Sladka smetana", "Čebula", "Jušna osnova",
    "File postrvi", "Krompir", "Blitva", "Maslo",
    "Goveji file", "Polenta", "Demi-glace omaka", "Korenje",
    "Pšenična moka", "Orehi", "Jajca", "Mleko",
  ];
  const inputs = await Promise.all(ingredientNames.map(name =>
    article({ enotaId: unit!.id, ime: `${marker} vhod: ${name}`, cena: "0.01", kategorijaId: inputCategory.id,
      enotaMere: "kg", prodajniArtikel: false, nabavniArtikel: true, qrNaVoljo: false })));
  const recipeQuantities = [
    ["0.1200", "0.0500", "0.0300", "0.2500"],
    ["0.2200", "0.1800", "0.1200", "0.0200"],
    ["0.2200", "0.1500", "0.0600", "0.1000"],
    ["0.0800", "0.0600", "0.0500", "0.0500"],
  ];
  for (let course = 0; course < foods.length; course++) {
    for (let ingredient = 0; ingredient < 4; ingredient++) {
      const input = inputs[course * 4 + ingredient];
      const existing = await one(() => db.select().from(normativiTable).where(and(eq(normativiTable.artikelId, foods[course].id), eq(normativiTable.vhodniArtikelId, input.id))));
      if (!existing) await db.insert(normativiTable).values({
        artikelId: foods[course].id,
        vhodniArtikelId: input.id,
        kolicina: recipeQuantities[course][ingredient],
        vrstniRed: ingredient + 1,
      });
    }
  }
  const wineInputs = await Promise.all(wineNames.map(name =>
    article({ enotaId: unit!.id, ime: `${marker} vhod: ${name} buteljka 0,75 l`, cena: "10.00", kategorijaId: inputCategory.id,
      enotaMere: "l", prodajniArtikel: false, nabavniArtikel: true, qrNaVoljo: false })));
  for (let i = 0; i < wines.length; i++) {
    const existing = await one(() => db.select().from(normativiTable).where(and(eq(normativiTable.artikelId, wines[i].id), eq(normativiTable.vhodniArtikelId, wineInputs[i].id))));
    if (!existing) await db.insert(normativiTable).values({ artikelId: wines[i].id, vhodniArtikelId: wineInputs[i].id, kolicina: "0.1000", vrstniRed: 1 });
  }

  const fixed = await article({ enotaId: unit.id, ime: `${marker} Fiksni štirihodnik`, cena: "61.00", kategorijaId: foodCategory.id, mealType: "composite", qrNaVoljo: true, jeDelMenija: true });
  const choose = await article({ enotaId: unit.id, ime: `${marker} Izberi tri hode`, cena: "48.00", kategorijaId: foodCategory.id, mealType: "composite", qrNaVoljo: true, jeDelMenija: true });
  for (const [menu, izbor] of [[fixed, "fixed_four"], [choose, "choose_three"]] as const) {
    let config = await one(() => db.select().from(multicourseMenusTable).where(eq(multicourseMenusTable.menuArtikelId, menu.id)));
    if (!config) [config] = await db.insert(multicourseMenusTable).values({ enotaId: unit.id, menuArtikelId: menu.id, izbor }).returning();
    for (let i = 0; i < 4; i++) {
      const found = await one(() => db.select().from(multicourseMenuCoursesTable).where(and(eq(multicourseMenuCoursesTable.menuId, config!.id), eq(multicourseMenuCoursesTable.courseNumber, i + 1))));
      if (!found) await db.insert(multicourseMenuCoursesTable).values({ menuId: config!.id, courseNumber: i + 1, foodArtikelId: foods[i].id, allowedWineArtikelIds: wines.map(wine => wine.id) });
    }
  }

  let room = await one(() => db.select().from(prostoriTable).where(and(eq(prostoriTable.enotaId, unit!.id), eq(prostoriTable.ime, `${marker} Jedilnica`))));
  if (!room) [room] = await db.insert(prostoriTable).values({ enotaId: unit.id, ime: `${marker} Jedilnica`, vrstniRed: 1 }).returning();
  const tables: number[] = [];
  for (const number of [1, 2]) {
    let table = await one(() => db.select().from(mizeTable).where(and(eq(mizeTable.enotaId, unit!.id), eq(mizeTable.stevilka, number))));
    if (!table) [table] = await db.insert(mizeTable).values({ enotaId: unit.id, stevilka: number, ime: `Miza ${number}`, prostorId: room!.id, qrToken: token() }).returning();
    tables.push(table!.id);
  }

  let kitchen = await one(() => db.select().from(kdsPostajeTable).where(and(eq(kdsPostajeTable.enotaId, unit!.id), eq(kdsPostajeTable.ime, "Kuhinja"))));
  if (!kitchen) [kitchen] = await db.insert(kdsPostajeTable).values({ enotaId: unit.id, ime: "Kuhinja", tip: "kitchen" }).returning();
  let bar = await one(() => db.select().from(kdsPostajeTable).where(and(eq(kdsPostajeTable.enotaId, unit!.id), eq(kdsPostajeTable.ime, "Bar"))));
  if (!bar) [bar] = await db.insert(kdsPostajeTable).values({ enotaId: unit.id, ime: "Bar", tip: "bar" }).returning();
  for (const [station, categoryId] of [[kitchen!, foodCategory.id], [bar!, wineCategory.id]] as const) {
    const mapped = await one(() => db.select().from(kdsPostajaMapiranjaTable).where(and(eq(kdsPostajaMapiranjaTable.postajaId, station.id), eq(kdsPostajaMapiranjaTable.kategorijaId, categoryId))));
    if (!mapped) await db.insert(kdsPostajaMapiranjaTable).values({ postajaId: station.id, kategorijaId: categoryId });
  }
  await db.insert(kdsNastavitveTable).values({ enotaId: unit.id, profil: "bar_separate_kitchen_pizza", fallbackPostajaId: kitchen!.id }).onConflictDoNothing();
  report.ids = { categories: [foodCategory.id, wineCategory.id, inputCategory.id], foods: foods.map(x => x.id), wines: wines.map(x => x.id), tables, roomId: room!.id, stations: { kitchen: kitchen!.id, bar: bar!.id } };
  report.blocker = "Configuration persisted. QR orders, waiter calls, KDS progression and receipts were intentionally not forged: execute them only through authenticated public/POS route handlers with FURS unit settings explicitly set to simulacija.";
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ scenario: "gostilna-krizisce", error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });