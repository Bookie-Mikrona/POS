import { eq, sql } from "drizzle-orm";
import { artikliTable } from "@workspace/db";

export type DrobniInventarSkupina = {
  id: "01" | "02" | "03" | "04" | "05" | "06" | "07";
  naziv: string;
  artikli: Array<{ kljuc: string; ime: string; opis?: string }>;
};

/** Predloge so šifrantski artikli; količine in vrednotenja se določijo ločeno. */
export const DROBNI_INVENTAR_KATALOG: DrobniInventarSkupina[] = [
  {
    id: "01",
    naziv: "01 Steklovina",
    artikli: [
      { kljuc: "01-pivski-vrcek-050", ime: "Pivski vrček/krigel 0,5 L" },
      { kljuc: "01-pivski-vrcek-030", ime: "Pivski vrček/krigel 0,3 L" },
      { kljuc: "01-specialno-pivo-pecelj", ime: "Kozarec na peclju za specialno pivo" },
      { kljuc: "01-stekleni-vrcek-toceno-pivo", ime: "Stekleni vrček za točeno pivo" },
      { kljuc: "01-vino-belo-010", ime: "Kozarec za belo vino 0,1 L" },
      { kljuc: "01-vino-belo-020", ime: "Kozarec za belo vino 0,2 L" },
      { kljuc: "01-vino-pecelj-025-035", ime: "Pecljati kozarec za vino 2,5–3,5 dl" },
      { kljuc: "01-vino-rdece-velik", ime: "Velik pecljati kozarec za rdeče vino" },
      { kljuc: "01-penina-flavta", ime: "Kozarec za penino – flavta" },
      { kljuc: "01-vinogradniski-vrcek-025", ime: "Vinogradniški vrček/karafa 0,25 L" },
      { kljuc: "01-vinogradniski-vrcek-050", ime: "Vinogradniški vrček/karafa 0,5 L" },
      { kljuc: "01-vinogradniski-vrcek-100", ime: "Vinogradniški vrček/karafa 1 L" },
      { kljuc: "01-silce-003", ime: "Kozarec za kratke pijače/šilce 0,03 L" },
      { kljuc: "01-silce-005", ime: "Kozarec za kratke pijače/šilce 0,05 L" },
      { kljuc: "01-viski-rock", ime: "Kozarec za viski – rock/tumbler" },
      { kljuc: "01-pecelj-zganje-gt", ime: "Pecljati kozarec za žganje ali gin-tonik" },
      { kljuc: "01-visok-sok-voda-020", ime: "Visok kozarec za sok/vodo 0,2 L" },
      { kljuc: "01-visok-sok-voda-030", ime: "Visok kozarec za sok/vodo 0,3 L" },
      { kljuc: "01-kozarec-voda", ime: "Kozarec za vodo" },
      { kljuc: "01-vrc-voda-100", ime: "Vrč za vodo/retek 1 L" },
      { kljuc: "01-espresso-skodelica-podstavek", ime: "Skodelica za espresso s podstavkom" },
      { kljuc: "01-skodelica-podaljsana-kava-kapucino", ime: "Skodelica za podaljšano kavo/kapučino" },
      { kljuc: "01-skodelica-caj-kakav", ime: "Skodelica za čaj/kakav" },
      { kljuc: "01-stekleni-topli-napitki", ime: "Stekleni kozarec za kuhano vino/čaj" },
    ],
  },
  {
    id: "02",
    naziv: "02 Porcelan/strežna posoda",
    artikli: [
      { kljuc: "02-kroznik-plitvi-glavni", ime: "Plitvi krožnik – velik za glavne jedi" },
      { kljuc: "02-kroznik-globoki", ime: "Globoki krožnik za juhe/testenine" },
      { kljuc: "02-kroznik-desertni", ime: "Desertni krožnik" },
      { kljuc: "02-kroznik-kruh", ime: "Krožniček za kruh" },
      { kljuc: "02-skledica-solata-mala", ime: "Skledica za solato – manjša" },
      { kljuc: "02-skledica-solata-velika", ime: "Skleda za solato – večja" },
      { kljuc: "02-jusna-skodelica", ime: "Jušna skodelica" },
      { kljuc: "02-posodica-omaka", ime: "Posodica za omako/omačnica" },
      { kljuc: "02-deska-lesena-narezek-zar", ime: "Lesena servirna deska za narezek/žar" },
      { kljuc: "02-deska-kamnita-narezek-zar", ime: "Kamnita servirna deska za narezek/žar" },
      { kljuc: "02-pladenj-ovalni-strezni", ime: "Ovalni strežni pladenj" },
      { kljuc: "02-pladenj-kovinski-natakar", ime: "Kovinski pladenj za natakarje" },
    ],
  },
  {
    id: "03",
    naziv: "03 Jedilni pribor/namizni dodatki",
    artikli: [
      { kljuc: "03-vilice-velike", ime: "Velike jedilne vilice" },
      { kljuc: "03-noz-veliki", ime: "Veliki jedilni nož" },
      { kljuc: "03-zlica-velika", ime: "Velika jedilna žlica" },
      { kljuc: "03-vilice-desertne", ime: "Desertne vilice" },
      { kljuc: "03-zlicka-kava-caj", ime: "Mala žlička za kavo/čaj" },
      { kljuc: "03-zlicka-dolga-sladoled", ime: "Dolga žlička za sladoled/ledeno kavo" },
      { kljuc: "03-noz-steak", ime: "Steak nož za meso" },
      { kljuc: "03-pribor-ribe-vilice", ime: "Vilice za ribe" },
      { kljuc: "03-pribor-ribe-noz", ime: "Nož za ribe" },
      { kljuc: "03-solnica", ime: "Solnica" },
      { kljuc: "03-poprovnica", ime: "Poprovnica" },
      { kljuc: "03-dozator-olje", ime: "Dozator za olje" },
      { kljuc: "03-dozator-kis", ime: "Dozator za kis" },
      { kljuc: "03-stojalo-serviete", ime: "Stojalo za serviete" },
      { kljuc: "03-stevilka-mize", ime: "Številka za mizo" },
      { kljuc: "03-pepelnik-zunanja-terasa", ime: "Pepelnik za zunanjo teraso" },
      { kljuc: "03-menazka", ime: "Menažka" },
    ],
  },
  {
    id: "04",
    naziv: "04 Kuhinjska posoda & GN",
    artikli: [
      { kljuc: "04-inoks-lonec-10l", ime: "Inoks lonec velike kapacitete 10 L" },
      { kljuc: "04-inoks-lonec-20l", ime: "Inoks lonec velike kapacitete 20 L" },
      { kljuc: "04-inoks-lonec-30l", ime: "Inoks lonec velike kapacitete 30 L" },
      { kljuc: "04-inoks-lonec-50l", ime: "Inoks lonec velike kapacitete 50 L" },
      { kljuc: "04-kozica-omake", ime: "Nizka kozica za omake" },
      { kljuc: "04-ponva-inoks", ime: "Inoks ponev za pečenje" },
      { kljuc: "04-ponva-litozelezna", ime: "Litoželezna ponev za pečenje" },
      { kljuc: "04-ponva-palacinke", ime: "Ponev za palačinke" },
      ...(["1/1", "1/2", "1/3", "1/6"] as const).flatMap((size) =>
        (["inoks", "polikarbonat"] as const).flatMap((material) =>
          (["65 mm", "100 mm", "150 mm", "200 mm"] as const).flatMap((depth) => [
            { kljuc: `04-gn-${size.replace("/", "-")}-${material}-${depth.replace(" ", "")}`, ime: `GN ${size} ${material} posoda, globina ${depth}` },
            { kljuc: `04-gn-${size.replace("/", "-")}-${material}-${depth.replace(" ", "")}-pokrov`, ime: `Pokrov za GN ${size} ${material} posodo, globina ${depth}` },
          ]),
        ),
      ),
      { kljuc: "04-pekac-gn-1-1-polni", ime: "Polni pekač za konvektomat GN 1/1" },
      { kljuc: "04-pekac-gn-1-1-perforirani", ime: "Perforirani pekač za konvektomat GN 1/1" },
      { kljuc: "04-pekac-gn-1-2-polni", ime: "Polni pekač za konvektomat GN 1/2" },
      { kljuc: "04-pekac-gn-1-2-perforirani", ime: "Perforirani pekač za konvektomat GN 1/2" },
      { kljuc: "04-resetka-hlajenje", ime: "Rešetka za hlajenje" },
    ],
  },
  {
    id: "05",
    naziv: "05 Kuhinjska orodja",
    artikli: [
      { kljuc: "05-noz-kuharski-sefovski", ime: "Kuharski/šefovski nož" },
      { kljuc: "05-noz-izkoscenje", ime: "Nož za izkoščanje" },
      { kljuc: "05-noz-kruh", ime: "Nož za kruh" },
      { kljuc: "05-noz-zelenjava", ime: "Nož za zelenjavo" },
      { kljuc: "05-noz-sekanje-mesa", ime: "Masivni nož za sekanje mesa" },
      { kljuc: "05-jeklo-brušenje-nozev", ime: "Jeklo za brušenje nožev" },
      { kljuc: "05-brusni-kamen", ime: "Brusni kamen za nože" },
      { kljuc: "05-deska-rdeca-surovo-meso", ime: "HACCP deska rdeča – surovo meso" },
      { kljuc: "05-deska-modra-ribe", ime: "HACCP deska modra – ribe" },
      { kljuc: "05-deska-zelena-zelenjava", ime: "HACCP deska zelena – zelenjava" },
      { kljuc: "05-deska-bela-mlecno-kruh", ime: "HACCP deska bela – mlečni izdelki/kruh" },
      ...(["0,1 L", "0,2 L", "0,3 L", "0,5 L"] as const).map((capacity) => ({
        kljuc: `05-zajemalka-${capacity.replace(",", "").replace(" ", "")}`,
        ime: `Kuhinjska zajemalka ${capacity}`,
      })),
      { kljuc: "05-penovka", ime: "Penovka" },
      { kljuc: "05-kuhinjske-klesce", ime: "Kuhinjske klešče" },
      { kljuc: "05-metlica-stepanje", ime: "Metlica za stepanje" },
      { kljuc: "05-strgalnik", ime: "Kuhinjski strgalnik" },
      { kljuc: "05-tlacilec-krompir", ime: "Tlačilec za krompir" },
      { kljuc: "05-kuhalnica", ime: "Kuhalnica" },
      { kljuc: "05-zajemalka-sladoled", ime: "Zajemalka za sladoled" },
    ],
  },
  {
    id: "06",
    naziv: "06 Šank",
    artikli: [
      { kljuc: "06-rocka-kavni-aparat", ime: "Ročka za kavni aparat" },
      { kljuc: "06-tamper", ime: "Tamper/tlačilnik za kavo" },
      { kljuc: "06-podloga-tamper", ime: "Podloga za tamper" },
      { kljuc: "06-vrcek-penjenje-mleka-035", ime: "Latte art vrček za penjenje mleka 0,35 L" },
      { kljuc: "06-vrcek-penjenje-mleka-060", ime: "Latte art vrček za penjenje mleka 0,6 L" },
      { kljuc: "06-vrcek-penjenje-mleka-100", ime: "Latte art vrček za penjenje mleka 1 L" },
      { kljuc: "06-knock-box", ime: "Posoda za iztepanje kavne usedline (knock-box)" },
      { kljuc: "06-scetka-glava-kavni-aparat", ime: "Ščetka za čiščenje glave kavnega aparata" },
      { kljuc: "06-dozator-zganje-003", ime: "Dozirnik za žgane pijače 0,03 L" },
      { kljuc: "06-dozator-zganje-005", ime: "Dozirnik za žgane pijače 0,05 L" },
      { kljuc: "06-jigger", ime: "Merica za koktajle (jigger)" },
      { kljuc: "06-sejker", ime: "Šejker za koktajle" },
      { kljuc: "06-strainer", ime: "Cedilo za koktajle (strainer)" },
      { kljuc: "06-odpiralec-steklenice-kronski-zamaski", ime: "Odpirač za steklenice/kronske zamaške" },
      { kljuc: "06-natakar-odpiralec-vina", ime: "Profesionalni natakarski odpirač za vino (krivček)" },
      { kljuc: "06-odpiralec-konzerv-sodov", ime: "Odpirač za konzerve/sode" },
      { kljuc: "06-odcejalna-podloga", ime: "Gumijasta/plastična odcejalna podloga za kozarce" },
      { kljuc: "06-krtaca-pomivanje-kozarcev", ime: "Krtača za pomivanje kozarcev v koritu" },
      { kljuc: "06-kosara-pomivalni-kozarci", ime: "Košara za pomivalni stroj – kozarci" },
      { kljuc: "06-kosara-pomivalni-skodelice", ime: "Košara za pomivalni stroj – skodelice" },
    ],
  },
  {
    id: "07",
    naziv: "07 Tekstil & Ostalo",
    artikli: [
      { kljuc: "07-namizni-prt", ime: "Namizni prt" },
      { kljuc: "07-nadprt-tekac", ime: "Nadprt/namizni tekač" },
      { kljuc: "07-servirni-serviet-natakar", ime: "Servirni serviet za natakarje (audjuto)" },
      { kljuc: "07-kuhinjska-krpa", ime: "Kuhinjska krpa" },
      { kljuc: "07-krpa-mikrovlakna-poliranje", ime: "Mikrovlakenska krpa za poliranje kozarcev in pribora" },
      { kljuc: "07-natakarska-denarnica", ime: "Natakarska denarnica (taksa)" },
      { kljuc: "07-usnjena-natakarska-torbica", ime: "Usnjena natakarska torbica" },
      { kljuc: "07-stojalo-jedilni-listi", ime: "Stojalo za jedilne liste" },
    ],
  },
];

