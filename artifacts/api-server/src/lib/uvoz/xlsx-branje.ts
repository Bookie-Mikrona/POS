import ExcelJS from 'exceljs';

const OLE_PODPIS = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_PODPIS = Buffer.from([0x50, 0x4b]);

export type XlsxBranjeKoda = 'ZAJ010' | 'ZAJ018';
export type XlsxVrednost = string | number;

/**
 * Opt-in kanal za uvoze, ki morajo ločiti oblikovano besedilo od Excelove
 * nativne vrednosti. Privzeti matrix adapter ostaja izključno besedilen.
 *
 * Pri formulah je `value` shranjeni Excelov rezultat (ne formula). Numerični
 * rezultat formule zato varno pride do Decimal parserja brez lokalizacijskega
 * branja prikazanega besedila.
 */
export interface XlsxTipiziranaCelica {
  text: string;
  type: ExcelJS.ValueType;
  value: ExcelJS.CellValue;
}

export type XlsxTipiziranaMatrika = XlsxTipiziranaCelica[][];

/**
 * Napaka, ki jo pretvorijo uvozni tokovi v svoj odziv oziroma DTO.
 * `naVoljo` je posebej uporaben za profile z napačno nastavljenim listom.
 */
export class XlsxBranjeNapaka extends Error {
  constructor(
    public readonly koda: XlsxBranjeKoda,
    message: string,
    public readonly naVoljo: string[] = [],
  ) {
    super(message);
    this.name = 'XlsxBranjeNapaka';
  }
}

export function jeLegacyXls(raw: Buffer): boolean {
  return raw.length >= OLE_PODPIS.length && raw.subarray(0, OLE_PODPIS.length).equals(OLE_PODPIS);
}

const normalizirajImeLista = (ime: string): string =>
  ime.replace(/[\s_]+/g, '').toLocaleLowerCase('sl');

function izberiList(
  workbook: ExcelJS.Workbook,
  imeLista?: string,
  fallbackIndex?: number,
): ExcelJS.Worksheet {
  const listi = workbook.worksheets;
  const naVoljo = listi.map((list) => list.name);

  if (!listi.length) {
    throw new XlsxBranjeNapaka('ZAJ018', 'Datoteka .xlsx ne vsebuje nobenega lista.');
  }

  if (!imeLista) return listi[fallbackIndex ?? 0]!;

  const tocni = listi.find((list) => list.name === imeLista);
  if (tocni) return tocni;

  const normaliziran = normalizirajImeLista(imeLista);
  const poNormalizaciji = listi.find((list) => normalizirajImeLista(list.name) === normaliziran);
  if (poNormalizaciji) return poNormalizaciji;

  if (fallbackIndex !== undefined && listi[fallbackIndex]) return listi[fallbackIndex]!;

  throw new XlsxBranjeNapaka(
    'ZAJ010',
    `Lista "${imeLista}" ni v datoteki. Na voljo: ${naVoljo.join(', ') || 'brez listov'}.`,
    naVoljo,
  );
}

function dvomestno(vrednost: number): string {
  return String(vrednost).padStart(2, '0');
}

/**
 * ExcelJS za Date brez lastnega formatterja vrne Date#toString(), SheetJS
 * raw:false pa privzeto uporabi Excelov format. Za pogoste oblike ohranimo
 * SheetJS-ov prikaz; preostale celice ostanejo točno `cell.text`.
 */
function formatirajDatumKotSheetJs(datum: Date, numFmt?: string): string {
  const leto = datum.getUTCFullYear();
  const mesec = datum.getUTCMonth() + 1;
  const dan = datum.getUTCDate();
  const format = (numFmt ?? '').toLowerCase().replace(/\./g, '').trim();

  if (format === 'yyyy-mm-dd') return `${leto}-${dvomestno(mesec)}-${dvomestno(dan)}`;
  if (format === 'ddmmmyyyy' || format === 'ddmmyyyy') return `${dvomestno(dan)}.${dvomestno(mesec)}.${leto}`;
  if (/^m{1,2}[-/]d{1,2}[-/]y{2}$/.test(format)) return `${mesec}/${dan}/${String(leto).slice(-2)}`;
  if (/^m{1,2}[-/]d{1,2}[-/]y{4}$/.test(format)) return `${mesec}/${dan}/${leto}`;

  // Excelov privzeti datum (numFmt 14) je pri SheetJS raw:false m/d/yy.
  return `${mesec}/${dan}/${String(leto).slice(-2)}`;
}

