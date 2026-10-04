/**
 * Explicit, development-only import of researched dessert drafts for Križišče.
 * Never overwrites existing articles, prices, normative rows, stock or documents.
 * Recipe quantities are per prepared portion, not per cake/tray.
 */
import { pool } from "@workspace/db";
import Decimal from "decimal.js";

const UNIT = 309;
const COMPANY = "24399fa0-9d99-4571-a77f-808ee59146ac";
const MARKER = "[Razvojni osnutek sladice]";
type Raw = { name: string; unit: "KGM" | "LTR" | "H87"; note?: string };
const raw: Record<string, Raw> = {
  flour: { name: "Moka pšenična gladka", unit: "KGM" },
  butter: { name: "Maslo", unit: "KGM" },
  sugar: { name: "Sladkor kristalni", unit: "KGM" },
  icing: { name: "Sladkor v prahu za posip", unit: "KGM" },
  milk: { name: "Mleko 3,5% 1l", unit: "LTR" },
  cream: { name: "Smetana", unit: "LTR" },
  eggs: { name: "Jajca (sveža, kokošja)", unit: "H87" },
  oil: { name: "Olje sončnično", unit: "LTR" },
  salt: { name: "Sol", unit: "KGM" },
  rum: { name: "Rum 1 liter", unit: "LTR" },
  lemon: { name: "Limona", unit: "KGM" },
  curd: { name: "Skuta polnomastna", unit: "KGM" },
  poppy: { name: "Mak mleti", unit: "KGM" },
  walnut: { name: "Orehi mleti", unit: "KGM" },
  apple: { name: "Jabolka", unit: "KGM",
    note: "Recepti uporabljajo jabolka oziroma naribana jabolka. Pred aktivacijo preverite, ali je količina bruto ali očiščena, in izkoristek." },
  chocolate: { name: "Temna čokolada 64–70 % kakava", unit: "KGM" },
  jam: { name: "Marelična marmelada", unit: "KGM" },
  sourCream: { name: "Kisla smetana", unit: "KGM" },
  starch: { name: "Koruzni škrob", unit: "KGM" },
  puff: { name: "Listnato testo masleno", unit: "KGM" },
  vanillaSugar: { name: "Vaniljev sladkor", unit: "KGM",
    note: "Maso zavitka potrdite po dejanskem pakiranju; recept je ne določa." },
  vanilla: { name: "Vanilja", unit: "KGM",
    note: "Oblika in odmerek v Homanovem receptu nista določena; pred uporabo izberite dejanski izdelek." },
  cinnamon: { name: "Cimet mleti", unit: "KGM" },
  bakingPowder: { name: "Pecilni prašek", unit: "KGM",
    note: "Recept navaja žličko; masa v kg še ni potrjena." },
  water: { name: "Voda za pripravo sladic", unit: "LTR",
    note: "Količina se vodi v litrih. Pri Sacher torti je navedenih 100 g vode; volumen pred vnosom preverite, ne pretvarjajte samodejno." },
};
type Recipe = {
  name: string; portions: number; source: string; origin: string;
  batch: Array<[string, string]>; missing: string; notes?: string;
};
const recipes: Recipe[] = [
  {
    name: "Homanove kremne rezine", portions: 10,
    source: "https://odprtakuhinja.delo.si/triki-in-namigi/kultne-jedi-kremsnite-po-starem-receptu",
    origin: "Objavljen zgodovinski recept Beti Homan; ni originalna receptura Hotela Park.",
    batch: [["milk", "1"], ["flour", "0.120"], ["sugar", "0.180"], ["cream", "0.400"], ["eggs", "6"]],
    missing: "Masa dveh plasti listnatega testa; količine masla, ruma, vanilje in sladkorja za posip; končna masa in cena.",
    notes: "Iz šestih celih jajc se uporabijo šest rumenjakov in štirje beljaki. Normativ odpiše šest jajc; dva preostala beljaka nista dodatna poraba. Nabavnega artikla jajc ne podvajamo.",
  },
  {
    name: "Prekmurska gibanica", portions: 12,
    source: "https://assets.publishing.service.gov.uk/media/665ef480dc15efdddf1a86ca/CELEX_52014XC0904_03__EN_TXT_Prekmurska_gibanica.pdf",
    origin: "Uradna specifikacija izdelka, razdelek 3.6; ni potrjen hišni normativ Rajha.",
    batch: [["flour", "1.100"], ["butter", "0.350"], ["sugar", "0.420"], ["poppy", "0.300"],
      ["curd", "1.200"], ["walnut", "0.300"], ["apple", "1.500"], ["cream", "0.800"],
      ["eggs", "5"], ["water", "0.100"]],
    missing: "Voda za vlečeno testo; masa ene žlice olja oziroma njen volumen; masa šestih zavitkov vaniljevega sladkorja, soli in cimeta; izkoristek jabolk in odrezki testa; končna masa in cena.",
    notes: "Za razvojno osnovo je izbrano maslo, smetanov preliv pa uporablja obstoječo Smetano. Dodatno neobvezno jajce v vlečenem testu ni vključeno. Razdelitev sestavin serije: moka 200 + 900 g; maslo 100 + 250 g; sladkor 100 + 100 + 100 + 120 g. Vsak nadev nastopi dvakrat, količin zato ne podvajamo. Razrez na 12 kosov je izrecna uporabnikova izbira, ne zahteva specifikacije. Za zaščiteno ime preverite dejansko maso kosa: specifikacija omejuje kos na 250 g, pri industrijski proizvodnji na 200 g.",
  },
  {
    name: "Sacher torta", portions: 12,
    source: "https://jernejkitchen.com/recipes/chocolate/sacher-torte",
    origin: "Primerjalni recept Jernej Kitchen za torto premera 20 cm; ne potrjen normativ gostinskega obrata.",
    batch: [["chocolate", "0.300"], ["butter", "0.130"], ["icing", "0.050"],
      ["sugar", "0.200"], ["flour", "0.130"], ["jam", "0.150"], ["eggs", "6"]],
    missing: "Voda za preliv: 100 g (zaloga vode je v litrih, zato še ni vpisana v številčni normativ); sol po postopku; smetana in dekoracija ob postrežbi, če se uporabljata; končna masa in cena.",
    notes: "Biskvit: 160 g čokolade, 130 g masla, 50 g sladkorja v prahu, 100 g sladkorja, 6 jajc in 130 g moke. Marmelada 150 g. Preliv: 140 g čokolade, 100 g sladkorja in 100 g vode.",
  },
  {
    name: "Jabolčna pita s kislo smetano", portions: 12,
    source: "https://glasdezele.si/recept/jabolcna-pita-s-kislo-smetano",
    origin: "Primerjalni recept Glas dežele za pekač premera 20 cm; ne potrjen normativ gostinskega obrata.",
    batch: [["flour", "0.250"], ["butter", "0.090"], ["sugar", "0.120"], ["apple", "0.700"],
      ["sourCream", "0.400"], ["starch", "0.030"], ["eggs", "2"]],
    missing: "Masa ene limone za lupinico in sok (obstoječa zaloga limon je v kg); masa vaniljevega sladkorja in žličke pecilnega praška; sol, morebitni posip; izkoristek jabolk; končna masa in cena.",
    notes: "Sladkor v seriji: 40 g testo + 40 g jabolka + 40 g smetanov nadev. Obe jajci sta porabljeni v celoti: rumenjaka v testu, beljaka v smetanovem nadevu.",
  },
];