/** Predlogi OS so namenoma ločeni in jih uvoz nikoli ne ustvari kot artikle. */
export const OS_PREDLOGI = [
  { kljuc: "os-gostinske-mize", ime: "Gostinske mize – notranje in zunanje/terasne", razlog: "Pohištvo oziroma večje sredstvo; predlagana ločena presoja osnovnih sredstev." },
  { kljuc: "os-barske-mize", ime: "Visoke barske mize", razlog: "Pohištvo oziroma večje sredstvo; ni drobni inventar POS šifranta." },
  { kljuc: "os-gostinski-stoli", ime: "Gostinski stoli", razlog: "Pohištvo oziroma večje sredstvo; predlagana ločena presoja osnovnih sredstev." },
  { kljuc: "os-barski-stoli", ime: "Barski stoli", razlog: "Pohištvo oziroma večje sredstvo; predlagana ločena presoja osnovnih sredstev." },
  { kljuc: "os-otroski-stolcki", ime: "Otroški stolčki za hranjenje", razlog: "Večja oprema; ločena presoja osnovnih sredstev." },
  { kljuc: "os-posrezni-vozicki", ime: "Vozički za serviranje/pospravljanje posode", razlog: "Premična večja oprema; ločena presoja osnovnih sredstev." },
  { kljuc: "os-pos-terminali", ime: "Prenosni POS terminali", razlog: "Elektronska oprema; ločena presoja osnovnih sredstev." },
  { kljuc: "os-mobilne-blagajne", ime: "Mobilne blagajne/orderman naprave", razlog: "Elektronska oprema; ločena presoja osnovnih sredstev." },
  { kljuc: "os-konvektomat", ime: "Profesionalni konvektomat/pečica", razlog: "Velik kuhinjski stroj; osnovno sredstvo." },
  { kljuc: "os-profesionalni-pomivalni-stroj", ime: "Profesionalni pomivalni stroj", razlog: "Velik kuhinjski stroj; osnovno sredstvo." },
  { kljuc: "os-kuhinjski-hladilnik", ime: "Profesionalni kuhinjski hladilnik", razlog: "Velik kuhinjski stroj; osnovno sredstvo." },
  { kljuc: "os-kuhinjski-zamrzovalnik", ime: "Profesionalni kuhinjski zamrzovalnik", razlog: "Velik kuhinjski stroj; osnovno sredstvo." },
  { kljuc: "os-kavni-aparat", ime: "Profesionalni kavni aparat", razlog: "Večja šank oprema; ločena presoja osnovnih sredstev." },
  { kljuc: "os-aparat-za-led", ime: "Aparat za led", razlog: "Večja šank/kuhinjska oprema; ločena presoja osnovnih sredstev." },
] as const;