function besediloCelice(celica: ExcelJS.Cell): string {
  const vrednost = celica.value;
  if (vrednost instanceof Date) return formatirajDatumKotSheetJs(vrednost, celica.numFmt);

  if (
    vrednost
    && typeof vrednost === 'object'
    && 'result' in vrednost
    && vrednost.result instanceof Date
  ) {
    return formatirajDatumKotSheetJs(vrednost.result, celica.numFmt);
  }

  // Formula tu uporabi shranjeni result; ExcelJS je nikoli ne računa.
  return celica.text ?? '';
}

function tipizirajCelico(celica: ExcelJS.Cell): XlsxTipiziranaCelica {
  const text = besediloCelice(celica);
  const vrednost = celica.value;

  // Formula tu uporabi izključno cached rezultat. Formula brez rezultata ne
  // postane številka in varno ostane na text fallbacku.
  if (vrednost && typeof vrednost === 'object' && 'result' in vrednost) {
    const rezultat = vrednost.result;
    if (typeof rezultat === 'number' && Number.isFinite(rezultat)) {
      return { text, type: ExcelJS.ValueType.Number, value: rezultat };
    }
    if (rezultat instanceof Date) {
      return { text, type: ExcelJS.ValueType.Date, value: rezultat };
    }
    if (rezultat !== undefined && rezultat !== null) {
      return { text, type: celica.type, value: rezultat as ExcelJS.CellValue };
    }
    return { text, type: celica.type, value: text };
  }

  return { text, type: celica.type, value: vrednost ?? null };
}