async function main() {
  if (!process.argv.includes("--development-only") || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.NODE_ENV === "production") {
    throw new Error("Uvoz je dovoljen le ročno v razvoju z --development-only.");
  }
  const client = await pool.connect();
  const createdRaw: string[] = [];
  const createdDesserts: string[] = [];
  let insertedNorms = 0;
  try {
    await client.query("BEGIN");
    const unit = await client.query(
      "SELECT id FROM enote WHERE id=$1 AND ime=$2 AND company_id=$3 AND aktiven=true FOR UPDATE",
      [UNIT, "Križišče", COMPANY],
    );
    if (unit.rowCount !== 1) throw new Error("Razvojna enota Križišče ni enolično potrjena.");
    const category = await client.query(
      "SELECT id FROM kategorije WHERE enota_id=$1 AND ime=$2", [UNIT, "Sladice"],
    );
    if (category.rowCount !== 1) throw new Error("Kategorija Sladice ni enolična.");
    const ingredientIds = new Map<string, number>();
    for (const [key, spec] of Object.entries(raw)) {
      const found = await client.query(
        "SELECT id,enota_mere,nabavni_artikel,prodajni_artikel,aktiven FROM artikli WHERE enota_id=$1 AND lower(ime)=lower($2) AND nabavni_artikel=true AND prodajni_artikel=false FOR UPDATE",
        [UNIT, spec.name],
      );
      if ((found.rowCount ?? 0) > 1) throw new Error(`Podvojena surovina: ${spec.name}`);
      if (found.rowCount === 1) {
        const a = found.rows[0];
        if (a.enota_mere !== spec.unit || !a.nabavni_artikel || a.prodajni_artikel || !a.aktiven) {
          throw new Error(`Neskladna obstoječa surovina: ${spec.name}; brez samodejnega popravka.`);
        }
        ingredientIds.set(key, a.id);
      } else {
        const a = await client.query(
          `INSERT INTO artikli (enota_id,ime,opis,cena,davek,enota_mere,nabavni_artikel,
             prodajni_artikel,meal_type,vrsta_artikla,tax_category,qr_na_voljo,alergeni_status)
           VALUES ($1,$2,$3,0,9.5,$4,true,false,'ala_carte','material','food',false,'nepreverjeno')
           RETURNING id`,
          [UNIT, spec.name, `Surovina za razvojne osnutke sladic. Nabavna cena in alergeni niso potrjeni. ${spec.note ?? ""}`, spec.unit],
        );
        ingredientIds.set(key, a.rows[0].id);
        createdRaw.push(spec.name);
      }
    }
    for (const r of recipes) {
      const quantities = r.batch.map(([key, quantity], index) => ({
        id: ingredientIds.get(key)!,
        quantity: new Decimal(quantity).div(r.portions).toFixed(4),
        order: index,
      }));
      if (quantities.some(q => !q.id || new Decimal(q.quantity).lte(0))) throw new Error("Neveljaven normativ.");
      const batchText = r.batch.map(([key, quantity]) => `${raw[key]!.name}: ${quantity} ${raw[key]!.unit}`).join("; ");
      const description = `${MARKER}\n${r.origin}\nVir: ${r.source}\n`
        + `Osnova: ${r.portions} kosov. Količine normativa veljajo za EN kos; izplen ni potrjena končna masa.\n`
        + `Znane količine celotne serije: ${batchText}.\n${r.notes ?? ""}\n`
        + `MANJKA / PREVERITI: ${r.missing}\n`
        + "Neaktivno, ni na QR meniju. Cena 0 je tehnična prazna osnova, ne prodajna cena. Alergeni še niso potrjeni. Pred aktivacijo dopolnite celoten normativ, izplen in dejansko prodajno ceno.";
      const existing = await client.query(
        "SELECT id,opis,meal_type,enota_mere,nabavni_artikel,prodajni_artikel,aktiven,qr_na_voljo,cena FROM artikli WHERE enota_id=$1 AND lower(ime)=lower($2) FOR UPDATE",
        [UNIT, r.name],
      );
      if ((existing.rowCount ?? 0) > 1) throw new Error(`Podvojena sladica: ${r.name}`);
      let articleId: number;
      if (existing.rowCount === 1) {
        const a = existing.rows[0];
        if (a.opis !== description || a.meal_type !== "prepared" || a.enota_mere !== "H87"
          || a.nabavni_artikel || !a.prodajni_artikel || a.aktiven || a.qr_na_voljo || Number(a.cena) !== 0) {
          throw new Error(`Obstoječa sladica ${r.name} je drugačna; ni bila prepisana.`);
        }
        articleId = a.id;
        const norms = await client.query(
          "SELECT vhodni_artikel_id,kolicina,vrstni_red FROM normativi WHERE artikel_id=$1 ORDER BY vrstni_red,id",
          [articleId],
        );
        if (norms.rows.length !== quantities.length || norms.rows.some((n, i) =>
          n.vhodni_artikel_id !== quantities[i]!.id || !new Decimal(n.kolicina).eq(quantities[i]!.quantity)
          || n.vrstni_red !== quantities[i]!.order)) {
          throw new Error(`Obstoječi normativ ${r.name} je drugačen; ni bil prepisan.`);
        }
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO artikli (enota_id,ime,opis,cena,davek,aktiven,kategorija_id,enota_mere,
           nabavni_artikel,prodajni_artikel,meal_type,vrsta_artikla,tax_category,qr_na_voljo,
           priprava_vrsta,malica_vloga,alergeni_status)
         VALUES ($1,$2,$3,0,9.5,false,$4,'H87',false,true,'prepared','storitev','food',false,
           'hrana','dessert','nepreverjeno') RETURNING id`,
        [UNIT, r.name, description, category.rows[0].id],
      );
      articleId = inserted.rows[0].id;
      for (const q of quantities) {
        await client.query(
          "INSERT INTO normativi (artikel_id,vhodni_artikel_id,kolicina,vrstni_red) VALUES ($1,$2,$3,$4)",
          [articleId, q.id, q.quantity, q.order],
        );
        insertedNorms++;
      }
      createdDesserts.push(r.name);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ unit: UNIT, createdDesserts, createdRaw, insertedNorms,
      reusedRaw: Object.keys(raw).length - createdRaw.length }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
await main();