export function normalizirajImeDrobnegaInventarja(ime: string): string {
  return ime.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("sl")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

export function vsiDrobniInventarPredlogi() {
  return DROBNI_INVENTAR_KATALOG.flatMap((skupina) =>
    skupina.artikli.map((artikel) => ({
      ...artikel,
      skupinaId: skupina.id,
      skupina: skupina.naziv,
    })),
  );
}

/** Seed atomaren za ustvarjanje enote in varen za ponovne/simultane uvoze. */
export async function uvoziDrobniInventar(tx: any, enotaId: number): Promise<{ insertedCount: number; skippedCount: number }> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(1315924558::integer, ${enotaId}::integer)
  `);

  const existing = await tx.select({
    ime: artikliTable.ime,
    kljuc: artikliTable.drobniInventarPredlogaKljuc,
  }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
  const keys = new Set(existing.map((article: { kljuc: string | null }) => article.kljuc).filter(Boolean));
  const names = new Set(existing.map((article: { ime: string }) => normalizirajImeDrobnegaInventarja(article.ime)));
  const toInsert = vsiDrobniInventarPredlogi().filter((article) =>
    !keys.has(article.kljuc) && !names.has(normalizirajImeDrobnegaInventarja(article.ime)),
  );

  const inserted = toInsert.length
    ? await tx.insert(artikliTable).values(toInsert.map((article) => ({
      enotaId,
      ime: article.ime,
      opis: article.opis ?? null,
      cena: "0",
      davek: "0",
      aktiven: true,
      nabavniArtikel: true,
      prodajniArtikel: false,
      povratnaEmbalaza: false,
      drobniInventar: true,
      vrstaArtikla: "material",
      cenaMala: null,
      cenaDruzinska: null,
      happyHourCena: null,
      happyHourCenaMala: null,
      happyHourCenaDruzinska: null,
      enotaMere: "kos",
      skupina: article.skupina,
      drobniInventarPredlogaKljuc: article.kljuc,
    }))).onConflictDoNothing().returning({ id: artikliTable.id })
    : [];
  return {
    insertedCount: inserted.length,
    skippedCount: vsiDrobniInventarPredlogi().length - inserted.length,
  };
}

export async function importirajDrobniInventar(db: any, enotaId: number) {
  return db.transaction((tx: any) => uvoziDrobniInventar(tx, enotaId));
}