async function naloziXlsx(raw: Buffer): Promise<ExcelJS.Workbook> {
  if (jeLegacyXls(raw)) {
    throw new XlsxBranjeNapaka(
      'ZAJ018',
      'Format .xls ni podprt — shranite datoteko kot .xlsx.',
    );
  }

  if (!raw.subarray(0, ZIP_PODPIS.length).equals(ZIP_PODPIS)) {
    throw new XlsxBranjeNapaka('ZAJ018', 'Datoteka ni veljaven .xlsx dokument.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS 4.4 deklarira Buffer<ArrayBuffer>, Multer/Node 24 pa poda
    // Buffer<ArrayBufferLike>. Kopija v nov ArrayBuffer odpravi tipovno
    // razliko brez spreminjanja bajtov datoteke.
    const excelBuffer = Buffer.from(new Uint8Array(raw).buffer);
    await workbook.xlsx.load(
      excelBuffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );
  } catch {
    throw new XlsxBranjeNapaka('ZAJ018', 'Datoteke .xlsx ni bilo mogoče prebrati.');
  }
  return workbook;
}

/**
 * ExcelJS ekvivalent:
 * sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true })
 *
 * `fallbackIndex` je namenjen večlistnim uvozom, ki ga izrecno želijo.
 * Header-matrix tokovi ga ne podajo, zato napačno konfiguriran list vedno
 * vrne ZAJ010 in se ne more tiho preseliti na prvi list.
 */
export async function preberiXlsxMatriko(
  raw: Buffer,
  imeLista?: string,
  fallbackIndex?: number,
): Promise<string[][]> {
  const list = izberiList(await naloziXlsx(raw), imeLista, fallbackIndex);
  const vrstic = list.rowCount;
  const stolpcev = list.columnCount;

  return Array.from({ length: vrstic }, (_neuporabljeno, vrsticaIdx) =>
    Array.from({ length: stolpcev }, (_tudiNeuporabljeno, stolpecIdx) =>
      besediloCelice(list.getCell(vrsticaIdx + 1, stolpecIdx + 1)),
    ),
  );
}

/**
 * Typed različica XLSX adapterja. Ne spremeni obstoječega `raw:false`
 * besedilnega toka; porabnik mora izrecno izbrati nativne številke.
 */
export async function preberiXlsxTipizirano(
  raw: Buffer,
  imeLista?: string,
  fallbackIndex?: number,
): Promise<XlsxTipiziranaMatrika> {
  const list = izberiList(await naloziXlsx(raw), imeLista, fallbackIndex);
  const vrstic = list.rowCount;
  const stolpcev = list.columnCount;

  return Array.from({ length: vrstic }, (_neuporabljeno, vrsticaIdx) =>
    Array.from({ length: stolpcev }, (_tudiNeuporabljeno, stolpecIdx) =>
      tipizirajCelico(list.getCell(vrsticaIdx + 1, stolpecIdx + 1)),
    ),
  );
}

/**
 * Iz typed matrike izbere native številko samo v eksplicitno dovoljenih
 * stolpcih. Vsi drugi stolpci vedno obdržijo oblikovano besedilo.
 */
export function xlsxMatrikaZaStevilskeStolpce(
  matrika: XlsxTipiziranaMatrika,
  stevilskiStolpci: Iterable<number>,
): XlsxVrednost[][] {
  const stolpci = new Set(stevilskiStolpci);
  return matrika.map((vrstica) =>
    vrstica.map((celica, indeks) =>
      stolpci.has(indeks) && typeof celica.value === 'number' && Number.isFinite(celica.value)
        ? celica.value
        : celica.text,
    ),
  );
}

/**
 * Object-mode pretvorba za tokove, ki izrecno dovolijo native številke v
 * posameznih podatkovnih stolpcih. Besedilni object-mode ostaja spodaj.
 */
export function matrikaVObjekteZVrednostmi(
  matrika: XlsxVrednost[][],
): Record<string, XlsxVrednost>[] {
  const [glava = [], ...podatki] = matrika;
  const uporabljeniKljuči = new Map<string, number>();

  const kljuci = glava.map((celica) => {
    const osnovni = String(celica ?? '') || '__EMPTY';
    const ponovitve = uporabljeniKljuči.get(osnovni) ?? 0;
    uporabljeniKljuči.set(osnovni, ponovitve + 1);
    return ponovitve === 0 ? osnovni : `${osnovni}_${ponovitve}`;
  });

  return podatki
    .filter((vrstica) => vrstica.some((celica) => String(celica) !== ''))
    .map((vrstica) =>
      Object.fromEntries(kljuci.map((kljuc, indeks) => [kljuc, vrstica[indeks] ?? ''])),
    );
}

/**
 * Ekvivalent SheetJS:
 * sheet_to_json(ws, { defval: '' })
 *
 * Glava je prva vrstica matrike, podatkovne vrstice pa se preslikajo v
 * objekte. Ker SheetJS pri object-mode privzeto preskoči popolnoma prazne
 * vrstice, to naredimo tudi tu. Ključi `__EMPTY` posnemajo SheetJS za prazne
 * ali podvojene glave.
 */
export function matrikaVObjekte(matrika: string[][]): Record<string, string>[] {
  return matrikaVObjekteZVrednostmi(matrika).map((vrstica) =>
    Object.fromEntries(
      Object.entries(vrstica).map(([kljuc, vrednost]) => [kljuc, String(vrednost)]),
    ),
  );
}

/**
 * ExcelJS ekvivalent SheetJS object-mode branja:
 * sheet_to_json(ws, { defval: '' })
 *
 * Namenoma gradi na `preberiXlsxMatriko`, zato so izbira lista, legacy .xls
 * zavrnitev, datumi in `raw:false` oblikovano besedilo enotni za vse uvoze.
 */
export async function preberiXlsxObjekte(
  raw: Buffer,
  imeLista?: string,
  fallbackIndex?: number,
): Promise<Record<string, string>[]> {
  return matrikaVObjekte(await preberiXlsxMatriko(raw, imeLista, fallbackIndex));
}